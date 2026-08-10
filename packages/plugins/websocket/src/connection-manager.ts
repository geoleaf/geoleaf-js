/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * connection-manager.ts — Connection lifecycle, reconnection, and backoff.
 *
 * Implements the 5-state machine:
 *   DISCONNECTED → CONNECTING → CONNECTED
 *   CONNECTED → DISCONNECTED → RECONNECTING → CONNECTED
 *   RECONNECTING → FAILED (when maxRetries > 0 and all attempts exhausted)
 *
 * After successful reconnection:
 *   1. ChannelManager.resubscribeAll() — re-activates all channel handlers.
 *   2. SendQueue.flush() → transport.send() — delivers queued messages in order.
 *
 * backoff formula: delay = min(initialDelayMs × 2^(attempt-1), maxDelayMs)
 * maxRetries: 0 = infinite retries (suitable for offline-first PWAs).
 */

import type { IWsTransport, WsError, TransportState } from "./transports/i-ws-transport.js";
import type { ResolvedWsConfig } from "./config.js";
import type { ChannelManager } from "./channel-manager.js";
import type { SendQueue } from "./send-queue.js";
import type { MetricsCollector } from "./metrics-collector.js";
import type { HeartbeatManager } from "./heartbeat-manager.js";
import {
    emitConnected,
    emitDisconnected,
    emitFailed,
    emitReconnecting,
    emitAuthRequired,
    emitMetricsUpdated,
} from "./event-bus-bridge.js";

/**
 * Owns the connection lifecycle: the five-state machine, reconnection and backoff.
 *
 * DISCONNECTED → CONNECTING → CONNECTED, plus the reconnecting and closed states. Backoff
 * grows between attempts so a server that is down is not hammered; a deliberate close leaves
 * the machine in a terminal state rather than retrying.
 */
export class ConnectionManager {
    private _transport: IWsTransport | null = null;
    private _config: ResolvedWsConfig | null = null;
    private _channelManager: ChannelManager | null = null;
    private _sendQueue: SendQueue | null = null;
    private _metrics: MetricsCollector | null = null;
    private _heartbeat: HeartbeatManager | null = null;

    private _state: TransportState = "disconnected";
    private _attempt = 0;
    private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _destroyed = false;
    /** True when the current connect() call is a reconnect attempt (not the initial connect). */
    private _isReconnect = false;

    /** Current connection state. */
    get state(): TransportState {
        return this._state;
    }

    /**
     * Attach all required collaborators.
     * Must be called before connect().
     */
    attach(
        transport: IWsTransport,
        config: ResolvedWsConfig,
        channelManager: ChannelManager,
        sendQueue: SendQueue,
        metrics: MetricsCollector,
        heartbeat: HeartbeatManager
    ): void {
        this._transport = transport;
        this._config = config;
        this._channelManager = channelManager;
        this._sendQueue = sendQueue;
        this._metrics = metrics;
        this._heartbeat = heartbeat;
        this._destroyed = false;

        // Wire transport callbacks
        transport.onConnected = () => this._onConnected();
        transport.onDisconnected = (reason) => this._onDisconnected(reason);
        transport.onError = (err) => this._onError(err);
    }

    /**
     * Initiate the connection.
     * No-op if already connected or connecting.
     */
    async connect(): Promise<void> {
        if (!this._transport || !this._config) return;
        if (this._state === "connected" || this._state === "connecting") return;

        this._setState("connecting");
        try {
            await this._transport.connect({
                url: this._config.url,
                ...(this._config.auth !== undefined && { auth: this._config.auth }),
            });
        } catch (_err) {
            // Transport rejected — error will be routed via onError callback.
            // Guard: if onError was not called (e.g. transport threw synchronously),
            // fall back to scheduling a reconnect. Cast to bypass TS control-flow narrowing
            // across the async boundary — the runtime check is valid.
            if ((this._state as string) === "connecting") {
                this._setState("disconnected");
                this._scheduleReconnect();
            }
        }
    }

    /**
     * Force a reconnection. Resets the retry counter.
     * No-op if already connected or connecting.
     */
    reconnect(): void {
        if (this._state === "connected" || this._state === "connecting") return;
        this._attempt = 0;
        this._isReconnect = true;
        this._clearReconnectTimer();
        void this.connect();
    }

    /**
     * Disconnect gracefully and stop all reconnect timers.
     */
    disconnect(reason = "manual"): void {
        this._clearReconnectTimer();
        this._heartbeat?.stop();
        this._transport?.disconnect(reason);
        this._setState("disconnected");
    }

    /**
     * Tear down completely — clears all state.
     */
    destroy(): void {
        this._destroyed = true;
        this._clearReconnectTimer();
        this._heartbeat?.detach();
        this._transport?.disconnect("plugin-destroyed");
        this._channelManager?.clear();
        this._sendQueue?.clear();
        this._setState("disconnected");
        this._transport = null;
        this._config = null;
    }

    // ─── Transport callbacks ───────────────────────────────────────────────────

    private _onConnected(): void {
        if (this._destroyed) return;

        const wasReconnect = this._isReconnect;
        this._attempt = 0;
        this._isReconnect = false;
        this._setState("connected");

        this._metrics?.touchConnected();
        if (wasReconnect) {
            this._metrics?.touchReconnect();
        }

        // Re-subscribe channels after reconnection
        this._channelManager?.resubscribeAll();

        // Flush send queue
        if (this._sendQueue) {
            const queued = this._sendQueue.flush();
            for (const msg of queued) {
                try {
                    this._transport!.send(msg.channel, msg.payload);
                    this._metrics?.touchMessageSent();
                } catch {
                    // Failed to flush — discard silently (transport just reconnected)
                }
            }
        }

        // Update metrics snapshot
        this._updateMetrics();

        emitConnected({
            transport: this._config?.transport ?? "native-ws",
            channels: this._channelManager?.getSubscriptions() ?? [],
        });

        // Start heartbeat
        this._heartbeat?.start();
    }

    private _onDisconnected(reason: string): void {
        if (this._destroyed) return;
        if (this._state === "disconnected" || this._state === "failed") return;

        this._heartbeat?.stop();
        emitDisconnected({ transport: this._config?.transport ?? "native-ws", reason });

        this._setState("disconnected");
        this._scheduleReconnect();
    }

    private _onError(err: WsError): void {
        if (this._destroyed) return;

        this._heartbeat?.stop();

        // Auth errors → immediate FAILED, no retry
        if (err.code === "AUTH_FAILED" || err.code === "AUTH_EXPIRED") {
            this._clearReconnectTimer();
            this._setState("failed");
            emitAuthRequired({ transport: err.transport });
            emitFailed({ transport: err.transport, error: err });
            return;
        }

        // Other errors — let reconnect logic handle
        this._setState("disconnected");
        this._scheduleReconnect();
    }

    // ─── Reconnect backoff ─────────────────────────────────────────────────────

    private _scheduleReconnect(): void {
        if (!this._config || this._destroyed) return;

        const { maxRetries, initialDelayMs, maxDelayMs } = this._config.reconnect;

        // maxRetries > 0 and exceeded → FAILED
        if (maxRetries > 0 && this._attempt >= maxRetries) {
            this._setState("failed");
            const transportName = this._config?.transport ?? "native-ws";
            const error: WsError = {
                code: "MAX_RETRIES_EXCEEDED",
                message: `WebSocket reconnection failed after ${maxRetries} attempts.`,
                transport: transportName,
                attempt: this._attempt,
            };
            emitFailed({ transport: transportName, error });
            return;
        }

        this._attempt++;
        const delay = Math.min(initialDelayMs * Math.pow(2, this._attempt - 1), maxDelayMs);

        this._setState("reconnecting");
        emitReconnecting({ attempt: this._attempt, nextDelayMs: delay });

        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._isReconnect = true;
            void this.connect();
        }, delay);
    }

    private _clearReconnectTimer(): void {
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    // ─── State helpers ─────────────────────────────────────────────────────────

    private _setState(state: TransportState): void {
        this._state = state;
        this._updateMetrics();
    }

    private _updateMetrics(): void {
        if (!this._metrics) return;
        const channels = this._channelManager?.getSubscriptions() ?? [];
        const queueLength = this._sendQueue?.length ?? 0;
        this._metrics.setActiveChannels(channels);
        this._metrics.setQueueLength(queueLength);
        emitMetricsUpdated(this._metrics.getSnapshot());
    }
}
