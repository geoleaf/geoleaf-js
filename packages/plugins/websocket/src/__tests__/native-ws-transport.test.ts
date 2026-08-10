/**
 * native-ws-transport.test.ts — NativeWsTransport unit tests via a mock WebSocket.
 *
 * Covers:
 *   - connect() resolves on open, fires onConnected callback
 *   - connect() rejects on close code 1008 → AUTH_FAILED
 *   - connect() rejects on non-1008 close during handshake → CONNECTION_REFUSED
 *   - onDisconnected fires on close after connected
 *   - send() sends JSON to WebSocket / throws when not connected
 *   - subscribe() / unsubscribe via returned function
 *   - ping() resolves on pong message
 *   - disconnect() clears state
 *   - Non-JSON messages silently ignored
 *   - Messages without "channel" key are ignored
 *   - connect() is no-op if already connected
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NativeWsTransport } from "../transports/native-ws.transport.js";

// ─── Mock WebSocket ────────────────────────────────────────────────────────────

interface MockWsInstance {
    url: string;
    readyState: number;
    onopen: (() => void) | null;
    onclose: ((ev: { code: number; reason: string }) => void) | null;
    onerror: ((ev: Event) => void) | null;
    onmessage: ((ev: { data: string }) => void) | null;
    sent: string[];
    /** Trigger the open event. */
    open(): void;
    /** Trigger the close event. */
    closeWith(code?: number, reason?: string): void;
    send(data: string): void;
    close(code?: number, reason?: string): void;
}

let lastWs: MockWsInstance | null = null;

class MockWebSocket implements MockWsInstance {
    static OPEN = 1;
    static CLOSING = 2;
    url: string;
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: ((ev: { code: number; reason: string }) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    sent: string[] = [];

    constructor(url: string) {
        this.url = url;

        lastWs = this;
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(code = 1000, reason = ""): void {
        this.readyState = 2;
        this.closeWith(code, reason);
    }

    open(): void {
        this.readyState = 1;
        this.onopen?.();
    }

    closeWith(code = 1000, reason = ""): void {
        this.readyState = 3;
        this.onclose?.({ code, reason });
    }
}

vi.stubGlobal("WebSocket", MockWebSocket);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _makeConnected(): { transport: NativeWsTransport; ws: MockWsInstance } {
    const transport = new NativeWsTransport();
    const connectPromise = transport.connect({ url: "wss://test.example.com" });
    const ws = lastWs!;
    ws.open();
    return { transport, ws, _promise: connectPromise } as unknown as {
        transport: NativeWsTransport;
        ws: MockWsInstance;
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NativeWsTransport — connect()", () => {
    beforeEach(() => {
        lastWs = null;
    });

    it("resolves when WebSocket opens and state becomes 'connected'", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        expect(transport.state).toBe("connected");
    });

    it("fires onConnected callback on open", async () => {
        const transport = new NativeWsTransport();
        const onConnected = vi.fn();
        transport.onConnected = onConnected;
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        expect(onConnected).toHaveBeenCalledOnce();
    });

    it("is a no-op (resolves immediately) when already connected", async () => {
        const transport = new NativeWsTransport();
        const p1 = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p1;
        // Second call — should not create a new WebSocket
        const prevWs = lastWs;
        const p2 = transport.connect({ url: "wss://test.example.com" });
        await p2;
        expect(lastWs).toBe(prevWs); // no new WebSocket instance
        expect(transport.state).toBe("connected");
    });

    it("rejects with AUTH_FAILED on close code 1008 during handshake", async () => {
        const transport = new NativeWsTransport();
        const onError = vi.fn();
        transport.onError = onError;
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.closeWith(1008, "policy violation");
        await expect(p).rejects.toMatchObject({ code: "AUTH_FAILED" });
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "AUTH_FAILED" }));
    });

    it("rejects with CONNECTION_REFUSED on non-1008 close during handshake", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.closeWith(1006, "abnormal closure");
        await expect(p).rejects.toMatchObject({ code: "CONNECTION_REFUSED" });
    });
});

describe("NativeWsTransport — post-connect lifecycle", () => {
    beforeEach(() => {
        lastWs = null;
    });

    it("fires onDisconnected when closed after connecting", async () => {
        const transport = new NativeWsTransport();
        const onDisconnected = vi.fn();
        transport.onDisconnected = onDisconnected;
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        lastWs!.closeWith(1000, "server-bye");
        expect(onDisconnected).toHaveBeenCalledWith(expect.stringContaining("server-bye"));
    });

    it("disconnect() sets state to disconnected and nulls ws", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        transport.disconnect("manual");
        expect(transport.state).toBe("disconnected");
    });
});

describe("NativeWsTransport — send()", () => {
    beforeEach(() => {
        lastWs = null;
    });

    it("serializes {channel, payload} as JSON to the WebSocket", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        transport.send("ch-x", { value: 99 });
        expect(lastWs!.sent).toHaveLength(1);
        expect(JSON.parse(lastWs!.sent[0]!)).toEqual({ channel: "ch-x", payload: { value: 99 } });
    });

    it("throws if not connected", () => {
        const transport = new NativeWsTransport();
        expect(() => transport.send("ch", "data")).toThrow();
    });
});

describe("NativeWsTransport — subscribe()", () => {
    beforeEach(() => {
        lastWs = null;
    });

    it("delivers messages routed by channel key", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        const handler = vi.fn();
        transport.subscribe("ch-data", handler);
        lastWs!.onmessage?.({ data: JSON.stringify({ channel: "ch-data", payload: { n: 7 } }) });
        expect(handler).toHaveBeenCalledWith({ n: 7 });
    });

    it("returned unsubscribe function stops delivery", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        const handler = vi.fn();
        const unsub = transport.subscribe("ch-unsub", handler);
        unsub();
        lastWs!.onmessage?.({ data: JSON.stringify({ channel: "ch-unsub", payload: "msg" }) });
        expect(handler).not.toHaveBeenCalled();
    });

    it("silently ignores non-JSON messages", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        const handler = vi.fn();
        transport.subscribe("ch", handler);
        expect(() => lastWs!.onmessage?.({ data: "not-valid-json" })).not.toThrow();
        expect(handler).not.toHaveBeenCalled();
    });

    it("silently ignores messages without a channel key", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        const handler = vi.fn();
        transport.subscribe("ch", handler);
        lastWs!.onmessage?.({ data: JSON.stringify({ type: "server-push", data: "hello" }) });
        expect(handler).not.toHaveBeenCalled();
    });
});

describe("NativeWsTransport — ping()", () => {
    beforeEach(() => {
        lastWs = null;
    });

    it("resolves when a pong message arrives", async () => {
        const transport = new NativeWsTransport();
        const p = transport.connect({ url: "wss://test.example.com" });
        lastWs!.open();
        await p;
        const pingPromise = transport.ping();
        lastWs!.onmessage?.({ data: JSON.stringify({ type: "pong" }) });
        await pingPromise;
    });

    it("resolves immediately when not connected", async () => {
        const transport = new NativeWsTransport();
        // No connect — should resolve immediately without throwing
        await expect(transport.ping()).resolves.toBeUndefined();
    });
});
