/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * channel-manager.ts — Channel subscription registry.
 *
 * Maintains a Map<channel, handler> with strict isolation between channels.
 * A channel can have at most one active handler at a time.
 * All active subscriptions are preserved across reconnections via resubscribeAll().
 */

import type { IWsTransport, MessageHandler } from "./transports/i-ws-transport.js";
import { emitChannelSubscribed, emitChannelUnsubscribed } from "./event-bus-bridge.js";

/**
 * Registry of channel subscriptions, one handler per channel.
 *
 * ⚠️ Strict isolation, and it is a **replacement** policy: subscribing a second handler to a
 * channel displaces the first rather than fanning out. A caller needing several consumers
 * must multiplex them itself.
 */
export class ChannelManager {
    /** Active channel → handler pairs. */
    private _subscriptions: Map<string, MessageHandler> = new Map();
    /** Unsubscribe functions returned by the transport for each active channel. */
    private _unsubs: Map<string, () => void> = new Map();
    /** Currently attached transport. May be null before first connection. */
    private _transport: IWsTransport | null = null;

    /** Attach a transport. Must be called before subscribe() can wire to the transport. */
    attach(transport: IWsTransport): void {
        this._transport = transport;
    }

    /**
     * Subscribe to a named channel.
     * If a handler already exists for this channel, it is replaced.
     * Returns an idempotent unsubscribe function.
     */
    subscribe(channel: string, handler: MessageHandler): () => void {
        // Remove existing transport-level subscription if present
        this._unsubs.get(channel)?.();
        this._unsubs.delete(channel);

        // Store new handler
        this._subscriptions.set(channel, handler);

        // Wire to transport if attached
        if (this._transport) {
            const unsub = this._transport.subscribe(channel, handler);
            this._unsubs.set(channel, unsub);
        }

        emitChannelSubscribed({ channel });

        let called = false;
        return () => {
            if (called) return;
            called = true;
            this.unsubscribe(channel);
        };
    }

    /** Unsubscribe from a channel by name. No-op if not subscribed. */
    unsubscribe(channel: string): void {
        if (!this._subscriptions.has(channel)) return;

        this._unsubs.get(channel)?.();
        this._unsubs.delete(channel);
        this._subscriptions.delete(channel);

        emitChannelUnsubscribed({ channel });
    }

    /**
     * Re-subscribe all stored channels on the currently attached transport.
     * Called by ConnectionManager after a successful reconnection.
     */
    resubscribeAll(): void {
        if (!this._transport) return;

        // Cancel all previously registered transport-level subscriptions
        for (const unsub of this._unsubs.values()) {
            unsub();
        }
        this._unsubs.clear();

        for (const [channel, handler] of this._subscriptions.entries()) {
            const unsub = this._transport.subscribe(channel, handler);
            this._unsubs.set(channel, unsub);
        }
    }

    /** Returns the names of all currently active channel subscriptions. */
    getSubscriptions(): string[] {
        return Array.from(this._subscriptions.keys());
    }

    /** Clear all subscriptions and detach from the transport. */
    clear(): void {
        for (const unsub of this._unsubs.values()) {
            unsub();
        }
        this._unsubs.clear();
        this._subscriptions.clear();
        this._transport = null;
    }
}
