/**
 */

/**
 * Extended tests for GeoLeaf.GeoJSON module
 * ESM: import GeoJSON + style-resolver/shared for _StyleRules; global.GeoLeaf/L for runtime.
 */

import { GeoJSONCore as GeoJSON } from "../../src/kernel/geojson/core.js";
import { GeoJSONStyleResolver } from "../../src/kernel/geojson/style-resolver.js";
import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";

describe("GeoLeaf.GeoJSON Extended", () => {
    let GeoLeaf;
    let mockMap;
    let mockGeoJsonLayer;
    let mockAdapter;

    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = "";

        // Create mock Leaflet objects
        mockGeoJsonLayer = {
            addTo: vi.fn().mockReturnThis(),
            addData: vi.fn(),
            clearLayers: vi.fn(),
            getBounds: vi.fn().mockReturnValue({
                isValid: () => true,
            }),
            eachLayer: vi.fn((_callback) => {}),
            getLayers: vi.fn().mockReturnValue([]),
            setStyle: vi.fn(),
            bringToFront: vi.fn(),
            bringToBack: vi.fn(),
        };

        const paneStub = { style: { zIndex: 0 } };
        mockMap = {
            addLayer: vi.fn(),
            removeLayer: vi.fn(),
            hasLayer: vi.fn().mockReturnValue(true),
            fitBounds: vi.fn(),
            fire: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            getZoom: vi.fn().mockReturnValue(10),
            createPane: vi.fn(() => paneStub),
            getPane: vi.fn(() => paneStub),
        };

        // Mock adapter for MapLibre mode
        mockAdapter = {
            getNativeMap: vi.fn(() => mockMap),
            addGeoJSONLayer: vi.fn(),
            getLayerRegistry: vi.fn(() => ({ getSubLayerIds: vi.fn(() => []) })),
        };
        // Make mockMap look like a MapLibre native map
        mockMap.addSource = vi.fn();

        // Setup GeoLeaf namespace (required by modules/geojson/core.js at runtime)
        global.GeoLeaf = {
            Log: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            },
            Config: {
                get: vi.fn().mockReturnValue(null),
                getActiveProfile: vi.fn().mockReturnValue(null),
                _activeProfileData: null,
            },
            Core: {
                getMap: vi.fn().mockReturnValue(mockAdapter),
            },
            Utils: {
                ensureMap: vi.fn((map) => map || mockMap),
                mergeOptions: vi.fn((defaults, opts) => ({ ...defaults, ...opts })),
            },
            Legend: {
                addSection: vi.fn(),
                removeSection: vi.fn(),
            },
            CONSTANTS: {
                GEOJSON_MAX_ZOOM_ON_FIT: 16,
            },
            GeoJSON,
        };

        const layers = () => global.GeoLeaf.GeoJSON._layers;
        global.GeoLeaf._GeoJSONLayerManager = {
            getLayerById: (id) => (layers() && layers().get(id)) || null,
            getLayerData: (id) => (layers() && layers().get(id)) || null,
            getAllLayers: () => (layers() && Array.from(layers().values())) || [],
            showLayer: (id) => {
                const m = layers() && layers().get(id);
                if (m) m.visible = true;
            },
            hideLayer: (id) => {
                const m = layers() && layers().get(id);
                if (m) m.visible = false;
            },
            toggleLayer: (id) => {
                const m = layers() && layers().get(id);
                if (m) m.visible = !m.visible;
            },
            updateLayerVisibilityByZoom: () => {},
        };
        global.GeoLeaf._GeoJSONLoader = {
            loadUrl: () => Promise.resolve(null),
            addData: () => {},
            loadFromActiveProfile: () => Promise.resolve([]),
        };
        global.GeoLeaf._StyleRules = {
            evaluate: GeoJSONStyleResolver.evaluateStyleRules,
            operators: GeoJSONShared.STYLE_OPERATORS || {},
            getNestedValue: GeoJSONStyleResolver.getNestedValue,
        };

        GeoLeaf = global.GeoLeaf;
    });

    afterEach(() => {
        delete global.L;
        delete global.GeoLeaf;
        vi.clearAllMocks();
    });

    // ============================================
    // MODULE STRUCTURE TESTS
    // ============================================
    describe("Module structure", () => {
        test("GeoJSON module exists", () => {
            expect(GeoLeaf.GeoJSON).toBeDefined();
        });

        test("has init method", () => {
            expect(typeof GeoLeaf.GeoJSON.init).toBe("function");
        });

        test("has showLayer method", () => {
            expect(typeof GeoLeaf.GeoJSON.showLayer).toBe("function");
        });

        test("has hideLayer method", () => {
            expect(typeof GeoLeaf.GeoJSON.hideLayer).toBe("function");
        });

        test("_StyleRules module is exposed", () => {
            expect(GeoLeaf._StyleRules).toBeDefined();
            expect(typeof GeoLeaf._StyleRules.evaluate).toBe("function");
            expect(GeoLeaf._StyleRules.operators).toBeDefined();
        });
    });

    // ============================================
    // STYLE RULES TESTS
    // ============================================
    describe("_StyleRules", () => {
        describe("getNestedValue()", () => {
            test("returns value for simple path", () => {
                const obj = { name: "Test" };
                expect(GeoLeaf._StyleRules.getNestedValue(obj, "name")).toBe("Test");
            });

            test("returns value for nested path", () => {
                const obj = { properties: { category: "A" } };
                expect(GeoLeaf._StyleRules.getNestedValue(obj, "properties.category")).toBe("A");
            });

            test("returns null for non-existent path", () => {
                const obj = { name: "Test" };
                expect(GeoLeaf._StyleRules.getNestedValue(obj, "missing")).toBeNull();
            });

            test("returns null for null object", () => {
                expect(GeoLeaf._StyleRules.getNestedValue(null, "name")).toBeNull();
            });

            test("returns null for null path", () => {
                expect(GeoLeaf._StyleRules.getNestedValue({ name: "Test" }, null)).toBeNull();
            });
        });

        describe("operators", () => {
            test("comparison operators work correctly", () => {
                const ops = GeoLeaf._StyleRules.operators;

                // > operator
                expect(ops[">"](5, 3)).toBe(true);
                expect(ops[">"](3, 5)).toBe(false);

                // >= operator
                expect(ops[">="](5, 5)).toBe(true);
                expect(ops[">="](3, 5)).toBe(false);

                // < operator
                expect(ops["<"](3, 5)).toBe(true);
                expect(ops["<"](5, 3)).toBe(false);

                // <= operator
                expect(ops["<="](5, 5)).toBe(true);
                expect(ops["<="](6, 5)).toBe(false);
            });

            test("equality operators work correctly", () => {
                const ops = GeoLeaf._StyleRules.operators;

                // == operator
                expect(ops["=="]("5", 5)).toBe(true);
                expect(ops["=="](5, 3)).toBe(false);

                // === operator
                expect(ops["==="]("5", "5")).toBe(true);
                expect(ops["==="]("5", 5)).toBe(false);

                // != operator
                expect(ops["!="](5, 3)).toBe(true);
                expect(ops["!="]("5", 5)).toBe(false);
            });

            test("string operators work correctly", () => {
                const ops = GeoLeaf._StyleRules.operators;

                // contains
                expect(ops["contains"]("Hello World", "World")).toBe(true);
                expect(ops["contains"]("Hello", "World")).toBe(false);

                // startsWith
                expect(ops["startsWith"]("Hello World", "Hello")).toBe(true);
                expect(ops["startsWith"]("Hello World", "World")).toBe(false);

                // endsWith
                expect(ops["endsWith"]("Hello World", "World")).toBe(true);
                expect(ops["endsWith"]("Hello World", "Hello")).toBe(false);
            });

            test("array operators work correctly", () => {
                const ops = GeoLeaf._StyleRules.operators;

                // in
                expect(ops["in"]("a", ["a", "b", "c"])).toBe(true);
                expect(ops["in"]("d", ["a", "b", "c"])).toBe(false);

                // notIn
                expect(ops["notIn"]("d", ["a", "b", "c"])).toBe(true);
                expect(ops["notIn"]("a", ["a", "b", "c"])).toBe(false);

                // between
                expect(ops["between"](5, [1, 10])).toBe(true);
                expect(ops["between"](15, [1, 10])).toBe(false);
                expect(ops["between"](5, [5, 10])).toBe(true);
                expect(ops["between"](5, "invalid")).toBe(false);
            });
        });

        describe("evaluate()", () => {
            test("returns null for empty rules", () => {
                expect(GeoLeaf._StyleRules.evaluate({}, [])).toBeNull();
                expect(GeoLeaf._StyleRules.evaluate({}, null)).toBeNull();
            });

            test("returns matching rule style", () => {
                const feature = { properties: { status: "active" } };
                const rules = [
                    {
                        when: { field: "status", operator: "==", value: "active" },
                        style: { color: "green" },
                    },
                ];
                expect(GeoLeaf._StyleRules.evaluate(feature, rules)).toEqual({ color: "green" });
            });

            test("returns first matching rule style", () => {
                const feature = { properties: { value: 10 } };
                const rules = [
                    {
                        when: { field: "value", operator: ">", value: 5 },
                        style: { color: "red" },
                    },
                    {
                        when: { field: "value", operator: ">", value: 8 },
                        style: { color: "orange" },
                    },
                ];
                expect(GeoLeaf._StyleRules.evaluate(feature, rules)).toEqual({ color: "red" });
            });

            test("returns null when no rule matches", () => {
                const feature = { properties: { value: 3 } };
                const rules = [
                    {
                        when: { field: "value", operator: ">", value: 5 },
                        style: { color: "red" },
                    },
                ];
                expect(GeoLeaf._StyleRules.evaluate(feature, rules)).toBeNull();
            });

            test("skips invalid rules gracefully", () => {
                const feature = { properties: { value: 10 } };
                const rules = [
                    null,
                    {},
                    {
                        when: { field: "value", operator: ">", value: 5 },
                        style: { color: "red" },
                    },
                ];
                expect(GeoLeaf._StyleRules.evaluate(feature, rules)).toEqual({ color: "red" });
            });
        });
    });

    // ============================================
    // INITIALIZATION TESTS
    // ============================================
    describe("init()", () => {
        beforeEach(() => {
            // Reset module state via shared reset (properties are getter-only)
            GeoJSONShared.reset();
        });

        test("initializes successfully with map option", () => {
            const result = GeoLeaf.GeoJSON.init({ map: mockAdapter });

            expect(result).toBeNull(); // MapLibre init returns null
            expect(GeoLeaf.GeoJSON._map).toBe(mockMap);
        });

        test("uses Core.getMap when no map provided", () => {
            GeoLeaf.GeoJSON.init({});

            expect(GeoLeaf.Core.getMap).toHaveBeenCalled();
        });

        test("returns null when no adapter available", () => {
            GeoLeaf.Core.getMap.mockReturnValue(null);

            const result = GeoLeaf.GeoJSON.init({ map: {} });

            expect(result).toBeNull();
        });

        test("returns null when no map available", () => {
            GeoLeaf.Core.getMap.mockReturnValue(null);
            GeoLeaf.Utils.ensureMap.mockReturnValue(null);

            const result = GeoLeaf.GeoJSON.init({});

            expect(result).toBeNull();
        });

        test("init sets state.adapter in MapLibre mode", () => {
            GeoLeaf.GeoJSON.init({ map: mockAdapter });

            expect(GeoLeaf.GeoJSON._map).toBe(mockMap);
        });

        test("merges custom options", () => {
            GeoLeaf.GeoJSON.init({
                map: mockAdapter,
                fitBoundsOnLoad: false,
                maxZoomOnFit: 12,
            });

            expect(GeoLeaf.Utils.mergeOptions).toHaveBeenCalled();
        });
    });

    // ============================================
    // OPTION VALIDATION TESTS
    // ============================================
    describe("_validateOptions()", () => {
        test("warns when map is invalid", () => {
            GeoLeaf.GeoJSON._validateOptions({ map: { notAMap: true } });

            expect(GeoLeaf.Log.warn).toHaveBeenCalledWith(expect.stringContaining("valid map"));
        });

        test("removes invalid defaultStyle", () => {
            const options = { defaultStyle: "invalid" };
            const result = GeoLeaf.GeoJSON._validateOptions(options);

            expect(result.defaultStyle).toBeUndefined();
        });

        test("removes invalid onEachFeature", () => {
            const options = { onEachFeature: "notAFunction" };
            const result = GeoLeaf.GeoJSON._validateOptions(options);

            expect(result.onEachFeature).toBeUndefined();
        });

        test("removes invalid pointToLayer", () => {
            const options = { pointToLayer: "notAFunction" };
            const result = GeoLeaf.GeoJSON._validateOptions(options);

            expect(result.pointToLayer).toBeUndefined();
        });

        test("corrects invalid maxZoomOnFit", () => {
            const options1 = { maxZoomOnFit: 0 };
            const options2 = { maxZoomOnFit: 25 };

            GeoLeaf.GeoJSON._validateOptions(options1);
            GeoLeaf.GeoJSON._validateOptions(options2);

            expect(GeoLeaf.Log.warn).toHaveBeenCalledWith(expect.stringContaining("maxZoomOnFit"));
        });
    });

    // ============================================
    // LAYER MANAGEMENT TESTS
    // ============================================
    describe("Layer management", () => {
        beforeEach(() => {
            GeoLeaf.GeoJSON.init({ map: mockMap });
        });

        describe("getLayerById()", () => {
            test("returns null for non-existent layer", () => {
                expect(GeoLeaf.GeoJSON.getLayerById("non-existent")).toBeNull();
            });

            test("returns layer data when exists", () => {
                GeoLeaf.GeoJSON._layers.set("test-layer", {
                    id: "test-layer",
                    label: "Test",
                    layer: mockGeoJsonLayer,
                    visible: true,
                });

                const result = GeoLeaf.GeoJSON.getLayerById("test-layer");
                expect(result).toBeTruthy();
                expect(result.id).toBe("test-layer");
            });
        });

        describe("getLayerData()", () => {
            test("returns null for non-existent layer", () => {
                expect(GeoLeaf.GeoJSON.getLayerData("non-existent")).toBeNull();
            });

            test("returns layer data structure when exists", () => {
                GeoLeaf.GeoJSON._layers.set("test-layer", {
                    id: "test-layer",
                    label: "Test",
                    layer: mockGeoJsonLayer,
                    geojson: { type: "FeatureCollection", features: [] },
                    geometryType: "polygon",
                    config: { fillColor: "#ff0000" },
                });

                const result = GeoLeaf.GeoJSON.getLayerData("test-layer");
                expect(result).toBeTruthy();
                expect(result.geojson).toBeDefined();
                expect(result.geometryType).toBe("polygon");
                expect(result.config).toBeDefined();
            });
        });

        describe("getAllLayers()", () => {
            test("returns empty array when no layers", () => {
                GeoLeaf.GeoJSON._layers.clear();
                expect(GeoLeaf.GeoJSON.getAllLayers()).toEqual([]);
            });

            test("returns all layer info", () => {
                // Create mock layers with eachLayer method for _detectLayerType
                const mockLayer1 = {
                    getLayers: vi.fn().mockReturnValue([]),
                    eachLayer: vi.fn(),
                };
                const mockLayer2 = {
                    getLayers: vi.fn().mockReturnValue([]),
                    eachLayer: vi.fn(),
                };

                GeoLeaf.GeoJSON._layers.set("layer1", {
                    id: "layer1",
                    label: "Layer 1",
                    visible: true,
                    geometryType: "point",
                    layer: mockLayer1,
                });
                GeoLeaf.GeoJSON._layers.set("layer2", {
                    id: "layer2",
                    label: "Layer 2",
                    visible: false,
                    geometryType: "polygon",
                    layer: mockLayer2,
                });

                const layers = GeoLeaf.GeoJSON.getAllLayers();
                expect(layers.length).toBe(2);
            });
        });
    });

    // ============================================
    // VISIBILITY TESTS
    // ============================================
    describe("Visibility methods", () => {
        beforeEach(() => {
            GeoLeaf.GeoJSON.init({ map: mockMap });
            // Add a test layer
            GeoLeaf.GeoJSON._layers.set("test-layer", {
                id: "test-layer",
                label: "Test",
                layer: mockGeoJsonLayer,
                visible: true,
            });
        });

        describe("showLayer()", () => {
            test("shows layer by id", () => {
                GeoLeaf.GeoJSON._layers.get("test-layer").visible = false;

                GeoLeaf.GeoJSON.showLayer("test-layer");

                const layer = GeoLeaf.GeoJSON._layers.get("test-layer");
                expect(layer.visible).toBe(true);
            });

            test("handles non-existent layer gracefully", () => {
                expect(() => GeoLeaf.GeoJSON.showLayer("non-existent")).not.toThrow();
            });
        });

        describe("hideLayer()", () => {
            test("hides layer by id", () => {
                GeoLeaf.GeoJSON.hideLayer("test-layer");

                const layer = GeoLeaf.GeoJSON._layers.get("test-layer");
                expect(layer.visible).toBe(false);
            });

            test("handles non-existent layer gracefully", () => {
                expect(() => GeoLeaf.GeoJSON.hideLayer("non-existent")).not.toThrow();
            });
        });

        describe("toggleLayer()", () => {
            test("toggles layer visibility", () => {
                GeoLeaf.GeoJSON._layers.get("test-layer").visible = true;

                GeoLeaf.GeoJSON.toggleLayer("test-layer");
                expect(GeoLeaf.GeoJSON._layers.get("test-layer").visible).toBe(false);

                GeoLeaf.GeoJSON.toggleLayer("test-layer");
                expect(GeoLeaf.GeoJSON._layers.get("test-layer").visible).toBe(true);
            });
        });
    });

    // ============================================
    // GET FEATURES TESTS
    // ============================================
    describe("getFeatures()", () => {
        beforeEach(() => {
            GeoLeaf.GeoJSON.init({ map: mockMap });
        });

        test("returns empty array when no layers", () => {
            GeoLeaf.GeoJSON._layers.clear();
            const features = GeoLeaf.GeoJSON.getFeatures();
            expect(Array.isArray(features)).toBe(true);
        });

        test("getFeatures method exists and is callable", () => {
            expect(typeof GeoLeaf.GeoJSON.getFeatures).toBe("function");
        });
    });

    // ============================================
    // FILTER FEATURES TESTS
    // ============================================
    describe("filterFeatures()", () => {
        beforeEach(() => {
            GeoLeaf.GeoJSON.init({ map: mockMap });
        });

        test("filterFeatures method exists and is callable", () => {
            expect(typeof GeoLeaf.GeoJSON.filterFeatures).toBe("function");
        });
    });
});
