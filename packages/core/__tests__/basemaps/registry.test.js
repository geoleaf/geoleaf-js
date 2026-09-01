/**
 */
/* src/kernel/basemaps/registry.ts (MapLibre native API) */

const Log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../../src/utils/log/index.js", () => ({
    Log,
}));

import {
    _acquireNativeMap,
    setMap,
    getInternalMap,
    registerBaseLayer,
    registerBaseLayers,
    setBaseLayer,
    refreshBasemap,
    getBaseLayers,
    getActiveKey,
    getActiveLayer,
    _baseLayers,
    _resetStateForTesting,
} from "../../src/kernel/basemaps/registry.ts";
// registerDefaultBaseLayers() was removed (98a0d69a); defaults are now registered
// via registerBaseLayers(DEFAULT_BASELAYERS) from providers.ts.
import { DEFAULT_BASELAYERS } from "../../src/kernel/basemaps/providers.ts";

// Fixed IDs mirrored from registry.ts
const BASEMAP_SOURCE_ID = "__geoleaf_basemap__";
const BASEMAP_LAYER_ID = "__geoleaf_basemap_layer__";

// No global L needed — registry no longer uses Leaflet.
// registry.ts uses `const _g: any = globalThis`, so we set globals directly.
globalThis.GeoLeaf = globalThis.GeoLeaf || {};
globalThis.GeoLeaf.Core = null; // overridden per-test when needed

/** Creates a fully-mocked native maplibregl.Map for tests. */
function makeMockMap({ loaded = true, styleLoaded = true } = {}) {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        getLayer: vi.fn((id) => (id === BASEMAP_LAYER_ID ? {} : null)),
        getSource: vi.fn((id) => (id === BASEMAP_SOURCE_ID ? {} : null)),
        getStyle: vi.fn(() => ({ layers: [] })),
        setStyle: vi.fn(),
        once: vi.fn(),
        loaded: vi.fn(() => loaded),
        isStyleLoaded: vi.fn(() => styleLoaded),
    };
}

describe("basemaps/registry (MapLibre native)", () => {
    let mockMap;

    beforeEach(() => {
        vi.clearAllMocks();
        // Clear all registered layers
        Object.keys(_baseLayers).forEach((k) => delete _baseLayers[k]);
        // Reset map and active state
        setMap(null);
        _resetStateForTesting();
        // Fresh mock for each test
        mockMap = makeMockMap();
        // Reset Core fallback
        globalThis.GeoLeaf.Core = null;
    });

    // ─── setMap / _acquireNativeMap ───────────────────────────────────────────────────

    it("setMap accepts a native maplibregl.Map (duck-type: addSource + addLayer)", () => {
        setMap(mockMap);
        expect(getInternalMap()).toBe(mockMap);
    });

    it("setMap accepts null to clear the cached map", () => {
        setMap(mockMap);
        expect(getInternalMap()).toBe(mockMap);
        setMap(null);
        expect(getInternalMap()).toBeNull();
    });

    it("setMap unwraps an IMapAdapter via getNativeMap()", () => {
        const adapter = { getNativeMap: vi.fn(() => mockMap) };
        setMap(adapter);
        expect(getInternalMap()).toBe(mockMap);
    });

    it("setMap ignores an object that lacks addSource/addLayer", () => {
        setMap({ setView: vi.fn() }); // non-MapLibre object (no addSource/addLayer)
        expect(getInternalMap()).toBeNull();
    });

    it("_acquireNativeMap stores explicit native map", () => {
        _acquireNativeMap(mockMap);
        expect(getInternalMap()).toBe(mockMap);
    });

    it("_acquireNativeMap keeps existing map when no explicit map given", () => {
        setMap(mockMap);
        _acquireNativeMap(null);
        expect(getInternalMap()).toBe(mockMap);
    });

    it("_acquireNativeMap falls back via Core.getMap().getNativeMap()", () => {
        globalThis.GeoLeaf.Core = {
            getMap: vi.fn(() => ({ getNativeMap: vi.fn(() => mockMap) })),
        };
        setMap(null);
        _acquireNativeMap();
        expect(getInternalMap()).toBe(mockMap);
    });

    it("_acquireNativeMap ignores non-native-map explicit argument", () => {
        _acquireNativeMap({ setView: vi.fn() }); // Leaflet-like
        expect(getInternalMap()).toBeNull();
    });

    // ─── registerBaseLayer ────────────────────────────────────────────────────

    it("registerBaseLayer warns when key is empty", () => {
        registerBaseLayer("", { url: "https://x.com/{z}/{x}/{y}.png" });
        expect(Log.warn).toHaveBeenCalled();
    });

    it("registerBaseLayer warns when definition is null", () => {
        registerBaseLayer("k", null);
        expect(Log.warn).toHaveBeenCalled();
    });

    it("registerBaseLayer stores definition and layer:null for url definition", () => {
        const def = { label: "Street", url: "https://tile.example/{z}/{x}/{y}.png" };
        registerBaseLayer("street", def);
        expect(_baseLayers.street).toBeDefined();
        expect(_baseLayers.street.label).toBe("Street");
        expect(_baseLayers.street.definition).toBe(def);
        expect(_baseLayers.street.layer).toBeNull();
    });

    it("registerBaseLayer stores definition for tiles array definition", () => {
        const def = {
            label: "Custom",
            tiles: ["https://a.tile.example/{z}/{x}/{y}.png"],
        };
        registerBaseLayer("custom", def);
        expect(_baseLayers.custom).toBeDefined();
        expect(_baseLayers.custom.definition).toBe(def);
    });

    it("registerBaseLayer uses definition.id as actualKey when provided", () => {
        const def = {
            id: "custom-id",
            label: "Custom",
            url: "https://example.com/{z}/{x}/{y}.png",
        };
        registerBaseLayer("key", def);
        expect(_baseLayers["custom-id"]).toBeDefined();
        expect(_baseLayers["key"]).toBeUndefined();
    });

    it("registerBaseLayer stores vector (maplibre) definition without calling map API", () => {
        const def = { type: "maplibre", style: "https://style.example/style.json" };
        registerBaseLayer("liberty", def);
        expect(_baseLayers.liberty).toBeDefined();
        expect(_baseLayers.liberty.definition).toBe(def);
        // No map API should be called at registration time
        expect(mockMap.addSource).not.toHaveBeenCalled();
        expect(mockMap.setStyle).not.toHaveBeenCalled();
    });

    it("registerBaseLayer warns and skips when no url, tiles, or style provided", () => {
        const before = Object.keys(_baseLayers).length;
        registerBaseLayer("inv", { label: "Invalid" });
        expect(Log.warn).toHaveBeenCalledWith(
            "[GeoLeaf.Baselayers] Invalid definition for layer:",
            "inv",
            "(no url / tiles / style / type provided)"
        );
        expect(Object.keys(_baseLayers).length).toBe(before);
    });

    it("registering DEFAULT_BASELAYERS adds the default layers without requiring global L", () => {
        // No global L set — must work without Leaflet
        registerBaseLayers(DEFAULT_BASELAYERS);
        expect(Object.keys(_baseLayers).length).toBeGreaterThan(0);
        expect(_baseLayers.street).toBeDefined();
        expect(_baseLayers.satellite).toBeDefined();
    });

    it("registerBaseLayers warns when definitions is not an object", () => {
        registerBaseLayers(null);
        registerBaseLayers("string");
        expect(Log.warn).toHaveBeenCalled();
    });

    it("registerBaseLayers registers each key", () => {
        registerBaseLayers({
            one: { url: "https://a.com/{z}/{x}/{y}.png", label: "One" },
            two: { tiles: ["https://b.com/{z}/{x}/{y}.png"], label: "Two" },
        });
        expect(_baseLayers.one).toBeDefined();
        expect(_baseLayers.two).toBeDefined();
    });

    // ─── setBaseLayer — raster ────────────────────────────────────────────────

    it("setBaseLayer warns when key is missing", () => {
        setBaseLayer("");
        expect(Log.warn).toHaveBeenCalled();
    });

    it("setBaseLayer warns when no maplibregl.Map available", () => {
        setMap(null);
        registerBaseLayer("st", { url: "https://tile.example/{z}/{x}/{y}.png" });
        setBaseLayer("st");
        expect(Log.warn).toHaveBeenCalledWith("[GeoLeaf.Baselayers] No maplibregl.Map available.");
    });

    it("setBaseLayer calls addSource and addLayer for a raster basemap", () => {
        setMap(mockMap);
        registerBaseLayer("street", {
            label: "Street",
            tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
            maxZoom: 19,
            attribution: "© OSM",
        });
        setBaseLayer("street");

        expect(mockMap.addSource).toHaveBeenCalledWith(
            BASEMAP_SOURCE_ID,
            expect.objectContaining({ type: "raster", tiles: expect.any(Array) })
        );
        expect(mockMap.addLayer).toHaveBeenCalledWith(
            expect.objectContaining({
                id: BASEMAP_LAYER_ID,
                type: "raster",
                source: BASEMAP_SOURCE_ID,
            })
        );
        expect(getActiveKey()).toBe("street");
    });

    it("setBaseLayer passes correct maxzoom and attribution to source spec", () => {
        setMap(mockMap);
        registerBaseLayer("topo", {
            url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
            maxZoom: 17,
            attribution: "© Topo",
        });
        setBaseLayer("topo");

        const sourceCall = mockMap.addSource.mock.calls[0];
        expect(sourceCall[1]).toMatchObject({ maxzoom: 17, attribution: "© Topo" });
    });

    it("setBaseLayer uses tileSize from definition (default 256)", () => {
        setMap(mockMap);
        registerBaseLayer("big", {
            tiles: ["https://tile.example/{z}/{x}/{y}.png"],
            tileSize: 512,
        });
        setBaseLayer("big");
        const sourceCall = mockMap.addSource.mock.calls[0];
        expect(sourceCall[1].tileSize).toBe(512);
    });

    // ─── setBaseLayer — vector ────────────────────────────────────────────────

    it("setBaseLayer calls setStyle for a vector basemap (type: maplibre)", () => {
        setMap(mockMap);
        const styleUrl = "https://style.example/liberty.json";
        registerBaseLayer("liberty", { type: "maplibre", style: styleUrl });
        setBaseLayer("liberty");

        // setStyle(target, transform?) — 2nd arg undefined when no GeoLeaf layers to preserve.
        expect(mockMap.setStyle).toHaveBeenCalledWith(styleUrl, undefined);
        expect(mockMap.once).toHaveBeenCalledWith("style.load", expect.any(Function));
        expect(getActiveKey()).toBe("liberty");
    });

    it("setBaseLayer calls setStyle for a definition with style and no url/tiles", () => {
        setMap(mockMap);
        registerBaseLayer("vec", { style: "https://style.example/vec.json" });
        setBaseLayer("vec");
        expect(mockMap.setStyle).toHaveBeenCalled();
    });

    // ─── setBaseLayer — deferred (map not loaded) ─────────────────────────────

    it("setBaseLayer defers activation via once('idle') when the style is not loaded", () => {
        const notLoadedMap = makeMockMap({ styleLoaded: false });
        setMap(notLoadedMap);
        registerBaseLayer("st", { tiles: ["https://tile.example/{z}/{x}/{y}.png"] });
        setBaseLayer("st");

        // Should not apply immediately — gate on isStyleLoaded() (NOT loaded(), which is false
        // while GeoJSON sources load). Defers on `idle` (fires once the map is fully settled at
        // boot, without a user interaction), NOT the one-shot `load` which may already have fired.
        expect(notLoadedMap.addSource).not.toHaveBeenCalled();
        expect(notLoadedMap.once).toHaveBeenCalledWith("idle", expect.any(Function));
    });

    // ⚠️ The `once('idle')` deferral OVERWROTE a more recent choice.
    //
    // Measured in a browser (`tourism` profile, 8/8):
    // `setBaseLayer("positron")` applied (`Active basemap: positron`), then
    // ~500 ms later the basemap went back to `terrain-terrarium` — the
    // BOOT's key, captured by a deferral still pending. No console error:
    // the switch was refused silently, and the layer's labels were lost
    // without being rebuilt.
    //
    // The cause: the deferral captures `key` at call time and re-applies
    // itself without ever checking that a later request replaced it. The
    // module already had `_styleGeneration` for exactly this race class, but
    // it only guarded `style.load` and the WMTS path — not this deferral.
    it("un report sur idle n'écrase PAS une activation plus récente (R.7b)", () => {
        const map = makeMockMap({ styleLoaded: false });
        setMap(map);
        registerBaseLayer("boot", { tiles: ["https://tile.example/boot/{z}/{x}/{y}.png"] });
        registerBaseLayer("choix", { tiles: ["https://tile.example/choix/{z}/{x}/{y}.png"] });

        // 1 — boot activation: the map is not ready, it is deferred to `idle`.
        setBaseLayer("boot", { silent: true });
        const deferred = map.once.mock.calls.find(([evt]) => evt === "idle")?.[1];
        expect(deferred, "aucun report armé sur idle").toBeTypeOf("function");

        // 2 — the map becomes ready and the user picks ANOTHER basemap, which applies.
        map.isStyleLoaded.mockReturnValue(true);
        setBaseLayer("choix");
        expect(getActiveKey()).toBe("choix");

        // 3 — the boot's deferral finally fires. It must recognise itself stale.
        deferred();

        expect(
            getActiveKey(),
            "le report du boot a écrasé le choix de l'utilisateur — c'est le défaut R.7b"
        ).toBe("choix");
    });

    // ─── setBaseLayer — switcher ──────────────────────────────────────────────

    // ─── raster→raster: mutate rather than destroy ─────────────────────────────
    // `RasterTileSource.setTiles()` mutates ONLY the tiles. Everything else
    // (tileSize, attribution, zoom bounds) is frozen at source creation: as
    // soon as one of those properties changes, rebuilding is REQUIRED,
    // otherwise the old value survives silently.

    /** Live raster source, as MapLibre exposes it (with setTiles). */
    const liveRasterSource = () => ({ setTiles: vi.fn() });

    function primeSwitch(source) {
        setBaseLayer("a");
        vi.clearAllMocks();
        mockMap.getLayer.mockImplementation((id) => (id === BASEMAP_LAYER_ID ? {} : null));
        mockMap.getSource.mockImplementation((id) => (id === BASEMAP_SOURCE_ID ? source : null));
    }

    it("setBaseLayer raster→raster: mute les tuiles en place, sans détruire la source", () => {
        setMap(mockMap);
        registerBaseLayer("a", { tiles: ["https://a.example/{z}/{x}/{y}.png"] });
        registerBaseLayer("b", { tiles: ["https://b.example/{z}/{x}/{y}.png"] });
        const source = liveRasterSource();
        primeSwitch(source);

        setBaseLayer("b");

        expect(source.setTiles).toHaveBeenCalledWith(["https://b.example/{z}/{x}/{y}.png"]);
        expect(mockMap.removeSource).not.toHaveBeenCalled();
        expect(mockMap.removeLayer).not.toHaveBeenCalled();
        expect(mockMap.addSource).not.toHaveBeenCalled();
    });

    it("setBaseLayer raster→raster: reconstruit si tileSize change (non mutable)", () => {
        setMap(mockMap);
        registerBaseLayer("a", { tiles: ["https://a.example/{z}/{x}/{y}.png"], tileSize: 256 });
        registerBaseLayer("b", { tiles: ["https://b.example/{z}/{x}/{y}.png"], tileSize: 512 });
        const source = liveRasterSource();
        primeSwitch(source);

        setBaseLayer("b");

        expect(source.setTiles).not.toHaveBeenCalled();
        expect(mockMap.removeSource).toHaveBeenCalledWith(BASEMAP_SOURCE_ID);
        expect(mockMap.addSource).toHaveBeenCalledWith(BASEMAP_SOURCE_ID, expect.any(Object));
    });

    it("setBaseLayer raster→raster: reconstruit si l'attribution change", () => {
        setMap(mockMap);
        registerBaseLayer("a", { tiles: ["https://a.example/{z}/{x}/{y}.png"], attribution: "A" });
        registerBaseLayer("b", { tiles: ["https://b.example/{z}/{x}/{y}.png"], attribution: "B" });
        const source = liveRasterSource();
        primeSwitch(source);

        setBaseLayer("b");

        expect(source.setTiles).not.toHaveBeenCalled();
        expect(mockMap.addSource).toHaveBeenCalled();
    });

    it("setBaseLayer raster→raster: retombe sur remove+re-add si la source n'a pas setTiles", () => {
        // Net: a source not exposing the mutation (or an older engine) must
        // keep working through the historical path.
        setMap(mockMap);
        registerBaseLayer("a", { tiles: ["https://a.example/{z}/{x}/{y}.png"] });
        registerBaseLayer("b", { tiles: ["https://b.example/{z}/{x}/{y}.png"] });
        primeSwitch({}); // no setTiles

        setBaseLayer("b");

        expect(mockMap.removeLayer).toHaveBeenCalledWith(BASEMAP_LAYER_ID);
        expect(mockMap.removeSource).toHaveBeenCalledWith(BASEMAP_SOURCE_ID);
        expect(mockMap.addSource).toHaveBeenCalledWith(BASEMAP_SOURCE_ID, expect.any(Object));
        expect(mockMap.addLayer).toHaveBeenCalledWith(expect.any(Object));
    });

    it("setBaseLayer raster→raster: reconstruit toujours pour un type image (ImageSource)", () => {
        // `image` is not a RasterTileSource: it has no setTiles.
        setMap(mockMap);
        registerBaseLayer("a", { tiles: ["https://a.example/{z}/{x}/{y}.png"] });
        registerBaseLayer("img", {
            type: "image",
            url: "https://x.example/i.png",
            coordinates: [
                [0, 1],
                [1, 1],
                [1, 0],
                [0, 0],
            ],
        });
        const source = liveRasterSource();
        primeSwitch(source);

        setBaseLayer("img");

        expect(source.setTiles).not.toHaveBeenCalled();
        expect(mockMap.removeSource).toHaveBeenCalledWith(BASEMAP_SOURCE_ID);
    });

    it("setBaseLayer raster→raster: dispatche le changement même en mutant", () => {
        // The mutation must not short-circuit the switch's bookkeeping.
        setMap(mockMap);
        registerBaseLayer("a", { tiles: ["https://a.example/{z}/{x}/{y}.png"] });
        registerBaseLayer("b", { tiles: ["https://b.example/{z}/{x}/{y}.png"] });
        primeSwitch(liveRasterSource());

        setBaseLayer("b");

        expect(getActiveKey()).toBe("b");
    });

    it("setBaseLayer raster→vector: calls setStyle and defers rebuild to style.load", () => {
        setMap(mockMap);
        registerBaseLayer("raster", { tiles: ["https://a.example/{z}/{x}/{y}.png"] });
        registerBaseLayer("vector", { type: "maplibre", style: "https://style.example" });

        setBaseLayer("raster");
        vi.clearAllMocks();
        mockMap.getLayer.mockImplementation((id) => (id === BASEMAP_LAYER_ID ? {} : null));
        mockMap.getSource.mockImplementation((id) => (id === BASEMAP_SOURCE_ID ? {} : null));

        setBaseLayer("vector");

        // No explicit removal: setStyle replaces the entire style
        expect(mockMap.removeLayer).not.toHaveBeenCalled();
        expect(mockMap.removeSource).not.toHaveBeenCalled();
        expect(mockMap.setStyle).toHaveBeenCalledWith("https://style.example", undefined);
        expect(mockMap.once).toHaveBeenCalledWith("style.load", expect.any(Function));
    });

    it("setBaseLayer vector→raster: calls setStyle(empty) and defers raster injection to style.load", () => {
        setMap(mockMap);
        registerBaseLayer("vector", { type: "maplibre", style: "https://style.example" });
        registerBaseLayer("raster", { tiles: ["https://a.example/{z}/{x}/{y}.png"] });

        setBaseLayer("vector");
        vi.clearAllMocks();
        // After setStyle, basemap layer no longer exists
        mockMap.getLayer.mockImplementation(() => null);
        mockMap.getSource.mockImplementation(() => null);

        setBaseLayer("raster");

        // Uses the async path: setStyle(empty) to clear vector, then raster is injected in style.load
        expect(mockMap.removeLayer).not.toHaveBeenCalled();
        expect(mockMap.removeSource).not.toHaveBeenCalled();
        expect(mockMap.setStyle).toHaveBeenCalledWith(
            expect.objectContaining({ version: 8, sources: {}, layers: [] }),
            undefined
        );
        expect(mockMap.once).toHaveBeenCalledWith("style.load", expect.any(Function));
        // Raster addSource/addLayer happens inside the style.load callback, not synchronously
        expect(mockMap.addSource).not.toHaveBeenCalled();
    });

    it("setBaseLayer is no-op when same key is requested again", () => {
        setMap(mockMap);
        registerBaseLayer("st", { tiles: ["https://tile.example/{z}/{x}/{y}.png"] });
        setBaseLayer("st");
        vi.clearAllMocks();
        setBaseLayer("st");
        expect(mockMap.addSource).not.toHaveBeenCalled();
    });

    it("setBaseLayer warns and falls back to first layer when key is unknown and no active key", () => {
        setMap(mockMap);
        registerBaseLayer("fallback", { tiles: ["https://fb.example/{z}/{x}/{y}.png"] });
        setBaseLayer("nonexistent");
        expect(Log.warn).toHaveBeenCalledWith("[GeoLeaf.Baselayers] Unknown layer:", "nonexistent");
        // Falls back to first registered layer because _activeKey is null
        expect(mockMap.addSource).toHaveBeenCalled();
    });

    // ─── Events ───────────────────────────────────────────────────────────────

    it("setBaseLayer dispatches geoleaf:basemap:change with definition in detail", () => {
        setMap(mockMap);
        const def = { label: "D", tiles: ["https://d.example/{z}/{x}/{y}.png"] };
        registerBaseLayer("d", def);
        const spy = vi.spyOn(document, "dispatchEvent");

        setBaseLayer("d", { silent: false });

        expect(spy).toHaveBeenCalled();
        const call = spy.mock.calls.find((c) => c[0]?.type === "geoleaf:basemap:change");
        expect(call).toBeDefined();
        expect(call[0].detail.key).toBe("d");
        expect(call[0].detail.definition).toStrictEqual(def);
        expect(call[0].detail.layer).toBeNull(); // tombstone
        spy.mockRestore();
    });

    it("setBaseLayer does not dispatch when silent:true", () => {
        setMap(mockMap);
        registerBaseLayer("s", { tiles: ["https://s.example/{z}/{x}/{y}.png"] });
        const spy = vi.spyOn(document, "dispatchEvent");
        setBaseLayer("s", { silent: true });
        const basemapChangeCalls = spy.mock.calls.filter(
            (c) => c[0]?.type === "geoleaf:basemap:change"
        );
        expect(basemapChangeCalls.length).toBe(0);
        spy.mockRestore();
    });

    // ─── Accessors ────────────────────────────────────────────────────────────

    it("getBaseLayers returns a copy of _baseLayers", () => {
        _baseLayers.a = { key: "a", label: "A", definition: {}, layer: null };
        const copy = getBaseLayers();
        expect(copy.a).toBeDefined();
        expect(copy).not.toBe(_baseLayers);
    });

    it("getActiveLayer returns definition after setBaseLayer", () => {
        setMap(mockMap);
        const def = { label: "K", tiles: ["https://k.example/{z}/{x}/{y}.png"] };
        registerBaseLayer("k", def);
        setBaseLayer("k");
        expect(getActiveKey()).toBe("k");
        expect(getActiveLayer()).toBe(def);
    });

    it("getActiveLayer returns null when no basemap is active", () => {
        expect(getActiveLayer()).toBeNull();
    });

    // ─── refreshBasemap ───────────────────────────────────────────────────────

    it("refreshBasemap re-applies the raster basemap when source is absent", () => {
        const map = makeMockMap();
        // Source absent initially
        map.getSource = vi.fn(() => null);
        setMap(map);
        registerBaseLayer("r", { tiles: ["https://r.example/{z}/{x}/{y}.png"] });
        setBaseLayer("r");
        // Simulate source being lost (e.g., race at boot)
        map.getSource = vi.fn(() => null);
        map.addSource.mockClear();
        map.addLayer.mockClear();

        refreshBasemap();

        expect(map.addSource).toHaveBeenCalledWith("__geoleaf_basemap__", expect.any(Object));
        expect(map.addLayer).toHaveBeenCalled();
    });

    it("refreshBasemap is a no-op when source already exists", () => {
        const map = makeMockMap();
        // Source present
        map.getSource = vi.fn((id) => (id === "__geoleaf_basemap__" ? {} : null));
        setMap(map);
        registerBaseLayer("r2", { tiles: ["https://r2.example/{z}/{x}/{y}.png"] });
        setBaseLayer("r2");
        map.addSource.mockClear();

        refreshBasemap();

        expect(map.addSource).not.toHaveBeenCalled();
    });

    it("refreshBasemap is a no-op when activeKey is null", () => {
        const map = makeMockMap({ loaded: true });
        map.getSource = vi.fn(() => null);
        setMap(map);
        // No setBaseLayer call — _activeKey stays null

        refreshBasemap();

        expect(map.addSource).not.toHaveBeenCalled();
    });

    it("refreshBasemap does not emit geoleaf:basemap:change", () => {
        const map = makeMockMap();
        map.getSource = vi.fn(() => null);
        setMap(map);
        registerBaseLayer("r3", { tiles: ["https://r3.example/{z}/{x}/{y}.png"] });
        setBaseLayer("r3");
        map.getSource = vi.fn(() => null);
        const spy = vi.spyOn(document, "dispatchEvent");

        refreshBasemap();

        const changeCalls = spy.mock.calls.filter((c) => c[0]?.type === "geoleaf:basemap:change");
        expect(changeCalls.length).toBe(0);
        spy.mockRestore();
    });
});
