/**
 * Unit tests — façade publique `Storage` (backlog COUVERTURE B.2).
 *
 * `built-in/storage/facade.ts` était mesuré à **6,6 %** (7/106 lignes) : 47 fichiers de test
 * la citent, mais tous la MOCKENT — personne ne l'exerçait. Or c'est le point d'entrée public
 * du moteur hors-ligne (`GeoLeaf.Storage`).
 *
 * La façade est **découplée par conception** : elle ne contient aucun code de moteur, seulement
 * des références injectées par `wireModules()`. On peut donc l'exercer avec de faux modules,
 * sans mocker quoi que ce soit — c'est exactement ce que cette découpe permet.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

const { Storage } = await import("../../src/kernel/storage/facade.js");

/** Un faux moteur, entièrement sous contrôle du test. */
function fakeModules(overrides = {}) {
    return {
        db: {
            _db: {},
            _dbName: undefined,
            _dbVersion: undefined,
            init: vi.fn().mockResolvedValue(undefined),
            close: vi.fn(),
            getStorageStats: vi.fn().mockResolvedValue({
                used: 10,
                quota: 100,
                percentage: 10,
                layersCount: 4,
                syncQueueCount: 2,
            }),
            getLayersByProfile: vi.fn().mockResolvedValue([1, 2, 3]),
            ...overrides.db,
        },
        cacheManager: {
            init: vi.fn(),
            listCachedProfiles: vi.fn().mockResolvedValue(["p1"]),
            clearProfile: vi.fn().mockResolvedValue(1),
            isProfileCached: vi.fn().mockResolvedValue(true),
            estimateProfileSize: vi.fn().mockResolvedValue({ totalSize: 100 }),
            getStorageQuota: vi.fn().mockResolvedValue({ available: 1000 }),
            cacheProfile: vi.fn().mockResolvedValue({ ok: true }),
            ...overrides.cacheManager,
        },
        cache: { marker: "cache-ns" },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    Storage.wireModules({});
    delete globalThis.GeoLeaf._OfflineDetector;
});

afterEach(() => {
    Storage.wireModules({});
    delete globalThis.GeoLeaf._OfflineDetector;
});

describe("Storage.wireModules — la façade ne tient que des références", () => {
    test("sans câblage, tous les accesseurs rendent undefined", () => {
        expect(Storage.DB).toBeUndefined();
        expect(Storage.CacheManager).toBeUndefined();
        expect(Storage.Cache).toBeUndefined();
    });

    test("après câblage, les accesseurs rendent les modules injectés", () => {
        const m = fakeModules();
        Storage.wireModules(m);
        expect(Storage.DB).toBe(m.db);
        expect(Storage.CacheManager).toBe(m.cacheManager);
        expect(Storage.Cache).toBe(m.cache);
    });

    test("les accesseurs Plugin Contract v1 (minuscules) sont des alias des majuscules", () => {
        const m = fakeModules();
        Storage.wireModules(m);
        expect(Storage.db).toBe(Storage.DB);
        expect(Storage.cacheManager).toBe(Storage.CacheManager);
        expect(Storage.cache).toBe(Storage.Cache);
    });

    test("OfflineDetector est résolu depuis globalThis.GeoLeaf, pas depuis le câblage", () => {
        const detector = { isOnline: () => true };
        globalThis.GeoLeaf._OfflineDetector = detector;
        expect(Storage.OfflineDetector).toBe(detector);
    });
});

describe("Storage.isAvailable — la connexion IndexedDB est-elle ouverte ?", () => {
    test("faux sans module DB", () => {
        expect(Storage.isAvailable()).toBe(false);
    });

    test("faux quand `_db` est null ou undefined — le module seul ne suffit pas", () => {
        Storage.wireModules({ db: { _db: null } });
        expect(Storage.isAvailable()).toBe(false);
        Storage.wireModules({ db: { _db: undefined } });
        expect(Storage.isAvailable()).toBe(false);
    });

    test("vrai dès que `_db` est ouvert", () => {
        Storage.wireModules({ db: { _db: {} } });
        expect(Storage.isAvailable()).toBe(true);
    });
});

describe("Storage.isOffline", () => {
    test("suit le détecteur quand il est présent (et l'inverse)", () => {
        globalThis.GeoLeaf._OfflineDetector = { isOnline: () => true };
        expect(Storage.isOffline()).toBe(false);
        globalThis.GeoLeaf._OfflineDetector = { isOnline: () => false };
        expect(Storage.isOffline()).toBe(true);
    });

    test("sans détecteur, retombe sur navigator.onLine", () => {
        const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        expect(Storage.isOffline()).toBe(true);
        spy.mockReturnValue(true);
        expect(Storage.isOffline()).toBe(false);
        spy.mockRestore();
    });
});

describe("Storage.init", () => {
    test("initialise DB et CacheManager, émet l'événement et rend true", async () => {
        const m = fakeModules();
        Storage.wireModules(m);
        const onInit = vi.fn();
        document.addEventListener("geoleaf:storage:initialized", onInit);

        await expect(Storage.init()).resolves.toBe(true);

        expect(m.db.init).toHaveBeenCalledTimes(1);
        expect(m.cacheManager.init).toHaveBeenCalledTimes(1);
        expect(onInit).toHaveBeenCalledTimes(1);
        document.removeEventListener("geoleaf:storage:initialized", onInit);
    });

    test("les options indexedDB renomment et versionnent la base AVANT init()", async () => {
        const m = fakeModules();
        Storage.wireModules(m);
        await Storage.init({ indexedDB: { name: "ma-base", version: 7 } });
        expect(m.db._dbName).toBe("ma-base");
        expect(m.db._dbVersion).toBe(7);
    });

    test("les options `cache` sont transmises telles quelles au CacheManager", async () => {
        const m = fakeModules();
        Storage.wireModules(m);
        await Storage.init({ cache: { maxCacheBytes: 42 } });
        expect(m.cacheManager.init).toHaveBeenCalledWith({ maxCacheBytes: 42 });
    });

    test("le détecteur reste éteint par défaut — c'est un opt-in", async () => {
        const detector = { init: vi.fn(), isOnline: () => true };
        globalThis.GeoLeaf._OfflineDetector = detector;
        Storage.wireModules(fakeModules());
        await Storage.init();
        expect(detector.init).not.toHaveBeenCalled();
    });

    test("le détecteur s'initialise quand on l'active explicitement", async () => {
        const detector = { init: vi.fn(), isOnline: () => true };
        globalThis.GeoLeaf._OfflineDetector = detector;
        Storage.wireModules(fakeModules());
        await Storage.init({ enableOfflineDetector: true, offline: { poll: 1 } });
        expect(detector.init).toHaveBeenCalledWith({ poll: 1 });
    });

    test("sans module, init ne jette pas — elle se contente d'avertir", async () => {
        Storage.wireModules({});
        await expect(Storage.init()).resolves.toBe(true);
    });

    test("un échec de sous-module est enveloppé dans une erreur explicite", async () => {
        const m = fakeModules({ db: { init: vi.fn().mockRejectedValue(new Error("idb ko")) } });
        Storage.wireModules(m);
        await expect(Storage.init()).rejects.toThrow("[Storage] Initialization failed: idb ko");
    });
});

describe("Storage.getStats — agrégation, et elle ne jette JAMAIS", () => {
    test("agrège quota, couches, magasins v4 et profils cachés", async () => {
        // ⚠️ Ce cas assertait `stats.sync.pending`. Le bloc `sync` est retiré (4.11) : sa seule
        // source était `syncQueueCount`, le magasin v3 que plus personne n'écrivait depuis
        // 4.4b — il rapportait 0 en toutes circonstances, et `failed` n'était jamais assigné.
        // Le décompte réel des écritures dues est `outbox.count`.
        const m = fakeModules();
        Storage.wireModules(m);
        const stats = await Storage.getStats();
        expect(stats.storage).toEqual({ used: 10, quota: 100, percentage: 10 });
        expect(stats.layers.count).toBe(4);
        expect(stats.sync).toBeUndefined();
        expect(stats.cache.profiles).toEqual(["p1"]);
        expect(stats.layers.byProfile).toEqual({ p1: 3 });
    });

    test("reflète l'état en ligne du détecteur", async () => {
        globalThis.GeoLeaf._OfflineDetector = { isOnline: () => false };
        Storage.wireModules(fakeModules());
        expect((await Storage.getStats()).online).toBe(false);
    });

    test("une erreur en cours de route rend des stats PARTIELLES au lieu de jeter", async () => {
        const m = fakeModules({
            db: { getStorageStats: vi.fn().mockRejectedValue(new Error("plus de quota")) },
        });
        Storage.wireModules(m);
        const stats = await Storage.getStats();
        expect(stats.storage).toEqual({ used: 0, quota: 0, percentage: 0 });
    });

    test("sans aucun module câblé, rend la structure par défaut", async () => {
        const stats = await Storage.getStats();
        expect(stats).toMatchObject({
            storage: { used: 0, quota: 0, percentage: 0 },
            layers: { count: 0, byProfile: {} },
            cache: { profiles: [] },
        });
    });
});

describe("Storage.clearAll", () => {
    /** Fabrique un `_db` dont la transaction se complète toute seule. */
    function dbWithTransaction(stores = {}) {
        const cleared = [];
        const tx = {
            objectStore: (name) => ({
                clear: () => {
                    cleared.push(name);
                    return stores[name];
                },
            }),
        };
        const db = {
            _db: {
                transaction: vi.fn(() => {
                    queueMicrotask(() => tx.oncomplete && tx.oncomplete());
                    return tx;
                }),
            },
        };
        return { db, cleared, tx };
    }

    test("vide chaque profil caché puis les 2 magasins, et émet l'événement", async () => {
        const { db, cleared } = dbWithTransaction();
        const m = fakeModules();
        m.db = { ...m.db, ...db };
        Storage.wireModules(m);
        const onCleared = vi.fn();
        document.addEventListener("geoleaf:storage:cleared", onCleared);

        await Storage.clearAll();

        expect(m.cacheManager.clearProfile).toHaveBeenCalledWith("p1");
        // ⚠️ `sync_queue` était le troisième. Le magasin est retiré (4.11), et le NOMMER dans
        // la transaction la ferait jeter sur une base neuve. `features` et `outbox` restent
        // délibérément absents : `clearAll()` ne détruit jamais une saisie de terrain.
        expect(cleared).toEqual(["preferences", "metadata"]);
        expect(onCleared).toHaveBeenCalledTimes(1);
        document.removeEventListener("geoleaf:storage:cleared", onCleared);
    });

    test("une erreur est journalisée ET propagée — effacer à moitié doit se voir", async () => {
        const m = fakeModules({
            cacheManager: { listCachedProfiles: vi.fn().mockRejectedValue(new Error("ko")) },
        });
        Storage.wireModules(m);
        await expect(Storage.clearAll()).rejects.toThrow("ko");
    });
});

describe("Storage.close", () => {
    test("ferme la base et démonte le détecteur", () => {
        const detector = { destroy: vi.fn(), isOnline: () => true };
        globalThis.GeoLeaf._OfflineDetector = detector;
        const m = fakeModules();
        Storage.wireModules(m);
        Storage.close();
        expect(m.db.close).toHaveBeenCalledTimes(1);
        expect(detector.destroy).toHaveBeenCalledTimes(1);
    });

    test("sans modules, close ne jette pas", () => {
        expect(() => Storage.close()).not.toThrow();
    });
});

// ⚠️ LE BLOC `Storage.downloadProfileForOffline` A ÉTÉ RETIRÉ D'ICI (tâche 3.13), et ses
// quatre tests n'ont pas été jetés : ils sont DÉPLACÉS dans
// `__tests__/capabilities/offline/cache-manager-orchestration.test.js`, où le pré-contrôle de
// quota vit désormais. La fonction était morte — zéro appelant dans tout le dépôt — mais elle
// portait la seule garde de quota du téléchargement ; ses tests suivent le comportement, pas
// le symbole. Deux tests neufs les accompagnent là-bas : un navigateur muet sur le quota ne
// doit pas faire refuser, et un refus doit libérer le verrou de profil.

describe("Storage — lectures hors-ligne", () => {
    test("isProfileAvailableOffline est faux tant que le stockage n'est pas prêt", async () => {
        await expect(Storage.isProfileAvailableOffline("p")).resolves.toBe(false);
    });

    test("isProfileAvailableOffline délègue une fois prêt", async () => {
        const m = fakeModules();
        Storage.wireModules(m);
        await expect(Storage.isProfileAvailableOffline("p")).resolves.toBe(true);
        expect(m.cacheManager.isProfileCached).toHaveBeenCalledWith("p");
    });

    test("getOfflineProfiles rend [] tant que le stockage n'est pas prêt", async () => {
        await expect(Storage.getOfflineProfiles()).resolves.toEqual([]);
    });

    test("getOfflineProfiles délègue une fois prêt", async () => {
        Storage.wireModules(fakeModules());
        await expect(Storage.getOfflineProfiles()).resolves.toEqual(["p1"]);
    });
});

describe("Storage.pullLayer — tâche 4.1, l'attente du moteur est BORNÉE", () => {
    test("délègue au module `pull` quand il est câblé", async () => {
        const report = { layerId: "sites_rosario", written: 27, refused: null };
        const pullLayer = vi.fn().mockResolvedValue(report);
        Storage.wireModules({ ...fakeModules(), pull: { pullLayer } });

        const bbox = [-60.66, -32.95, -60.62, -32.93];
        await expect(Storage.pullLayer("sites_rosario", { bbox })).resolves.toBe(report);
        expect(pullLayer).toHaveBeenCalledWith("sites_rosario", { bbox });
    });

    test("sans moteur, refuse en `engineUnavailable` — et ne pend PAS", async () => {
        // 🛑 Le motif de la borne : `StorageContract.whenReady()` ne résout JAMAIS quand
        // `modules.offline` est désactivé. Sans plafond, cet appel attendrait pour toujours
        // sur une variante sans moteur. Et contrairement à la lecture de couche, il n'y a
        // aucun repli réseau ici : le refus doit se DIRE, pas rendre un zéro muet.
        vi.useFakeTimers();
        Storage.wireModules({});
        const pending = Storage.pullLayer("sites_rosario");
        await vi.advanceTimersByTimeAsync(3100);
        vi.useRealTimers();

        const report = await pending;
        expect(report.refused).toBe("engineUnavailable");
        expect(report.written).toBe(0);
    });
});
