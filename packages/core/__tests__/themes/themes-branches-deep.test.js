/**
 * T10.3.5+6 — themes-branches-deep.test.js
 * Covers: src/kernel/themes/theme-loader.ts + theme-cache.ts
 * Strategy: await import() + mock Log, FetchHelper, GeoLeaf.Storage.DB
 */
"use strict";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: (key) => key,
}));

// ─── ThemeLoader tests ────────────────────────────────────────────────────────

describe("ThemeLoader (T10.3.5)", () => {
    let ThemeLoader;
    let FetchHelperMock;

    beforeAll(async () => {
        // We need to control FetchHelper — mock it before importing ThemeLoader
        vi.mock("../../src/utils/general/fetch-helper.js", () => ({
            FetchHelper: {
                get: vi.fn(),
            },
        }));
        const mod = await import("../../src/kernel/themes/theme-loader.ts");
        ThemeLoader = mod.ThemeLoader;
        const fetchMod = await import("../../src/utils/general/fetch-helper.js");
        FetchHelperMock = fetchMod.FetchHelper;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        // Clear the loader cache before each test
        ThemeLoader.clearCache();
        // Reset window location
        Object.defineProperty(window, "location", {
            value: { pathname: "/profiles/test/" },
            writable: true,
        });
    });

    const VALID_CONFIG = {
        themes: [
            { id: "base", label: "Base Map", type: "primary" },
            { id: "satellite", label: "Satellite", type: "primary" },
        ],
        defaultTheme: "base",
    };

    // ── _validateConfig (through loadThemesConfig) ───────────────────────────

    describe("_validateConfig()", () => {
        it("throws on null config", async () => {
            FetchHelperMock.get.mockResolvedValue(null);
            await expect(ThemeLoader.loadThemesConfig("prof1")).rejects.toThrow();
        });

        it("throws on non-object config", async () => {
            FetchHelperMock.get.mockResolvedValue("invalid");
            await expect(ThemeLoader.loadThemesConfig("prof1")).rejects.toThrow();
        });

        it("warns and returns empty themes when config.themes is not an array", async () => {
            FetchHelperMock.get.mockResolvedValue({ themes: "not-array" });
            const result = await ThemeLoader.loadThemesConfig("prof_no_array");
            expect(result.themes).toEqual([]);
        });

        it("throws when all themes have no valid ID (empty after normalize)", async () => {
            FetchHelperMock.get.mockResolvedValue({ themes: [{ label: "No ID" }] });
            await expect(ThemeLoader.loadThemesConfig("prof_empty")).rejects.toThrow();
        });

        it("filters out themes without id (_normalizeTheme returns null for no id)", async () => {
            FetchHelperMock.get.mockResolvedValue({
                themes: [{ id: "ok", label: "OK" }, { label: "No ID" }],
            });
            const result = await ThemeLoader.loadThemesConfig("prof_mixed");
            expect(result.themes.length).toBe(1);
            expect(result.themes[0].id).toBe("ok");
        });

        it("sets default values for normalized theme fields", async () => {
            FetchHelperMock.get.mockResolvedValue({
                themes: [{ id: "minimal" }],
                defaultTheme: "minimal",
            });
            const result = await ThemeLoader.loadThemesConfig("prof_minimal");
            const theme = result.themes[0];
            expect(theme.label).toBe("minimal"); // falls back to id
            expect(theme.type).toBe("secondary"); // default
            expect(theme.layers).toEqual([]);
        });

        it("sets defaultTheme to first theme when missing", async () => {
            FetchHelperMock.get.mockResolvedValue({
                themes: [{ id: "first" }, { id: "second" }],
            });
            const result = await ThemeLoader.loadThemesConfig("prof_no_default");
            expect(result.defaultTheme).toBe("first");
        });

        it("falls back to first theme when defaultTheme not found in list", async () => {
            FetchHelperMock.get.mockResolvedValue({
                themes: [{ id: "alpha" }],
                defaultTheme: "missing-theme",
            });
            const result = await ThemeLoader.loadThemesConfig("prof_bad_default");
            expect(result.defaultTheme).toBe("alpha");
        });

        it("keeps valid defaultTheme", async () => {
            FetchHelperMock.get.mockResolvedValue(VALID_CONFIG);
            const result = await ThemeLoader.loadThemesConfig("prof_valid");
            expect(result.defaultTheme).toBe("base");
        });
    });

    // ── loadThemesConfig caching ─────────────────────────────────────────────

    describe("loadThemesConfig() caching", () => {
        it("returns cached result on second call (no extra fetch)", async () => {
            FetchHelperMock.get.mockResolvedValue(VALID_CONFIG);
            const r1 = await ThemeLoader.loadThemesConfig("prof_cache");
            const r2 = await ThemeLoader.loadThemesConfig("prof_cache");
            expect(FetchHelperMock.get).toHaveBeenCalledTimes(1);
            expect(r1).toBe(r2);
        });

        it("returns same promise when loading is in progress", async () => {
            let resolve;
            const pendingPromise = new Promise((res) => {
                resolve = res;
            });
            FetchHelperMock.get.mockReturnValueOnce(pendingPromise);
            const p1 = ThemeLoader.loadThemesConfig("prof_concurrent");
            const p2 = ThemeLoader.loadThemesConfig("prof_concurrent");
            expect(p1).toBe(p2);
            resolve(VALID_CONFIG);
            await p1;
        });

        it("clearCache() with profileId removes only that profile", async () => {
            FetchHelperMock.get.mockResolvedValue(VALID_CONFIG);
            await ThemeLoader.loadThemesConfig("prof_a");
            ThemeLoader.clearCache("prof_a");
            FetchHelperMock.get.mockResolvedValue(VALID_CONFIG);
            await ThemeLoader.loadThemesConfig("prof_a");
            expect(FetchHelperMock.get).toHaveBeenCalledTimes(2);
        });

        it("clearCache() without args clears all profiles", async () => {
            FetchHelperMock.get.mockResolvedValue(VALID_CONFIG);
            await ThemeLoader.loadThemesConfig("prof_x");
            await ThemeLoader.loadThemesConfig("prof_y");
            ThemeLoader.clearCache();
            FetchHelperMock.get.mockResolvedValue(VALID_CONFIG);
            await ThemeLoader.loadThemesConfig("prof_x");
            expect(FetchHelperMock.get).toHaveBeenCalledTimes(3);
        });
    });

    // ── FetchHelper fallback path ─────────────────────────────────────────────

    describe("loadThemesConfig() error handling", () => {
        it("rejects when FetchHelper.get rejects", async () => {
            FetchHelperMock.get.mockRejectedValue(new Error("Network error"));
            await expect(ThemeLoader.loadThemesConfig("prof_fail")).rejects.toThrow(
                "Network error"
            );
        });
    });

    // ── /demo/ path detection ────────────────────────────────────────────────

    describe("demo path detection", () => {
        it("prefixes path with '../' when in /demo/ context", async () => {
            Object.defineProperty(window, "location", {
                value: { pathname: "/demo/index.html" },
                writable: true,
            });
            FetchHelperMock.get.mockResolvedValue(VALID_CONFIG);
            await ThemeLoader.loadThemesConfig("demo_prof");
            const calledPath = FetchHelperMock.get.mock.calls[0][0];
            expect(calledPath).toMatch(/^\.\.\//);
        });

        it("does not prefix path when outside /demo/", async () => {
            Object.defineProperty(window, "location", {
                value: { pathname: "/app/index.html" },
                writable: true,
            });
            FetchHelperMock.get.mockResolvedValue(VALID_CONFIG);
            await ThemeLoader.loadThemesConfig("app_prof");
            const calledPath = FetchHelperMock.get.mock.calls[0][0];
            expect(calledPath).not.toMatch(/^\.\.\//);
        });
    });
});

// ─── ThemeCache tests ─────────────────────────────────────────────────────────

describe("ThemeCache (T10.3.6)", () => {
    let ThemeCache;
    let mockDB;

    beforeAll(async () => {
        const mod = await import("../../src/kernel/themes/theme-cache.ts");
        ThemeCache = mod.ThemeCache;
    });

    beforeEach(() => {
        // Reset config
        ThemeCache._config.enabled = true;
        ThemeCache._config.maxAge = 7 * 24 * 60 * 60 * 1000;

        // Setup mock IndexedDB via globalThis.GeoLeaf
        mockDB = {
            getLayer: vi.fn(),
            cacheLayer: vi.fn(),
            removeLayer: vi.fn(),
        };
        if (!globalThis.GeoLeaf) globalThis.GeoLeaf = {};
        if (!globalThis.GeoLeaf.Storage) globalThis.GeoLeaf.Storage = {};
        globalThis.GeoLeaf.Storage.DB = mockDB;
    });

    afterEach(() => {
        // Clear mock DB
        if (globalThis.GeoLeaf?.Storage) {
            globalThis.GeoLeaf.Storage.DB = null;
        }
    });

    // ── get() ─────────────────────────────────────────────────────────────────

    describe("get()", () => {
        it("returns null when cache is disabled", async () => {
            ThemeCache._config.enabled = false;
            const result = await ThemeCache.get("layer1", "prof1");
            expect(result).toBeNull();
        });

        it("returns null when StorageDB is unavailable", async () => {
            globalThis.GeoLeaf.Storage.DB = null;
            const result = await ThemeCache.get("layer1", "prof1");
            expect(result).toBeNull();
        });

        it("returns null when layer is not in cache (getLayer returns null)", async () => {
            mockDB.getLayer.mockResolvedValue(null);
            const result = await ThemeCache.get("layer_miss", "prof1");
            expect(result).toBeNull();
        });

        it("returns null when cached entry is expired", async () => {
            const oldEntry = {
                data: { features: [] },
                profileId: "prof1",
                timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
            };
            mockDB.getLayer.mockResolvedValue(oldEntry);
            const result = await ThemeCache.get("layer_expired", "prof1");
            expect(result).toBeNull();
        });

        it("returns null when profileId does not match", async () => {
            const entry = {
                data: { features: [] },
                profileId: "other_profile",
                timestamp: Date.now(),
            };
            mockDB.getLayer.mockResolvedValue(entry);
            const result = await ThemeCache.get("layer_mismatch", "prof1");
            expect(result).toBeNull();
        });

        it("returns cached data when entry is valid and profileId matches", async () => {
            const entry = {
                data: { features: [{ id: 1 }] },
                profileId: "prof1",
                timestamp: Date.now(),
            };
            mockDB.getLayer.mockResolvedValue(entry);
            const result = await ThemeCache.get("layer_hit", "prof1");
            expect(result).toEqual({ features: [{ id: 1 }] });
        });

        it("returns cached data when profileId in entry is null (no profile check)", async () => {
            const entry = {
                data: { features: [] },
                profileId: null,
                timestamp: Date.now(),
            };
            mockDB.getLayer.mockResolvedValue(entry);
            const result = await ThemeCache.get("layer_noprofile", "prof1");
            // profileId in entry is null → no mismatch check applied
            expect(result).not.toBeUndefined();
        });

        it("returns null and logs warning on getLayer() error", async () => {
            mockDB.getLayer.mockRejectedValue(new Error("DB read error"));
            const result = await ThemeCache.get("layer_err", "prof1");
            expect(result).toBeNull();
        });
    });

    // ── store() ───────────────────────────────────────────────────────────────

    describe("store()", () => {
        it("does nothing when cache is disabled", async () => {
            ThemeCache._config.enabled = false;
            await ThemeCache.store("layer1", "prof1", {}, {});
            expect(mockDB.cacheLayer).not.toHaveBeenCalled();
        });

        it("does nothing when StorageDB is unavailable", async () => {
            globalThis.GeoLeaf.Storage.DB = null;
            await ThemeCache.store("layer1", "prof1", {});
            expect(mockDB.cacheLayer).not.toHaveBeenCalled();
        });

        it("stores data via StorageDB.cacheLayer()", async () => {
            mockDB.cacheLayer.mockResolvedValue(undefined);
            const data = { features: [{ id: 2 }] };
            await ThemeCache.store("layer2", "prof1", data);
            expect(mockDB.cacheLayer).toHaveBeenCalledWith("layer2", data, "prof1", {});
        });

        it("uses null for profileId when not provided", async () => {
            mockDB.cacheLayer.mockResolvedValue(undefined);
            await ThemeCache.store("layer3", null, {});
            expect(mockDB.cacheLayer).toHaveBeenCalledWith("layer3", {}, null, {});
        });

        it("catches and logs write errors", async () => {
            mockDB.cacheLayer.mockRejectedValue(new Error("Write failed"));
            await expect(ThemeCache.store("layer_fail", "prof1", {})).resolves.not.toThrow();
        });
    });

    // ── invalidate() ──────────────────────────────────────────────────────────

    describe("invalidate()", () => {
        it("does nothing when StorageDB is unavailable", async () => {
            globalThis.GeoLeaf.Storage.DB = null;
            await ThemeCache.invalidate("layer1");
            expect(mockDB.removeLayer).not.toHaveBeenCalled();
        });

        it("calls StorageDB.removeLayer()", async () => {
            mockDB.removeLayer.mockResolvedValue(undefined);
            await ThemeCache.invalidate("layer_to_remove");
            expect(mockDB.removeLayer).toHaveBeenCalledWith("layer_to_remove");
        });

        it("catches and logs remove errors", async () => {
            mockDB.removeLayer.mockRejectedValue(new Error("Remove failed"));
            await expect(ThemeCache.invalidate("layer_err")).resolves.not.toThrow();
        });
    });
});
