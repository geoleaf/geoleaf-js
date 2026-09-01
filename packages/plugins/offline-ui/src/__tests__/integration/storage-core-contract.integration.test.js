/**
 * Integration test: StorageContract (core) ↔ GeoLeafStorage plugin
 *
 * Verifies that the plugin-storage module correctly implements all methods
 * expected by the core StorageContract singleton. The contract acts as the
 * bridge between @geoleaf/core and @geoleaf-plugins/offline-ui at runtime.
 */

import { StorageContract } from "@core/shared/storage-contract.js";
import { RetryHandler } from "@core-offline/cache/retry-handler.js";
import { StorageHelperModule as StorageHelper } from "@core-offline/db/storage-helper.js";
import { CacheStorage } from "@core-offline/cache/storage.js";

// This file imports the CORE's contract (`@core/shared/…`), not the plugin's
// adapter: its subject IS the singleton and its `init()` cycle. So it keeps
// `StorageContract.init()`. The other test files now drive `GeoLeaf.Storage` —
// the channel production takes.

describe("Integration core ↔ storage — StorageContract", () => {
    beforeEach(() => {
        // Reset contract state between tests
        StorageContract._storageModule = null;
        StorageContract._available = false;
    });

    describe("StorageContract interface completeness", () => {
        test("should expose init, isAvailable, isPluginLoaded methods", () => {
            expect(typeof StorageContract.init).toBe("function");
            expect(typeof StorageContract.isAvailable).toBe("function");
            expect(typeof StorageContract.isPluginLoaded).toBe("function");
        });

        test("should expose DB getter", () => {
            const descriptor = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(StorageContract) === null
                    ? StorageContract
                    : Object.getPrototypeOf(StorageContract),
                "DB"
            );
            // DB may be a getter or a direct property — either is acceptable
            expect(descriptor?.get !== undefined || "DB" in StorageContract).toBe(true);
        });

        test("should expose CacheManager getter", () => {
            expect("CacheManager" in StorageContract || StorageContract.CacheManager === null).toBe(
                true
            );
        });

        // ⚠️ THE `downloadProfileForOffline` ASSERTION IS REMOVED. The member no
        // longer exists: it was dead across the repo, and its ONLY useful
        // content — the quota pre-check — was moved into
        // `CacheManager.cacheProfile()` BEFORE the deletion. This contract thus
        // declared a method this plugin did not call.
    });

    describe("contract init lifecycle", () => {
        test("isAvailable returns false before init", () => {
            expect(StorageContract.isAvailable()).toBe(false);
        });

        test("isPluginLoaded returns false before init", () => {
            expect(StorageContract.isPluginLoaded()).toBe(false);
        });

        test("DB returns null before init", () => {
            expect(StorageContract.DB).toBeNull();
        });

        test("CacheManager returns null before init", () => {
            expect(StorageContract.CacheManager).toBeNull();
        });

        test("Cache returns null before init", () => {
            expect(StorageContract.Cache).toBeNull();
        });

        test("init with a valid storage module marks contract as available", () => {
            const fakeStorageModule = {
                DB: { layers: {}, sync: {}, backups: {} },
                CacheManager: { get: vi.fn(), set: vi.fn() },
                Cache: {},
            };

            StorageContract.init(fakeStorageModule);

            expect(StorageContract.isAvailable()).toBe(true);
            expect(StorageContract.isPluginLoaded()).toBe(true);
        });

        test("DB getter returns the storage module DB after init", () => {
            const fakeDB = { layers: {}, sync: {}, backups: {} };
            StorageContract.init({ DB: fakeDB, CacheManager: null, Cache: null });

            expect(StorageContract.DB).toBe(fakeDB);
        });

        test("CacheManager getter returns the storage module CacheManager after init", () => {
            const fakeCacheManager = { get: vi.fn(), set: vi.fn() };
            StorageContract.init({ DB: null, CacheManager: fakeCacheManager, Cache: null });

            expect(StorageContract.CacheManager).toBe(fakeCacheManager);
        });

        test("Cache getter exposes Storage + LayerSelector after init (download wiring)", () => {
            const fakeCache = {
                Storage: { loadLayerSelection: vi.fn(), saveLayerSelection: vi.fn() },
                LayerSelector: { refreshCacheIcons: vi.fn() },
            };
            StorageContract.init({ DB: null, CacheManager: null, Cache: fakeCache });

            expect(StorageContract.Cache).toBe(fakeCache);
            expect(typeof StorageContract.Cache.Storage.loadLayerSelection).toBe("function");
            expect(typeof StorageContract.Cache.Storage.saveLayerSelection).toBe("function");
            expect(typeof StorageContract.Cache.LayerSelector.refreshCacheIcons).toBe("function");
        });
    });

    describe("contract ↔ plugin-storage shape compatibility", () => {
        test("plugin-storage RetryHandler can be loaded alongside contract", () => {
            expect(typeof RetryHandler.retry).toBe("function");
            expect(typeof RetryHandler.getConfig).toBe("function");
        });

        test("StorageHelper exposes setItem / getItem used by core consumers", () => {
            expect(typeof StorageHelper.setItem).toBe("function");
            expect(typeof StorageHelper.getItem).toBe("function");
            expect(typeof StorageHelper.removeItem).toBe("function");
        });

        test("real CacheStorage exposes the selection methods the Cache namespace needs", () => {
            expect(typeof CacheStorage.loadLayerSelection).toBe("function");
            expect(typeof CacheStorage.saveLayerSelection).toBe("function");
        });

        test("assembled LayerSelector (LS) exposes refreshCacheIcons used after download", async () => {
            // ⚠️ DEFERRED loading, and it is the test's very subject: the three
            // modules below mount their methods on `LS` via `Object.assign` AT
            // LOAD. Hoisted to top-level `import`s, the assertion would still
            // pass — but it would no longer demonstrate that THEY bring
            // `refreshCacheIcons`, since any other file of the suite could have
            // loaded them first. `await import()` preserves the sequence to the
            // letter.
            await import("../../cache/layer-selector/data-fetching.js");
            await import("../../cache/layer-selector/row-rendering.js");
            await import("../../cache/layer-selector/selection-cache.js");
            const { LS } = await import("../../cache/layer-selector/core.js");
            expect(typeof LS.refreshCacheIcons).toBe("function");
        });

        test("contract shape matches what core modules expect (DB sub-object)", () => {
            const fakeDB = {
                layers: { get: vi.fn(), set: vi.fn() },
                sync: { getQueue: vi.fn() },
                backups: { list: vi.fn() },
            };
            StorageContract.init({ DB: fakeDB, CacheManager: null, Cache: null });

            const db = StorageContract.DB;
            expect(db).toHaveProperty("layers");
            expect(db).toHaveProperty("sync");
            expect(db).toHaveProperty("backups");
        });
    });
});
