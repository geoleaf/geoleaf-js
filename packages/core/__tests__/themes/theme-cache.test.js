/**
 * Tests for themes/theme-cache.ts
 * Sprint S5B.4 — migrated to ESM static imports for Istanbul coverage instrumentation.
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

import { ThemeCache } from "../../src/kernel/themes/theme-cache.ts";

describe("themes/theme-cache", () => {
    let StorageDB;

    beforeEach(() => {
        vi.clearAllMocks();
        StorageDB = {
            getLayer: vi.fn(),
            cacheLayer: vi.fn(() => Promise.resolve()),
            removeLayer: vi.fn(() => Promise.resolve()),
        };
        globalThis.GeoLeaf = {
            Storage: {
                DB: StorageDB,
            },
        };
        ThemeCache._config.enabled = true;
    });

    describe("get", () => {
        it("returns null when cache is disabled", async () => {
            ThemeCache._config.enabled = false;
            const out = await ThemeCache.get("layer-1", "p1");
            expect(out).toBeNull();
            expect(StorageDB.getLayer).not.toHaveBeenCalled();
        });

        it("returns null when StorageDB is missing", async () => {
            delete globalThis.GeoLeaf.Storage.DB;
            const out = await ThemeCache.get("layer-1", "p1");
            expect(out).toBeNull();
        });

        it("returns null when nothing cached", async () => {
            StorageDB.getLayer.mockResolvedValueOnce(null);
            const out = await ThemeCache.get("no-cache", "p1");
            expect(out).toBeNull();
            expect(StorageDB.getLayer).toHaveBeenCalledWith("no-cache");
        });

        it("returns null when profileId does not match", async () => {
            StorageDB.getLayer.mockResolvedValueOnce({
                profileId: "other",
                timestamp: Date.now(),
                data: { foo: 1 },
            });
            const out = await ThemeCache.get("layer-1", "p1");
            expect(out).toBeNull();
        });

        it("returns null when cache is expired", async () => {
            StorageDB.getLayer.mockResolvedValueOnce({
                profileId: "p1",
                timestamp: Date.now() - ThemeCache._config.maxAge - 1000,
                data: { foo: 1 },
            });
            const out = await ThemeCache.get("layer-1", "p1");
            expect(out).toBeNull();
        });

        it("returns data when profile matches and age is valid", async () => {
            const cached = {
                profileId: "p1",
                timestamp: Date.now(),
                data: { foo: 42 },
            };
            StorageDB.getLayer.mockResolvedValueOnce(cached);
            const out = await ThemeCache.get("layer-ok", "p1");
            expect(out).toEqual({ foo: 42 });
        });

        it("returns null and logs warn on error", async () => {
            StorageDB.getLayer.mockRejectedValueOnce(new Error("boom"));
            const out = await ThemeCache.get("err", "p1");
            expect(out).toBeNull();
        });
    });

    describe("store", () => {
        it("does nothing when cache disabled", async () => {
            ThemeCache._config.enabled = false;
            await ThemeCache.store("layer-1", "p1", { foo: 1 });
            expect(StorageDB.cacheLayer).not.toHaveBeenCalled();
        });

        it("does nothing when StorageDB missing", async () => {
            delete globalThis.GeoLeaf.Storage.DB;
            await ThemeCache.store("layer-1", "p1", { foo: 1 });
        });

        it("stores layer with profile and metadata", async () => {
            await ThemeCache.store("layer-1", "p1", { foo: 1 }, { tag: "t" });
            expect(StorageDB.cacheLayer).toHaveBeenCalledWith("layer-1", { foo: 1 }, "p1", {
                tag: "t",
            });
        });

        it("stores layer with null profileId (uses null fallback)", async () => {
            await ThemeCache.store("layer-null-profile", null, { bar: 2 });
            expect(StorageDB.cacheLayer).toHaveBeenCalledWith(
                "layer-null-profile",
                { bar: 2 },
                null,
                {}
            );
        });

        it("handles errors from cacheLayer", async () => {
            StorageDB.cacheLayer.mockRejectedValueOnce(new Error("fail"));
            await ThemeCache.store("layer-err", "p1", { foo: 1 });
        });
    });

    describe("invalidate", () => {
        it("does nothing when StorageDB missing", async () => {
            delete globalThis.GeoLeaf.Storage.DB;
            await ThemeCache.invalidate("layer-1");
        });

        it("removes cached layer", async () => {
            await ThemeCache.invalidate("layer-1");
            expect(StorageDB.removeLayer).toHaveBeenCalledWith("layer-1");
        });

        it("swallows errors when removeLayer throws", async () => {
            StorageDB.removeLayer.mockRejectedValueOnce(new Error("oops"));
            await ThemeCache.invalidate("layer-err");
        });
    });
});
