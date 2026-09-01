/**
 * @geoleaf-plugins/position-share — the two built-in transports
 *
 * The failure modes matter more than the happy path here: both transports can fail in ways the
 * integrator cannot see from the outside (a token silently absent, a socket nobody initialised),
 * so each one is asserted to fail LOUDLY and by name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createHttpTransport } from "../transports/http-transport.js";
import { createWsTransport } from "../transports/ws-transport.js";
import type { PluginConfig } from "../config.js";
import type { PositionPayload } from "../transports/contract.js";

const payload: PositionPayload = {
    clientId: "loc:test",
    lat: 48.85,
    lng: 2.35,
    timestamp: 1_700_000_000_000,
};

function cfg(over: Partial<PluginConfig> = {}): PluginConfig {
    return {
        enabled: true,
        mode: "manual",
        transport: "http",
        endpoint: "https://example.test/positions",
        intervalMs: 30000,
        minDistanceM: 10,
        showButton: true,
        receive: { enabled: false },
        ...over,
    };
}

describe("HTTP transport", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("POSTs the sample as JSON", async () => {
        const fetchMock = vi.fn(async () => new Response("", { status: 201 }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await createHttpTransport(cfg()).send(payload);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://example.test/positions");
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toMatchObject({ clientId: "loc:test" });
    });

    // The connector plugin owns the token by replacing `fetch`. A header set here would be a
    // second, competing source of truth.
    it("sets no Authorization header of its own", async () => {
        const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await createHttpTransport(cfg()).send(payload);

        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(init.headers).not.toHaveProperty("Authorization");
    });

    it("rejects when the endpoint answers a non-2xx", async () => {
        globalThis.fetch = vi.fn(
            async () => new Response("", { status: 503, statusText: "Service Unavailable" })
        ) as unknown as typeof fetch;

        await expect(createHttpTransport(cfg()).send(payload)).rejects.toThrow(/503/);
    });

    it("rejects when no endpoint is configured", async () => {
        await expect(
            createHttpTransport(cfg({ endpoint: undefined })).send(payload)
        ).rejects.toThrow(/endpoint is required/);
    });
});

describe("WebSocket transport", () => {
    beforeEach(() => {
        (globalThis as Record<string, unknown>).GeoLeaf = {};
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("sends on the configured channel when connected", async () => {
        const send = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = { Ws: { state: "connected", send } };

        await createWsTransport(cfg({ transport: "websocket", channel: "positions" })).send(
            payload
        );

        expect(send).toHaveBeenCalledWith("positions", payload);
    });

    it("rejects with a cause-naming error when GeoLeaf.Ws is absent", async () => {
        await expect(
            createWsTransport(cfg({ transport: "websocket", channel: "positions" })).send(payload)
        ).rejects.toThrow(/GeoLeaf\.Ws is absent/);
    });

    it("rejects when the socket is not connected, and says so", async () => {
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Ws: { state: "disconnected", send: vi.fn() },
        };

        await expect(
            createWsTransport(cfg({ transport: "websocket", channel: "positions" })).send(payload)
        ).rejects.toThrow(/disconnected/);
    });

    // It must never call Ws.init(): the connection belongs to the integrator and may already be
    // serving realtime layers, and init() destroys before it rebuilds.
    it("never initialises the connection itself", async () => {
        const init = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Ws: { state: "disconnected", send: vi.fn(), init },
        };

        await expect(
            createWsTransport(cfg({ transport: "websocket", channel: "positions" })).send(payload)
        ).rejects.toThrow();
        expect(init).not.toHaveBeenCalled();
    });

    it("rejects when no channel is configured", async () => {
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Ws: { state: "connected", send: vi.fn() },
        };

        await expect(
            createWsTransport(cfg({ transport: "websocket", channel: undefined })).send(payload)
        ).rejects.toThrow(/channel is required/);
    });
});
