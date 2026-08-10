/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * send-queue.ts — FIFO message queue for offline buffering.
 *
 * When queueOnDisconnect is true, messages sent while the transport is not
 * connected are held here and flushed in order once reconnection succeeds.
 * Overflow drops the oldest message and emits a send-queued-overflow event.
 */

import { emitSendDropped, emitSendQueued, emitSendQueuedOverflow } from "./event-bus-bridge.js";

interface QueuedMessage {
    channel: string;
    payload: unknown;
}

/**
 * FIFO buffer for messages sent while the transport is down.
 *
 * Active only when `queueOnDisconnect` is set; flushed in order once reconnection succeeds,
 * so ordering survives the outage. ⚠️ The queue is bounded — beyond its cap the oldest
 * messages are dropped, which is the intended trade against unbounded memory growth.
 */
export class SendQueue {
    private _queue: QueuedMessage[] = [];
    private _maxSize: number;
    private _enabled: boolean;

    constructor(maxSize: number, enabled: boolean) {
        this._maxSize = Math.max(1, maxSize);
        this._enabled = enabled;
    }

    /** Whether the queue is active (queueOnDisconnect). */
    get enabled(): boolean {
        return this._enabled;
    }

    /** Number of messages currently held. */
    get length(): number {
        return this._queue.length;
    }

    /**
     * Attempt to enqueue a message.
     * - If disabled: emits send-dropped and discards the message.
     * - If queue is full: drops the oldest entry + emits send-queued-overflow.
     * - Otherwise: enqueues and emits send-queued.
     */
    enqueue(channel: string, payload: unknown): void {
        if (!this._enabled) {
            emitSendDropped({ channel });
            return;
        }

        // Enforce maxSize — drop oldest if needed
        if (this._queue.length >= this._maxSize) {
            const dropped = this._queue.shift()!;
            emitSendQueuedOverflow({ channel: dropped.channel, droppedPayload: dropped.payload });
        }

        this._queue.push({ channel, payload });
        emitSendQueued({ channel, queueLength: this._queue.length });
    }

    /**
     * Drain and return all queued messages in FIFO order.
     * The queue is empty after this call.
     */
    flush(): QueuedMessage[] {
        const messages = this._queue.slice();
        this._queue = [];
        return messages;
    }

    /** Clear the queue without returning messages. */
    clear(): void {
        this._queue = [];
    }
}
