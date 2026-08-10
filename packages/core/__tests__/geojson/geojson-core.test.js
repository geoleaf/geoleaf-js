/**
 */

// Tests for GeoLeaf.GeoJSON module - Core initialization and layer management

describe("GeoLeaf.GeoJSON Core", () => {
    let GeoJSON;
    let mockNativeMap;
    let mockAdapter;

    beforeEach(async () => {
        // Mock MapLibre native map (has addSource/addLayer)
        mockNativeMap = {
            addSource: vi.fn(),
            addLayer: vi.fn(),
            removeLayer: vi.fn(),
            removeSource: vi.fn(),
            getSource: vi.fn().mockReturnValue(null),
            getLayer: vi.fn().mockReturnValue(null),
            fitBounds: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            fire: vi.fn(),
        };

        // Mock MapLibre adapter (wraps the native map)
        mockAdapter = {
            getNativeMap: vi.fn().mockReturnValue(mockNativeMap),
            addLayer: vi.fn(),
            removeLayer: vi.fn(),
        };

        // Mock GeoLeaf namespace
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            CONSTANTS: {
                GEOJSON_MAX_ZOOM_ON_FIT: 16,
            },
            Core: {
                getMap: vi.fn().mockReturnValue(mockAdapter),
            },
            Config: {
                get: vi.fn().mockReturnValue(null),
                getActiveProfile: vi.fn().mockReturnValue({}),
            },
            Utils: {
                mergeOptions: (a, b) => Object.assign({}, a, b),
                ensureMap: (map) => map || mockAdapter,
            },
        };

        vi.resetModules();

        // Load GeoJSON sub-modules in correct order (paths: built-in/geojson/).
        // Spelled out one await import() per entry rather than looping over a template
        // literal: Vite cannot resolve a constructed specifier statically, and these nine
        // were the repository's only such site — invisible to every inventory until the
        // load-mode gate started counting them separately.
        await import("../../src/kernel/geojson/shared.js");
        await import("../../src/kernel/geojson/style-resolver.js");
        await import("../../src/kernel/geojson/layers/store.js");
        await import("../../src/kernel/geojson/layers/style.js");
        await import("../../src/kernel/geojson/layers/visibility.js");
        await import("../../src/kernel/geojson/layers/integration.js");
        await import("../../src/kernel/geojson/loader/profile.js");
        await import("../../src/kernel/geojson/loader/single-layer.js");
        await import("../../src/kernel/geojson/core.js");

        // Register GeoJSONCore on global (done by globals.geojson.ts at runtime)
        const { GeoJSONCore } = await import("../../src/kernel/geojson/core.js");
        global.GeoLeaf.GeoJSON = GeoJSONCore;
        GeoJSON = global.GeoLeaf.GeoJSON;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("init()", () => {
        it("should initialize and return null in MapLibre mode", () => {
            const result = GeoJSON.init({ map: mockAdapter });

            // MapLibre mode returns null (no legacy GeoJSON layer)
            expect(result).toBeNull();
            expect(global.GeoLeaf.Log.info).toHaveBeenCalled();
        });

        it("should use adapter from Core.getMap if not provided", () => {
            GeoJSON.init({});

            // In MapLibre mode, adapter is resolved from Core.getMap()
            expect(GeoJSON._map).toBe(mockNativeMap);
        });

        it("should return null if no map available", () => {
            global.GeoLeaf.Utils.ensureMap = () => null;
            global.GeoLeaf.Core.getMap = vi.fn().mockReturnValue(null);

            const result = GeoJSON.init({});

            expect(result).toBeNull();
            expect(global.GeoLeaf.Log.error).toHaveBeenCalled();
        });

        it("should return null if no valid adapter available", () => {
            global.GeoLeaf.Core.getMap = vi.fn().mockReturnValue(null);

            const result = GeoJSON.init({ map: {} });

            expect(result).toBeNull();
        });

        it("should merge custom options", () => {
            GeoJSON.init({
                map: mockAdapter,
                defaultStyle: { color: "red" },
            });

            expect(GeoJSON._options.defaultStyle.color).toBe("red");
        });
    });

    describe("getLayerById()", () => {
        beforeEach(() => {
            GeoJSON.init({ map: mockAdapter });
        });

        it("should return null for non-existent layer", () => {
            const layer = GeoJSON.getLayerById("nonexistent");

            expect(layer).toBeNull();
        });
    });

    describe("getAllLayers()", () => {
        beforeEach(() => {
            GeoJSON.init({ map: mockAdapter });
        });

        it("should return empty array if no layers", () => {
            const layers = GeoJSON.getAllLayers();

            expect(layers).toEqual([]);
        });
    });

    describe("getLayerData()", () => {
        beforeEach(() => {
            GeoJSON.init({ map: mockAdapter });
        });

        it("should return null for non-existent layer", () => {
            const data = GeoJSON.getLayerData("nonexistent");

            expect(data).toBeNull();
        });
    });

    describe("showLayer()", () => {
        beforeEach(() => {
            GeoJSON.init({ map: mockAdapter });
        });

        it("should be a no-op when LayerManager is not available", () => {
            expect(() => GeoJSON.showLayer("nonexistent")).not.toThrow();
        });
    });

    describe("hideLayer()", () => {
        beforeEach(() => {
            GeoJSON.init({ map: mockAdapter });
        });

        it("should be a no-op when LayerManager is not available", () => {
            expect(() => GeoJSON.hideLayer("nonexistent")).not.toThrow();
        });
    });

    describe("_validateOptions()", () => {
        beforeEach(() => {
            GeoJSON.init({ map: mockAdapter });
        });

        it("should warn for invalid defaultStyle", () => {
            GeoJSON._validateOptions({ defaultStyle: "invalid" });

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });

        it("should warn for invalid onEachFeature", () => {
            GeoJSON._validateOptions({ onEachFeature: "notAFunction" });

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });

        it("should warn for invalid maxZoomOnFit", () => {
            GeoJSON._validateOptions({ maxZoomOnFit: 100 });

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });

        it("should accept valid options", () => {
            const result = GeoJSON._validateOptions({
                defaultStyle: { color: "red" },
                onEachFeature: () => {},
                maxZoomOnFit: 15,
            });

            expect(result.defaultStyle.color).toBe("red");
            expect(result.maxZoomOnFit).toBe(15);
        });
    });

    describe("Default options", () => {
        it("should have default polygon style", () => {
            expect(GeoJSON._options.defaultStyle).toBeDefined();
            expect(GeoJSON._options.defaultStyle.color).toBeDefined();
        });

        it("should have default point style", () => {
            expect(GeoJSON._options.defaultPointStyle).toBeDefined();
            expect(GeoJSON._options.defaultPointStyle.radius).toBeDefined();
        });

        it("should have fitBoundsOnLoad option", () => {
            expect(GeoJSON._options.fitBoundsOnLoad).toBe(true);
        });

        it("should have maxZoomOnFit option", () => {
            expect(GeoJSON._options.maxZoomOnFit).toBeDefined();
        });
    });

    describe("Internal layer map", () => {
        beforeEach(() => {
            GeoJSON.init({ map: mockAdapter });
        });

        it("should initialize with empty layers map", () => {
            expect(GeoJSON._layers).toBeInstanceOf(Map);
            expect(GeoJSON._layers.size).toBe(0);
        });
    });
});
