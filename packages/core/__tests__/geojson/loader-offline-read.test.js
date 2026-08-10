/**
 * 4.3 — LA LECTURE LOCALE, à travers le VRAI chargeur de couche.
 *
 * Prouve les quatre branches de `_getDataPromise` telles que la tâche 4.3 les laisse :
 *
 *   1. couche déclarée hors-ligne + store peuplé  → le store sert, ZÉRO fetch
 *   2. couche déclarée hors-ligne + store VIDE    → repli réseau (le store rend `null`)
 *   3. couche NON déclarée + store peuplé         → le réseau sert, le store est ignoré
 *   4. lecture locale qui JETTE                   → repli réseau, et la couche se charge
 *
 * 🛑 LA 3 EST CELLE QUI COMPTE, et elle est la raison de l'arbitrage. L'option écartée
 * — « lire le store dès qu'il porte des entités » — aurait fait dépendre la source de vérité
 * d'un ACCIDENT DE PEUPLEMENT. Ce test échoue si quelqu'un la réintroduit.
 *
 * ⚠️ Le store est atteint par `StorageContract.DB`, jamais par un import de `capabilities/` :
 * le kernel n'en importe aucun. C'est donc le CONTRAT qui est moqué ici, pas IndexedDB — un
 * mock d'IndexedDB éprouverait le stockage, quand ce qui est en jeu est le seam.
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
        // `isAvailable: false` — le worker forcerait un fetch hors du seam mesuré ici.
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

/** Monte une façade de stockage minimale derrière le contrat. */
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
        // 🛑 L'assertion centrale de 4.3 : « lire `features` AU LIEU de refetcher ».
        expect(global.fetch).not.toHaveBeenCalled();

        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features).toHaveLength(1);
        expect(fc.features[0].properties.id).toBe("local-1");
    });

    it("② déclarée + store VIDE → repli réseau, parce que `null` ≠ collection vide", async () => {
        // `getLayerFeatureCollection` rend `null` quand rien n'est stocké. Rendre une
        // collection vide aurait affiché zéro entité en croyant avoir lu — indiscernable
        // d'une couche réellement vide.
        const read = vi.fn().mockResolvedValue(null);
        mountStorage(read);

        await LoaderSingleLayer._loadSingleLayer("sites_rosario", "Sites", OFFLINE_DEF, {});

        expect(read).toHaveBeenCalledOnce();
        expect(global.fetch).toHaveBeenCalledOnce();
        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features[0].properties.id).toBe("net-1");
    });

    it("③ NON déclarée + store peuplé → le réseau sert, le store est IGNORÉ", async () => {
        // 🛑 Le test qui tient l'arbitrage. Si quelqu'un fait décider la présence dans le
        // store plutôt que la déclaration, celui-ci rougit — et c'est exactement ce qu'on
        // lui demande.
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
        // Le cas d'une variante de déploiement sans stockage : un profil peut déclarer
        // `offline` sans que le module soit là, et ça ne doit pas casser le chargement.
        // ⚠️ Horloge factice : sans elle ce test attend la borne réelle de 3 s. Un test qui
        // dort est un test qu'on finit par retirer de la boucle rapide.
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
        // 🛑 LE TEST DU DÉFAUT QUI A COÛTÉ LE PLUS LONG DIAGNOSTIC DU SPRINT. Le moteur de
        // stockage est un chunk DIFFÉRÉ (`globals.storage.ts` : « injected LATER via
        // wireModules ») alors que les couches chargent au boot. Sans attente, `StorageContract.DB`
        // vaut `null` au moment exact de la lecture et le repli réseau s'exécute EN SILENCE.
        const read = vi.fn().mockResolvedValue(STORED);
        StorageContract.init({ DB: null }); // moteur pas encore câblé
        StorageContract._resetReady();

        const loading = LoaderSingleLayer._loadSingleLayer(
            "sites_rosario",
            "Sites",
            OFFLINE_DEF,
            {}
        );
        // le moteur arrive APRÈS que le chargement a commencé
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
        // ⚠️ `whenReady()` ne résout jamais quand `modules.offline` est désactivé — son propre
        // TSDoc le dit. Sans borne, une couche déclarée `offline` sur une variante SANS moteur
        // ne se chargerait jamais : la carte serait vide selon la variante qui sert le profil.
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

    // ── 4.1 — le défaut adjacent que le rapatriement rend atteignable ─────────────────────
    it("⑨ `data.ogcApi` + `offline.enabled` → le store passe DEVANT, et rien ne part sur le fil", async () => {
        // 🛑 La branche `data.ogcApi` est un EARLY-EXIT de `_loadSingleLayer` : elle rend la
        // main avant `_getDataPromise`, donc avant la lecture locale des cas ① à ⑥. Une
        // couche portant les deux déclarations voyait son store COURT-CIRCUITÉ en silence et
        // refetchait le réseau en se croyant hors-ligne. Aucune couche du dépôt ne portait
        // les deux quand c'est écrit — 4.1 est la tâche qui rend la combinaison possible.
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

        // Et `autoRefresh` ne s'arme pas : au premier `moveend` il refetcherait le réseau et
        // écraserait la lecture locale qu'on vient d'établir.
        expect(state.layers.get("sites_rosario")?._ogcAutoRefreshCleanup).toBeUndefined();
    });

    it("⑩ `data.ogcApi` SANS déclaration hors-ligne → le réseau sert, le store est ignoré", async () => {
        // Le contrôle de référence du ⑨ : la garde ne doit pas détourner la branche OGC
        // d'une couche qui n'a rien demandé.
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
