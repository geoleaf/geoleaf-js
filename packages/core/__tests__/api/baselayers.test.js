/**
 */

// Tests for GeoLeaf.Baselayers module

describe("GeoLeaf.Baselayers", () => {
    let Baselayers;
    let mockMap;

    beforeEach(async () => {
        // Mock map - MapLibre-native (needs addSource + addLayer to pass _isNativeMaplibreMap)
        mockMap = {
            setView: vi.fn().mockReturnThis(),
            addLayer: vi.fn(),
            removeLayer: vi.fn(),
            removeSource: vi.fn(),
            addSource: vi.fn(),
            getLayer: vi.fn().mockReturnValue(null),
            getSource: vi.fn().mockReturnValue(null),
            hasLayer: vi.fn().mockReturnValue(false),
            getStyle: vi.fn(() => ({ layers: [] })),
            setStyle: vi.fn(),
            once: vi.fn(),
            on: vi.fn(),
            loaded: vi.fn().mockReturnValue(true),
        };

        // Mock GeoLeaf namespace
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            Core: {
                getMap: vi.fn().mockReturnValue(mockMap),
            },
        };

        // Clear module cache
        vi.resetModules();

        // Load the module (Phase 7 B11: capture named export)
        const baselayersModule = await import("../../src/api/geoleaf.baselayers.js");
        Baselayers = baselayersModule.Baselayers || global.GeoLeaf.Baselayers;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("init()", () => {
        it("should initialize and return result object", () => {
            const result = Baselayers.init({ map: mockMap });

            expect(result).toBeDefined();
            expect(result.activeKey).toBeDefined();
        });

        it("should get map from Core if not provided", () => {
            Baselayers.init({});

            expect(global.GeoLeaf.Core.getMap).toHaveBeenCalled();
        });

        it("should register default base layers", () => {
            Baselayers.init({ map: mockMap });

            const layers = Baselayers.getBaseLayers();
            expect(Object.keys(layers).length).toBeGreaterThan(0);
        });

        it("should set initial base layer", () => {
            Baselayers.init({
                map: mockMap,
                activeKey: "street",
            });

            expect(Baselayers.getActiveKey()).toBe("street");
        });
    });

    describe("registerBaseLayer()", () => {
        beforeEach(() => {
            Baselayers.init({ map: mockMap });
        });

        it("should register a base layer with URL config", () => {
            Baselayers.registerBaseLayer("custom", {
                label: "Custom Layer",
                url: "https://example.com/tiles/{z}/{x}/{y}.png",
                options: { maxZoom: 18 },
            });

            const layers = Baselayers.getBaseLayers();
            expect(layers["custom"]).toBeDefined();
        });

        it("should warn if no key provided", () => {
            Baselayers.registerBaseLayer(null, {});

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });

        it("should warn if no definition provided", () => {
            Baselayers.registerBaseLayer("test", null);

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });
    });

    describe("registerBaseLayers()", () => {
        beforeEach(() => {
            Baselayers.init({ map: mockMap });
        });

        it("should register multiple base layers", () => {
            Baselayers.registerBaseLayers({
                layer1: {
                    label: "Layer 1",
                    url: "https://example.com/layer1/{z}/{x}/{y}.png",
                },
                layer2: {
                    label: "Layer 2",
                    url: "https://example.com/layer2/{z}/{x}/{y}.png",
                },
            });

            const layers = Baselayers.getBaseLayers();
            expect(layers["layer1"]).toBeDefined();
            expect(layers["layer2"]).toBeDefined();
        });

        it("should warn if not an object", () => {
            Baselayers.registerBaseLayers(null);

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });
    });

    describe("setBaseLayer()", () => {
        beforeEach(() => {
            Baselayers.init({ map: mockMap });
        });

        it("should switch to specified base layer", () => {
            Baselayers.setBaseLayer("topo");

            expect(Baselayers.getActiveKey()).toBe("topo");
        });

        it("should warn for unknown layer", () => {
            Baselayers.setBaseLayer("unknown");

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });
    });

    describe("getActiveKey()", () => {
        it("should return current active layer key after set", () => {
            Baselayers.init({ map: mockMap });
            Baselayers.setBaseLayer("satellite");

            expect(Baselayers.getActiveKey()).toBe("satellite");
        });
    });

    describe("getBaseLayers()", () => {
        it("should return object of available layers", () => {
            Baselayers.init({ map: mockMap });

            const layers = Baselayers.getBaseLayers();

            expect(typeof layers).toBe("object");
            expect(layers["street"]).toBeDefined();
        });
    });

    describe("Default base layers", () => {
        beforeEach(() => {
            Baselayers.init({ map: mockMap });
        });

        it("should have street layer", () => {
            const layers = Baselayers.getBaseLayers();
            expect(layers["street"]).toBeDefined();
        });

        it("should have topo layer", () => {
            const layers = Baselayers.getBaseLayers();
            expect(layers["topo"]).toBeDefined();
        });

        it("should have satellite layer", () => {
            const layers = Baselayers.getBaseLayers();
            expect(layers["satellite"]).toBeDefined();
        });
    });

    describe("Aliases", () => {
        it("should expose setActive as alias for setBaseLayer", () => {
            Baselayers.init({ map: mockMap });

            expect(Baselayers.setActive).toBe(Baselayers.setBaseLayer);
        });

        it("should be available as GeoLeaf.BaseLayers", () => {
            expect(global.GeoLeaf.BaseLayers).toBe(global.GeoLeaf.Baselayers);
        });
    });

    describe("MapLibre GL basemaps", () => {
        it("should register a maplibre basemap from definition.type", () => {
            Baselayers.init({ map: mockMap });
            Baselayers.registerBaseLayer("test-vector", {
                type: "maplibre",
                label: "Test Vector",
                style: "https://tiles.openfreemap.org/styles/liberty",
                attribution: "© OpenFreeMap",
            });

            const layers = Baselayers.getBaseLayers();
            expect(layers["test-vector"]).toBeDefined();
        });

        it("should register a maplibre basemap with a raster url fallback", () => {
            Baselayers.init({ map: mockMap });
            Baselayers.registerBaseLayer("test-vector", {
                type: "maplibre",
                label: "Test Vector",
                style: "https://tiles.openfreemap.org/styles/liberty",
                url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                attribution: "© OpenFreeMap",
            });

            const layers = Baselayers.getBaseLayers();
            expect(layers["test-vector"]).toBeDefined();
        });

        it("should register a maplibre basemap with a legacy fallbackUrl", () => {
            Baselayers.init({ map: mockMap });
            Baselayers.registerBaseLayer("test-vector-legacy", {
                type: "maplibre",
                label: "Test Vector Legacy",
                style: "https://tiles.openfreemap.org/styles/liberty",
                fallbackUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                attribution: "© OpenFreeMap",
            });

            const layers = Baselayers.getBaseLayers();
            expect(layers["test-vector-legacy"]).toBeDefined();
        });

        it("should fallback to DEFAULT_BASELAYERS.street when no url/fallbackUrl", () => {
            Baselayers.init({ map: mockMap });
            Baselayers.registerBaseLayer("test-vector-no-fallback", {
                type: "maplibre",
                label: "Test Vector",
                style: "https://tiles.openfreemap.org/styles/liberty",
            });

            const layers = Baselayers.getBaseLayers();
            expect(layers["test-vector-no-fallback"]).toBeDefined();
        });

        it("should register maplibre basemap via definition.style (without explicit type)", () => {
            Baselayers.init({ map: mockMap });
            Baselayers.registerBaseLayer("style-only", {
                label: "Style Only",
                style: "https://tiles.openfreemap.org/styles/dark",
                attribution: "© OpenFreeMap",
            });

            const layers = Baselayers.getBaseLayers();
            expect(layers["style-only"]).toBeDefined();
        });

        it("should pass minZoom/maxZoom to layer config", () => {
            Baselayers.init({ map: mockMap });
            Baselayers.registerBaseLayer("test-vector-zoom", {
                type: "maplibre",
                label: "Test Vector Zoom",
                style: "https://tiles.openfreemap.org/styles/liberty",
                minZoom: 5,
                maxZoom: 19,
                attribution: "© OpenFreeMap",
            });

            const layers = Baselayers.getBaseLayers();
            expect(layers["test-vector-zoom"]).toBeDefined();
            expect(layers["test-vector-zoom"].definition.minZoom).toBe(5);
        });

        it("should switch basemap to MapLibre layer using setBaseLayer()", () => {
            Baselayers.init({ map: mockMap });
            Baselayers.registerBaseLayer("gl-vector", {
                type: "maplibre",
                label: "GL Vector",
                style: "https://tiles.openfreemap.org/styles/liberty",
                attribution: "© OpenFreeMap",
            });

            Baselayers.setBaseLayer("gl-vector");
            expect(Baselayers.getActiveKey()).toBe("gl-vector");
            expect(mockMap.setStyle).toHaveBeenCalledWith(
                "https://tiles.openfreemap.org/styles/liberty",
                undefined
            );
        });

        it("should not have built-in vector basemaps (defined via profile only)", () => {
            Baselayers.init({ map: mockMap });
            const layers = Baselayers.getBaseLayers();

            // Vector basemaps are no longer in DEFAULT_BASELAYERS — they come from profile config
            expect(layers["vector-liberty"]).toBeUndefined();
            expect(layers["vector-dark"]).toBeUndefined();
        });
    });
});
