/**
 * source-factory.test.ts — tests for createSource()
 */
import { describe, it, expect } from "vitest";
import { createSource } from "../source-factory.js";
import type { RealtimeConfig } from "../config.js";

function makeConfig(overrides: Partial<RealtimeConfig> = {}): RealtimeConfig {
    return {
        enabled: true,
        source: "polling",
        decoder: "json",
        url: "https://example.com/data",
        intervalMs: 30_000,
        ...overrides,
    };
}

describe("createSource", () => {
    // ── polling ───────────────────────────────────────────────────────────────

    it("creates a PollingSource for source: polling", () => {
        const src = createSource(makeConfig({ source: "polling" }), "layer1");
        expect(typeof src.start).toBe("function");
        expect(typeof src.stop).toBe("function");
        expect(typeof src.onData).toBe("function");
    });

    it("throws if polling url is missing", () => {
        expect(() =>
            createSource(makeConfig({ source: "polling", url: undefined }), "layer1")
        ).toThrow(/url is required/);
    });

    // ── websocket ─────────────────────────────────────────────────────────────

    it("creates a WebSocketSource for source: websocket", () => {
        const src = createSource(
            makeConfig({ source: "websocket", channel: "my-channel" }),
            "layer2"
        );
        expect(typeof src.start).toBe("function");
    });

    it("throws if websocket channel is missing", () => {
        expect(() =>
            createSource(makeConfig({ source: "websocket", channel: undefined }), "layer2")
        ).toThrow(/channel is required/);
    });

    // ── sse ───────────────────────────────────────────────────────────────────

    it("creates a SseSource for source: sse", () => {
        const src = createSource(
            makeConfig({ source: "sse", url: "https://example.com/stream" }),
            "layer3"
        );
        expect(typeof src.start).toBe("function");
    });

    it("throws if sse url is missing", () => {
        expect(() => createSource(makeConfig({ source: "sse", url: undefined }), "layer3")).toThrow(
            /url is required/
        );
    });

    // ── unknown ───────────────────────────────────────────────────────────────

    it("throws for unknown source type", () => {
        expect(() =>
            createSource(makeConfig({ source: "mqtt" as RealtimeConfig["source"] }), "layer4")
        ).toThrow(/unknown source type/);
    });
});
