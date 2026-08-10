/**
 * stale-tracking.test.ts — tests for stale tracking logic
 *
 * Uses vi.useFakeTimers() to control setInterval without real waiting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    touch,
    startTracking,
    stopTracking,
    registerStaleAction,
    getStaleCount,
} from "../stale-tracking.js";
import type { RealtimeConfig } from "../config.js";

// ── GeoLeaf mock ──────────────────────────────────────────────────────────────

type Feature = {
    type?: string;
    properties?: Record<string, unknown> | null;
    geometry?: unknown;
};

let _layers: Record<string, { features: Feature[] }> = {};

const mockGeoJSON = {
    getLayerData: vi.fn((id: string) => _layers[id] ?? null),
    updateLayerData: vi.fn((id: string, data: unknown) => {
        const d = data as { features: Feature[] };
        _layers[id] = { features: d.features };
    }),
};

(globalThis as unknown as { GeoLeaf: unknown }).GeoLeaf = { GeoJSON: mockGeoJSON };

// ── helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<RealtimeConfig>): RealtimeConfig {
    return {
        enabled: true,
        source: "polling",
        decoder: "json",
        url: "https://example.com",
        staleTimeoutMs: 5_000,
        staleAction: "remove",
        idField: "id",
        ...overrides,
    };
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.useFakeTimers();
    _layers = {};
    mockGeoJSON.getLayerData.mockClear();
    mockGeoJSON.updateLayerData.mockClear();
});

afterEach(() => {
    stopTracking("test");
    stopTracking("layer-a");
    stopTracking("layer-b");
    vi.useRealTimers();
});

// ── touch + getStaleCount ─────────────────────────────────────────────────────

describe("touch / getStaleCount", () => {
    it("getStaleCount returns 0 for unknown layer", () => {
        expect(getStaleCount("unknown")).toBe(0);
    });

    it("touch does not throw for a new layer", () => {
        expect(() => touch("test", "f1")).not.toThrow();
    });
});

// ── startTracking / stopTracking ──────────────────────────────────────────────

describe("startTracking / stopTracking", () => {
    it("does not start timer if staleTimeoutMs is absent", () => {
        const config = makeConfig({ staleTimeoutMs: undefined });
        expect(() => startTracking("test", config)).not.toThrow();
    });

    it("startTracking does not throw for valid config", () => {
        expect(() => startTracking("test", makeConfig())).not.toThrow();
    });

    it("stopTracking does not throw for untracked layer", () => {
        expect(() => stopTracking("no-such-layer")).not.toThrow();
    });

    it("resets staleCount on stop", () => {
        startTracking("test", makeConfig());
        stopTracking("test");
        expect(getStaleCount("test")).toBe(0);
    });
});

// ── stale remove action ───────────────────────────────────────────────────────

describe("stale remove action", () => {
    it("removes tracked features that become stale", () => {
        _layers["test"] = {
            features: [
                { type: "Feature", properties: { id: "A" }, geometry: null },
                { type: "Feature", properties: { id: "B" }, geometry: null },
            ],
        };

        startTracking("test", makeConfig({ staleTimeoutMs: 5_000, staleAction: "remove" }));

        // Touch only B — it will become stale after 5 s without a fresh update.
        // A is never touched so the stale-tracking never tracks it (it stays in the layer).
        touch("test", "B");

        // Advance 16 s: check interval fires at 10 s, when B's age = 10 s > 5 s timeout.
        vi.advanceTimersByTime(16_000);

        const ids = (_layers["test"]?.features ?? []).map((f) => f.properties?.["id"]);
        expect(ids).not.toContain("B"); // B was tracked and became stale → removed
        expect(ids).toContain("A"); // A was never tracked → untouched
    });

    it("increments staleCount when features are evicted", () => {
        _layers["test"] = {
            features: [{ type: "Feature", properties: { id: "stale1" }, geometry: null }],
        };

        startTracking("test", makeConfig({ staleTimeoutMs: 1_000 }));
        touch("test", "stale1");

        vi.advanceTimersByTime(2_000); // past timeout
        vi.advanceTimersByTime(10_000); // trigger check

        expect(getStaleCount("test")).toBeGreaterThan(0);
    });
});

// ── stale dim action ──────────────────────────────────────────────────────────

describe("stale dim action", () => {
    it("sets _stale: true on stale features", () => {
        _layers["test"] = {
            features: [{ type: "Feature", properties: { id: "X" }, geometry: null }],
        };

        startTracking("test", makeConfig({ staleTimeoutMs: 1_000, staleAction: "dim" }));
        touch("test", "X");

        vi.advanceTimersByTime(2_000);
        vi.advanceTimersByTime(10_000);

        const f = _layers["test"]?.features[0];
        expect(f?.properties?.["_stale"]).toBe(true);
    });
});

// ── id resolution: features not keyed on `id` ─────────────────────────────────
// Regression: the stale-tracking used to resolve identity as `id ?? _id` only,
// while the updater stores inbound ids under `[idField ?? "_realtimeId"]`. A feature
// written under `_realtimeId` or a custom idField was therefore unreachable to
// eviction — `remove`/`dim` silently no-op'd. These pin the shared resolution.

describe("stale eviction honours id storage (idField / _realtimeId)", () => {
    it("removes a stale feature stored under _realtimeId (no idField)", () => {
        _layers["test"] = {
            features: [{ type: "Feature", properties: { _realtimeId: "F1" }, geometry: null }],
        };

        startTracking(
            "test",
            makeConfig({ idField: undefined, staleTimeoutMs: 1_000, staleAction: "remove" })
        );
        touch("test", "F1");

        vi.advanceTimersByTime(2_000);
        vi.advanceTimersByTime(10_000);

        const ids = (_layers["test"]?.features ?? []).map((f) => f.properties?.["_realtimeId"]);
        expect(ids).not.toContain("F1");
        expect(getStaleCount("test")).toBeGreaterThan(0);
    });

    it("dims a stale feature matched by a custom idField", () => {
        _layers["test"] = {
            features: [{ type: "Feature", properties: { vehicle_id: "V1" }, geometry: null }],
        };

        startTracking(
            "test",
            makeConfig({ idField: "vehicle_id", staleTimeoutMs: 1_000, staleAction: "dim" })
        );
        touch("test", "V1");

        vi.advanceTimersByTime(2_000);
        vi.advanceTimersByTime(10_000);

        const f = _layers["test"]?.features[0];
        expect(f?.properties?.["_stale"]).toBe(true);
    });
});

// ── custom stale action ───────────────────────────────────────────────────────

describe("registerStaleAction", () => {
    it("calls a custom handler for unknown action name", () => {
        const handler = vi.fn();
        registerStaleAction("notify", handler);

        _layers["test"] = {
            features: [{ type: "Feature", properties: { id: "C" }, geometry: null }],
        };

        startTracking("test", makeConfig({ staleTimeoutMs: 1_000, staleAction: "notify" }));
        touch("test", "C");

        vi.advanceTimersByTime(2_000);
        vi.advanceTimersByTime(10_000);

        expect(handler).toHaveBeenCalledWith("test", "C", expect.any(Object));
    });
});
