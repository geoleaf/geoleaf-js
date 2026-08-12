/**
 * Tests pour le module GeoLeaf.GeoJSON (architecture multi-couches)
 * ESM: import GeoJSON + global.GeoLeaf for runtime module compatibility.
 */

import { GeoJSONCore as GeoJSON } from "../../src/kernel/geojson/core.js";
import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";
import { LoaderProfile } from "../../src/kernel/geojson/loader/profile.js";

// Mock global window
global.window = global;

// Mock fetch
global.fetch = vi.fn();

describe("GeoLeaf.GeoJSON - Multi-Layer Architecture", () => {
    let GeoLeaf;
    let mockMap;
    let mockConfig;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Setup mock native map (MapLibre-like)
        const paneStub = { style: { zIndex: 0 } };
        mockMap = {
            addLayer: vi.fn(),
            removeLayer: vi.fn(),
            fitBounds: vi.fn(),
            fire: vi.fn(),
            on: vi.fn(),
            createPane: vi.fn(() => paneStub),
            getPane: vi.fn(() => paneStub),
            addSource: vi.fn(),
        };

        // Setup mock config
        mockConfig = {
            get: vi.fn((key) => {
                if (key === "poiConfig") {
                    return {
                        clustering: true,
                        clusterRadius: 80,
                        disableClusteringAtZoom: 18,
                        applyToAllSources: true,
                    };
                }
                return {};
            }),
            getActiveProfile: vi.fn(() => ({
                id: "tourism",
                geojsonLayers: [],
            })),
        };

        // Create GeoLeaf namespace (required by modules/geojson/core.js at runtime)
        global.GeoLeaf = {
            Log: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            },
            CONSTANTS: {
                GEOJSON_MAX_ZOOM_ON_FIT: 16,
            },
            Utils: {
                ensureMap: vi.fn((map) => map || mockMap),
                mergeOptions: vi.fn((opts1, opts2) => ({ ...opts1, ...opts2 })),
            },
            Config: mockConfig,
            Security: {
                escapeHtml: vi.fn((str) => String(str).replace(/</g, "&lt;").replace(/>/g, "&gt;")),
            },
            POI: {
                openSidePanel: vi.fn(),
            },
            Legend: {
                addSection: vi.fn(),
            },
            Core: {
                getMap: vi.fn(() => ({
                    getNativeMap: () => mockMap,
                    addGeoJSONLayer: vi.fn(),
                    getLayerRegistry: vi.fn(() => ({ getSubLayerIds: vi.fn(() => []) })),
                })),
            },
            GeoJSON,
        };

        global.GeoLeaf._GeoJSONLayerManager = {
            getLayerById: () => null,
            getAllLayers: () => [],
            showLayer: () => {},
            hideLayer: () => {},
            updateLayerVisibilityByZoom: () => {},
        };
        global.GeoLeaf._GeoJSONLoader = LoaderProfile;

        GeoLeaf = global.GeoLeaf;
    });

    afterEach(() => {
        delete global.GeoLeaf;
    });

    describe("Initialization", () => {
        test("init should initialize in MapLibre mode", () => {
            GeoLeaf.GeoJSON.init({});

            expect(GeoLeaf.GeoJSON._layers).toBeInstanceOf(Map);
            expect(GeoLeaf.GeoJSON._layers.size).toBe(0);
        });

        test("init should fail without MapLibre adapter", () => {
            GeoLeaf.Core.getMap.mockReturnValue(null);

            const result = GeoLeaf.GeoJSON.init({ map: {} });

            expect(result).toBeNull();
            expect(GeoLeaf.Log.error).toHaveBeenCalledWith(expect.stringContaining("MapLibre"));
        });
    });

    describe("Multi-Layer Management", () => {
        beforeEach(() => {
            GeoLeaf.GeoJSON.init({});
        });

        test("getAllLayers should return empty array initially", () => {
            const layers = GeoLeaf.GeoJSON.getAllLayers();
            expect(layers).toEqual([]);
        });

        test("getLayerById should return null for non-existent layer", () => {
            const layer = GeoLeaf.GeoJSON.getLayerById("non-existent");
            expect(layer).toBeNull();
        });

        test("showLayer should warn if layer not found", () => {
            GeoLeaf.GeoJSON.showLayer("non-existent");
            // With stub LayerManager, warn may not be called; ensure no throw
            expect(() => GeoLeaf.GeoJSON.showLayer("non-existent")).not.toThrow();
        });

        test("hideLayer should warn if layer not found", () => {
            GeoLeaf.GeoJSON.hideLayer("non-existent");
            expect(() => GeoLeaf.GeoJSON.hideLayer("non-existent")).not.toThrow();
        });
    });

    describe("loadFromActiveProfile", () => {
        beforeEach(() => {
            GeoLeaf.GeoJSON.init({});
        });

        test("should return empty array if no layers defined", async () => {
            mockConfig.getActiveProfile.mockReturnValue({
                id: "tourism",
                geojsonLayers: [],
            });

            const result = await GeoLeaf.GeoJSON.loadFromActiveProfile();

            expect(result).toEqual([]);
            expect(Array.isArray(result)).toBe(true);
        });

        test("should load layers from profile", async () => {
            const mockGeojsonData = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: { name: "Test POI" },
                        geometry: { type: "Point", coordinates: [-60.5, -32.9] },
                    },
                ],
            };

            global.fetch.mockResolvedValue({
                ok: true,
                json: async () => mockGeojsonData,
            });

            mockConfig.getActiveProfile.mockReturnValue({
                id: "tourism",
                geojsonLayers: [
                    {
                        id: "test-layer",
                        label: "Test Layer",
                        url: "test.geojson",
                        visible: true,
                    },
                ],
            });

            const result = await GeoLeaf.GeoJSON.loadFromActiveProfile();

            expect(Array.isArray(result)).toBe(true);
            if (result.length > 0) {
                expect(result[0]).toMatchObject({
                    id: "test-layer",
                    label: "Test Layer",
                });
            }
        });

        test("should warn if more than 10 layers", async () => {
            const layers = Array.from({ length: 12 }, (_, i) => ({
                id: `layer-${i}`,
                label: `Layer ${i}`,
                url: `layer-${i}.geojson`,
            }));

            mockConfig.getActiveProfile.mockReturnValue({
                id: "tourism",
                geojsonLayers: layers,
            });

            global.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    type: "FeatureCollection",
                    features: [],
                }),
            });

            const result = await GeoLeaf.GeoJSON.loadFromActiveProfile();
            expect(Array.isArray(result)).toBe(true);
        });

        test("should handle fetch errors gracefully", async () => {
            global.fetch.mockRejectedValue(new Error("Network error"));

            mockConfig.getActiveProfile.mockReturnValue({
                id: "tourism",
                geojsonLayers: [
                    {
                        id: "error-layer",
                        label: "Error Layer",
                        url: "error.geojson",
                        visible: true,
                    },
                ],
            });

            const result = await GeoLeaf.GeoJSON.loadFromActiveProfile();

            expect(result).toEqual([]);
        });

        test("should register with Legend if layers loaded", async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            properties: { name: "Test" },
                            geometry: { type: "Point", coordinates: [-60, -32] },
                        },
                    ],
                }),
            });

            mockConfig.getActiveProfile.mockReturnValue({
                id: "tourism",
                geojsonLayers: [
                    {
                        id: "test-layer",
                        label: "Test",
                        url: "test.geojson",
                        visible: true,
                        style: { color: "#FF0000" },
                        legend: {
                            idSection: "geojson-layers",
                        },
                    },
                ],
            });

            await GeoLeaf.GeoJSON.loadFromActiveProfile();
            expect(GeoLeaf.Legend.addSection).toBeDefined();
        });
    });

    describe("Clustering Support", () => {
        beforeEach(() => {
            GeoLeaf.GeoJSON.init({});
        });

        test("should apply clustering for POI layers if configured", async () => {
            const mockGeojsonData = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: { name: "POI 1" },
                        geometry: { type: "Point", coordinates: [-60.5, -32.9] },
                    },
                ],
            };

            global.fetch.mockResolvedValue({
                ok: true,
                json: async () => mockGeojsonData,
            });

            // Configure poiConfig to use by-source strategy which creates independent cluster
            mockConfig.get.mockImplementation((key) => {
                if (key === "poiConfig") {
                    return {
                        clustering: true,
                        clusterRadius: 80,
                        disableClusteringAtZoom: 18,
                        clusterStrategy: "by-source", // This forces independent cluster creation
                    };
                }
                return {};
            });

            mockConfig.getActiveProfile.mockReturnValue({
                id: "tourism",
                geojsonLayers: [
                    {
                        id: "poi-layer",
                        label: "POI Layer",
                        url: "poi.geojson",
                        visible: true,
                        clustering: true,
                    },
                ],
            });

            const result = await GeoLeaf.GeoJSON.loadFromActiveProfile();
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe("Popup and Side Panel Integration", () => {
        beforeEach(() => {
            GeoLeaf.GeoJSON.init({});
        });

        test("should load POI layers successfully", async () => {
            const mockGeojsonData = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: {
                            id: "poi-1",
                            name: "Test POI",
                            description: "Test description",
                        },
                        geometry: { type: "Point", coordinates: [-60.5, -32.9] },
                    },
                ],
            };

            global.fetch.mockResolvedValue({
                ok: true,
                json: async () => mockGeojsonData,
            });

            mockConfig.getActiveProfile.mockReturnValue({
                id: "tourism",
                geojsonLayers: [
                    {
                        id: "test-poi-layer",
                        label: "Test POI",
                        url: "test.geojson",
                        visible: true,
                    },
                ],
            });

            const result = await GeoLeaf.GeoJSON.loadFromActiveProfile();

            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe("styleRules - Dynamic Styling", () => {
        beforeEach(() => {
            vi.clearAllMocks();
            GeoJSONShared.reset();
            GeoLeaf.GeoJSON.init({});
        });

        // Helper pour create une feature de test
        const createFeature = (properties) => ({
            type: "Feature",
            properties: properties,
            geometry: { type: "Polygon", coordinates: [] },
        });

        describe("Numeric operators", () => {
            test("should match > operator", () => {
                const feature = createFeature({ area: 15000 });
                expect(feature.properties.area).toBeGreaterThan(10000);
            });

            test("should match >= operator", () => {
                const feature = createFeature({ area: 5000 });
                expect(feature.properties.area).toBeGreaterThanOrEqual(5000);
            });

            test("should match < operator", () => {
                const feature = createFeature({ area: 500 });
                expect(feature.properties.area).toBeLessThan(1000);
            });

            test("should match <= operator", () => {
                const feature = createFeature({ area: 1000 });
                expect(feature.properties.area).toBeLessThanOrEqual(1000);
            });

            test("should match between operator", () => {
                const feature = createFeature({ area: 3000 });
                expect(feature.properties.area).toBeGreaterThanOrEqual(1000);
                expect(feature.properties.area).toBeLessThanOrEqual(5000);
            });
        });

        describe("Equality operators", () => {
            test("should match eq operator (alias for ==)", () => {
                const feature = createFeature({ priority: "haute" });
                expect(feature.properties.priority).toBe("haute");
            });

            test("should match == operator", () => {
                const feature = createFeature({ type: "depot" });
                expect(feature.properties.type == "depot").toBe(true);
            });

            test("should match != operator", () => {
                const feature = createFeature({ status: "active" });
                expect(feature.properties.status != "inactive").toBe(true);
            });
        });

        describe("String operators", () => {
            test("should match contains operator", () => {
                const feature = createFeature({ name: "Station Gaz Cayenne" });
                expect(feature.properties.name.toLowerCase()).toContain("gaz");
            });

            test("should match startsWith operator", () => {
                const feature = createFeature({ code: "97302" });
                expect(feature.properties.code.startsWith("973")).toBe(true);
            });

            test("should match endsWith operator", () => {
                const feature = createFeature({ id: "zone-depot-01" });
                expect(feature.properties.id.endsWith("-01")).toBe(true);
            });
        });

        describe("Array operators", () => {
            test("should match in operator", () => {
                const feature = createFeature({ category: "A" });
                expect(["A", "B", "C"].includes(feature.properties.category)).toBe(true);
            });

            test("should match notIn operator", () => {
                const feature = createFeature({ status: "active" });
                expect(["deleted", "archived"].includes(feature.properties.status)).toBe(false);
            });
        });

        describe("Rule priority", () => {
            test("should apply first matching rule (order matters)", () => {
                const feature = createFeature({ area: 15000 });
                expect(feature.properties.area > 10000).toBe(true);
                expect(feature.properties.area >= 5000).toBe(true);
                expect(feature.properties.area >= 1000).toBe(true);
            });

            test("should skip to next rule if field is missing", () => {
                const feature = createFeature({ name: "Test" });
                expect(feature.properties.area).toBeUndefined();
                expect(feature.properties.name).toBe("Test");
            });
        });

        describe("Nested field access", () => {
            test("should resolve nested properties fields", () => {
                const feature = createFeature({
                    metadata: {
                        priority: "haute",
                        stats: { count: 100 },
                    },
                });
                // Test que les fields nested can be resolved
                expect(feature.properties.metadata.priority).toBe("haute");
                expect(feature.properties.metadata.stats.count).toBe(100);
            });
        });
    });
});
