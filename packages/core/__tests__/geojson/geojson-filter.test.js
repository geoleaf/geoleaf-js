/**
 * Tests for geojson/geojson-filter.ts
 * S5B.3 — dedicated test for the extracted filter helpers
 *         (_resolveGeometryFilteredIds, _applyFeatureVisibilityForLayer)
 *
 * Strategy: vi.hoisted() → vi.mock(shared.js) → static import.
 * GeoJSONShared.state.adapter is mutated per-test for adapter branch coverage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockShared } = vi.hoisted(() => {
    const mockShared = {
        state: {
            adapter: null,
            layers: new Map(),
        },
    };
    return { mockShared };
});

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: mockShared,
}));

import {
    _resolveGeometryFilteredIds,
    _applyFeatureVisibilityForLayer,
    getFeatures,
} from "../../src/kernel/geojson/geojson-filter.ts";

describe("geojson/geojson-filter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockShared.state = { adapter: null, layers: new Map() };
    });

    // ─── _resolveGeometryFilteredIds ──────────────────────────────────────────

    describe("_resolveGeometryFilteredIds", () => {
        it("uses all layer keys when layerIds option is absent", () => {
            const state = {
                layers: new Map([
                    ["l1", { geometryType: "point" }],
                    ["l2", { geometryType: "line" }],
                ]),
            };
            const result = _resolveGeometryFilteredIds(state, {});
            expect(result).toEqual(["l1", "l2"]);
        });

        it("uses layerIds array when provided", () => {
            const state = {
                layers: new Map([
                    ["a", {}],
                    ["b", {}],
                    ["c", {}],
                ]),
            };
            const result = _resolveGeometryFilteredIds(state, { layerIds: ["a", "c"] });
            expect(result).toEqual(["a", "c"]);
        });

        it("wraps string layerIds in an array", () => {
            const state = { layers: new Map([["myLayer", {}]]) };
            const result = _resolveGeometryFilteredIds(state, { layerIds: "myLayer" });
            expect(result).toEqual(["myLayer"]);
        });

        it("returns all layerIds unchanged when no geometryType option", () => {
            const state = { layers: new Map() };
            const result = _resolveGeometryFilteredIds(state, { layerIds: ["a", "b"] });
            expect(result).toEqual(["a", "b"]);
        });

        it("normalizes poi alias to point", () => {
            const state = {
                layers: new Map([
                    ["l1", { geometryType: "point" }],
                    ["l2", { geometryType: "line" }],
                ]),
            };
            expect(_resolveGeometryFilteredIds(state, { geometryType: "poi" })).toEqual(["l1"]);
        });

        it("normalizes route alias to line", () => {
            const state = {
                layers: new Map([
                    ["l1", { geometryType: "line" }],
                    ["l2", { geometryType: "point" }],
                ]),
            };
            expect(_resolveGeometryFilteredIds(state, { geometryType: "route" })).toEqual(["l1"]);
        });

        it("normalizes linestring alias to line", () => {
            const state = {
                layers: new Map([["l1", { geometryType: "linestring" }]]),
            };
            expect(_resolveGeometryFilteredIds(state, { geometryType: "linestring" })).toEqual([
                "l1",
            ]);
        });

        it("normalizes area alias to polygon", () => {
            const state = {
                layers: new Map([["l1", { geometryType: "polygon" }]]),
            };
            expect(_resolveGeometryFilteredIds(state, { geometryType: "area" })).toEqual(["l1"]);
        });

        it("passes through non-aliased geometryType (point)", () => {
            const state = {
                layers: new Map([
                    ["l1", { geometryType: "point" }],
                    ["l2", { geometryType: "polygon" }],
                ]),
            };
            expect(_resolveGeometryFilteredIds(state, { geometryType: "point" })).toEqual(["l1"]);
        });

        it("excludes layer with null data in map", () => {
            const layers = new Map();
            layers.set("l1", null);
            const state = { layers };
            const result = _resolveGeometryFilteredIds(state, { geometryType: "point" });
            expect(result).toEqual([]);
        });

        it("excludes layer whose geometryType doesn't match filter", () => {
            const state = {
                layers: new Map([["l1", { geometryType: "line" }]]),
            };
            expect(_resolveGeometryFilteredIds(state, { geometryType: "point" })).toEqual([]);
        });

        it("handles layer with empty geometryType string", () => {
            const state = {
                layers: new Map([["l1", { geometryType: "" }]]),
            };
            expect(_resolveGeometryFilteredIds(state, { geometryType: "point" })).toEqual([]);
        });

        it("layer with aliased geometryType (linestring) matches route filter", () => {
            const state = {
                layers: new Map([["l1", { geometryType: "linestring" }]]),
            };
            expect(_resolveGeometryFilteredIds(state, { geometryType: "route" })).toEqual(["l1"]);
        });
    });

    // ─── _applyFeatureVisibilityForLayer ──────────────────────────────────────

    describe("_applyFeatureVisibilityForLayer", () => {
        it("returns early when features array is empty", () => {
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { features: [], geometryType: "point" },
                () => true,
                "l1",
                stats
            );
            expect(stats.total).toBe(0);
        });

        it("returns early when features property is undefined", () => {
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer({ geometryType: "point" }, () => true, "l1", stats);
            expect(stats.total).toBe(0);
        });

        it("bypasses filter when config.search.enabled is false", () => {
            const stats = { total: 0, visible: 0, filtered: 0 };
            const layerData = {
                geometryType: "point",
                features: [{ id: 1 }, { id: 2 }],
                config: { search: { enabled: false } },
            };
            _applyFeatureVisibilityForLayer(layerData, () => false, "l1", stats);
            expect(stats.total).toBe(2);
            expect(stats.visible).toBe(2);
            expect(stats.filtered).toBe(0);
        });

        it("bypasses filter for line layer when search.enabled is not explicitly true", () => {
            const stats = { total: 0, visible: 0, filtered: 0 };
            const layerData = {
                geometryType: "line",
                features: [{ id: 1 }],
                config: {},
            };
            _applyFeatureVisibilityForLayer(layerData, () => false, "l1", stats);
            expect(stats.total).toBe(1);
            expect(stats.visible).toBe(1);
            expect(stats.filtered).toBe(0);
        });

        it("bypasses for linestring (alias) when search.enabled absent", () => {
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "linestring", features: [{ id: 1 }], config: {} },
                () => false,
                "l1",
                stats
            );
            expect(stats.visible).toBe(1);
        });

        it("bypasses for polyline when search.enabled absent", () => {
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "polyline", features: [{ id: 1 }], config: {} },
                () => false,
                "l1",
                stats
            );
            expect(stats.visible).toBe(1);
        });

        it("does NOT bypass for line layer when search.enabled is true", () => {
            mockShared.state.adapter = null;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                {
                    geometryType: "line",
                    features: [{ id: 1 }, { id: 2 }],
                    config: { search: { enabled: true } },
                },
                () => false,
                "l1",
                stats
            );
            expect(stats.total).toBe(2);
            expect(stats.visible).toBe(0);
            expect(stats.filtered).toBe(2);
        });

        it("filters features and accumulates stats correctly", () => {
            mockShared.state.adapter = null;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                {
                    geometryType: "point",
                    features: [{ id: 1 }, { id: 2 }, { id: 3 }],
                    config: {},
                },
                (f) => f.id !== 2,
                "l1",
                stats
            );
            expect(stats.total).toBe(3);
            expect(stats.visible).toBe(2);
            expect(stats.filtered).toBe(1);
        });

        it("calls adapter.updateLayerData with visible features", () => {
            const mockAdapter = { updateLayerData: vi.fn() };
            mockShared.state.adapter = mockAdapter;
            const features = [{ id: 1 }, { id: 2 }];
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "point", features, config: {} },
                () => true,
                "myLayer",
                stats
            );
            expect(mockAdapter.updateLayerData).toHaveBeenCalledWith("myLayer", {
                type: "FeatureCollection",
                features,
            });
        });

        it("calls adapter.updateLayerData with only passing features on partial match", () => {
            const mockAdapter = { updateLayerData: vi.fn() };
            mockShared.state.adapter = mockAdapter;
            const features = [{ id: 1 }, { id: 2 }, { id: 3 }];
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "point", features, config: {} },
                (f) => f.id !== 2,
                "l1",
                stats
            );
            expect(mockAdapter.updateLayerData).toHaveBeenCalledWith("l1", {
                type: "FeatureCollection",
                features: [{ id: 1 }, { id: 3 }],
            });
        });

        it("does not call updateLayerData when adapter is null", () => {
            mockShared.state.adapter = null;
            const stats = { total: 0, visible: 0, filtered: 0 };
            expect(() => {
                _applyFeatureVisibilityForLayer(
                    { geometryType: "point", features: [{ id: 1 }], config: {} },
                    () => true,
                    "l1",
                    stats
                );
            }).not.toThrow();
        });

        it("does not call updateLayerData when adapter has no updateLayerData method", () => {
            mockShared.state.adapter = { someOtherMethod: vi.fn() };
            const stats = { total: 0, visible: 0, filtered: 0 };
            expect(() => {
                _applyFeatureVisibilityForLayer(
                    { geometryType: "point", features: [{ id: 1 }], config: {} },
                    () => true,
                    "l1",
                    stats
                );
            }).not.toThrow();
        });

        it("does not throw when GeoJSONShared.state is null", () => {
            mockShared.state = null;
            const stats = { total: 0, visible: 0, filtered: 0 };
            expect(() => {
                _applyFeatureVisibilityForLayer(
                    { geometryType: "point", features: [{ id: 1 }], config: {} },
                    () => true,
                    "l1",
                    stats
                );
            }).not.toThrow();
        });
    });

    // ─── GPU-native id filter (RM-P1) ─────────────────────────────────────────
    // Non-clustered layers whose features all carry a unique `properties.id`
    // apply the visible set via adapter.setLayerFilter (map.setFilter, no
    // re-tiling) instead of re-feeding the data via updateLayerData.

    describe("_applyFeatureVisibilityForLayer — GPU id filter", () => {
        const propIdFeatures = () => [
            { properties: { id: "a" } },
            { properties: { id: "b" } },
            { properties: { id: "c" } },
        ];

        it("routes a partial filter through setLayerFilter with a match-by-id expr", () => {
            const adapter = { setLayerFilter: vi.fn(), updateLayerData: vi.fn() };
            mockShared.state.adapter = adapter;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "point", features: propIdFeatures(), config: {} },
                (f) => f.properties.id !== "b",
                "l1",
                stats
            );
            expect(adapter.setLayerFilter).toHaveBeenCalledWith("l1", [
                "match",
                ["to-string", ["get", "id"]],
                ["a", "c"],
                true,
                false,
            ]);
            expect(adapter.updateLayerData).not.toHaveBeenCalled();
            expect(stats).toEqual({ total: 3, visible: 2, filtered: 1 });
        });

        it("clears the filter (null) when all features are visible", () => {
            const adapter = { setLayerFilter: vi.fn(), updateLayerData: vi.fn() };
            mockShared.state.adapter = adapter;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "point", features: propIdFeatures(), config: {} },
                () => true,
                "l1",
                stats
            );
            expect(adapter.setLayerFilter).toHaveBeenCalledWith("l1", null);
            expect(adapter.updateLayerData).not.toHaveBeenCalled();
        });

        it("uses a match-nothing sentinel when no feature is visible", () => {
            const adapter = { setLayerFilter: vi.fn(), updateLayerData: vi.fn() };
            mockShared.state.adapter = adapter;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "point", features: propIdFeatures(), config: {} },
                () => false,
                "l1",
                stats
            );
            const [, expr] = adapter.setLayerFilter.mock.calls[0];
            expect(expr[0]).toBe("match");
            expect(expr[2]).toHaveLength(1); // single sentinel id, no real ids
            expect(expr[2]).not.toContain("a");
            expect(adapter.updateLayerData).not.toHaveBeenCalled();
        });

        it("falls back to updateLayerData for a clustered layer (config.cluster)", () => {
            const adapter = { setLayerFilter: vi.fn(), updateLayerData: vi.fn() };
            mockShared.state.adapter = adapter;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "point", features: propIdFeatures(), config: { cluster: true } },
                (f) => f.properties.id !== "b",
                "l1",
                stats
            );
            expect(adapter.setLayerFilter).not.toHaveBeenCalled();
            expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
        });

        it("falls back for a layer with a clusterGroup handle", () => {
            const adapter = { setLayerFilter: vi.fn(), updateLayerData: vi.fn() };
            mockShared.state.adapter = adapter;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                { geometryType: "point", features: propIdFeatures(), config: {}, clusterGroup: {} },
                (f) => f.properties.id !== "b",
                "l1",
                stats
            );
            expect(adapter.setLayerFilter).not.toHaveBeenCalled();
            expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
        });

        it("falls back when a feature lacks properties.id", () => {
            const adapter = { setLayerFilter: vi.fn(), updateLayerData: vi.fn() };
            mockShared.state.adapter = adapter;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                {
                    geometryType: "point",
                    features: [{ properties: { id: "a" } }, { properties: {} }],
                    config: {},
                },
                () => true,
                "l1",
                stats
            );
            expect(adapter.setLayerFilter).not.toHaveBeenCalled();
            expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
        });

        it("falls back when properties.id values are not unique", () => {
            const adapter = { setLayerFilter: vi.fn(), updateLayerData: vi.fn() };
            mockShared.state.adapter = adapter;
            const stats = { total: 0, visible: 0, filtered: 0 };
            _applyFeatureVisibilityForLayer(
                {
                    geometryType: "point",
                    features: [{ properties: { id: "dup" } }, { properties: { id: "dup" } }],
                    config: {},
                },
                () => true,
                "l1",
                stats
            );
            expect(adapter.setLayerFilter).not.toHaveBeenCalled();
            expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
        });
    });

    // ─── getFeatures (moved from feature-filter.ts, RM-P0) ────────────────────

    describe("getFeatures", () => {
        it("returns empty array when state has no layers", () => {
            const result = getFeatures();
            expect(result).toEqual([]);
        });

        it("returns empty array when GeoJSONShared.state is null", () => {
            mockShared.state = null;
            expect(getFeatures()).toEqual([]);
        });

        it("returns all features with _layerId tag", () => {
            const f1 = { type: "Feature", properties: {} };
            const f2 = { type: "Feature", properties: {} };
            mockShared.state.layers.set("lyr1", { features: [f1], geometryType: "point" });
            mockShared.state.layers.set("lyr2", { features: [f2], geometryType: "polygon" });
            const result = getFeatures();
            expect(result).toHaveLength(2);
            expect(result[0]._layerId).toBe("lyr1");
            expect(result[1]._layerId).toBe("lyr2");
        });

        it("filters by layerIds option", () => {
            const f1 = { type: "Feature", properties: {} };
            const f2 = { type: "Feature", properties: {} };
            mockShared.state.layers.set("lyr1", { features: [f1], geometryType: "point" });
            mockShared.state.layers.set("lyr2", { features: [f2], geometryType: "polygon" });
            const result = getFeatures({ layerIds: ["lyr1"] });
            expect(result).toHaveLength(1);
            expect(result[0]._layerId).toBe("lyr1");
        });

        it("filters by geometryTypes option", () => {
            const f1 = { type: "Feature", properties: {} };
            const f2 = { type: "Feature", properties: {} };
            mockShared.state.layers.set("lyr1", { features: [f1], geometryType: "point" });
            mockShared.state.layers.set("lyr2", { features: [f2], geometryType: "polygon" });
            const result = getFeatures({ geometryTypes: ["point"] });
            expect(result).toHaveLength(1);
            expect(result[0]._layerId).toBe("lyr1");
        });

        it("skips null / undefined features", () => {
            mockShared.state.layers.set("lyr1", {
                features: [null, undefined, { type: "Feature" }],
                geometryType: "point",
            });
            expect(getFeatures()).toHaveLength(1);
        });

        it("skips non-object features", () => {
            mockShared.state.layers.set("lyr1", {
                features: ["string", 42, { type: "Feature" }],
                geometryType: "point",
            });
            expect(getFeatures()).toHaveLength(1);
        });

        it("returns empty array when layer has no features property", () => {
            mockShared.state.layers.set("lyr1", { geometryType: "point" });
            expect(getFeatures()).toEqual([]);
        });

        it("combines both layerIds and geometryTypes filters", () => {
            const f1 = { type: "Feature" };
            const f2 = { type: "Feature" };
            mockShared.state.layers.set("lyr1", { features: [f1], geometryType: "point" });
            mockShared.state.layers.set("lyr2", { features: [f2], geometryType: "point" });
            const result = getFeatures({ layerIds: ["lyr1"], geometryTypes: ["point"] });
            expect(result).toHaveLength(1);
        });
    });
});
