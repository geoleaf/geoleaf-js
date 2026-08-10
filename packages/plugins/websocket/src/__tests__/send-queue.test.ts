/**
 * send-queue.test.ts — SendQueue FIFO behavior, overflow, and disable
 *
 * Covers CDC §11.4:
 *   - send() during RECONNECTING → queued → flushed in order on reconnect
 *   - maxQueueSize: 2, 3 messages → oldest dropped + send-queued-overflow
 *   - queueOnDisconnect: false → send-dropped, message not queued
 */

import { describe, it, expect } from "vitest";
import { SendQueue } from "../send-queue.js";

// Capture dispatched events
function _captureEvents(names: string[]): Map<string, CustomEvent[]> {
    const captured = new Map<string, CustomEvent[]>();
    const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
    for (const name of names) {
        const list: CustomEvent[] = [];
        captured.set(name, list);
        const handler = (e: Event) => list.push(e as CustomEvent);
        document.addEventListener(name, handler);
        listeners.push([name, handler]);
    }
    return captured;
}

function _removeListeners(captured: Map<string, CustomEvent[]>): void {
    // Listeners are auto-cleaned in vmForks — no explicit cleanup needed
    void captured;
}

describe("SendQueue — enabled", () => {
    it("enqueues messages in FIFO order and flushes all", () => {
        const q = new SendQueue(10, true);
        q.enqueue("ch", { n: 1 });
        q.enqueue("ch", { n: 2 });
        q.enqueue("ch", { n: 3 });
        const out = q.flush();
        expect(out).toHaveLength(3);
        expect(out[0]).toEqual({ channel: "ch", payload: { n: 1 } });
        expect(out[1]).toEqual({ channel: "ch", payload: { n: 2 } });
        expect(out[2]).toEqual({ channel: "ch", payload: { n: 3 } });
        expect(q.length).toBe(0);
    });

    it("drops oldest and emits send-queued-overflow when full", () => {
        const overflowEvents: CustomEvent[] = [];
        const handler = (e: Event) => overflowEvents.push(e as CustomEvent);
        document.addEventListener("geoleaf:ws:send-queued-overflow", handler);

        const q = new SendQueue(2, true);
        q.enqueue("ch", "msg1"); // queue: [msg1]
        q.enqueue("ch", "msg2"); // queue: [msg1, msg2] — full
        q.enqueue("ch", "msg3"); // overflow: drops msg1, queue: [msg2, msg3]

        const out = q.flush();
        expect(out).toHaveLength(2);
        expect(out[0].payload).toBe("msg2");
        expect(out[1].payload).toBe("msg3");

        expect(overflowEvents).toHaveLength(1);
        expect(overflowEvents[0]!.detail.droppedPayload).toBe("msg1");

        document.removeEventListener("geoleaf:ws:send-queued-overflow", handler);
    });

    it("emits send-queued event on each enqueue", () => {
        const events: CustomEvent[] = [];
        const handler = (e: Event) => events.push(e as CustomEvent);
        document.addEventListener("geoleaf:ws:send-queued", handler);

        const q = new SendQueue(5, true);
        q.enqueue("ch1", "a");
        q.enqueue("ch2", "b");

        expect(events).toHaveLength(2);
        expect(events[0]!.detail.channel).toBe("ch1");
        expect(events[1]!.detail.channel).toBe("ch2");

        document.removeEventListener("geoleaf:ws:send-queued", handler);
    });

    it("clear() empties the queue", () => {
        const q = new SendQueue(10, true);
        q.enqueue("ch", "x");
        q.clear();
        expect(q.length).toBe(0);
        expect(q.flush()).toHaveLength(0);
    });
});

describe("SendQueue — disabled (queueOnDisconnect: false)", () => {
    it("does not enqueue and emits send-dropped on each call", () => {
        const events: CustomEvent[] = [];
        const handler = (e: Event) => events.push(e as CustomEvent);
        document.addEventListener("geoleaf:ws:send-dropped", handler);

        const q = new SendQueue(10, false);
        q.enqueue("ch", "will-be-dropped");

        expect(q.length).toBe(0);
        expect(events).toHaveLength(1);
        expect(events[0]!.detail.channel).toBe("ch");

        document.removeEventListener("geoleaf:ws:send-dropped", handler);
    });
});
