/**
 */
let StorageContract;

/** Resolves `true` if `p` settles within `ms`, `false` if still pending (real-timer probe). */
function settledWithin(p, ms = 10) {
    return Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
}

describe("shared/storage-contract", () => {
    beforeAll(async () => {
        const mod = await import("../../src/kernel/shared/storage-contract.ts");
        StorageContract = mod.StorageContract;
    });

    beforeEach(() => {
        StorageContract.init(null);
    });

    describe("init", () => {
        it("accepts null to clear ref", () => {
            StorageContract.init({ isAvailable: () => true, DB: {} });
            expect(StorageContract.isPluginLoaded()).toBe(true);
            StorageContract.init(null);
            expect(StorageContract.isPluginLoaded()).toBe(false);
        });

        it("accepts storage module", () => {
            const mod = { isAvailable: () => true, DB: {} };
            StorageContract.init(mod);
            expect(StorageContract.isAvailable()).toBe(true);
            expect(StorageContract.DB).toBe(mod.DB);
        });
    });

    describe("isAvailable", () => {
        it("returns false when not initialized", () => {
            StorageContract.init(null);
            expect(StorageContract.isAvailable()).toBe(false);
        });

        it("returns true when module has isAvailable and it returns true", () => {
            StorageContract.init({ isAvailable: () => true });
            expect(StorageContract.isAvailable()).toBe(true);
        });

        it("returns true when module has DB and no isAvailable", () => {
            StorageContract.init({ DB: {} });
            expect(StorageContract.isAvailable()).toBe(true);
        });
    });

    describe("isPluginLoaded", () => {
        it("returns false when ref null", () => {
            StorageContract.init(null);
            expect(StorageContract.isPluginLoaded()).toBe(false);
        });
    });

    describe("get DB / CacheManager / Cache", () => {
        it("returns null when not initialized", () => {
            StorageContract.init(null);
            expect(StorageContract.DB).toBeNull();
            expect(StorageContract.CacheManager).toBeNull();
            expect(StorageContract.Cache).toBeNull();
        });

        it("returns ref when initialized", () => {
            const db = {};
            const cm = {};
            const cache = {};
            StorageContract.init({ DB: db, CacheManager: cm, Cache: cache });
            expect(StorageContract.DB).toBe(db);
            expect(StorageContract.CacheManager).toBe(cm);
            expect(StorageContract.Cache).toBe(cache);
        });
    });

    // ⚠️ THE `downloadProfileForOffline` BLOCK WAS REMOVED: the delegation
    // no longer exists, because the method it delegated was dead — zero
    // callers in the whole repo. The behaviour that mattered, the quota
    // pre-check, was MOVED into `CacheManager.cacheProfile()` before the
    // deletion, and its tests with it
    // (`__tests__/capabilities/offline/cache-manager-orchestration.test.js`).

    describe("whenReady / _markReady / _resetReady (B5)", () => {
        beforeEach(() => {
            // Re-arm the module-level deferred so each spec starts pending.
            StorageContract._resetReady();
        });

        it("stays pending until _markReady is called", async () => {
            expect(await settledWithin(StorageContract.whenReady())).toBe(false);
            StorageContract._markReady();
            expect(await settledWithin(StorageContract.whenReady())).toBe(true);
        });

        it("returns the same deferred across calls", () => {
            expect(StorageContract.whenReady()).toBe(StorageContract.whenReady());
        });

        it("_markReady is idempotent (a second call is a no-op)", async () => {
            StorageContract._markReady();
            StorageContract._markReady();
            expect(await settledWithin(StorageContract.whenReady())).toBe(true);
        });

        it("_resetReady re-arms a fresh pending promise", async () => {
            StorageContract._markReady();
            expect(await settledWithin(StorageContract.whenReady())).toBe(true);
            StorageContract._resetReady();
            expect(await settledWithin(StorageContract.whenReady())).toBe(false);
        });
    });
});
