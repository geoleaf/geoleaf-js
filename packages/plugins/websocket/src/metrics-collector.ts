/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * metrics-collector.ts — Connection and message metrics for GeoLeaf.Ws.
 *
 * Maintains internal mutable state and exposes immutable snapshots via getSnapshot().
 * WsMetrics is defined in i-ws-transport.ts and re-exported here for convenience.
 */

import type { WsMetrics } from "./transports/i-ws-transport.js";

/**
 * Counts connections and messages, and hands out immutable snapshots.
 *
 * State is mutable internally but never exposed: `getSnapshot()` returns a copy, so a caller
 * holding a snapshot sees a fixed instant rather than a value that drifts under it.
 */
export class MetricsCollector {
    private _connectedAt: string | null = null;
    private _reconnectCount = 0;
    private _messagesSent = 0;
    private _messagesReceived = 0;
    private _lastPingMs: number | null = null;
    private _activeChannels: string[] = [];
    private _queueLength = 0;

    /** Record a successful connection. */
    touchConnected(): void {
        this._connectedAt = new Date().toISOString();
    }

    /** Increment reconnect counter. */
    touchReconnect(): void {
        this._reconnectCount++;
    }

    /** Increment sent messages counter. */
    touchMessageSent(): void {
        this._messagesSent++;
    }

    /** Increment received messages counter. */
    touchMessageReceived(): void {
        this._messagesReceived++;
    }

    /** Record the last round-trip ping latency in ms. */
    touchPingMs(ms: number): void {
        this._lastPingMs = ms;
    }

    /** Update the active channel list (snapshot of current subscriptions). */
    setActiveChannels(channels: string[]): void {
        this._activeChannels = channels.slice();
    }

    /** Update the current send queue length. */
    setQueueLength(length: number): void {
        this._queueLength = length;
    }

    /**
     * Returns an immutable snapshot of the current metrics.
     * Always returns a valid WsMetrics object — safe to call before init().
     */
    getSnapshot(): WsMetrics {
        return {
            connectedAt: this._connectedAt,
            reconnectCount: this._reconnectCount,
            messagesSent: this._messagesSent,
            messagesReceived: this._messagesReceived,
            lastPingMs: this._lastPingMs,
            activeChannels: this._activeChannels.slice(),
            queueLength: this._queueLength,
        };
    }

    /** Reset all metrics to their initial values. */
    reset(): void {
        this._connectedAt = null;
        this._reconnectCount = 0;
        this._messagesSent = 0;
        this._messagesReceived = 0;
        this._lastPingMs = null;
        this._activeChannels = [];
        this._queueLength = 0;
    }
}
