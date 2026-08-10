import { LoaderProfile, setupProfileDeps } from "../../src/kernel/geojson/loader/profile.js";
import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";

/**
 */
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: { state: { layerIdCounter: 0, layers: new Map(), map: null, layerGroup: null } },
}));
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

describe("geojson/loader/profile", () => {
    beforeEach(() => {
        globalThis.GeoLeaf = undefined;
        setupProfileDeps({
            getConfig: () => undefined,
            getLoader: () => undefined,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: () => {},
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
    });

    it("loadFromActiveProfile resolves [] when Config missing", async () => {
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(result).toEqual([]);
    });

    it("_getDefaultThemeLayerIds returns empty Set when profile has no themes", () => {
        const set = LoaderProfile._getDefaultThemeLayerIds({});
        expect(set).toBeInstanceOf(Set);
        expect(set.size).toBe(0);
    });

    it("_loadLayersByBatch returns empty array for empty tasks", async () => {
        const result = await LoaderProfile._loadLayersByBatch([], 3, 0);
        expect(result).toEqual([]);
    });

    it("loadAllLayersConfigsForLayerManager returns [] when profile has no layers", async () => {
        const result = await LoaderProfile.loadAllLayersConfigsForLayerManager({});
        expect(result).toEqual([]);
    });

    it("loadFromActiveProfile loads geojsonLayers and calls _loadSingleLayer", async () => {
        const loadedLayer = { id: "lyr1", label: "L1" };
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [{ id: "lyr1", url: "https://example.com/d.json" }],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "lyr1" }] }],
                    },
                }),
            },
            _GeoJSONLoader: { _loadSingleLayer: vi.fn(() => Promise.resolve(loadedLayer)) },
        };
        setupProfileDeps({
            getConfig: () => globalThis.GeoLeaf.Config,
            getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: (c) => {
                if (globalThis.GeoLeaf) globalThis.GeoLeaf._allLayerConfigs = c;
            },
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(result).toEqual([loadedLayer]);
        expect(globalThis.GeoLeaf._GeoJSONLoader._loadSingleLayer).toHaveBeenCalled();
        globalThis.GeoLeaf = undefined;
    });

    it("loadFromActiveProfile uses profile.geojson.layers when geojsonLayers missing", async () => {
        const loadedLayer = { id: "lyr1", label: "L1" };
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojson: { layers: [{ id: "lyr1", url: "https://example.com/d.json" }] },
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "lyr1" }] }],
                    },
                }),
            },
            _GeoJSONLoader: { _loadSingleLayer: vi.fn(() => Promise.resolve(loadedLayer)) },
        };
        setupProfileDeps({
            getConfig: () => globalThis.GeoLeaf.Config,
            getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: () => {},
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(result).toEqual([loadedLayer]);
        globalThis.GeoLeaf = undefined;
    });

    it("loadFromActiveProfile resolves [] when profile null", async () => {
        globalThis.GeoLeaf = { Config: { getActiveProfile: () => null } };
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(result).toEqual([]);
        globalThis.GeoLeaf = undefined;
    });

    it("loadFromActiveProfile skips layer with active false", async () => {
        const loadedLayer = { id: "lyr1", label: "L1" };
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [
                        { id: "lyr1", url: "https://example.com/d.json" },
                        { id: "lyr2", url: "https://example.com/d2.json", active: false },
                    ],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "lyr1" }, { id: "lyr2" }] }],
                    },
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn((id) =>
                    id === "lyr2" ? Promise.resolve(null) : Promise.resolve(loadedLayer)
                ),
            },
        };
        setupProfileDeps({
            getConfig: () => globalThis.GeoLeaf.Config,
            getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: () => {},
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(result).toContainEqual(loadedLayer);
        globalThis.GeoLeaf = undefined;
    });

    it("loadFromActiveProfile uses profile.layers when geojsonLayers and geojson.layers missing", async () => {
        const loadedLayer = { id: "lyr1", label: "L1" };
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    layers: [{ id: "lyr1", url: "https://example.com/d.json" }],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "lyr1" }] }],
                    },
                }),
            },
            _GeoJSONLoader: { _loadSingleLayer: vi.fn(() => Promise.resolve(loadedLayer)) },
        };
        setupProfileDeps({
            getConfig: () => globalThis.GeoLeaf.Config,
            getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: () => {},
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(result).toEqual([loadedLayer]);
        globalThis.GeoLeaf = undefined;
    });

    it("_getDefaultThemeLayerIds returns layer ids from default theme", () => {
        const profile = {
            themes: {
                defaultTheme: "t1",
                themes: [{ id: "t1", layers: [{ id: "a" }, { id: "b", visible: false }] }],
            },
        };
        const set = LoaderProfile._getDefaultThemeLayerIds(profile);
        expect(set.has("a")).toBe(true);
        expect(set.has("b")).toBe(false);
    });

    it("_getDefaultThemeLayerIds uses themes.config.defautTheme when present", () => {
        const profile = {
            themes: {
                config: { defautTheme: "t2" },
                themes: [{ id: "t2", layers: [{ id: "x" }] }],
            },
        };
        const set = LoaderProfile._getDefaultThemeLayerIds(profile);
        expect(set.has("x")).toBe(true);
    });

    it("_loadLayersByBatch runs tasks in batches with delay", async () => {
        const tasks = [
            () => Promise.resolve(1),
            () => Promise.resolve(2),
            () => Promise.resolve(3),
            () => Promise.resolve(4),
        ];
        const result = await LoaderProfile._loadLayersByBatch(tasks, 2, 0);
        expect(result).toEqual([1, 2, 3, 4]);
    });

    it("loadAllLayersConfigsForLayerManager returns configs with styles and labels", async () => {
        globalThis.GeoLeaf = { _allLayerConfigs: null };
        setupProfileDeps({
            getConfig: () => undefined,
            getLoader: () => undefined,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: (c) => {
                if (globalThis.GeoLeaf) globalThis.GeoLeaf._allLayerConfigs = c;
            },
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
        const profile = {
            layers: [
                {
                    id: "c1",
                    label: "C1",
                    // geometry lives directly on the layer at runtime (bundled profile),
                    // not under `config` — this is the path the legend depends on.
                    geometry: "polyline",
                    config: {
                        zIndex: 1,
                        styles: { default: "s1" },
                        labels: {},
                    },
                },
                { id: "c2", label: "C2", styles: { default: "s2" }, labels: { enabled: true } },
            ],
        };
        const result = await LoaderProfile.loadAllLayersConfigsForLayerManager(profile);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe("c1");
        expect(result[0].styles).toBeDefined();
        // Regression: geometry must be carried through so the legend resolves the
        // right symbol (line/polygon) instead of defaulting to a point/circle.
        expect(result[0].geometry).toBe("polyline");
        expect(globalThis.GeoLeaf._allLayerConfigs).toEqual(result);
        globalThis.GeoLeaf = undefined;
    });

    it("loadFromActiveProfile handles _loadSingleLayer rejection gracefully", async () => {
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [{ id: "errLayer", url: "https://fail.com/d.json" }],
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn(() => Promise.reject(new Error("load error"))),
            },
        };
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(Array.isArray(result)).toBe(true);
        globalThis.GeoLeaf = undefined;
    });

    it("_getDefaultThemeLayerIds returns empty set when themes array is empty", () => {
        const profile = { themes: { themes: [] } };
        const set = LoaderProfile._getDefaultThemeLayerIds(profile);
        expect(set.size).toBe(0);
    });

    it("_getDefaultThemeLayerIds handles undefined defaultTheme (no matching theme)", () => {
        const profile = {
            themes: {
                themes: [{ id: "t1", layers: [{ id: "x", visible: true }] }],
            },
        };
        const set = LoaderProfile._getDefaultThemeLayerIds(profile);
        expect(set.size).toBe(0);
    });

    it("_loadLayersByBatch handles tasks that resolve null", async () => {
        const tasks = [() => Promise.resolve(null), () => Promise.resolve({ id: "lyr1" })];
        const result = await LoaderProfile._loadLayersByBatch(tasks, 2, 0);
        expect(result).toContain(null);
        expect(result).toContainEqual({ id: "lyr1" });
    });

    it("loadAllLayersConfigsForLayerManager returns [] when profile has no layers", async () => {
        globalThis.GeoLeaf = { _allLayerConfigs: null };
        const result = await LoaderProfile.loadAllLayersConfigsForLayerManager({
            geojsonLayers: [],
        });
        expect(result).toEqual([]);
        globalThis.GeoLeaf = undefined;
    });

    // ── F0 (S8) — boot-time initial visibility of deferred layers ───────────
    const _f0Deps = (GeoLeaf) => ({
        getConfig: () => GeoLeaf.Config,
        getLoader: () => GeoLeaf._GeoJSONLoader,
        getLayerManager: () => undefined,
        getAllLayerConfigs: () => undefined,
        setAllLayerConfigs: () => {},
        getFeatureValidator: () => undefined,
        getLayerConfig: () => undefined,
        getVectorTiles: () => undefined,
        getUtils: () => undefined,
        getNotifications: () => undefined,
        getCore: () => undefined,
        getPopupTooltip: () => undefined,
        getLabels: () => undefined,
        getWorkerManager: () => undefined,
        getDataConverter: () => undefined,
        getNormalizer: () => undefined,
    });

    it("F0: with a default theme, only its layers load — non-theme layers are skipped at boot", async () => {
        const calls = [];
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [
                        { id: "lyr1", url: "https://example.com/d1.json" },
                        { id: "lyr2", url: "https://example.com/d2.json" },
                    ],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "lyr1" }] }],
                    },
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn((id, label) => {
                    calls.push(id);
                    return Promise.resolve({ id, label });
                }),
            },
        };
        setupProfileDeps(_f0Deps(globalThis.GeoLeaf));
        await LoaderProfile.loadFromActiveProfile();
        // Let any (skipped) deferred idle pass drain — nothing more should load.
        await new Promise((r) => setTimeout(r, 250));

        expect(calls).toContain("lyr1"); // in the default theme → loaded
        expect(calls).not.toContain("lyr2"); // off-theme → not loaded at boot (loads on switch)
        globalThis.GeoLeaf = undefined;
    });

    it("F0: with no default theme, all declared layers load (kernel shows the data)", async () => {
        const calls = [];
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [
                        { id: "lyr1", url: "https://example.com/d1.json" },
                        { id: "lyr2", url: "https://example.com/d2.json" },
                    ],
                    // no themes → the kernel shows every declared layer
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn((id, label) => {
                    calls.push(id);
                    return Promise.resolve({ id, label });
                }),
            },
        };
        setupProfileDeps(_f0Deps(globalThis.GeoLeaf));
        await LoaderProfile.loadFromActiveProfile();
        await new Promise((r) => setTimeout(r, 250));

        expect(calls).toContain("lyr1");
        expect(calls).toContain("lyr2");
        globalThis.GeoLeaf = undefined;
    });
});

// ── T22 — geojson/loader/profile.ts branch coverage ─────────────────────────
describe("geojson/loader/profile — T22 branch coverage", () => {
    beforeEach(() => {
        setupProfileDeps({
            getConfig: () => undefined,
            getLoader: () => undefined,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: () => {},
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
    });
    afterEach(() => {
        globalThis.GeoLeaf = undefined;
        GeoJSONShared.state.map = null;
        GeoJSONShared.state.layerGroup = null;
    });

    it("loadAllLayersConfigsForLayerManager: layer with no styles/labels returns null (branch 71.1)", async () => {
        globalThis.GeoLeaf = { _allLayerConfigs: null };
        const result = await LoaderProfile.loadAllLayersConfigsForLayerManager({
            layers: [{ id: "bare", label: "Bare" }],
        });
        expect(result[0].styles).toBeNull();
        expect(result[0].labels).toBeNull();
    });

    it("loadFromActiveProfile calls registerWithLayerManager when immediate layers loaded (branch 32.0)", async () => {
        const registerWithLayerManager = vi.fn();
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [{ id: "l1", url: "https://example.com/l1.json" }],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "l1", visible: true }] }],
                    },
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn(() => Promise.resolve({ id: "l1", label: "L1" })),
            },
            _GeoJSONLayerManager: { registerWithLayerManager },
        };
        setupProfileDeps({
            getConfig: () => globalThis.GeoLeaf.Config,
            getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
            getLayerManager: () => globalThis.GeoLeaf._GeoJSONLayerManager,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: () => {},
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
        await LoaderProfile.loadFromActiveProfile();
        expect(registerWithLayerManager).toHaveBeenCalled();
    });

    it("loadFromActiveProfile with map+layerGroup triggers fitBounds (branches 34-37)", async () => {
        const fitBounds = vi.fn();
        const fire = vi.fn();
        const on = vi.fn();
        GeoJSONShared.state.map = { fitBounds, fire, on };
        GeoJSONShared.state.layerGroup = {
            getBounds: vi.fn(() => ({ isValid: () => true })),
        };
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [{ id: "l1", url: "https://example.com/l1.json" }],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "l1", visible: true }] }],
                    },
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn(() => Promise.resolve({ id: "l1", label: "L1" })),
            },
        };
        setupProfileDeps({
            getConfig: () => globalThis.GeoLeaf.Config,
            getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: () => {},
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
        await LoaderProfile.loadFromActiveProfile({ maxZoomOnFit: 15 });
        expect(fitBounds).toHaveBeenCalled();
    });

    it("loadFromActiveProfile with deferred layers schedules idle loading (branch 42.0)", async () => {
        vi.useFakeTimers();
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [
                        { id: "l1", url: "https://example.com/l1.json" },
                        { id: "l2", url: "https://example.com/l2.json" },
                    ],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "l1", visible: true }] }],
                    },
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn(() => Promise.resolve({ id: "l1", label: "L1" })),
            },
        };
        // l1 is immediate, l2 is deferred → _scheduleDeferredLayers is called
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(Array.isArray(result)).toBe(true);
        vi.useRealTimers();
    });

    it("loadFromActiveProfile with 25 layers exercises _warnLayerCount > 20 branch (branch 74.0)", async () => {
        vi.useFakeTimers();
        const layers = Array.from({ length: 25 }, (_, i) => ({
            id: `l${i}`,
            url: `https://example.com/l${i}.json`,
        }));
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({ id: "p1", geojsonLayers: layers }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn(() => Promise.resolve({ id: "x" })),
            },
        };
        // _warnLayerCount(25, Log) → layersDef.length > 20 branch hit
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(Array.isArray(result)).toBe(true);
        vi.useRealTimers();
    });

    it("_getLayersDef: uses Config.Profile.getActiveProfileLayersConfig when other sources missing (branches 6-8)", async () => {
        const layerConfigs = [{ id: "lp1", url: "https://example.com/lp1.json" }];
        globalThis.GeoLeaf = {
            Config: {
                Profile: {
                    getActiveProfileLayersConfig: vi.fn(() => layerConfigs),
                },
                getActiveProfile: () => ({
                    id: "p1",
                    // no geojsonLayers, no geojson.layers, no layers
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn(() => Promise.resolve({ id: "lp1" })),
            },
        };
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(Array.isArray(result)).toBe(true);
    });

    it("loadFromActiveProfile: layer with popup config covers _applyPopupConfig (branches 12, 14)", async () => {
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [
                        {
                            id: "l1",
                            url: "https://example.com/l1.json",
                            popup: { enabled: true, fields: ["name", "type"] },
                            tooltip: { enabled: true, fields: ["name"], mode: "hover" },
                            sidepanel: { detailLayout: ["section1"] },
                            clustering: {
                                enabled: true,
                                maxClusterRadius: 80,
                                disableClusteringAtZoom: 15,
                            },
                            vectorTiles: { url: "https://tiles.example.com/{z}/{x}/{y}.pbf" },
                        },
                    ],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "l1", visible: true }] }],
                    },
                }),
            },
            _GeoJSONLoader: {
                _loadSingleLayer: vi.fn(() => Promise.resolve({ id: "l1", label: "L1" })),
            },
        };
        setupProfileDeps({
            getConfig: () => globalThis.GeoLeaf.Config,
            getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
            getLayerManager: () => undefined,
            getAllLayerConfigs: () => undefined,
            setAllLayerConfigs: () => {},
            getFeatureValidator: () => undefined,
            getLayerConfig: () => undefined,
            getVectorTiles: () => undefined,
            getUtils: () => undefined,
            getNotifications: () => undefined,
            getCore: () => undefined,
            getPopupTooltip: () => undefined,
            getLabels: () => undefined,
            getWorkerManager: () => undefined,
            getDataConverter: () => undefined,
            getNormalizer: () => undefined,
        });
        const result = await LoaderProfile.loadFromActiveProfile();
        expect(result).toContainEqual({ id: "l1", label: "L1" });
    });
});

// ── S10 — plugin: layer dispatch (flatgeobuf et al.) ─────────────────────────
describe("geojson/loader/profile — plugin dispatch (S10)", () => {
    const baseDeps = () => ({
        getConfig: () => globalThis.GeoLeaf.Config,
        getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
        getLayerManager: () => undefined,
        getAllLayerConfigs: () => undefined,
        setAllLayerConfigs: () => {},
        getFeatureValidator: () => undefined,
        getLayerConfig: () => undefined,
        getVectorTiles: () => undefined,
        getUtils: () => undefined,
        getNotifications: () => undefined,
        getCore: () => undefined,
        getPopupTooltip: () => undefined,
        getLabels: () => undefined,
        getWorkerManager: () => undefined,
        getDataConverter: () => undefined,
        getNormalizer: () => undefined,
    });

    afterEach(() => {
        globalThis.GeoLeaf = undefined;
    });

    it("dispatches a `plugin:` layer to the registered loader (not _loadSingleLayer)", async () => {
        const pluginLoader = vi.fn(() => Promise.resolve("gl-fgb-1"));
        const singleLayer = vi.fn(() => Promise.resolve({ id: "x" }));
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [
                        {
                            id: "fgb1",
                            plugin: "flatgeobuf",
                            label: "FGB",
                            data: { url: "data/x.fgb" },
                        },
                    ],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "fgb1", visible: true }] }],
                    },
                }),
            },
            _GeoJSONLoader: { _loadSingleLayer: singleLayer },
        };
        setupProfileDeps({
            ...baseDeps(),
            getPluginLayerLoader: (id) => (id === "flatgeobuf" ? pluginLoader : undefined),
        });

        const result = await LoaderProfile.loadFromActiveProfile();

        expect(pluginLoader).toHaveBeenCalledWith(
            expect.objectContaining({ plugin: "flatgeobuf", _profileId: "p1" })
        );
        expect(singleLayer).not.toHaveBeenCalled();
        expect(result).toContainEqual({ id: "gl-fgb-1", label: "FGB" });
    });

    it("skips a `plugin:` layer when no loader is registered", async () => {
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [{ id: "ghostLayer", plugin: "ghost", data: { url: "x.fgb" } }],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "ghostLayer", visible: true }] }],
                    },
                }),
            },
            _GeoJSONLoader: { _loadSingleLayer: vi.fn() },
        };
        setupProfileDeps({ ...baseDeps(), getPluginLayerLoader: () => undefined });

        const result = await LoaderProfile.loadFromActiveProfile();
        expect(result).toEqual([]);
    });

    it("does not affect ordinary GeoJSON layers (no plugin field)", async () => {
        const singleLayer = vi.fn(() => Promise.resolve({ id: "l1", label: "L1" }));
        const pluginLoader = vi.fn();
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [{ id: "l1", url: "https://example.com/d.json" }],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "l1", visible: true }] }],
                    },
                }),
            },
            _GeoJSONLoader: { _loadSingleLayer: singleLayer },
        };
        setupProfileDeps({ ...baseDeps(), getPluginLayerLoader: () => pluginLoader });

        const result = await LoaderProfile.loadFromActiveProfile();
        expect(singleLayer).toHaveBeenCalled();
        expect(pluginLoader).not.toHaveBeenCalled();
        expect(result).toContainEqual({ id: "l1", label: "L1" });
    });
});

/**
 * R.40 (backlog résiduel S5) — the clustering normalisation this loader applies used to
 * be duplicated verbatim in `themes/theme-applier/deferred.ts`. It is now shared through
 * `resolveClusteringNormalization()`. A mutation run over the whole core suite (8 576
 * tests) showed that ONLY the `deferred.ts` side was covered: neutralising the logic
 * broke exactly one test, and none of them was here. These cases close that hole, so the
 * shared helper is provable from both call sites rather than from one.
 */
describe("geojson/loader/profile — clustering normalisation (R.40)", () => {
    const baseDeps = () => ({
        getConfig: () => globalThis.GeoLeaf.Config,
        getLoader: () => globalThis.GeoLeaf._GeoJSONLoader,
        getLayerManager: () => undefined,
        getAllLayerConfigs: () => undefined,
        setAllLayerConfigs: () => {},
        getFeatureValidator: () => undefined,
        getLayerConfig: () => undefined,
        getVectorTiles: () => undefined,
        getUtils: () => undefined,
        getNotifications: () => undefined,
        getCore: () => undefined,
        getPopupTooltip: () => undefined,
        getLabels: () => undefined,
        getWorkerManager: () => undefined,
        getDataConverter: () => undefined,
        getNormalizer: () => undefined,
    });

    /** Runs one layer through the loader and returns the normalisedDef it produced. */
    async function normalizedDefFor(clustering) {
        const singleLayer = vi.fn(() => Promise.resolve({ id: "l1", label: "L1" }));
        const layer = { id: "l1", url: "https://example.com/d.json" };
        if (clustering !== undefined) layer.clustering = clustering;
        globalThis.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    id: "p1",
                    geojsonLayers: [layer],
                    themes: {
                        defaultTheme: "t1",
                        themes: [{ id: "t1", layers: [{ id: "l1", visible: true }] }],
                    },
                }),
            },
            _GeoJSONLoader: { _loadSingleLayer: singleLayer },
        };
        setupProfileDeps(baseDeps());
        await LoaderProfile.loadFromActiveProfile();
        expect(singleLayer).toHaveBeenCalled();
        // _loadSingleLayer(layerId, layerLabel, normalizedDef, baseOptions)
        return singleLayer.mock.calls[0][2];
    }

    afterEach(() => {
        globalThis.GeoLeaf = undefined;
    });

    it("hoists maxClusterRadius to both maxClusterRadius and clusterRadius", async () => {
        const nd = await normalizedDefFor({
            enabled: true,
            maxClusterRadius: 80,
            disableClusteringAtZoom: 12,
        });
        expect(nd.clustering).toBe(true);
        expect(nd.maxClusterRadius).toBe(80);
        // Two names for the same value — dropping either silently changes rendering.
        expect(nd.clusterRadius).toBe(80);
        expect(nd.disableClusteringAtZoom).toBe(12);
    });

    it("treats a missing `enabled` as enabled, and `enabled:false` as disabled", async () => {
        expect((await normalizedDefFor({ maxClusterRadius: 50 })).clustering).toBe(true);
        expect((await normalizedDefFor({ enabled: false })).clustering).toBe(false);
    });

    it("leaves the definition untouched when `clustering` is absent or not an object", async () => {
        for (const value of [undefined, "yes", 42, null]) {
            const nd = await normalizedDefFor(value);
            // An absent clustering block is NOT the same as `clustering: false`:
            // the boolean flag must not be written at all.
            expect(nd.clustering).toBe(value === undefined ? undefined : value);
            expect(nd.maxClusterRadius).toBeUndefined();
            expect(nd.clusterRadius).toBeUndefined();
        }
    });

    it("ignores non-numeric radius and zoom overrides", async () => {
        const nd = await normalizedDefFor({
            enabled: true,
            maxClusterRadius: "80",
            disableClusteringAtZoom: null,
        });
        expect(nd.clustering).toBe(true);
        expect(nd.maxClusterRadius).toBeUndefined();
        expect(nd.clusterRadius).toBeUndefined();
        expect(nd.disableClusteringAtZoom).toBeUndefined();
    });
});

/**
 * S5.1 — the Phase 1 batching DEFAULTS, which gate the reveal.
 *
 * ⚠️ These call `_loadLayersByBatch` with NO arguments on purpose. The pre-existing suite always
 * passed `(tasks, 2, 0)`, so it exercised the mechanism while leaving the shipped values — the
 * only ones that ever run — untested. That is how a 200 ms serialisation survived on the reveal
 * path unnoticed: the delay had a test in its name and none in its assertions.
 */
describe("geojson/loader/profile — Phase 1 batching defaults (S5.1)", () => {
    it("runs six tasks concurrently, not three", async () => {
        const started = [];
        let releaseFirstBatch;
        const gate = new Promise((resolve) => {
            releaseFirstBatch = resolve;
        });
        const tasks = Array.from({ length: 8 }, (_, i) => () => {
            started.push(i);
            return i === 0 ? gate : Promise.resolve(i);
        });

        const pending = LoaderProfile._loadLayersByBatch(tasks);
        await Promise.resolve();

        // The first batch is held open, so whatever started is exactly the cap.
        expect(started).toEqual([0, 1, 2, 3, 4, 5]);

        releaseFirstBatch(0);
        await expect(pending).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it("arms no timer between batches", async () => {
        vi.useFakeTimers();
        try {
            const tasks = Array.from({ length: 8 }, (_, i) => () => Promise.resolve(i));
            let resolved = false;
            const pending = LoaderProfile._loadLayersByBatch(tasks).then(() => {
                resolved = true;
            });

            // Flushes microtasks and fires anything due at 0 ms — a `setTimeout(…, 200)` between
            // batches would still be pending, leaving `resolved` false.
            await vi.advanceTimersByTimeAsync(0);

            expect(resolved).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
            await pending;
        } finally {
            vi.useRealTimers();
        }
    });

    it("still throttles when a caller asks for it — the mechanism is disarmed, not removed", async () => {
        vi.useFakeTimers();
        try {
            const tasks = Array.from({ length: 4 }, (_, i) => () => Promise.resolve(i));
            let resolved = false;
            const pending = LoaderProfile._loadLayersByBatch(tasks, 2, 200).then(() => {
                resolved = true;
            });

            await vi.advanceTimersByTimeAsync(0);
            expect(resolved).toBe(false);

            await vi.advanceTimersByTimeAsync(200);
            expect(resolved).toBe(true);
            await pending;
        } finally {
            vi.useRealTimers();
        }
    });
});
