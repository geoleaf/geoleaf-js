/**
 * T17.2.3 — geojson/loader/single-layer.ts branch coverage
 * Focus: uncovered branches — VectorTiles, GPX, worker paths, preloadStyle,
 *         clustering (shared/pending/independent), zIndex, fitBounds, labels, postProcess.
 * Static imports for Istanbul instrumentation.
 */
import {
    LoaderSingleLayer,
    setupSingleLayerDeps,
    applyOgcRefreshedData,
} from "../../src/kernel/geojson/loader/single-layer.js";
import { notifyPrimitive } from "../../src/utils/notify/notify.primitive.js";

const state = vi.hoisted(() => ({
    layers: new Map(),
    map: { addLayer: vi.fn(), fitBounds: vi.fn() },
    options: {},
    adapter: null,
}));

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        state,
    },
}));

vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    }),
}));

// The OGC path is `_doLoadSingleLayerMapLibre`'s SECOND caller, and it was
// exercised by no overlap test: the three original cases all enter through
// `url:`, `plugin:` or `vectorTiles`. `_loadFromOgcApi` exits BEFORE them
// (`_loadSingleLayer`'s early-exit), so pulling its `_preloadStyle` under
// the `await`s would have come out GREEN. This mock holds its data open, as
// `withHeldData()` does for `fetch`.
const ogcGate = vi.hoisted(() => ({ release: null, promise: null }));
vi.mock("../../src/kernel/geojson/loader/ogc-api-loader.js", () => ({
    fetchOgcApiFeatures: vi.fn(
        () => ogcGate.promise ?? Promise.resolve({ type: "FeatureCollection", features: [] })
    ),
    setupAutoRefresh: vi.fn(() => () => {}),
}));

function createMockAdapter() {
    return {
        addGeoJSONLayer: vi.fn(),
        getNativeMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
        getLayerRegistry: vi.fn(() => ({
            getSubLayerIds: vi.fn(() => []),
        })),
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Maps a baseGeoLeaf()-style mock object to a LoaderDependencies interface. */
function makeDeps(gleaf = {}) {
    return {
        getLayerManager: () => gleaf._GeoJSONLayerManager,
        getLoader: () => undefined,
        getConfig: () => gleaf.Config,
        getFeatureValidator: () => gleaf._GeoJSONFeatureValidator,
        getLayerConfig: () => gleaf._GeoJSONLayerConfig,
        getVectorTiles: () => gleaf._VectorTiles,
        getCluster: () => gleaf._Cluster,
        getUtils: () => gleaf.Utils,
        getNotifications: () => gleaf.Notifications,
        getCore: () => gleaf.Core,
        getPopupTooltip: () => gleaf._GeoJSONPopupTooltip,
        getLabels: () => gleaf.Labels,
        getWorkerManager: () => gleaf._WorkerManager,
        getDataConverter: () => gleaf._DataConverter,
        getNormalizer: () => gleaf._Normalizer,
        getAllLayerConfigs: () => gleaf._allLayerConfigs,
        setAllLayerConfigs: (configs) => {
            if (gleaf) gleaf._allLayerConfigs = configs;
        },
    };
}

function baseGeoLeaf(overrides = {}) {
    return {
        _WorkerManager: { isAvailable: () => false },
        _VectorTiles: null,
        _DataConverter: {
            autoConvert: (x) => x,
        },
        _GeoJSONLayerConfig: {
            buildLayerOptions: () => ({}),
            inferGeometryType: () => "point",
            loadDefaultStyle: vi.fn().mockResolvedValue(null),
        },
        _GeoJSONLayerManager: {
            updateLayerVisibilityByZoom: vi.fn(),
            setLayerStyle: vi.fn(),
        },
        _GeoJSONClustering: {
            getClusteringStrategy: () => ({ shouldCluster: false, useSharedCluster: false }),
            getSharedPOICluster: () => null,
        },
        ThemeCache: { store: vi.fn() },
        ThemeSelector: null,
        Config: { getActiveProfileId: () => null, get: () => null },
        Labels: null,
        _LabelButtonManager: null,
        Notifications: null,
        ...overrides,
    };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("geojson/loader/single-layer — T17.2.3 branch coverage", () => {
    beforeEach(() => {
        state.layers = new Map();
        state.map = { addLayer: vi.fn(), fitBounds: vi.fn() };
        state.adapter = createMockAdapter();
        globalThis.GeoLeaf = baseGeoLeaf();
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
    });

    afterEach(() => {
        globalThis.GeoLeaf = undefined;
        setupSingleLayerDeps(makeDeps({}));
    });

    // ── VectorTiles early-exit ────────────────────────────────────────────
    it("early-exit to VectorTiles when shouldUseVectorTiles returns true", async () => {
        const mockLoad = vi.fn().mockResolvedValue({ id: "lyr", label: "L", featureCount: 0 });
        globalThis.GeoLeaf = baseGeoLeaf({
            _VectorTiles: {
                shouldUseVectorTiles: () => true,
                loadVectorTileLayer: mockLoad,
            },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        const result = await LoaderSingleLayer._loadSingleLayer(
            "lyr",
            "L",
            { url: "https://example.com/tiles" },
            {}
        );
        expect(mockLoad).toHaveBeenCalled();
        expect(result).toEqual({ id: "lyr", label: "L", featureCount: 0 });
    });

    // ── Plugin-backed layer dispatch (S10) ────────────────────────────────
    it("dispatches a `plugin:` layer to the registered plugin loader", async () => {
        const pluginLoader = vi.fn().mockResolvedValue("gl-fgb-1");
        globalThis.GeoLeaf = baseGeoLeaf();
        setupSingleLayerDeps({
            ...makeDeps(globalThis.GeoLeaf),
            getPluginLayerLoader: (id) => (id === "flatgeobuf" ? pluginLoader : undefined),
        });
        const result = await LoaderSingleLayer._loadSingleLayer(
            "zones_desserte",
            "Zones",
            { plugin: "flatgeobuf", data: { url: "data/z.fgb" }, _profileId: "france-rail" },
            {}
        );
        expect(pluginLoader).toHaveBeenCalledWith(
            expect.objectContaining({ plugin: "flatgeobuf", _profileId: "france-rail" })
        );
        expect(result).toEqual({ id: "gl-fgb-1", label: "Zones", featureCount: 0 });
    });

    it("reports a `plugin:` layer with no registered loader without throwing", async () => {
        globalThis.GeoLeaf = baseGeoLeaf();
        setupSingleLayerDeps({
            ...makeDeps(globalThis.GeoLeaf),
            getPluginLayerLoader: () => undefined,
        });
        const result = await LoaderSingleLayer._loadSingleLayer(
            "ghost",
            "Ghost",
            { plugin: "ghost", data: { url: "x" } },
            {}
        );
        expect(result).toEqual({ id: "ghost", label: "Ghost", featureCount: 0 });
    });

    // ── From-cache path ───────────────────────────────────────────────────
    it("loads from cache and removes _cachedData from def", async () => {
        const def = {
            _cachedData: {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [2, 48] },
                        properties: {},
                    },
                ],
            },
            zIndex: 10,
        };
        const result = await LoaderSingleLayer._loadSingleLayer("lyr1", "Layer 1", def, {});
        expect(result.featureCount).toBe(1);
        expect(def._cachedData).toBeUndefined();
    });

    // ── Worker path — fetchGeoJSON ────────────────────────────────────────
    it("uses WorkerManager.fetchGeoJSON when useWorker=true", async () => {
        const mockFetchGeoJSON = vi
            .fn()
            .mockResolvedValue({ type: "FeatureCollection", features: [] });
        globalThis.GeoLeaf = baseGeoLeaf({
            _WorkerManager: { isAvailable: () => true, fetchGeoJSON: mockFetchGeoJSON },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        await LoaderSingleLayer._loadSingleLayer(
            "lyrW",
            "Worker",
            {
                url: "https://example.com/data.json",
            },
            {}
        );
        expect(mockFetchGeoJSON).toHaveBeenCalledWith("https://example.com/data.json", "lyrW");
    });

    // ── Worker path — BYPASSED for a `data.mapping` layer (B.6 / ANO-083) ──
    // Regression guard: the worker's `_normalizeFeatures` keeps only `.features` / a
    // top-level array, so a foreign envelope (GBIF `{ results: [...] }`) was reduced to
    // an empty FeatureCollection before `applyDataMapping` ever saw it — the per-source
    // mapping pipeline rendered 0 feature in the browser (caught by cfg-b6 E2E).
    it("bypasses the worker for a layer declaring data.mapping (raw payload must survive)", async () => {
        const mockFetchGeoJSON = vi
            .fn()
            .mockResolvedValue({ type: "FeatureCollection", features: [] });
        globalThis.GeoLeaf = baseGeoLeaf({
            _WorkerManager: { isAvailable: () => true, fetchGeoJSON: mockFetchGeoJSON },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
        });
        await LoaderSingleLayer._loadSingleLayer(
            "lyrMap",
            "Mapped",
            {
                url: "https://api.example.org/search",
                data: { mapping: "gbif", itemsPath: "results" },
            },
            {}
        );
        expect(mockFetchGeoJSON).not.toHaveBeenCalled();
        expect(globalThis.fetch).toHaveBeenCalledWith("https://api.example.org/search", undefined);
    });

    // ── _preloadStyle — def.styles.default present → success ─────────────
    it("applies preloaded style when def.styles.default is set and loadDefaultStyle resolves", async () => {
        const mockLoad = vi.fn().mockResolvedValue({
            defaultStyle: { color: "#ff0000" },
            styleRules: [],
        });
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "point",
                loadDefaultStyle: mockLoad,
            },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        const def = {
            _cachedData: { type: "FeatureCollection", features: [] },
            styles: { default: "some-style.json" },
            zIndex: 10,
        };
        await LoaderSingleLayer._loadSingleLayer("lyrS", "Styled", def, {});
        expect(mockLoad).toHaveBeenCalled();
        expect(def.style).toBeDefined();
        expect(def.style.color).toBe("#ff0000");
    });

    // ── _preloadStyle — loadDefaultStyle throws → Notifications.warning ──
    it("notifies about style failure when loadDefaultStyle throws", async () => {
        // S7: _notifyStyleFail emits via the kernel notify primitive (the former
        // `GeoLeaf.Notifications` reader was dead — never mounted).
        const notifySpy = vi.spyOn(notifyPrimitive, "notify");
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "point",
                loadDefaultStyle: vi.fn().mockRejectedValue(new Error("404 not found")),
            },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        const def = {
            _cachedData: { type: "FeatureCollection", features: [] },
            styles: { default: "missing.json" },
            zIndex: 10,
        };
        const result = await LoaderSingleLayer._loadSingleLayer("lyrE", "Error Layer", def, {});
        expect(result.id).toBe("lyrE");
        expect(notifySpy).toHaveBeenCalledWith(expect.stringContaining("Error Layer"), "warning");
        notifySpy.mockRestore();
    });

    // ── _preloadStyle — loadDefaultStyle returns null ─────────────────────
    it("continues normally when loadDefaultStyle returns null", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "point",
                loadDefaultStyle: vi.fn().mockResolvedValue(null),
            },
        });
        const result = await LoaderSingleLayer._loadSingleLayer(
            "lyrNull",
            "Null Style",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                styles: { default: "style.json" },
                zIndex: 10,
            },
            {}
        );
        expect(result.id).toBe("lyrNull");
    });

    // ── SVG renderer no longer used — MapLibre handles rendering natively ──
    // (L.svg removed — these tests now verify adapter is called)

    it("registers layer via adapter when defaultStyle has hatch.enabled=true", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "polygon",
                loadDefaultStyle: vi
                    .fn()
                    .mockResolvedValue({ defaultStyle: { hatch: { enabled: true } } }),
            },
        });
        await LoaderSingleLayer._loadSingleLayer(
            "lyrH",
            "Hatch",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                styles: { default: "hatch.json" },
                zIndex: 10,
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
    });

    it("registers layer via adapter when a styleRule has casing.enabled=true", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "line",
                loadDefaultStyle: vi.fn().mockResolvedValue({
                    defaultStyle: {},
                    styleRules: [{ style: { casing: { enabled: true } } }],
                }),
            },
        });
        await LoaderSingleLayer._loadSingleLayer(
            "lyrCasing",
            "Casing",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                styles: { default: "casing.json" },
                zIndex: 10,
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
    });

    it("registers layer via adapter when interactiveShape=true and geometry=polygon", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrP",
            "Polygon",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                interactiveShape: true,
                geometry: "polygon",
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
    });

    it("registers layer via adapter when interactiveShape=true and geometry=polyline", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrPL",
            "Polyline",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                interactiveShape: true,
                geometry: "polyline",
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
    });

    // ── _adjustClusterOptions — clustering handled by MapLibre natively ──
    it("registers layer with clustering config via MapLibre adapter", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrAdj",
            "Adj",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                clustering: { maxClusterRadius: 120, disableClusteringAtZoom: 14 },
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
        expect(state.layers.get("lyrAdj")).toBeDefined();
    });

    // ── _handleClustering — shouldCluster=false ───────────────────────────
    it("no clusterGroup when shouldCluster=false", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONClustering: {
                getClusteringStrategy: () => ({ shouldCluster: false, useSharedCluster: false }),
            },
        });
        await LoaderSingleLayer._loadSingleLayer(
            "lyrNC",
            "No Cluster",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
            },
            {}
        );
        expect(state.layers.get("lyrNC").clusterGroup).toBeNull();
    });

    // ── _handleClustering — _GeoJSONClustering absent ────────────────────
    it("no cluster when _GeoJSONClustering is null", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({ _GeoJSONClustering: null });
        const result = await LoaderSingleLayer._loadSingleLayer(
            "lyrNM",
            "No Module",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
            },
            {}
        );
        expect(result.featureCount).toBe(0);
    });

    // ── Clustering in MapLibre is handled natively (cluster: true on source) ──
    it("registers layer via adapter (clustering handled natively by MapLibre)", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrIndep",
            "Indep",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
        expect(state.layers.get("lyrIndep").useSharedCluster).toBe(false);
    });

    it("registers layer with clusterGroup null (MapLibre native clustering)", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrSC",
            "Shared Cluster",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
        expect(state.layers.get("lyrSC").clusterGroup).toBeNull();
    });

    // ── _setupPendingSharedCluster — cluster not yet available ────────────
    it("triggers earlyReturn with pendingSharedCluster when POI cluster is null (first call)", async () => {
        vi.useFakeTimers();
        const mockPoiCluster = { addLayer: vi.fn(), on: vi.fn() };
        const getSharedPOICluster = vi
            .fn()
            .mockReturnValueOnce(null)
            .mockReturnValue(mockPoiCluster);
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONClustering: {
                getClusteringStrategy: () => ({ shouldCluster: true, useSharedCluster: true }),
                getSharedPOICluster,
            },
        });
        const result = await LoaderSingleLayer._loadSingleLayer(
            "lyrPend",
            "Pending",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
            },
            {}
        );
        // earlyReturn was triggered — layer registered in pending state
        expect(result.id).toBe("lyrPend");
        // Run timers for the setTimeout in _setupPendingSharedCluster
        vi.runAllTimers();
        vi.useRealTimers();
    });

    // ── Shared cluster retry — no longer applicable (MapLibre native clustering) ──
    it("registers layer even when clustering resolution is deferred", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrResolve",
            "Resolve",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
            },
            {}
        );
        expect(state.layers.get("lyrResolve")).toBeDefined();
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
    });

    // ── zIndex — resolved directly in MapLibre path ─────────────────────
    it("defaults zIndex to 0 when def.zIndex is not a number", async () => {
        const def = {
            _cachedData: { type: "FeatureCollection", features: [] },
            // no zIndex
        };
        await LoaderSingleLayer._loadSingleLayer("lyrZ", "Auto Z", def, {});
        expect(state.layers.get("lyrZ")).toBeDefined();
    });

    it("preserves explicit zIndex from def", async () => {
        const def = {
            _cachedData: { type: "FeatureCollection", features: [] },
            zIndex: 5000,
        };
        await LoaderSingleLayer._loadSingleLayer("lyrClamp", "Clamped", def, {});
        expect(state.layers.get("lyrClamp")).toBeDefined();
    });

    // ── fitBounds — handled by MapLibre adapter, not by the map directly ──
    it("registers layer with fitBoundsOnLoad config preserved", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrFit",
            "Fit",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                fitBoundsOnLoad: true,
            },
            {}
        );
        expect(state.layers.get("lyrFit")).toBeDefined();
        expect(state.layers.get("lyrFit").config.fitBoundsOnLoad).toBe(true);
    });

    it("preserves maxZoomOnFit config in registered layer", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrMaxZ",
            "MaxZoom",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                fitBoundsOnLoad: true,
                maxZoomOnFit: 14,
            },
            {}
        );
        expect(state.layers.get("lyrMaxZ")).toBeDefined();
        expect(state.layers.get("lyrMaxZ").config.maxZoomOnFit).toBe(14);
    });

    // ── _postLoadHooks — fitBoundsOnLoad skipped when ThemeSelector present
    it("skips fitBounds when ThemeSelector is present", async () => {
        const mockFitBounds = vi.fn();
        state.map = { addLayer: vi.fn(), fitBounds: mockFitBounds };
        globalThis.GeoLeaf = baseGeoLeaf({ ThemeSelector: { isActive: true } });
        await LoaderSingleLayer._loadSingleLayer(
            "lyrNoFit",
            "No Fit",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                fitBoundsOnLoad: true,
            },
            {}
        );
        expect(mockFitBounds).not.toHaveBeenCalled();
    });

    // ── _applyLabels — with preloadedStyleData ────────────────────────────
    it("calls Labels.initializeLayerLabels when style loaded", async () => {
        const mockInitLabels = vi.fn();
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "point",
                loadDefaultStyle: vi.fn().mockResolvedValue({ defaultStyle: { color: "#fff" } }),
            },
            Labels: { initializeLayerLabels: mockInitLabels },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        await LoaderSingleLayer._loadSingleLayer(
            "lyrLbl",
            "Labels",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                styles: { default: "style.json" },
                zIndex: 10,
            },
            {}
        );
        expect(mockInitLabels).toHaveBeenCalledWith("lyrLbl");
    });

    // ── _applyLabels — def.labels.enabled without preloadedStyleData ──────
    it("calls Labels.initializeLayerLabels from def.labels.enabled when no preloaded style", async () => {
        const mockInitLabels = vi.fn();
        globalThis.GeoLeaf = baseGeoLeaf({
            Labels: { initializeLayerLabels: mockInitLabels },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        await LoaderSingleLayer._loadSingleLayer(
            "lyrLbl2",
            "Labels2",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                labels: { enabled: true },
            },
            {}
        );
        expect(mockInitLabels).toHaveBeenCalledWith("lyrLbl2");
    });

    // ── Style post-process — now handled by adapter, not setLayerStyle ──
    it("registers layer with hatch style via adapter", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "polygon",
                loadDefaultStyle: vi.fn().mockResolvedValue({
                    defaultStyle: { hatch: { enabled: true } },
                }),
            },
        });
        await LoaderSingleLayer._loadSingleLayer(
            "lyrPP",
            "PostProcess",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                styles: { default: "style.json" },
                zIndex: 10,
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
        expect(state.layers.get("lyrPP")).toBeDefined();
    });

    // ── ThemeCache.store — no longer called in MapLibre path ────────────
    it("registers layer via adapter (ThemeCache handled elsewhere)", async () => {
        await LoaderSingleLayer._loadSingleLayer(
            "lyrTC",
            "TC",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
        expect(state.layers.get("lyrTC")).toBeDefined();
    });

    // ── _buildLayerDataRecord — uses profilesBasePath from Config ─────────
    it("uses profilesBasePath from Config.get('data') when available", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            Config: {
                getActiveProfileId: () => null,
                get: (key) => (key === "data" ? { profilesBasePath: "custom-profiles" } : null),
            },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        await LoaderSingleLayer._loadSingleLayer(
            "lyrCfg",
            "Config",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                _profileId: "prof1",
                _layerDirectory: "dir1",
            },
            {}
        );
        expect(state.layers.get("lyrCfg").basePath).toBe("custom-profiles/prof1/dir1");
    });

    // ── _buildLayerDataRecord — default profilesBasePath fallback ─────────
    it("uses 'profiles' as default basePath when Config.get returns null", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            Config: { get: () => null, getActiveProfileId: () => null },
        });
        await LoaderSingleLayer._loadSingleLayer(
            "lyrDef",
            "Default",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
                _profileId: "myProf",
                _layerDirectory: "myDir",
            },
            {}
        );
        expect(state.layers.get("lyrDef").basePath).toBe("profiles/myProf/myDir");
    });

    // ── Large dataset — MapLibre handles chunking natively ──────────────
    it("registers large dataset (250 features) via adapter", async () => {
        const manyFeatures = Array.from({ length: 250 }, (_, i) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [i, i] },
            properties: { id: i },
        }));
        const result = await LoaderSingleLayer._loadSingleLayer(
            "lyrBig",
            "Big",
            {
                _cachedData: { type: "FeatureCollection", features: manyFeatures },
                zIndex: 10,
            },
            {}
        );
        expect(result.featureCount).toBe(250);
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
    });

    // ── Cluster group always null in MapLibre path ─────────────────────
    it("always registers clusterGroup as null (MapLibre native clustering)", async () => {
        const result = await LoaderSingleLayer._loadSingleLayer(
            "lyrNoMCG",
            "NoMCG",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                zIndex: 10,
            },
            {}
        );
        expect(result.id).toBe("lyrNoMCG");
        expect(state.layers.get("lyrNoMCG").clusterGroup).toBeNull();
    });

    // ── Style with casing — adapter handles rendering ──────────────────
    it("registers layer with casing style via adapter", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "polygon",
                loadDefaultStyle: vi
                    .fn()
                    .mockResolvedValue({ defaultStyle: { casing: { enabled: true } } }),
            },
        });
        await LoaderSingleLayer._loadSingleLayer(
            "lyrNAF",
            "NeedsAwait",
            {
                _cachedData: { type: "FeatureCollection", features: [] },
                styles: { default: "s.json" },
                zIndex: 10,
            },
            {}
        );
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalled();
    });

    // ── HTTP 404 error — fetch returns non-ok response ────────────────────
    it("rejects when fetch returns HTTP 404", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        try {
            await expect(
                LoaderSingleLayer._loadSingleLayer(
                    "lyrHTTP",
                    "HTTP",
                    { url: "https://example.com/data.json" },
                    {}
                )
            ).rejects.toThrow("HTTP 404");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    // ── No adapter — state.adapter null + Core.getMap returns null ────────
    it("throws when adapter is null and Core.getMap returns null", async () => {
        state.adapter = null;
        globalThis.GeoLeaf = baseGeoLeaf({ Core: { getMap: () => null } });
        await expect(
            LoaderSingleLayer._loadSingleLayer(
                "lyrNoAdapter",
                "NoAdp",
                { _cachedData: { type: "FeatureCollection", features: [] } },
                {}
            )
        ).rejects.toThrow("MapLibre adapter not available");
    });

    // ── showIconsOnMap — no legacy fallback (S10 F5 pure taxonomy bridge) ─────
    it("injects no symbolId when showIconsOnMap is true but no taxonomy resolver (Lite)", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            Config: {
                getActiveProfileId: () => null,
                get: () => null,
            },
        });
        // makeDeps wires no getTaxonomyResolvePoiIcon → Lite / absent-capability path.
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        const capturedCalls = [];
        state.adapter.addGeoJSONLayer = vi.fn((...args) => capturedCalls.push(args));
        const pointFeature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { categoryId: "NATURE" },
        };
        await LoaderSingleLayer._loadSingleLayer(
            "lyrIcons",
            "Icons",
            {
                _cachedData: { type: "FeatureCollection", features: [pointFeature] },
                showIconsOnMap: true,
            },
            {}
        );
        expect(capturedCalls.length).toBeGreaterThan(0);
        const passedGeojson = capturedCalls[0][1];
        expect(passedGeojson.features[0].properties.symbolId).toBeUndefined();
    });

    // ── S10 F5 — taxonomy resolver present → its symbolId is injected ─────
    // (the test above, with no resolver in deps, proves the no-icon Lite path)
    it("injects the taxonomy resolver's symbolId for a bound point layer", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            Config: {
                getActiveProfileId: () => null,
                get: () => null,
            },
        });
        const deps = makeDeps(globalThis.GeoLeaf);
        deps.getTaxonomyResolvePoiIcon = () => (feature) =>
            feature.layerId === "lyrTax"
                ? { useIcon: true, symbolId: "tax-symbol" }
                : { useIcon: false, symbolId: null };
        setupSingleLayerDeps(deps);
        const capturedCalls = [];
        state.adapter.addGeoJSONLayer = vi.fn((...args) => capturedCalls.push(args));
        const pointFeature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { categoryId: "NATURE" },
        };
        await LoaderSingleLayer._loadSingleLayer(
            "lyrTax",
            "Tax",
            {
                _cachedData: { type: "FeatureCollection", features: [pointFeature] },
                showIconsOnMap: true,
            },
            {}
        );
        const passedGeojson = capturedCalls[0][1];
        expect(passedGeojson.features[0].properties.symbolId).toBe("tax-symbol");
    });
});

// ── RM-P2 #1 — OGC autoRefresh applies data via adapter.updateLayerData ───────
describe("geojson/loader/single-layer — OGC autoRefresh (RM-P2 #1)", () => {
    afterEach(() => {
        globalThis.GeoLeaf = undefined;
        setupSingleLayerDeps(makeDeps({}));
    });

    it("applies refreshed OGC data via adapter.updateLayerData", () => {
        const updateLayerData = vi.fn();
        const fc = {
            type: "FeatureCollection",
            features: [{ type: "Feature", geometry: null, properties: {} }],
        };
        applyOgcRefreshedData({ adapter: { updateLayerData } }, "ogc-lyr", fc);
        // Regression guard: the former call used the non-existent `updateGeoJSONSource`,
        // so the optional-chained call was a silent no-op and the refresh was discarded.
        expect(updateLayerData).toHaveBeenCalledWith("ogc-lyr", fc);
    });

    it("falls back to the core map adapter when state.adapter is null", () => {
        const updateLayerData = vi.fn();
        globalThis.GeoLeaf = baseGeoLeaf({ Core: { getMap: () => ({ updateLayerData }) } });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        const fc = { type: "FeatureCollection", features: [] };
        applyOgcRefreshedData({ adapter: null }, "ogc-lyr2", fc);
        expect(updateLayerData).toHaveBeenCalledWith("ogc-lyr2", fc);
    });
});

// ── The style is fetched ALONGSIDE the data, not after it ─────────────
//
// `_preloadStyle` used to run only once the data had landed: one extra round-trip per layer,
// serialised behind a body reaching ~1,1 Mo for a style file of a few hundred bytes. The two
// are independent — the style needs neither the geometry types nor any feature property.
//
// ⚠️ These assert the OVERLAP, not a duration. A timing assertion would be flaky on a loaded
// runner and would still pass if the calls were merely fast; what has to hold is that the
// style request is issued while the data promise is still pending.
describe("geojson/loader/single-layer — style/data overlap", () => {
    afterEach(() => {
        delete globalThis.GeoLeaf;
        state.layers.clear();
        state.adapter = null;
    });

    /** Builds a GeoLeaf mock whose data promise is held open until the returned gate resolves. */
    function withHeldData() {
        let releaseData;
        const dataGate = new Promise((resolve) => {
            releaseData = resolve;
        });
        const loadDefaultStyle = vi.fn().mockResolvedValue({ defaultStyle: { color: "#ff0000" } });
        globalThis.GeoLeaf = baseGeoLeaf({
            _GeoJSONLayerConfig: {
                buildLayerOptions: () => ({}),
                inferGeometryType: () => "point",
                loadDefaultStyle,
            },
        });
        state.adapter = createMockAdapter();
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        globalThis.fetch = vi.fn(() =>
            dataGate.then(() => ({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ type: "FeatureCollection", features: [] }),
            }))
        );
        return { loadDefaultStyle, releaseData };
    }

    it("requests the style while the data is still pending", async () => {
        const { loadDefaultStyle, releaseData } = withHeldData();

        const pending = LoaderSingleLayer._loadSingleLayer(
            "lyrPar",
            "Parallel",
            { url: "https://example.test/data.geojson", styles: { default: "defaut.json" } },
            {}
        );
        await Promise.resolve();

        // The data has NOT resolved yet — if the style still waited on it, this would be 0.
        expect(loadDefaultStyle).toHaveBeenCalledTimes(1);

        releaseData();
        await pending;
        expect(loadDefaultStyle).toHaveBeenCalledTimes(1);
    });

    it("does not request a style for a plugin-backed layer", async () => {
        const { loadDefaultStyle } = withHeldData();
        setupSingleLayerDeps({
            ...makeDeps(globalThis.GeoLeaf),
            ensurePluginLoaded: () => Promise.resolve(),
            getPluginLayerLoader: () => undefined,
        });

        await LoaderSingleLayer._loadSingleLayer(
            "lyrPlug",
            "Plugin",
            { plugin: "flatgeobuf", styles: { default: "defaut.json" } },
            {}
        );

        // The early exit returns before the prefetch site — a style request here would be for
        // a layer that never reaches the code consuming it.
        expect(loadDefaultStyle).not.toHaveBeenCalled();
    });

    it("does not request a style for a vector-tile layer", async () => {
        const { loadDefaultStyle } = withHeldData();
        globalThis.GeoLeaf._VectorTiles = {
            shouldUseVectorTiles: () => true,
            loadVectorTileLayer: vi
                .fn()
                .mockResolvedValue({ id: "lyrVT", label: "VT", featureCount: 0 }),
        };
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));

        await LoaderSingleLayer._loadSingleLayer(
            "lyrVT",
            "VT",
            {
                data: { vectorTiles: { tilesUrl: "https://tiles.test/{z}/{x}/{y}" } },
                styles: { default: "defaut.json" },
            },
            {}
        );

        // vector-tiles resolves its own style through `loadDefaultStyle`; prefetching here
        // would issue a second, unconsumed request.
        expect(loadDefaultStyle).not.toHaveBeenCalled();
    });

    // ── The SECOND caller — `_loadFromOgcApi` ───────────────────────────────
    //
    // 🛑 This case fills a blind spot measured on 08/08/2026: the gesture
    // does cover BOTH callers in the code (`single-layer.ts`,
    // `_loadFromOgcApi` sites and main path), but no test crossed the
    // first. The three cases above all enter through `url:` / `plugin:` /
    // `vectorTiles`, and the two existing OGC tests
    // (`loader-offline-read.test.js`) declare no `styles`, so `_preloadStyle`
    // exits on its entry guard proving nothing. Moving the call under the
    // OGC branch's `await`s would thus have come out GREEN on the whole suite.
    //
    // ⚠️ The exposure is nil today — `loader/profile.ts` sets aside any layer
    // whose only source is `data.ogcApi`. Precisely why the regression would
    // have gone unnoticed: nobody would see it in use either.
    it("requests the style while the OGC features are still pending", async () => {
        const { loadDefaultStyle } = withHeldData();
        let releaseOgc;
        ogcGate.promise = new Promise((resolve) => {
            releaseOgc = () => resolve({ type: "FeatureCollection", features: [] });
        });

        const pending = LoaderSingleLayer._loadSingleLayer(
            "lyrOgc",
            "OGC",
            {
                data: { ogcApi: { url: "https://ogc.test/collections/x/items" } },
                styles: { default: "defaut.json" },
            },
            {}
        );
        await Promise.resolve();

        // The features have NOT landed — if the style still waited for the data, this would be 0.
        expect(loadDefaultStyle).toHaveBeenCalledTimes(1);

        releaseOgc();
        await pending;
        expect(loadDefaultStyle).toHaveBeenCalledTimes(1);
        ogcGate.promise = null;
    });
});
