/**
 * realtime-runtime.test.ts — tests for the RealtimeManager module
 *
 * Mocks GeoLeaf.GeoJSON so no real MapLibre instance is needed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    start,
    stop,
    stopAll,
    getStatus,
    registerDecoder,
    bootFromProfile,
} from "../realtime-runtime.js";
import type { IDecoder, DecodedUpdate } from "../decoders/i-decoder.js";

// ── GeoLeaf mock ──────────────────────────────────────────────────────────────

type LayerConfig = {
    id: string;
    config?: Record<string, unknown>;
    features?: unknown[];
};

let _layers: Record<string, LayerConfig> = {};

const mockGeoJSON = {
    getAllLayers: vi.fn(() => Object.values(_layers).map((l) => ({ id: l.id }))),
    getLayerData: vi.fn((id: string) => _layers[id] ?? null),
    updateLayerData: vi.fn(),
};

(globalThis as unknown as { GeoLeaf: unknown }).GeoLeaf = { GeoJSON: mockGeoJSON };

// ── helpers ───────────────────────────────────────────────────────────────────

function pollingLayerConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
    return {
        realtime: {
            enabled: true,
            source: "polling",
            url: "https://example.com/data",
            decoder: "json",
            intervalMs: 60_000,
            ...overrides,
        },
    };
}

class NoOpDecoder implements IDecoder {
    decode(_data: unknown): DecodedUpdate[] {
        return [];
    }
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    stopAll();
    _layers = {};
    mockGeoJSON.getAllLayers.mockClear();
    mockGeoJSON.getLayerData.mockClear();
    mockGeoJSON.updateLayerData.mockClear();
});

// ── getStatus ─────────────────────────────────────────────────────────────────

describe("getStatus", () => {
    it("returns inactive status for unknown layer", () => {
        const s = getStatus("unknown");
        expect(s.active).toBe(false);
        expect(s.source).toBe("none");
        expect(s.lastUpdateAt).toBeNull();
        expect(s.staleCount).toBe(0);
    });
});

// ── start / stop ──────────────────────────────────────────────────────────────

describe("start / stop", () => {
    it("start warns when GeoLeaf.GeoJSON is unavailable", () => {
        (globalThis as unknown as { GeoLeaf: unknown }).GeoLeaf = {};
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        start("layer1");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
        (globalThis as unknown as { GeoLeaf: unknown }).GeoLeaf = { GeoJSON: mockGeoJSON };
    });

    it("start warns when no data.realtime config", () => {
        _layers["noconfig"] = { id: "noconfig", config: {} };
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        start("noconfig");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("start errors on invalid config (missing url for polling)", () => {
        _layers["bad"] = {
            id: "bad",
            config: {
                realtime: { enabled: true, source: "polling", decoder: "json" },
            },
        };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        start("bad");
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });

    it("start activates a layer with valid config", () => {
        _layers["layer1"] = { id: "layer1", config: pollingLayerConfig() };
        start("layer1");
        expect(getStatus("layer1").active).toBe(true);
    });

    it("start is a no-op if already active", () => {
        _layers["layer1"] = { id: "layer1", config: pollingLayerConfig() };
        start("layer1");
        start("layer1"); // second call
        expect(getStatus("layer1").active).toBe(true);
    });

    it("stop deactivates a layer", () => {
        _layers["layer1"] = { id: "layer1", config: pollingLayerConfig() };
        start("layer1");
        stop("layer1");
        expect(getStatus("layer1").active).toBe(false);
    });

    it("stop is a no-op for unknown layer", () => {
        expect(() => stop("ghost")).not.toThrow();
    });

    it("stopAll stops all active layers", () => {
        _layers["l1"] = { id: "l1", config: pollingLayerConfig() };
        _layers["l2"] = { id: "l2", config: pollingLayerConfig() };
        start("l1");
        start("l2");
        stopAll();
        expect(getStatus("l1").active).toBe(false);
        expect(getStatus("l2").active).toBe(false);
    });

    it("getStatus returns source name when active", () => {
        _layers["layer1"] = { id: "layer1", config: pollingLayerConfig() };
        start("layer1");
        expect(getStatus("layer1").source).toBe("polling");
    });
});

// ── stale tracking keyed on the target layer ──────────────────────────────────
// Regression (PLUGINS S9 P1): a config on one layer with mapping.targetLayerId feeds
// another. Features land on — and are touched under — the TARGET, but stale tracking
// used to start under the SOURCE. The two keys never met, so stale eviction was a
// silent no-op whenever a mapping redirected. This drives one real poll (mocked
// fetch) and asserts the stale lifecycle actually runs on the target.

describe("stale tracking with mapping.targetLayerId", () => {
    const fc = {
        type: "FeatureCollection",
        features: [{ type: "Feature", id: "F1", properties: { id: "F1" }, geometry: null }],
    };
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Stub the global fetch so happy-dom's real fetch (which aborts under fake
        // timers) never runs. mockResolvedValue keeps the poll fully synchronous once
        // microtasks flush.
        fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(fc) });
        vi.stubGlobal("fetch", fetchMock);
        vi.useFakeTimers();
    });

    afterEach(() => {
        stop("source-layer");
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("evicts stale features on the mapped target layer, not the source", async () => {
        _layers["source-layer"] = {
            id: "source-layer",
            config: pollingLayerConfig({
                idField: "id",
                staleTimeoutMs: 5_000,
                mapping: { targetLayerId: "target-layer" },
            }),
        };
        _layers["target-layer"] = { id: "target-layer", features: [] };

        start("source-layer");
        // Flush the immediate poll's microtask chain: fetch → json → decode →
        // applyUpdates → touch(target). The source fires it as an unawaited promise,
        // so pump microtasks rather than relying on a timer tick.
        for (let i = 0; i < 10; i++) await Promise.resolve();

        expect(fetchMock).toHaveBeenCalled(); // the poll actually ran
        // applyUpdates wrote to the TARGET layer (proves the handler + touch fired there).
        expect(mockGeoJSON.updateLayerData).toHaveBeenCalledWith(
            "target-layer",
            expect.objectContaining({ type: "FeatureCollection" })
        );

        // Nothing is stale yet (age 0 < 5 s).
        expect(getStatus("source-layer").staleCount).toBe(0);

        // Fire the 10 s stale check: F1's age (10 s) now exceeds the 5 s timeout.
        await vi.advanceTimersByTimeAsync(11_000);

        // With the fix, tracking is keyed on "target-layer" (where touch wrote), so the
        // check finds F1 and evicts it. Before the fix it looked under "source-layer",
        // found nothing, and staleCount stayed 0.
        expect(getStatus("source-layer").staleCount).toBeGreaterThan(0);
    });
});

// ── registerDecoder ───────────────────────────────────────────────────────────

describe("registerDecoder", () => {
    it("accepts a custom decoder without throwing", () => {
        expect(() => registerDecoder("my-format", new NoOpDecoder())).not.toThrow();
    });

    it("uses a custom decoder when starting a layer", () => {
        registerDecoder("custom", new NoOpDecoder());
        _layers["custom-layer"] = {
            id: "custom-layer",
            config: pollingLayerConfig({ decoder: "custom" }),
        };
        start("custom-layer");
        expect(getStatus("custom-layer").active).toBe(true);
        stop("custom-layer");
    });

    it("errors on unknown decoder name", () => {
        _layers["bad-decoder"] = {
            id: "bad-decoder",
            config: pollingLayerConfig({ decoder: "not-registered" }),
        };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        start("bad-decoder");
        expect(err).toHaveBeenCalledWith(expect.stringContaining("unknown decoder"));
        err.mockRestore();
    });
});

// ── bootFromProfile ───────────────────────────────────────────────────────────

describe("bootFromProfile", () => {
    it("starts all enabled layers from profile", () => {
        _layers["enabled1"] = { id: "enabled1", config: pollingLayerConfig({ enabled: true }) };
        _layers["enabled2"] = { id: "enabled2", config: pollingLayerConfig({ enabled: true }) };
        bootFromProfile();
        expect(getStatus("enabled1").active).toBe(true);
        expect(getStatus("enabled2").active).toBe(true);
    });

    it("skips layers with enabled: false", () => {
        _layers["disabled"] = { id: "disabled", config: pollingLayerConfig({ enabled: false }) };
        bootFromProfile();
        expect(getStatus("disabled").active).toBe(false);
    });

    it("skips layers without data.realtime", () => {
        _layers["plain"] = { id: "plain", config: {} };
        bootFromProfile();
        expect(getStatus("plain").active).toBe(false);
    });

    it("is safe when GeoLeaf.GeoJSON is absent", () => {
        (globalThis as unknown as { GeoLeaf: unknown }).GeoLeaf = {};
        expect(() => bootFromProfile()).not.toThrow();
        (globalThis as unknown as { GeoLeaf: unknown }).GeoLeaf = { GeoJSON: mockGeoJSON };
    });

    it("reads realtime block from nested config.data.realtime (profile schema)", () => {
        _layers["nested"] = {
            id: "nested",
            config: {
                data: {
                    dataUrl: "https://example.com/initial.geojson",
                    realtime: {
                        enabled: true,
                        source: "polling",
                        url: "https://example.com/rt.geojson",
                        decoder: "json",
                        intervalMs: 60_000,
                    },
                },
            },
        };
        bootFromProfile();
        expect(getStatus("nested").active).toBe(true);
    });

    it("logs error for invalid config and continues", () => {
        _layers["bad-rt"] = {
            id: "bad-rt",
            config: {
                realtime: { enabled: true, source: "polling", decoder: "json" }, // missing url
            },
        };
        _layers["good-rt"] = { id: "good-rt", config: pollingLayerConfig({ enabled: true }) };

        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        bootFromProfile();
        err.mockRestore();

        expect(getStatus("good-rt").active).toBe(true);
        expect(getStatus("bad-rt").active).toBe(false);
    });
});
