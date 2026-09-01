/**
 * T10.3.9+10 — layer-manager-geojson-bridge-branches.test.js
 * Covers: src/kernel/geojson/layers/integration.ts
 * Strategy: await import() + mock GeoJSONShared, getLog, globalThis.GeoLeaf
 */
"use strict";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock GeoJSONShared with controllable state
const _mockLayers = new Map();
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        get state() {
            return { layers: _mockLayers };
        },
    },
}));

vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    })),
}));

// Helper to create a mock layer data object
function makeLayerData(overrides = {}) {
    return {
        label: "Test Layer",
        visible: true,
        layer: { _type: "geojson" },
        currentStyle: null,
        config: {
            style: null,
            pointStyle: null,
            labels: null,
            styles: null,
            themes: null,
            zIndex: 0,
            layerManagerId: null,
            ...overrides.config,
        },
        ...overrides,
    };
}

describe("LayerManager Integration (T10.3.9+10)", () => {
    let LayerManagerIntegration;
    let mockGeoLeafLayerManager;

    beforeAll(async () => {
        const mod = await import("../../src/kernel/geojson/layers/integration.ts");
        LayerManagerIntegration = mod.LayerManagerIntegration;
    });

    beforeEach(() => {
        _mockLayers.clear();
        vi.clearAllMocks();

        // Setup global GeoLeaf.LayerManager mock
        mockGeoLeafLayerManager = {
            _registerGeoJsonLayer: vi.fn(),
        };
        if (!globalThis.GeoLeaf) globalThis.GeoLeaf = {};
        globalThis.GeoLeaf.LayerManager = mockGeoLeafLayerManager;

        // Setup LayerManager.detectLayerType on the exported object
        if (LayerManagerIntegration) {
            LayerManagerIntegration.detectLayerType = vi.fn((layer) => {
                return layer?._type ?? "other";
            });
        }
    });

    afterEach(() => {
        if (globalThis.GeoLeaf) {
            delete globalThis.GeoLeaf.LayerManager;
        }
    });

    // The `_resolveLegendType` / `_resolveLayerColor` blocks were removed on
    // 11/08/2026 WITH the functions they named. They fed `SectionItem.type`
    // and `.color`, two fields the registration payload does not declare and
    // nobody reread. 🛑 Their deletion turned NO test red: these cases
    // exercised the lines for coverage without ever asserting their result.
    // ── _resolveLayerLabels (via registerWithLayerManager) ───────────────────

    describe("_resolveLayerLabels()", () => {
        it("returns hasLabels=true when config.labels.enabled is true", () => {
            _mockLayers.set(
                "ll1",
                makeLayerData({
                    config: { labels: { enabled: true, field: "name" } },
                })
            );
            LayerManagerIntegration.registerWithLayerManager();
            const call = mockGeoLeafLayerManager._registerGeoJsonLayer.mock.calls[0];
            expect(call[1].labels).not.toBeNull();
        });

        it("returns hasLabels=true when currentStyle.label.enabled is true", () => {
            _mockLayers.set("ll2", {
                ...makeLayerData({ config: { labels: null } }),
                currentStyle: { label: { enabled: true } },
            });
            LayerManagerIntegration.registerWithLayerManager();
            const call = mockGeoLeafLayerManager._registerGeoJsonLayer.mock.calls[0];
            expect(call[1].labels).toEqual({ enabled: true });
        });

        it("returns hasLabels=false when no labels config", () => {
            _mockLayers.set(
                "ll3",
                makeLayerData({
                    config: { labels: null },
                })
            );
            LayerManagerIntegration.registerWithLayerManager();
            const call = mockGeoLeafLayerManager._registerGeoJsonLayer.mock.calls[0];
            expect(call[1].labels).toBeNull();
        });
    });

    // ── registerWithLayerManager: edge cases ──────────────────────────────────

    describe("registerWithLayerManager()", () => {
        it("warns and returns early when LayerManager is unavailable", () => {
            _mockLayers.set("lw1", makeLayerData({}));
            delete globalThis.GeoLeaf.LayerManager;
            expect(() => LayerManagerIntegration.registerWithLayerManager()).not.toThrow();
        });

        it("warns and returns early when _registerGeoJsonLayer is not a function", () => {
            _mockLayers.set("lw2", makeLayerData({}));
            globalThis.GeoLeaf.LayerManager = { _registerGeoJsonLayer: "not-a-function" };
            expect(() => LayerManagerIntegration.registerWithLayerManager()).not.toThrow();
        });

        it("groups multiple layers in same section", () => {
            _mockLayers.set(
                "section1_a",
                makeLayerData({
                    config: { layerManagerId: "group1" },
                })
            );
            _mockLayers.set(
                "section1_b",
                makeLayerData({
                    config: { layerManagerId: "group1" },
                })
            );
            LayerManagerIntegration.registerWithLayerManager();
            expect(mockGeoLeafLayerManager._registerGeoJsonLayer).toHaveBeenCalledTimes(2);
        });

        it("handles layers across different sections", () => {
            _mockLayers.set("sa", makeLayerData({ config: { layerManagerId: "sec-a" } }));
            _mockLayers.set("sb", makeLayerData({ config: { layerManagerId: "sec-b" } }));
            LayerManagerIntegration.registerWithLayerManager();
            expect(mockGeoLeafLayerManager._registerGeoJsonLayer).toHaveBeenCalledTimes(2);
        });

        it("uses 'geojson-default' section when layerManagerId is absent", () => {
            _mockLayers.set("ldefault", makeLayerData({ config: { layerManagerId: null } }));
            LayerManagerIntegration.registerWithLayerManager();
            const call = mockGeoLeafLayerManager._registerGeoJsonLayer.mock.calls[0];
            expect(call[1].layerManagerId).toBe("geojson-default");
        });

        it("sorts items by descending zIndex within a section", () => {
            _mockLayers.set(
                "z_low",
                makeLayerData({
                    label: "Low",
                    config: { layerManagerId: "ztest", zIndex: 1 },
                })
            );
            _mockLayers.set(
                "z_high",
                makeLayerData({
                    label: "High",
                    config: { layerManagerId: "ztest", zIndex: 10 },
                })
            );
            LayerManagerIntegration.registerWithLayerManager();
            const calls = mockGeoLeafLayerManager._registerGeoJsonLayer.mock.calls;
            // First registered should be the one with higher zIndex
            expect(calls[0][0]).toBe("z_high");
        });

        it("passes themes and styles metadata to LayerManager", () => {
            _mockLayers.set(
                "meta_layer",
                makeLayerData({
                    config: {
                        themes: ["theme1", "theme2"],
                        styles: { available: [{ id: "s1", file: "s1.json" }] },
                    },
                })
            );
            LayerManagerIntegration.registerWithLayerManager();
            const call = mockGeoLeafLayerManager._registerGeoJsonLayer.mock.calls[0];
            expect(call[1].themes).toEqual(["theme1", "theme2"]);
            expect(call[1].styles).toBeDefined();
        });

        it("runs without error when state has no layers", () => {
            _mockLayers.clear();
            expect(() => LayerManagerIntegration.registerWithLayerManager()).not.toThrow();
        });
    });
});
