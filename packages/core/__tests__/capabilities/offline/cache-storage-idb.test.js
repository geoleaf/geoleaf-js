/**
 * Unit tests — `capabilities/offline/cache/storage.ts` (CacheStorage), gisement moteur offline.
 *
 * File at 58%: the cache's IndexedDB layer (manifest, layer selection, purge,
 * quota, profile loading). Under `capabilities/offline`, `../core/indexeddb.js`
 * is redirected by `__tests__/setup.js` to the in-memory mock
 * `__mocks__/indexeddb.js` ("metadata" store + preferences). We import the
 * SAME mock singleton to reset it between tests (`clearMockStore`) and drive
 * CacheStorage, which writes/reads through it.
 *
 * ⚠️ `getCachedUrls` is NOT covered here: it reads the "layers" store by
 * CURSOR, which this minimal mock (metadata only, no `openCursor`) cannot
 * produce — it would take `fake-indexeddb`, which the setup redirect prevents
 * for offline importers.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { CacheStorage } from "../../../src/capabilities/offline/cache/storage.js";
// Same instance storage.ts receives through the setup.js redirect.
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

// ── getCachedUrls (cursor over the "layers" store) ───────────────────────────────────

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

// ⚠️ THE `getStorageQuota` BLOCK IS REMOVED — third copy of the same quota
// reader, with no production caller. See `CacheManager.getStorageQuota()`.

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
