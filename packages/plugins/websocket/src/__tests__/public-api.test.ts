/**
 * public-api.test.ts — GeoLeaf.Ws public API surface tests.
 *
 * Uses a "test-api" MockTransport registered via registerTransport() so that
 * the full buildPublicApi() wiring is exercised without a real WebSocket.
 *
 * Covers:
 *   - State before/after init()
 *   - subscribe() / unsubscribe() / getSubscriptions()
 *   - send() while connected → transport receives message
 *   - send() while disconnected → queued
 *   - getMetrics() returns a valid snapshot
 *   - destroy() resets state
 *   - Re-init after destroy
 *   - init() with unknown transport → throws
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPublicApi } from "../public-api.js";
import { registerTransport } from "../transports/transport-registry.js";
import { MockTransport } from "../../test-utils/mock-transport.js";
import type { GeoLeafWsApi } from "../public-api.js";

// ─── Register mock transport once per module ──────────────────────────────────

let mockTransport: MockTransport;
registerTransport("test-api", () => {
    mockTransport = new MockTransport();
    return mockTransport;
});

function baseConfig() {
    return {
        transport: "test-api",
        url: "wss://test.example.com",
        reconnect: { initialDelayMs: 10, maxDelayMs: 100, maxRetries: 3 },
        heartbeat: { enabled: false },
        queueOnDisconnect: true,
        maxQueueSize: 50,
    };
}

// ─── Shared api object — reused across tests ──────────────────────────────────

let api: GeoLeafWsApi;

beforeEach(() => {
    api = buildPublicApi();
});

afterEach(() => {
    // Guard: destroy even if the test failed mid-init
    try {
        api.destroy();
    } catch {
        // already destroyed
    }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildPublicApi() — state", () => {
    it("state is 'disconnected' before init()", () => {
        expect(api.state).toBe("disconnected");
    });

    it("state is 'connected' after successful init()", async () => {
        await api.init(baseConfig());
        expect(api.state).toBe("connected");
    });

    it("state is 'disconnected' after destroy()", async () => {
        await api.init(baseConfig());
        api.destroy();
        expect(api.state).toBe("disconnected");
    });

    it("can re-init after destroy() without errors", async () => {
        await api.init(baseConfig());
        api.destroy();
        await api.init(baseConfig());
        expect(api.state).toBe("connected");
    });
});

describe("buildPublicApi() — subscribe / unsubscribe", () => {
    it("subscribe() delivers messages routed through the transport", async () => {
        await api.init(baseConfig());
        const handler = vi.fn();
        api.subscribe("live-ch", handler);
        mockTransport.simulateMessage("live-ch", { lat: 48.8, lng: 2.3 });
        expect(handler).toHaveBeenCalledWith({ lat: 48.8, lng: 2.3 });
    });

    it("returned unsubscribe function stops handler calls", async () => {
        await api.init(baseConfig());
        const handler = vi.fn();
        const unsub = api.subscribe("ch-a", handler);
        unsub();
        mockTransport.simulateMessage("ch-a", "msg");
        expect(handler).not.toHaveBeenCalled();
    });

    it("unsubscribe() by name removes the channel", async () => {
        await api.init(baseConfig());
        api.subscribe("ch-b", vi.fn());
        api.unsubscribe("ch-b");
        expect(api.getSubscriptions()).not.toContain("ch-b");
    });

    it("getSubscriptions() lists all active channels", async () => {
        await api.init(baseConfig());
        api.subscribe("alpha", vi.fn());
        api.subscribe("beta", vi.fn());
        expect(api.getSubscriptions()).toEqual(expect.arrayContaining(["alpha", "beta"]));
    });
});

describe("buildPublicApi() — send()", () => {
    it("send() while connected → transport receives the message", async () => {
        await api.init(baseConfig());
        api.send("cmd-ch", { action: "update" });
        expect(mockTransport.sentMessages).toHaveLength(1);
        expect(mockTransport.sentMessages[0]).toEqual({
            channel: "cmd-ch",
            payload: { action: "update" },
        });
    });

    it("send() while disconnected (queueOnDisconnect=true) → queued, not sent immediately", async () => {
        await api.init({
            ...baseConfig(),
            reconnect: { initialDelayMs: 5000, maxDelayMs: 10000, maxRetries: 0 },
        });
        mockTransport.simulateDisconnect("network-loss");
        api.send("ch-q", "payload-queued");
        // Message should NOT have been sent immediately (transport is down)
        const directlySent = mockTransport.sentMessages.filter((m) => m.channel === "ch-q");
        expect(directlySent).toHaveLength(0);
    });
});

describe("buildPublicApi() — getMetrics()", () => {
    it("returns a valid WsMetrics snapshot after init", async () => {
        await api.init(baseConfig());
        const m = api.getMetrics();
        expect(m.connectedAt).not.toBeNull();
        expect(typeof m.messagesSent).toBe("number");
        expect(typeof m.reconnectCount).toBe("number");
        expect(Array.isArray(m.activeChannels)).toBe(true);
    });

    it("is safe to call before init → returns zeroed snapshot", () => {
        const m = api.getMetrics();
        expect(m.connectedAt).toBeNull();
        expect(m.messagesSent).toBe(0);
    });
});

describe("buildPublicApi() — error handling", () => {
    it("init() with unknown transport rejects with an error", async () => {
        await expect(
            api.init({ ...baseConfig(), transport: "no-such-transport-xyz" })
        ).rejects.toThrow();
    });

    it("init() with invalid config (ws:// in production) rejects", async () => {
        const original = process.env["NODE_ENV"];
        process.env["NODE_ENV"] = "production";
        try {
            await expect(
                api.init({ ...baseConfig(), url: "ws://insecure.example.com" })
            ).rejects.toThrow();
        } finally {
            process.env["NODE_ENV"] = original;
        }
    });
});
