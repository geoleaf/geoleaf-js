/**
 * Tests for the CacheManager profile-cache gate (S3 offline download wiring).
 *
 * Root cause of the `[CacheManager] Profile cache is disabled` warning at download
 * time: `_config` started as `null`, so a missing/late `init()` call (plugin
 * registered after core boot) or a partial config silently disabled profile caching.
 * Fix: profile cache is enabled by default and `init()` merges over the defaults.
 */
"use strict";

import { CacheManager } from "../../../src/capabilities/offline/cache/cache-manager.js";
import { IndexedDB } from "../../__mocks__/indexeddb.js";

// Captured at import time (vitest isolates modules per file) → the true module default.
// The import is hoisted above these two consts, so the module is fully initialised here.
const MODULE_DEFAULT_ENABLED = CacheManager._config?.enableProfileCache;
const MODULE_DEFAULT_MAX_CACHE = CacheManager._config?.maxCacheBytes;

describe("CacheManager — profile cache gate", () => {
    beforeEach(() => {
        // Restore the documented default between tests (singleton shared in this file).
        CacheManager._config = { enableProfileCache: true, enableTileCache: true };
        CacheManager._cachingProfiles.clear();
    });

    test("ships with profile cache enabled by default (no init call)", () => {
        expect(MODULE_DEFAULT_ENABLED).toBe(true);
    });

    test("init() merges a partial config and keeps the enableProfileCache default", () => {
        CacheManager.init({ maxRetries: 5 });
        expect(CacheManager._config.enableProfileCache).toBe(true);
        expect(CacheManager._config.maxRetries).toBe(5);
    });

    test("init() lets a profile explicitly disable profile cache", () => {
        CacheManager.init({ enableProfileCache: false });
        expect(CacheManager._config.enableProfileCache).toBe(false);
    });

    test("cacheProfile aborts with the disabled error only when explicitly disabled", async () => {
        CacheManager.init({ enableProfileCache: false });
        const result = await CacheManager.cacheProfile("any-profile");
        expect(result).toEqual({ error: "Profile cache disabled" });
    });
});

describe("CacheManager — cache eviction (maxCacheBytes)", () => {
    test("ships with a positive default maxCacheBytes budget", () => {
        expect(MODULE_DEFAULT_MAX_CACHE).toBeGreaterThan(0);
    });

    test("_enforceCacheQuota no-ops when the budget is disabled (0)", async () => {
        CacheManager._config = { maxCacheBytes: 0 };
        // Must not throw and must not touch IndexedDB.
        await expect(CacheManager._enforceCacheQuota()).resolves.toBeUndefined();
    });

    test("_enforceCacheQuota no-ops when IndexedDB is a stub", async () => {
        CacheManager._config = { maxCacheBytes: 1000 };
        const origDb = IndexedDB._db;
        IndexedDB._db = { _isStub: true };
        await expect(CacheManager._enforceCacheQuota()).resolves.toBeUndefined();
        IndexedDB._db = origDb;
    });
});
