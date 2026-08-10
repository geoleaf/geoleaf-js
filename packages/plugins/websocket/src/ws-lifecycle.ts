/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ws-lifecycle.ts — the collaborators behind `GeoLeaf.Ws`, and their lifecycle.
 *
 * Split out of `public-api.ts` (backlog B.12), which held the module singletons, the
 * init/destroy sequence and the send routing — everything except the shape of the API
 * object. INV-FACADE puts the implementation here and leaves the facade delegating.
 *
 * The singletons are module-level and REPLACED on each `init()` rather than mutated in
 * place: that is what lets one `buildPublicApi()` result stay valid across repeated
 * init()/destroy() cycles, which the facade's contract promises.
 */
import type { WsPluginConfig } from "./config.js";
import type { MessageHandler, TransportState, WsMetrics } from "./transports/i-ws-transport.js";
import { validateConfig, applyDefaults } from "./config.js";
import { ConnectionManager } from "./connection-manager.js";
import { ChannelManager } from "./channel-manager.js";
import { HeartbeatManager } from "./heartbeat-manager.js";
import { SendQueue } from "./send-queue.js";
import { MetricsCollector } from "./metrics-collector.js";
import { createTransport } from "./transports/transport-registry.js";

// ─── Module-level mutable singletons ─────────────────────────────────────────
// Reset on each init() call — allows the API object to survive multiple cycles.

let _connectionManager: ConnectionManager = new ConnectionManager();
let _channelManager: ChannelManager = new ChannelManager();
let _heartbeatManager: HeartbeatManager = new HeartbeatManager();
let _metrics: MetricsCollector = new MetricsCollector();
let _sendQueue: SendQueue | null = null;
let _initialized = false;
/** Direct reference to transport.send, captured during init(). */
let _sendDirect: ((channel: string, payload: unknown) => void) | null = null;

/** Initialize the plugin: build collaborators, wire them, and connect. */
export async function wsInit(config: WsPluginConfig): Promise<void> {
    if (_initialized) {
        wsDestroy();
    }

    validateConfig(config);
    const resolved = applyDefaults(config);
    _initialized = true;

    _connectionManager = new ConnectionManager();
    _channelManager = new ChannelManager();
    _heartbeatManager = new HeartbeatManager();
    _metrics = new MetricsCollector();
    _sendQueue = new SendQueue(resolved.maxQueueSize, resolved.queueOnDisconnect);

    const transport = createTransport(resolved.transport);

    // Capture direct send reference — avoids coupling to ConnectionManager internals
    _sendDirect = (channel, payload) => {
        transport.send(channel, payload);
        _metrics.touchMessageSent();
    };

    _channelManager.attach(transport);
    _heartbeatManager.attach(transport, resolved.heartbeat, resolved.transport);
    _connectionManager.attach(
        transport,
        resolved,
        _channelManager,
        _sendQueue,
        _metrics,
        _heartbeatManager
    );

    await _connectionManager.connect();
}

/** Disconnect gracefully, clear all subscriptions, reset metrics. Idempotent. */
export function wsDestroy(): void {
    _connectionManager.destroy();
    _channelManager.clear();
    _heartbeatManager.detach();
    _metrics.reset();
    _sendQueue?.clear();
    _sendQueue = null;
    _sendDirect = null;
    _initialized = false;
}

/** Force a reconnection. Resets retry counter. No-op if already connected. */
export function wsReconnect(): void {
    _connectionManager.reconnect();
}

/** Current connection state. */
export function wsState(): TransportState {
    return _connectionManager.state;
}

/** Subscribe to a named channel. Returns an idempotent unsubscribe function. */
export function wsSubscribe(channel: string, handler: MessageHandler): () => void {
    return _channelManager.subscribe(channel, handler);
}

/** Unsubscribe from a channel by name. No-op if not subscribed. */
export function wsUnsubscribe(channel: string): void {
    _channelManager.unsubscribe(channel);
}

/** Send a message on a channel — direct when connected, queued otherwise. */
export function wsSend(channel: string, payload: unknown): void {
    const state = _connectionManager.state;
    if (state === "connected" && _sendDirect) {
        _sendDirect(channel, payload);
    } else if (_sendQueue) {
        _sendQueue.enqueue(channel, payload);
    }
}

/** Returns all currently active subscription channel names. */
export function wsGetSubscriptions(): string[] {
    return _channelManager.getSubscriptions();
}

/** Returns a metrics snapshot. Safe to call before init(). */
export function wsGetMetrics(): WsMetrics {
    return _metrics.getSnapshot();
}
