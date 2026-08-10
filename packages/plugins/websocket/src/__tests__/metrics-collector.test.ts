/**
 * metrics-collector.test.ts — MetricsCollector unit tests.
 *
 * Covers:
 *   - Initial zero state
 *   - All touch* methods
 *   - setActiveChannels / setQueueLength
 *   - getSnapshot() immutability
 *   - reset()
 */

import { describe, it, expect } from "vitest";
import { MetricsCollector } from "../metrics-collector.js";

describe("MetricsCollector — initial state", () => {
    it("returns zero/null snapshot before any mutations", () => {
        const m = new MetricsCollector();
        const snap = m.getSnapshot();
        expect(snap.connectedAt).toBeNull();
        expect(snap.reconnectCount).toBe(0);
        expect(snap.messagesSent).toBe(0);
        expect(snap.messagesReceived).toBe(0);
        expect(snap.lastPingMs).toBeNull();
        expect(snap.activeChannels).toHaveLength(0);
        expect(snap.queueLength).toBe(0);
    });
});

describe("MetricsCollector — touch* methods", () => {
    it("touchConnected() sets connectedAt to a valid ISO 8601 string", () => {
        const m = new MetricsCollector();
        const before = Date.now();
        m.touchConnected();
        const after = Date.now();
        const snap = m.getSnapshot();
        expect(snap.connectedAt).not.toBeNull();
        const ts = new Date(snap.connectedAt!).getTime();
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
    });

    it("touchReconnect() increments reconnectCount", () => {
        const m = new MetricsCollector();
        m.touchReconnect();
        m.touchReconnect();
        expect(m.getSnapshot().reconnectCount).toBe(2);
    });

    it("touchMessageSent() increments messagesSent", () => {
        const m = new MetricsCollector();
        m.touchMessageSent();
        m.touchMessageSent();
        m.touchMessageSent();
        expect(m.getSnapshot().messagesSent).toBe(3);
    });

    it("touchMessageReceived() increments messagesReceived", () => {
        const m = new MetricsCollector();
        m.touchMessageReceived();
        expect(m.getSnapshot().messagesReceived).toBe(1);
    });

    it("touchPingMs() sets lastPingMs", () => {
        const m = new MetricsCollector();
        m.touchPingMs(42);
        expect(m.getSnapshot().lastPingMs).toBe(42);
        // Overwrite with a new value
        m.touchPingMs(7);
        expect(m.getSnapshot().lastPingMs).toBe(7);
    });
});

describe("MetricsCollector — setters", () => {
    it("setActiveChannels() stores a copy — external mutation does not affect stored value", () => {
        const m = new MetricsCollector();
        const channels = ["ch-a", "ch-b"];
        m.setActiveChannels(channels);
        channels.push("ch-c"); // mutate original array
        expect(m.getSnapshot().activeChannels).toEqual(["ch-a", "ch-b"]);
    });

    it("setQueueLength() updates queueLength", () => {
        const m = new MetricsCollector();
        m.setQueueLength(12);
        expect(m.getSnapshot().queueLength).toBe(12);
    });
});

describe("MetricsCollector — getSnapshot()", () => {
    it("returns a fresh object each call (not the same reference)", () => {
        const m = new MetricsCollector();
        const s1 = m.getSnapshot();
        const s2 = m.getSnapshot();
        expect(s1).not.toBe(s2);
    });

    it("activeChannels array is a fresh copy each call", () => {
        const m = new MetricsCollector();
        m.setActiveChannels(["a"]);
        const s1 = m.getSnapshot();
        const s2 = m.getSnapshot();
        expect(s1.activeChannels).not.toBe(s2.activeChannels);
    });
});

describe("MetricsCollector — reset()", () => {
    it("clears all state back to zero", () => {
        const m = new MetricsCollector();
        m.touchConnected();
        m.touchReconnect();
        m.touchMessageSent();
        m.touchMessageReceived();
        m.touchPingMs(10);
        m.setActiveChannels(["ch-x"]);
        m.setQueueLength(5);

        m.reset();

        const snap = m.getSnapshot();
        expect(snap.connectedAt).toBeNull();
        expect(snap.reconnectCount).toBe(0);
        expect(snap.messagesSent).toBe(0);
        expect(snap.messagesReceived).toBe(0);
        expect(snap.lastPingMs).toBeNull();
        expect(snap.activeChannels).toHaveLength(0);
        expect(snap.queueLength).toBe(0);
    });
});
