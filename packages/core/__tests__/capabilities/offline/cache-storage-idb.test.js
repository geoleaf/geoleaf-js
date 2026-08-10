/**
 * Unit tests — `capabilities/offline/cache/storage.ts` (CacheStorage), gisement moteur offline.
 *
 * Fichier à 58 % : la couche IndexedDB du cache (manifeste, sélection de couches, purge,
 * quota, chargement de profil). Sous `capabilities/offline`, `../core/indexeddb.js` est
 * redirigé par `__tests__/setup.js` vers le mock en mémoire `__mocks__/indexeddb.js` (store
 * « metadata » + préférences). On importe le MÊME singleton mock pour le réinitialiser entre
 * tests (`clearMockStore`) et on pilote CacheStorage, qui écrit/lit à travers lui.
 *
 * ⚠️ `getCachedUrls` n'est PAS couvert ici : il lit le store « layers » par CURSEUR, que ce
 * mock minimal (metadata seul, `openCursor` absent) ne peut pas produire — il faudrait
 * `fake-indexeddb`, ce que le redirect de setup empêche pour les importeurs offline.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { CacheStorage } from "../../../src/capabilities/offline/cache/storage.js";
// Même instance que celle que storage.ts reçoit via le redirect de setup.js.
import { IndexedDB, clearMockStore } from "../../__mocks__/indexeddb.js";

let seq = 0;
const pid = () => `prof-${seq}`;

beforeEach(() => {
    seq += 1;
    clearMockStore();
    globalThis.GeoLeaf = {
        ...(globalThis.GeoLeaf ?? {}),
        Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        Config: { get: (_k, fb) => fb },
    };
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Layer selection ───────────────────────────────────────────────────────────────

describe("layer selection", () => {
    test("round-trip save → load, timestamp estampillé si absent", async () => {
        await CacheStorage.saveLayerSelection(pid(), { layers: ["a"], basemaps: ["osm"] });
        const loaded = await CacheStorage.loadLayerSelection(pid());
        expect(loaded.layers).toEqual(["a"]);
        expect(loaded.basemaps).toEqual(["osm"]);
        expect(typeof loaded.timestamp).toBe("number");
    });

    test("timestamp fourni par l'appelant est préservé", async () => {
        await CacheStorage.saveLayerSelection(pid(), { layers: [], basemaps: [], timestamp: 42 });
        expect((await CacheStorage.loadLayerSelection(pid())).timestamp).toBe(42);
    });

    test("sélection absente → null", async () => {
        expect(await CacheStorage.loadLayerSelection("jamais")).toBeNull();
    });
});

// ── Manifest ──────────────────────────────────────────────────────────────────────

describe("manifest", () => {
    const results = {
        cached: ["u1", "u2"],
        failed: [],
        totalSize: 4096,
        resourcesCount: 2,
        duration: 100,
    };

    test("save → get round-trip (résout resources depuis cached)", async () => {
        await CacheStorage.saveManifest(pid(), results);
        const m = await CacheStorage.getManifest(pid());
        expect(m.resourcesCount).toBe(2);
        expect(m.totalSize).toBe(4096);
        expect(m.resources.map((r) => r.url)).toEqual(["u1", "u2"]);
    });

    test("getManifest absent → null ; getCacheStatus délègue à getManifest", async () => {
        expect(await CacheStorage.getManifest("absent")).toBeNull();
        await CacheStorage.saveManifest(pid(), results);
        expect(await CacheStorage.getCacheStatus(pid())).toMatchObject({ resourcesCount: 2 });
    });

    test("deleteManifest retire l'entrée", async () => {
        await CacheStorage.saveManifest(pid(), results);
        await CacheStorage.deleteManifest(pid());
        expect(await CacheStorage.getManifest(pid())).toBeNull();
    });

    test("getCachedProfiles liste les profils manifestés (isolé par clearMockStore)", async () => {
        await CacheStorage.saveManifest("alpha", results);
        await CacheStorage.saveManifest("beta", results);
        const list = await CacheStorage.getCachedProfiles();
        expect(list.sort()).toEqual(["alpha", "beta"]);
    });
});

// ── clearCache ──────────────────────────────────────────────────────────────────────

describe("clearCache", () => {
    test("purge sélection + manifeste, rend le compte, émet l'événement", async () => {
        await CacheStorage.saveLayerSelection(pid(), { layers: ["a"], basemaps: [] });
        await CacheStorage.saveManifest(pid(), {
            cached: ["u1"],
            failed: [],
            totalSize: 1,
            resourcesCount: 1,
            duration: 1,
        });
        const evt = vi.fn();
        document.addEventListener("geoleaf:cache:cleared", evt, { once: true });

        const deleted = await CacheStorage.clearCache(pid());

        expect(deleted).toBeGreaterThanOrEqual(1);
        expect(await CacheStorage.getManifest(pid())).toBeNull();
        expect(evt).toHaveBeenCalled();
        expect(evt.mock.calls[0][0].detail).toMatchObject({ profileId: pid() });
    });
});

// ── getCachedUrls (curseur sur le store « layers ») ──────────────────────────────────

describe("getCachedUrls", () => {
    test("liste les URLs des couches du profil, ignore les autres", async () => {
        await IndexedDB.cacheLayer("url-1", { a: 1 }, pid(), {});
        await IndexedDB.cacheLayer("url-2", { b: 2 }, pid(), {});
        await IndexedDB.cacheLayer("autre", { c: 3 }, "autre-profil", {});

        const urls = await CacheStorage.getCachedUrls(pid());
        expect(urls.has("url-1")).toBe(true);
        expect(urls.has("url-2")).toBe(true);
        expect(urls.has("autre")).toBe(false);
    });

    test("aucune couche → set vide", async () => {
        expect((await CacheStorage.getCachedUrls("vide")).size).toBe(0);
    });
});

// ── Storage quota ───────────────────────────────────────────────────────────────────

// ⚠️ LE BLOC `getStorageQuota` EST RETIRÉ (clôture S3c) — troisième exemplaire du même
// lecteur de quota, sans appelant de production. Voir `CacheManager.getStorageQuota()`.

// ── loadProfileConfig ────────────────────────────────────────────────────────────────

describe("loadProfileConfig", () => {
    afterEach(() => {
        delete globalThis.fetch;
    });

    test("charge profile.json (couches inline → pas de fetch supplémentaire)", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ id: "t", layers: [{ id: "l1" }] }),
        }));
        const profile = await CacheStorage.loadProfileConfig("tourism");
        expect(profile.id).toBe("t");
        expect(profile.layers).toEqual([{ id: "l1" }]);
    });

    test("réponse non ok → jette", async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
        await expect(CacheStorage.loadProfileConfig("nope")).rejects.toThrow(/404/);
    });
});
