/**
 */
/* Sprint 5b — coverage for modules/geojson/core.ts */

const sharedState = vi.hoisted(() => ({
    layers: new Map(),
    map: null,
    layerGroup: null,
    geoJsonLayer: null,
    options: {},
}));
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        state: sharedState,
    },
}));
import { GeoJSONCore as GeoJSON } from "../../src/kernel/geojson/core.ts";

describe("geojson/core", () => {
    describe("_validateOptions", () => {
        it("returns options when valid", () => {
            const opts = GeoJSON._validateOptions({});
            expect(opts).toBeDefined();
            expect(opts).toEqual({});
        });

        it("warns when map has no addLayer", () => {
            const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            GeoJSON._validateOptions({ map: {} });
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it("keeps defaultStyle when object", () => {
            const opts = GeoJSON._validateOptions({ defaultStyle: { color: "#f00" } });
            expect(opts.defaultStyle).toEqual({ color: "#f00" });
        });

        it("deletes invalid defaultStyle", () => {
            const opts = GeoJSON._validateOptions({ defaultStyle: "not-an-object" });
            expect(opts.defaultStyle).toBeUndefined();
        });

        it("deletes invalid onEachFeature when not a function", () => {
            const opts = GeoJSON._validateOptions({ onEachFeature: "not-a-fn" });
            expect(opts.onEachFeature).toBeUndefined();
        });

        it("deletes invalid pointToLayer when not a function", () => {
            const opts = GeoJSON._validateOptions({ pointToLayer: 42 });
            expect(opts.pointToLayer).toBeUndefined();
        });

        it("clamps invalid maxZoomOnFit and warns", () => {
            const opts = GeoJSON._validateOptions({ maxZoomOnFit: 99 });
            expect(typeof opts.maxZoomOnFit).toBe("number");
            expect(opts.maxZoomOnFit).toBeLessThanOrEqual(20);
        });

        it("keeps valid maxZoomOnFit", () => {
            const opts = GeoJSON._validateOptions({ maxZoomOnFit: 15 });
            expect(opts.maxZoomOnFit).toBe(15);
        });

        it("uses CONSTANTS.GEOJSON_MAX_ZOOM_ON_FIT when invalid and GeoLeaf.CONSTANTS set", () => {
            const g = typeof globalThis !== "undefined" ? globalThis : window;
            const prev = g.GeoLeaf;
            g.GeoLeaf = { CONSTANTS: { GEOJSON_MAX_ZOOM_ON_FIT: 14 } };
            const opts = GeoJSON._validateOptions({ maxZoomOnFit: 0 });
            expect(opts.maxZoomOnFit).toBe(14);
            g.GeoLeaf = prev;
        });
    });

    describe("getters when no state", () => {
        it("_map is null when no state", () => {
            expect(GeoJSON._map).toBeNull();
        });

        it("_layers is Map when no state", () => {
            expect(GeoJSON._layers).toBeDefined();
            expect(
                GeoJSON._layers instanceof Map || typeof GeoJSON._layers.get === "function"
            ).toBe(true);
        });
    });

    describe("filterFeatures", () => {
        it("returns zeros and warns when filterFn is not a function", () => {
            const result = GeoJSON.filterFeatures(123);
            expect(result).toEqual({ filtered: 0, total: 0, visible: 0 });
        });
        it("returns zeros when filterFn is null", () => {
            const result = GeoJSON.filterFeatures(null);
            expect(result).toEqual({ filtered: 0, total: 0, visible: 0 });
        });
        it("dispatches geoleaf:filter:apply (public contract, restored RM-P0)", () => {
            sharedState.layers = new Map();
            const handler = vi.fn();
            document.addEventListener("geoleaf:filter:apply", handler);
            GeoJSON.filterFeatures(() => true);
            document.removeEventListener("geoleaf:filter:apply", handler);
            expect(handler).toHaveBeenCalled();
        });
    });

    describe("getFeatures", () => {
        it("returns empty array when layers is empty", () => {
            sharedState.layers = new Map();
            const result = GeoJSON.getFeatures();
            expect(result).toEqual([]);
        });
        it("filters by layerIds when provided", () => {
            sharedState.layers = new Map();
            const result = GeoJSON.getFeatures({ layerIds: ["lyr1"] });
            expect(result).toEqual([]);
        });
    });

    describe("delegation when LayerManager absent", () => {
        it("removeLayer does not throw when LayerManager null", () => {
            const g = typeof globalThis !== "undefined" ? globalThis : window;
            const prev = g.GeoLeaf;
            g.GeoLeaf = {};
            expect(() => GeoJSON.removeLayer("x")).not.toThrow();
            g.GeoLeaf = prev;
        });
        it("getLayerById returns null when LayerManager null", () => {
            const g = typeof globalThis !== "undefined" ? globalThis : window;
            const prev = g.GeoLeaf;
            g.GeoLeaf = {};
            expect(GeoJSON.getLayerById("x")).toBeNull();
            g.GeoLeaf = prev;
        });
        it("getAllLayers returns [] when LayerManager null", () => {
            const g = typeof globalThis !== "undefined" ? globalThis : window;
            const prev = g.GeoLeaf;
            g.GeoLeaf = {};
            expect(GeoJSON.getAllLayers()).toEqual([]);
            g.GeoLeaf = prev;
        });
    });

    describe("clearFeatureFilter", () => {
        it("calls filterFeatures with always-true predicate", () => {
            const result = GeoJSON.clearFeatureFilter();
            expect(result).toEqual({ filtered: 0, total: 0, visible: 0 });
        });
        it("dispatches geoleaf:filter:reset (public contract, restored RM-P0)", () => {
            sharedState.layers = new Map();
            const handler = vi.fn();
            document.addEventListener("geoleaf:filter:reset", handler);
            GeoJSON.clearFeatureFilter();
            document.removeEventListener("geoleaf:filter:reset", handler);
            expect(handler).toHaveBeenCalled();
        });
    });

    describe("branches supplémentaires (T17)", () => {
        let mockLayerManager;
        let mockLoader;

        const makeMockNativeMap = () => ({
            createPane: vi.fn(() => ({ style: {} })),
            on: vi.fn(),
            addSource: vi.fn(),
        });

        const makeMockAdapter = (nativeMap) => ({
            getNativeMap: () => nativeMap || makeMockNativeMap(),
            addGeoJSONLayer: vi.fn(),
            getLayerRegistry: vi.fn(() => ({ getSubLayerIds: vi.fn(() => []) })),
        });

        beforeEach(() => {
            vi.clearAllMocks();
            sharedState.layers = new Map();
            sharedState.map = null;
            sharedState.geoJsonLayer = null;
            sharedState.layerGroup = null;
            sharedState.options = {};
            sharedState.adapter = { updateLayerData: vi.fn() };

            mockLayerManager = {
                getLayerById: vi.fn((id) => ({ id })),
                getLayerData: vi.fn((id) => ({ data: id })),
                getAllLayers: vi.fn(() => ["l1"]),
                showLayer: vi.fn(),
                hideLayer: vi.fn(),
                toggleLayer: vi.fn(),
                removeLayer: vi.fn(),
                setLayerStyle: vi.fn(() => true),
                updateLayerVisibilityByZoom: vi.fn(),
                registerWithLayerManager: vi.fn(),
                detectLayerType: vi.fn(() => "point"),
            };

            mockLoader = {
                loadUrl: vi.fn(() => Promise.resolve({ features: [] })),
                addData: vi.fn(),
                loadFromActiveProfile: vi.fn(() => Promise.resolve([])),
            };

            globalThis.GeoLeaf = {
                _GeoJSONLayerManager: mockLayerManager,
                _GeoJSONLoader: mockLoader,
            };
        });

        afterEach(() => {
            delete globalThis.GeoLeaf;
            delete globalThis.L;
        });

        // ---- init() branches (MapLibre mode) ----

        it("init: no adapter → retourne null", () => {
            expect(GeoJSON.init({})).toBeNull();
        });

        it("init: map without getNativeMap → retourne null", () => {
            expect(GeoJSON.init({ map: {} })).toBeNull();
        });

        it("init: success — sets state.adapter and returns null (MapLibre)", () => {
            const nativeMap = makeMockNativeMap();
            const adapter = makeMockAdapter(nativeMap);
            const result = GeoJSON.init({ map: adapter });
            expect(result).toBeNull();
            expect(sharedState.adapter).toBe(adapter);
            expect(sharedState.map).toBe(nativeMap);
        });

        it("init: uses GeoLeaf.Core.getMap() fallback when options.map absent", () => {
            const nativeMap = makeMockNativeMap();
            const adapter = makeMockAdapter(nativeMap);
            globalThis.GeoLeaf.Core = { getMap: vi.fn(() => adapter) };
            GeoJSON.init({});
            expect(globalThis.GeoLeaf.Core.getMap).toHaveBeenCalled();
            expect(sharedState.adapter).toBe(adapter);
        });

        it("init: layerGroup stays null (layer ordering handled by the adapter registry)", () => {
            const nativeMap = makeMockNativeMap();
            const adapter = makeMockAdapter(nativeMap);
            GeoJSON.init({ map: adapter });
            expect(sharedState.layerGroup).toBeNull();
        });

        it("init: _mergeInitOptions avec GeoLeaf.Utils.mergeOptions", () => {
            const nativeMap = makeMockNativeMap();
            const adapter = makeMockAdapter(nativeMap);
            const mergeOptions = vi.fn((a, b) => ({ ...a, ...b }));
            globalThis.GeoLeaf.Utils = { ensureMap: vi.fn(() => adapter), mergeOptions };
            GeoJSON.init({ map: adapter });
            expect(mergeOptions).toHaveBeenCalled();
        });

        // ---- getters with state populated ----

        it("_options getter retourne options via state", () => {
            sharedState.options = { maxZoomOnFit: 14 };
            expect(GeoJSON._options).toEqual({ maxZoomOnFit: 14 });
        });

        // ---- Delegation vers LayerManager ----

        it("getLayerById avec LayerManager → délègue et retourne résultat", () => {
            expect(GeoJSON.getLayerById("l1")).toEqual({ id: "l1" });
            expect(mockLayerManager.getLayerById).toHaveBeenCalledWith("l1");
        });

        it("getLayerData avec LayerManager → délègue", () => {
            GeoJSON.getLayerData("l2");
            expect(mockLayerManager.getLayerData).toHaveBeenCalledWith("l2");
        });

        it("getAllLayers avec LayerManager → délègue", () => {
            expect(GeoJSON.getAllLayers()).toEqual(["l1"]);
            expect(mockLayerManager.getAllLayers).toHaveBeenCalled();
        });

        it("showLayer avec LayerManager → délègue", () => {
            GeoJSON.showLayer("l1");
            expect(mockLayerManager.showLayer).toHaveBeenCalledWith("l1");
        });

        it("hideLayer avec LayerManager → délègue", () => {
            GeoJSON.hideLayer("l2");
            expect(mockLayerManager.hideLayer).toHaveBeenCalledWith("l2");
        });

        it("toggleLayer avec LayerManager → délègue", () => {
            GeoJSON.toggleLayer("l3");
            expect(mockLayerManager.toggleLayer).toHaveBeenCalledWith("l3");
        });

        it("removeLayer avec LayerManager → délègue", () => {
            GeoJSON.removeLayer("l4");
            expect(mockLayerManager.removeLayer).toHaveBeenCalledWith("l4");
        });

        it("setLayerStyle avec LayerManager → retourne true", () => {
            expect(GeoJSON.setLayerStyle("l1", {})).toBe(true);
        });

        // ---- Delegation vers Loader ----

        it("loadFromActiveProfile avec Loader → retourne promise tableau", async () => {
            const result = await GeoJSON.loadFromActiveProfile({});
            expect(Array.isArray(result)).toBe(true);
        });

        // ---- Autres méthodes de délégation ----

        it("_updateLayerVisibilityByZoom avec LayerManager → délègue", () => {
            GeoJSON._updateLayerVisibilityByZoom();
            expect(mockLayerManager.updateLayerVisibilityByZoom).toHaveBeenCalled();
        });

        it("_registerWithLayerManager avec LayerManager → délègue", () => {
            GeoJSON._registerWithLayerManager();
            expect(mockLayerManager.registerWithLayerManager).toHaveBeenCalled();
        });

        it("_detectLayerType avec LayerManager → retourne 'point'", () => {
            expect(GeoJSON._detectLayerType({})).toBe("point");
        });

        it("_detectLayerType sans LayerManager → retourne 'mixed'", () => {
            delete globalThis.GeoLeaf._GeoJSONLayerManager;
            expect(GeoJSON._detectLayerType({})).toBe("mixed");
        });

        // ---- filterFeatures avec layers réels (MapLibre natif) ----

        it("filterFeatures: appelle adapter.updateLayerData avec features visibles", () => {
            const feat1 = { type: "Feature", properties: { keep: true } };
            const feat2 = { type: "Feature", properties: { keep: false } };
            sharedState.layers.set("l1", {
                features: [feat1, feat2],
                geometryType: "point",
                config: {},
            });
            const result = GeoJSON.filterFeatures((f) => f.properties.keep);
            expect(result.total).toBe(2);
            expect(result.visible).toBe(1);
            expect(result.filtered).toBe(1);
            expect(sharedState.adapter.updateLayerData).toHaveBeenCalledWith("l1", {
                type: "FeatureCollection",
                features: [feat1],
            });
        });

        it("filterFeatures: sans features → skip (total=0)", () => {
            sharedState.layers.set("l1", { geometryType: "point", config: {} });
            const result = GeoJSON.filterFeatures(() => true);
            expect(result.total).toBe(0);
            expect(sharedState.adapter.updateLayerData).not.toHaveBeenCalled();
        });

        it("filterFeatures: layerData null → skip", () => {
            sharedState.layers.set("l1", null);
            expect(GeoJSON.filterFeatures(() => true)).toEqual({
                filtered: 0,
                total: 0,
                visible: 0,
            });
        });

        it("filterFeatures: line layer sans search.enabled → bypassFilter=true", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "linestring",
                config: {},
            });
            const result = GeoJSON.filterFeatures(() => false);
            expect(result.visible).toBe(1);
            expect(sharedState.adapter.updateLayerData).not.toHaveBeenCalled();
        });

        it("filterFeatures: search.enabled=false → bypassFilter=true pour tout type", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "point",
                config: { search: { enabled: false } },
            });
            const result = GeoJSON.filterFeatures(() => false);
            expect(result.visible).toBe(1);
        });

        it("filterFeatures: line layer avec search.enabled=true → filtre appliqué", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "line",
                config: { search: { enabled: true } },
            });
            const result = GeoJSON.filterFeatures(() => false);
            expect(result.filtered).toBe(1);
        });

        // ---- _resolveGeometryFilteredIds branches ----

        it("filterFeatures: layerIds comme string → converti en tableau", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "point",
                config: {},
            });
            sharedState.layers.set("l2", {
                features: [{ type: "Feature" }],
                geometryType: "point",
                config: {},
            });
            const result = GeoJSON.filterFeatures(() => true, { layerIds: "l1" });
            expect(result.total).toBe(1);
        });

        it("filterFeatures: geometryType='poi' → alias vers point", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "point",
                config: {},
            });
            sharedState.layers.set("l2", {
                features: [{ type: "Feature" }],
                geometryType: "line",
                config: {},
            });
            expect(GeoJSON.filterFeatures(() => true, { geometryType: "poi" }).total).toBe(1);
        });

        it("filterFeatures: geometryType='route' → alias vers line", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "line",
                config: {},
            });
            expect(GeoJSON.filterFeatures(() => true, { geometryType: "route" }).total).toBe(1);
        });

        it("filterFeatures: geometryType='linestring' → alias vers line", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "line",
                config: {},
            });
            expect(GeoJSON.filterFeatures(() => true, { geometryType: "linestring" }).total).toBe(
                1
            );
        });

        it("filterFeatures: geometryType='area' → alias vers polygon", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "polygon",
                config: {},
            });
            expect(GeoJSON.filterFeatures(() => true, { geometryType: "area" }).total).toBe(1);
        });

        it("filterFeatures: geometryType sans alias → comparaison directe", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "custom-type",
                config: {},
            });
            expect(GeoJSON.filterFeatures(() => true, { geometryType: "custom-type" }).total).toBe(
                1
            );
        });

        it("filterFeatures: geometryType non correspondant → layer exclu", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "point",
                config: {},
            });
            expect(GeoJSON.filterFeatures(() => true, { geometryType: "line" }).total).toBe(0);
        });

        it("filterFeatures: layerIds tableau — seuls les layers listés traités", () => {
            sharedState.layers.set("l1", {
                features: [{ type: "Feature" }],
                geometryType: "point",
                config: {},
            });
            sharedState.layers.set("l2", {
                features: [{ type: "Feature" }],
                geometryType: "point",
                config: {},
            });
            const result = GeoJSON.filterFeatures(() => true, { layerIds: ["l1"] });
            expect(result.total).toBe(1);
        });

        // ---- getFeatures branches ----

        it("getFeatures: filtre par geometryTypes", () => {
            sharedState.layers.set("l1", {
                geometryType: "point",
                features: [{ id: 1 }, { id: 2 }],
            });
            sharedState.layers.set("l2", { geometryType: "line", features: [{ id: 3 }] });
            const result = GeoJSON.getFeatures({ geometryTypes: ["point"] });
            expect(result).toHaveLength(2);
            result.forEach((f) => expect(f._layerId).toBe("l1"));
        });

        it("getFeatures: filtre par layerIds", () => {
            sharedState.layers.set("l1", { geometryType: "point", features: [{ id: 1 }] });
            sharedState.layers.set("l2", { geometryType: "line", features: [{ id: 2 }] });
            const result = GeoJSON.getFeatures({ layerIds: ["l2"] });
            expect(result).toHaveLength(1);
            expect(result[0]._layerId).toBe("l2");
        });

        it("getFeatures: feature non-objet (null, string) → skippé", () => {
            sharedState.layers.set("l1", {
                geometryType: "point",
                features: [null, "str", { id: 1 }],
            });
            expect(GeoJSON.getFeatures()).toHaveLength(1);
        });

        it("getFeatures: layerSet ne contenant pas le layer → skip", () => {
            sharedState.layers.set("l1", { geometryType: "point", features: [{ id: 1 }] });
            expect(GeoJSON.getFeatures({ layerIds: ["l99"] })).toHaveLength(0);
        });

        it("getFeatures: geometrySet ne correspondant pas → skip", () => {
            sharedState.layers.set("l1", { geometryType: "line", features: [{ id: 1 }] });
            expect(GeoJSON.getFeatures({ geometryTypes: ["point"] })).toHaveLength(0);
        });

        // ---- _validateOptions: maxZoomOnFit ----

        it("_validateOptions: maxZoomOnFit=0 sans GeoLeaf.CONSTANTS → fallback 18", () => {
            delete globalThis.GeoLeaf;
            const opts = GeoJSON._validateOptions({ maxZoomOnFit: 0 });
            expect(opts.maxZoomOnFit).toBe(18);
        });

        it("_validateOptions: maxZoomOnFit valide (10) → conservé tel quel", () => {
            const opts = GeoJSON._validateOptions({ maxZoomOnFit: 10 });
            expect(opts.maxZoomOnFit).toBe(10);
        });
    });
});
