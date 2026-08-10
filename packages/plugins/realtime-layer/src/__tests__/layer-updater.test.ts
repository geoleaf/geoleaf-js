/**
 * layer-updater.test.ts — tests for applyUpdates() (replace / upsert / merge modes)
 *
 * We mock the GeoLeaf global so the updater can read/write layer data without
 * requiring the actual @geoleaf/core bundle.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyUpdates } from "../layer-updater.js";
import type { RealtimeConfig } from "../config.js";
import type { DecodedUpdate } from "../decoders/i-decoder.js";

// ── GeoLeaf mock ──────────────────────────────────────────────────────────────

type Feature = {
    type: "Feature";
    properties: Record<string, unknown> | null;
    geometry: unknown;
};

let _store: Record<string, { type: string; features: Feature[] }> = {};

const mockGeoJSON = {
    getLayerData: vi.fn((id: string) => _store[id] ?? null),
    updateLayerData: vi.fn((id: string, data: unknown) => {
        _store[id] = data as { type: string; features: Feature[] };
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
        updateMode: "upsert",
        idField: "id",
        ...overrides,
    };
}

function getFeatures(layerId = "test"): Feature[] {
    return _store[layerId]?.features ?? [];
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    _store = {
        test: {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: { id: "A", val: 1 }, geometry: null },
                { type: "Feature", properties: { id: "B", val: 2 }, geometry: null },
            ],
        },
    };
    mockGeoJSON.getLayerData.mockClear();
    mockGeoJSON.updateLayerData.mockClear();
});

// ── replace mode ──────────────────────────────────────────────────────────────

describe("replace mode", () => {
    it("replaces all features with incoming updates", () => {
        const updates: DecodedUpdate[] = [
            { id: "X", properties: { name: "X" }, action: "upsert" },
            { id: "Y", properties: { name: "Y" }, action: "upsert" },
        ];
        applyUpdates("test", updates, makeConfig({ updateMode: "replace" }));

        const features = getFeatures();
        expect(features).toHaveLength(2);
        expect(features[0].properties?.["_realtimeId"]).toBe("X");
        expect(features[1].properties?.["_realtimeId"]).toBe("Y");
    });

    it("replaces with empty array when updates is empty", () => {
        applyUpdates("test", [], makeConfig({ updateMode: "replace" }));
        expect(getFeatures()).toHaveLength(0);
    });

    it("preserves geometry in replace mode", () => {
        const updates: DecodedUpdate[] = [
            {
                id: "P",
                properties: {},
                geometry: { type: "Point", coordinates: [2.3, 48.8] },
                action: "upsert",
            },
        ];
        applyUpdates("test", updates, makeConfig({ updateMode: "replace" }));
        const f = getFeatures()[0];
        expect((f.geometry as { type: string })?.type).toBe("Point");
    });
});

// ── upsert mode ───────────────────────────────────────────────────────────────

describe("upsert mode", () => {
    it("updates an existing feature by idField", () => {
        const updates: DecodedUpdate[] = [{ id: "A", properties: { val: 99 }, action: "upsert" }];
        applyUpdates("test", updates, makeConfig({ updateMode: "upsert", idField: "id" }));

        const features = getFeatures();
        const a = features.find((f) => f.properties?.["id"] === "A");
        expect(a?.properties?.["val"]).toBe(99);
        expect(features).toHaveLength(2); // no new feature added
    });

    it("inserts a new feature when id does not exist", () => {
        const updates: DecodedUpdate[] = [{ id: "C", properties: { val: 3 }, action: "upsert" }];
        applyUpdates("test", updates, makeConfig({ updateMode: "upsert", idField: "id" }));

        const features = getFeatures();
        expect(features).toHaveLength(3);
        const c = features.find((f) => f.properties?.["id"] === "C");
        expect(c).toBeDefined();
    });

    it("handles delete action", () => {
        const updates: DecodedUpdate[] = [{ id: "A", action: "delete" }];
        applyUpdates("test", updates, makeConfig({ updateMode: "upsert", idField: "id" }));

        const features = getFeatures();
        expect(features).toHaveLength(1);
        expect(features[0].properties?.["id"]).toBe("B");
    });

    it("updates geometry when present in upsert", () => {
        const updates: DecodedUpdate[] = [
            {
                id: "A",
                properties: { val: 10 },
                geometry: { type: "Point", coordinates: [1, 2] },
                action: "upsert",
            },
        ];
        applyUpdates("test", updates, makeConfig({ updateMode: "upsert", idField: "id" }));
        const a = getFeatures().find((f) => f.properties?.["id"] === "A");
        expect((a?.geometry as { type: string })?.type).toBe("Point");
    });

    it("uses _realtimeId when idField is undefined", () => {
        const updates: DecodedUpdate[] = [{ id: "NEW", properties: { x: 1 }, action: "upsert" }];
        applyUpdates("test", updates, makeConfig({ updateMode: "upsert", idField: undefined }));
        const features = getFeatures();
        const newF = features.find((f) => f.properties?.["_realtimeId"] === "NEW");
        expect(newF).toBeDefined();
    });

    it("is no-op when GeoLeaf.GeoJSON is unavailable", () => {
        (globalThis as unknown as { GeoLeaf: unknown }).GeoLeaf = {};
        applyUpdates("test", [{ id: "X", action: "upsert" }], makeConfig());
        // Restore
        (globalThis as unknown as { GeoLeaf: unknown }).GeoLeaf = { GeoJSON: mockGeoJSON };
        expect(mockGeoJSON.updateLayerData).not.toHaveBeenCalled();
    });

    it("handles layer with no existing data (null)", () => {
        _store = {}; // no data for layer
        const updates: DecodedUpdate[] = [{ id: "Z", properties: { v: 1 }, action: "upsert" }];
        applyUpdates("test", updates, makeConfig({ updateMode: "upsert", idField: "id" }));
        expect(getFeatures()).toHaveLength(1);
    });
});

// ── merge mode ────────────────────────────────────────────────────────────────

describe("merge mode", () => {
    it("merges properties onto an existing feature", () => {
        const updates: DecodedUpdate[] = [
            { id: "A", properties: { extra: "merged" }, action: "upsert" },
        ];
        applyUpdates("test", updates, makeConfig({ updateMode: "merge", idField: "id" }));

        const a = getFeatures().find((f) => f.properties?.["id"] === "A");
        expect(a?.properties?.["val"]).toBe(1); // original preserved
        expect(a?.properties?.["extra"]).toBe("merged"); // merged in
    });

    it("does NOT insert new features in merge mode", () => {
        const updates: DecodedUpdate[] = [{ id: "NEW", properties: { v: 1 }, action: "upsert" }];
        applyUpdates("test", updates, makeConfig({ updateMode: "merge", idField: "id" }));
        expect(getFeatures()).toHaveLength(2); // unchanged
    });

    it("does NOT update geometry in merge mode", () => {
        const updates: DecodedUpdate[] = [
            {
                id: "A",
                properties: { v: 5 },
                geometry: { type: "Point", coordinates: [9, 9] },
                action: "upsert",
            },
        ];
        applyUpdates("test", updates, makeConfig({ updateMode: "merge", idField: "id" }));
        const a = getFeatures().find((f) => f.properties?.["id"] === "A");
        expect(a?.geometry).toBeNull(); // geometry not touched
    });

    it("handles delete in merge mode", () => {
        const updates: DecodedUpdate[] = [{ id: "B", action: "delete" }];
        applyUpdates("test", updates, makeConfig({ updateMode: "merge", idField: "id" }));
        expect(getFeatures()).toHaveLength(1);
    });
});

// ── targetLayerId override ────────────────────────────────────────────────────

describe("targetLayerId", () => {
    it("writes to targetLayerId when provided", () => {
        _store["other"] = { type: "FeatureCollection", features: [] };
        const updates: DecodedUpdate[] = [{ id: "X", properties: {}, action: "upsert" }];
        applyUpdates("test", updates, makeConfig({ updateMode: "upsert", idField: "id" }), "other");
        expect(_store["other"].features).toHaveLength(1);
        expect(_store["test"].features).toHaveLength(2); // test layer unchanged
    });
});
