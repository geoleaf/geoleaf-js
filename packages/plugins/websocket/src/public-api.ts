/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * public-api.ts — GeoLeaf.Ws public API surface.
 *
 * Façade only (INV-FACADE): `buildPublicApi()` returns the object mounted on
 * `globalThis.GeoLeaf.Ws` by `entry.ts`, and every member forwards to `ws-lifecycle.ts`.
 * The collaborators, their module singletons and the init/destroy sequence live there.
 *
 * The public API exposes:
 *   init, destroy, reconnect, state, subscribe, unsubscribe, send,
 *   getSubscriptions, getMetrics
 */

import type { WsPluginConfig } from "./config.js";
import type { MessageHandler, TransportState, WsMetrics } from "./transports/i-ws-transport.js";
import {
    wsInit,
    wsDestroy,
    wsReconnect,
    wsState,
    wsSubscribe,
    wsUnsubscribe,
    wsSend,
    wsGetSubscriptions,
    wsGetMetrics,
} from "./ws-lifecycle.js";

/**
 * The `GeoLeaf.Ws` surface — connect, subscribe, send, observe.
 *
 * A façade only (INV-FACADE): every member forwards to `ws-lifecycle.ts`, so this interface
 * describes the contract without holding any of the machinery. One shared connection backs it,
 * which is why {@link "sources/websocket-source"} in the realtime plugin rides it rather than
 * opening a socket of its own.
 */
export interface GeoLeafWsApi {
    /** Initialize the plugin. Connects immediately. Resolves when connected. */
    init(config: WsPluginConfig): Promise<void>;
    /** Disconnect gracefully, clear all subscriptions, reset metrics. Idempotent. */
    destroy(): void;
    /** Force a reconnection. Resets retry counter. No-op if already connected. */
    reconnect(): void;
    /** Current connection state. */
    readonly state: TransportState;
    /** Subscribe to a named channel. Returns an idempotent unsubscribe function. */
    subscribe(channel: string, handler: MessageHandler): () => void;
    /** Unsubscribe from a channel by name. No-op if not subscribed. */
    unsubscribe(channel: string): void;
    /**
     * Send a message on a channel.
     * Queued if disconnected and queueOnDisconnect is true.
     */
    send(channel: string, payload: unknown): void;
    /** Returns all currently active subscription channel names. */
    getSubscriptions(): string[];
    /** Returns a metrics snapshot. Safe to call before init(). */
    getMetrics(): WsMetrics;
}

/**
 * Creates and returns the GeoLeaf.Ws public API object.
 * Called once during entry.ts bootstrap.
 */
export function buildPublicApi(): GeoLeafWsApi {
    return {
        init: (config: WsPluginConfig): Promise<void> => wsInit(config),
        destroy: (): void => wsDestroy(),
        reconnect: (): void => wsReconnect(),
        get state(): TransportState {
            return wsState();
        },
        subscribe: (channel: string, handler: MessageHandler): (() => void) =>
            wsSubscribe(channel, handler),
        unsubscribe: (channel: string): void => wsUnsubscribe(channel),
        send: (channel: string, payload: unknown): void => wsSend(channel, payload),
        getSubscriptions: (): string[] => wsGetSubscriptions(),
        getMetrics: (): WsMetrics => wsGetMetrics(),
    };
}
