/**
 * Unit tests — the public `Storage` facade.
 *
 * `built-in/storage/facade.ts` measured at **6.6%** (7/106 lines): 47 test
 * files cite it, but all MOCK it — nobody exercised it. Yet it is the offline
 * engine's public entry point (`GeoLeaf.Storage`).
 *
 * The facade is **decoupled by design**: it contains no engine code, only
 * references injected by `wireModules()`. It can thus be exercised with fake
 * modules, mocking nothing — exactly what this cut allows.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

const { Storage } = await import("../../src/kernel/storage/facade.js");

/** A fake engine, entirely under the test's control. */
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
        // ⚠️ This case asserted `stats.sync.pending`. The `sync` block is
        // removed: its only source was `syncQueueCount`, the v3 store nobody
        // wrote any more — it reported 0 in all circumstances, and `failed`
        // was never assigned. The real tally of owed writes is `outbox.count`.
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
    /** Builds a `_db` whose transaction completes on its own. */
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
        // ⚠️ `sync_queue` was the third. The store is removed, and NAMING it
        // in the transaction would make it throw on a fresh base. `features`
        // and `outbox` stay deliberately absent: `clearAll()` never destroys
        // a field capture.
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

// ⚠️ THE `Storage.downloadProfileForOffline` BLOCK WAS REMOVED FROM HERE,
// and its four tests were not discarded: they are MOVED to
// `__tests__/capabilities/offline/cache-manager-orchestration.test.js`, where
// the quota pre-check now lives. The function was dead — zero callers in the
// whole repo — but it carried the download's only quota guard; its tests
// follow the behaviour, not the symbol. Two new tests join them there: a
// quota-mute browser must not cause a refusal, and a refusal must release
// the profile lock.

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
        // 🛑 The bound's motive: `StorageContract.whenReady()` NEVER resolves
        // when `modules.offline` is disabled. Without a cap, this call would
        // wait forever on an engineless variant. And unlike the layer read,
        // there is no network fallback here: the refusal must be SAID, not
        // return a mute zero.
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
