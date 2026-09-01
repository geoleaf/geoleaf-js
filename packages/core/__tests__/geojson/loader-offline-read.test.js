/**
 * THE LOCAL READ, through the REAL layer loader.
 *
 * Proves `_getDataPromise`'s four branches as the work leaves them:
 *
 *   1. layer declared offline + populated store  → the store serves, ZERO fetch
 *   2. layer declared offline + EMPTY store      → network fallback (the store returns `null`)
 *   3. layer NOT declared + populated store      → the network serves, the store is ignored
 *   4. local read that THROWS                    → network fallback, and the layer loads
 *
 * 🛑 3 IS THE ONE THAT MATTERS, and it is the arbitration's reason. The
 * ruled-out option — "read the store as soon as it carries entities" — would
 * have made the source of truth depend on a POPULATION ACCIDENT. This test
 * fails if someone reintroduces it.
 *
 * ⚠️ The store is reached through `StorageContract.DB`, never by a
 * `capabilities/` import: the kernel imports none. So the CONTRACT is what
 * is mocked here, not IndexedDB — an IndexedDB mock would exercise the
 * storage, when what is at stake is the seam.
 */
import {
    LoaderSingleLayer,
    setupSingleLayerDeps,
} from "../../src/kernel/geojson/loader/single-layer.js";
import { StorageContract } from "../../src/kernel/shared/index.js";

const state = vi.hoisted(() => ({
    layers: new Map(),
    map: { addLayer: vi.fn(), fitBounds: vi.fn() },
    options: {},
    adapter: null,
}));

vi.mock("../../src/kernel/geojson/shared.js", () => ({ GeoJSONShared: { state } }));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

const STORED = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-60.65, -32.94] },
            properties: { id: "local-1", title: "Saisie hors réseau" },
        },
    ],
};

const FROM_NETWORK = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: "net-1", title: "Depuis le réseau" },
        },
    ],
};

function createMockAdapter() {
    return {
        addGeoJSONLayer: vi.fn(),
        getNativeMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
        getLayerRegistry: vi.fn(() => ({ getSubLayerIds: vi.fn(() => []) })),
    };
}

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

function baseGeoLeaf() {
    return {
        // `isAvailable: false` — the worker would force a fetch outside the seam measured here.
        _WorkerManager: { isAvailable: () => false },
        _VectorTiles: null,
        _DataConverter: null,
        _GeoJSONLayerConfig: {
            buildLayerOptions: () => ({}),
            inferGeometryType: () => "point",
            loadDefaultStyle: vi.fn().mockResolvedValue(null),
        },
        _GeoJSONLayerManager: {
            updateLayerVisibilityByZoom: vi.fn(),
            setLayerStyle: vi.fn(),
        },
        ThemeCache: { store: vi.fn() },
        ThemeSelector: null,
        Config: { getActiveProfileId: () => "tourism", get: () => null },
        Labels: null,
        Notifications: null,
    };
}

/** Mounts a minimal storage facade behind the contract. */
function mountStorage(getLayerFeatureCollection) {
    StorageContract.init({ DB: getLayerFeatureCollection ? { getLayerFeatureCollection } : null });
}

describe("4.3 — lecture locale par le loader de couche", () => {
    beforeEach(() => {
        state.layers = new Map();
        state.map = { addLayer: vi.fn(), fitBounds: vi.fn() };
        state.adapter = createMockAdapter();
        globalThis.GeoLeaf = baseGeoLeaf();
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(FROM_NETWORK),
        });
    });

    afterEach(() => {
        globalThis.GeoLeaf = undefined;
        setupSingleLayerDeps(makeDeps({}));
        global.fetch = undefined;
        StorageContract.init({ DB: null });
    });

    const OFFLINE_DEF = {
        url: "../profiles/tourism/layers/sites_rosario/data/sites_rosario.geojson",
        geometry: "point",
        offline: { enabled: true, maxFeatures: 5000 },
    };

    it("① déclarée + store peuplé → le store sert, et le réseau n'est PAS sollicité", async () => {
        const read = vi.fn().mockResolvedValue(STORED);
        mountStorage(read);

        await LoaderSingleLayer._loadSingleLayer("sites_rosario", "Sites", OFFLINE_DEF, {});

        expect(read).toHaveBeenCalledWith("sites_rosario");
        // 🛑 The central assertion: "read `features` INSTEAD of refetching".
        expect(global.fetch).not.toHaveBeenCalled();

        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features).toHaveLength(1);
        expect(fc.features[0].properties.id).toBe("local-1");
    });

    it("② déclarée + store VIDE → repli réseau, parce que `null` ≠ collection vide", async () => {
        // `getLayerFeatureCollection` returns `null` when nothing is stored.
        // Returning an empty collection would have displayed zero entities
        // believing it had read — indistinguishable from a really empty layer.
        const read = vi.fn().mockResolvedValue(null);
        mountStorage(read);

        await LoaderSingleLayer._loadSingleLayer("sites_rosario", "Sites", OFFLINE_DEF, {});

        expect(read).toHaveBeenCalledOnce();
        expect(global.fetch).toHaveBeenCalledOnce();
        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features[0].properties.id).toBe("net-1");
    });

    it("③ NON déclarée + store peuplé → le réseau sert, le store est IGNORÉ", async () => {
        // 🛑 The test holding the arbitration. If someone makes store presence
        // decide rather than the declaration, this one turns red — exactly
        // what is asked of it.
        const read = vi.fn().mockResolvedValue(STORED);
        mountStorage(read);

        const def = { ...OFFLINE_DEF };
        delete def.offline;
        await LoaderSingleLayer._loadSingleLayer("sites_rosario", "Sites", def, {});

        expect(read).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledOnce();
        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features[0].properties.id).toBe("net-1");
    });

    it("④ lecture locale qui JETTE → repli réseau, la couche se charge quand même", async () => {
        const read = vi.fn().mockRejectedValue(new Error("IndexedDB fermée"));
        mountStorage(read);

        await LoaderSingleLayer._loadSingleLayer("sites_rosario", "Sites", OFFLINE_DEF, {});

        expect(global.fetch).toHaveBeenCalledOnce();
        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features[0].properties.id).toBe("net-1");
    });

    it("⑤ aucun module de stockage monté → repli réseau, sans erreur", async () => {
        // The case of a storage-less deployment variant: a profile can
        // declare `offline` without the module being there, and that must
        // not break loading.
        // ⚠️ Fake clock: without it this test waits the real 3 s bound. A
        // sleeping test is a test that ends up removed from the fast loop.
        vi.useFakeTimers();
        mountStorage(null);
        StorageContract._resetReady();

        const loading = LoaderSingleLayer._loadSingleLayer(
            "sites_rosario",
            "Sites",
            OFFLINE_DEF,
            {}
        );
        await vi.advanceTimersByTimeAsync(3100);
        vi.useRealTimers();
        await loading;

        expect(global.fetch).toHaveBeenCalledOnce();
    });

    it("⑦ moteur câblé APRÈS le début du chargement → la lecture l'attend et le store sert", async () => {
        // 🛑 THE TEST OF THE DEFECT THAT COST THE LONGEST DIAGNOSIS. The
        // storage engine is a DEFERRED chunk (`globals.storage.ts`:
        // "injected LATER via wireModules") while layers load at boot.
        // Without waiting, `StorageContract.DB` is `null` at the exact
        // moment of the read and the network fallback runs SILENTLY.
        const read = vi.fn().mockResolvedValue(STORED);
        StorageContract.init({ DB: null }); // moteur pas encore câblé
        StorageContract._resetReady();

        const loading = LoaderSingleLayer._loadSingleLayer(
            "sites_rosario",
            "Sites",
            OFFLINE_DEF,
            {}
        );
        // the engine arrives AFTER loading has started
        await new Promise((r) => setTimeout(r, 10));
        StorageContract.init({ DB: { getLayerFeatureCollection: read } });
        StorageContract._markReady();
        await loading;

        expect(read).toHaveBeenCalledWith("sites_rosario");
        expect(global.fetch).not.toHaveBeenCalled();
        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features[0].properties.id).toBe("local-1");
    });

    it("⑧ moteur qui n'arrive JAMAIS → repli réseau borné, pas une attente infinie", async () => {
        // ⚠️ `whenReady()` never resolves when `modules.offline` is disabled
        // — its own TSDoc says so. Without a bound, a layer declared
        // `offline` on an engine-less variant would never load: the map
        // would be empty depending on which variant serves the profile.
        vi.useFakeTimers();
        StorageContract.init({ DB: null });
        StorageContract._resetReady();

        const loading = LoaderSingleLayer._loadSingleLayer(
            "sites_rosario",
            "Sites",
            OFFLINE_DEF,
            {}
        );
        await vi.advanceTimersByTimeAsync(3100);
        vi.useRealTimers();
        await loading;

        expect(global.fetch).toHaveBeenCalledOnce();
        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features[0].properties.id).toBe("net-1");
    });

    it("⑥ `offline` présent mais `enabled: false` → réseau, comme une couche non déclarée", async () => {
        const read = vi.fn().mockResolvedValue(STORED);
        mountStorage(read);

        await LoaderSingleLayer._loadSingleLayer(
            "sites_rosario",
            "Sites",
            { ...OFFLINE_DEF, offline: { enabled: false } },
            {}
        );

        expect(read).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledOnce();
    });

    // ── the adjacent defect the pull makes reachable ─────────────────────────────────────
    it("⑨ `data.ogcApi` + `offline.enabled` → le store passe DEVANT, et rien ne part sur le fil", async () => {
        // 🛑 The `data.ogcApi` branch is an EARLY-EXIT of `_loadSingleLayer`:
        // it yields before `_getDataPromise`, hence before cases ① to ⑥'s
        // local read. A layer carrying both declarations saw its store
        // SHORT-CIRCUITED silently and refetched the network believing
        // itself offline. No repo layer carried both when this was written —
        // the pull is what makes the combination possible.
        const read = vi.fn().mockResolvedValue(STORED);
        mountStorage(read);

        await LoaderSingleLayer._loadSingleLayer(
            "sites_rosario",
            "Sites",
            {
                ...OFFLINE_DEF,
                data: { ogcApi: { url: "https://backend.test/ogc", autoRefresh: true } },
            },
            {}
        );

        expect(read).toHaveBeenCalledWith("sites_rosario");
        expect(global.fetch).not.toHaveBeenCalled();

        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features[0].properties.id).toBe("local-1");

        // And `autoRefresh` does not arm: at the first `moveend` it would
        // refetch the network and overwrite the local read just established.
        expect(state.layers.get("sites_rosario")?._ogcAutoRefreshCleanup).toBeUndefined();
    });

    it("⑩ `data.ogcApi` SANS déclaration hors-ligne → le réseau sert, le store est ignoré", async () => {
        // ⑨'s reference control: the guard must not divert the OGC branch of
        // a layer that asked for nothing.
        const read = vi.fn().mockResolvedValue(STORED);
        mountStorage(read);
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ ...FROM_NETWORK, links: [] }),
        });

        await LoaderSingleLayer._loadSingleLayer(
            "sites_rosario",
            "Sites",
            {
                ...OFFLINE_DEF,
                offline: { enabled: false },
                data: { ogcApi: { url: "https://backend.test/ogc" } },
            },
            {}
        );

        expect(read).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalled();
    });
});
