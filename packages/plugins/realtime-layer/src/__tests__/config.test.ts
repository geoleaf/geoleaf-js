/**
 * config.test.ts — tests for validateRealtimeConfig()
 */
import { describe, it, expect } from "vitest";
import { validateRealtimeConfig, resolveTargetLayerId } from "../config.js";
import type { RealtimeConfig } from "../config.js";

describe("validateRealtimeConfig", () => {
    const validPolling = {
        enabled: true,
        source: "polling",
        url: "https://example.com/data.json",
        decoder: "json",
    };

    const validWebSocket = {
        enabled: true,
        source: "websocket",
        channel: "my-channel",
        decoder: "json",
    };

    const validSse = {
        enabled: false,
        source: "sse",
        url: "https://example.com/stream",
        decoder: "json",
    };

    // ── happy paths ──────────────────────────────────────────────────────────

    it("accepts valid polling config", () => {
        const result = validateRealtimeConfig(validPolling, "layer1");
        expect(result.source).toBe("polling");
        expect(result.enabled).toBe(true);
        expect(result.decoder).toBe("json");
        expect(result.url).toBe("https://example.com/data.json");
        expect(result.intervalMs).toBe(30_000); // default
        expect(result.updateMode).toBe("upsert"); // default
        expect(result.staleAction).toBe("remove"); // default
    });

    it("accepts valid websocket config", () => {
        const result = validateRealtimeConfig(validWebSocket, "layer2");
        expect(result.source).toBe("websocket");
        expect(result.channel).toBe("my-channel");
    });

    it("accepts valid sse config", () => {
        const result = validateRealtimeConfig(validSse, "layer3");
        expect(result.source).toBe("sse");
        expect(result.enabled).toBe(false);
    });

    it("preserves optional fields", () => {
        const result = validateRealtimeConfig(
            {
                ...validPolling,
                intervalMs: 60_000,
                updateMode: "merge",
                idField: "code_uic",
                staleTimeoutMs: 300_000,
                staleAction: "dim",
                mapping: { idField: "stop_id", delayField: "delay", targetLayerId: "stations" },
            },
            "layer4"
        );
        expect(result.intervalMs).toBe(60_000);
        expect(result.updateMode).toBe("merge");
        expect(result.idField).toBe("code_uic");
        expect(result.staleTimeoutMs).toBe(300_000);
        expect(result.staleAction).toBe("dim");
        expect(result.mapping?.targetLayerId).toBe("stations");
    });

    it("accepts updateMode replace", () => {
        const result = validateRealtimeConfig({ ...validPolling, updateMode: "replace" }, "x");
        expect(result.updateMode).toBe("replace");
    });

    // ── type errors ──────────────────────────────────────────────────────────

    it("throws if not an object", () => {
        expect(() => validateRealtimeConfig(null, "layer")).toThrow();
        expect(() => validateRealtimeConfig("string", "layer")).toThrow();
        expect(() => validateRealtimeConfig(42, "layer")).toThrow();
    });

    it("throws if enabled is not boolean", () => {
        expect(() => validateRealtimeConfig({ ...validPolling, enabled: "true" }, "layer")).toThrow(
            /enabled must be a boolean/
        );
    });

    it("throws if source is invalid", () => {
        expect(() => validateRealtimeConfig({ ...validPolling, source: "mqtt" }, "layer")).toThrow(
            /source must be one of/
        );
    });

    it("throws if decoder is missing", () => {
        const { decoder: _, ...rest } = validPolling;
        expect(() => validateRealtimeConfig(rest, "layer")).toThrow(
            /decoder must be a non-empty string/
        );
    });

    it("throws if decoder is empty string", () => {
        expect(() => validateRealtimeConfig({ ...validPolling, decoder: "" }, "layer")).toThrow(
            /decoder must be a non-empty string/
        );
    });

    it("throws if polling url is missing", () => {
        const { url: _, ...rest } = validPolling;
        expect(() => validateRealtimeConfig(rest, "layer")).toThrow(/url is required/);
    });

    it("throws if sse url is missing", () => {
        const { url: _, ...rest } = validSse;
        expect(() => validateRealtimeConfig(rest, "layer")).toThrow(/url is required/);
    });

    it("throws if websocket channel is missing", () => {
        const { channel: _, ...rest } = validWebSocket;
        expect(() => validateRealtimeConfig(rest, "layer")).toThrow(/channel is required/);
    });

    it("throws if updateMode is invalid", () => {
        expect(() =>
            validateRealtimeConfig({ ...validPolling, updateMode: "patch" }, "layer")
        ).toThrow(/updateMode must be one of/);
    });

    // ── undefined optional fields fall back to defaults ──────────────────────

    it("defaults intervalMs to 30000 when omitted", () => {
        const result = validateRealtimeConfig(validPolling, "x");
        expect(result.intervalMs).toBe(30_000);
    });

    it("defaults staleAction to 'remove' when omitted", () => {
        const result = validateRealtimeConfig(validPolling, "x");
        expect(result.staleAction).toBe("remove");
    });

    it("mapping is undefined when omitted", () => {
        const result = validateRealtimeConfig(validPolling, "x");
        expect(result.mapping).toBeUndefined();
    });

    it("mapping is undefined when not an object", () => {
        const result = validateRealtimeConfig({ ...validPolling, mapping: "bad" }, "x");
        expect(result.mapping).toBeUndefined();
    });

    // ── fallbackUrl ──────────────────────────────────────────────────────────

    it("preserves fallbackUrl when provided as string", () => {
        const result = validateRealtimeConfig(
            { ...validPolling, fallbackUrl: "data/snap.geojson" },
            "x"
        );
        expect(result.fallbackUrl).toBe("data/snap.geojson");
    });

    it("fallbackUrl is undefined when omitted", () => {
        const result = validateRealtimeConfig(validPolling, "x");
        expect(result.fallbackUrl).toBeUndefined();
    });

    it("fallbackUrl is undefined when not a string", () => {
        const result = validateRealtimeConfig({ ...validPolling, fallbackUrl: 42 }, "x");
        expect(result.fallbackUrl).toBeUndefined();
    });
});

describe("resolveTargetLayerId", () => {
    const base: RealtimeConfig = {
        enabled: true,
        source: "polling",
        decoder: "json",
        url: "https://example.com/data.json",
    };

    it("falls back to the config's own layer when no mapping", () => {
        expect(resolveTargetLayerId(base, "layer-a")).toBe("layer-a");
    });

    it("falls back when mapping has no targetLayerId", () => {
        expect(
            resolveTargetLayerId({ ...base, mapping: { idField: "vehicle_id" } }, "layer-a")
        ).toBe("layer-a");
    });

    it("returns mapping.targetLayerId when set", () => {
        expect(
            resolveTargetLayerId({ ...base, mapping: { targetLayerId: "vehicles" } }, "layer-a")
        ).toBe("vehicles");
    });
});
