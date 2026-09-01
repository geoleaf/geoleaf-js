/**
 */

// Tests for GeoLeaf.Config module
// vi.mock() calls are hoisted before any require() — intercept the direct imports
// used by config-core.ts (_initSubModules, _applyConfig) which bypass global.GeoLeaf.*
vi.mock("../../src/kernel/config/storage.js", () => ({
    ConfigStore: {
        init: vi.fn(),
        deepMerge: vi.fn((a, b) => Object.assign({}, a, b)),
        getAll: vi.fn().mockReturnValue({}),
        get: vi.fn(),
        set: vi.fn(),
        getSection: vi.fn(),
    },
}));
vi.mock("../../src/kernel/config/profile.js", () => ({
    ProfileManager: {
        init: vi.fn(),
        loadActiveProfileResources: vi.fn().mockResolvedValue({}),
        getActiveProfileId: vi.fn().mockReturnValue(null),
        getActiveProfile: vi.fn().mockReturnValue(null),
        getActiveProfileMapping: vi.fn().mockReturnValue(null),
        isProfilePoiMappingEnabled: vi.fn().mockReturnValue(true),
    },
}));
vi.mock("../../src/kernel/config/normalization.js", () => ({
    ConfigNormalizer: {},
}));
// config-loaders.ts imports ConfigLoader from loader.js
vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: {
        loadUrl: vi.fn().mockResolvedValue({}),
    },
}));

describe("GeoLeaf.Config", () => {
    let Config;

    beforeEach(async () => {
        global.fetch = vi.fn();

        // Only Log needs to be pre-set — modules call globalThis.GeoLeaf.Log.*
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                setLevel: vi.fn(),
            },
        };

        // Clear module cache, then load the wired Config helper
        // (replaces the former geoleaf.config.ts facade — removed in S2).
        // The helper is ESM but require() dragged it — and, transitively, the whole
        // built-in/config source subgraph — through Node's CJS loader, where coverage is
        // attributed to the wrong lines. It was the last consumer of the setup.js shims.
        vi.resetModules();
        await import("../_helpers/load-wired-config.js");
        Config = global.GeoLeaf.Config;

        // Bridge global.GeoLeaf.* to the same vi.mock'd instances that
        // config-core/accessors/loaders use internally (direct imports).
        // This makes expect(global.GeoLeaf._ConfigStorage.get).toHaveBeenCalled()
        // work because it checks the same vi.fn() that the module called.
        const mStorage = await import("../../src/kernel/config/storage.js");
        const mProfile = await import("../../src/kernel/config/profile.js");
        const mLoader = await import("../../src/kernel/config/loader.js");
        global.GeoLeaf._ConfigStorage = mStorage.ConfigStore;
        global.GeoLeaf._ConfigProfile = mProfile.ProfileManager;
        global.GeoLeaf._ConfigLoader = mLoader.ConfigLoader;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("init()", () => {
        it("should initialize with inline config", async () => {
            const cfg = { map: { center: [48, 2] } };

            await Config.init({ config: cfg });

            expect(Config.isLoaded()).toBe(true);
            expect(Config.getSource()).toBe("inline");
        });

        it("should call onLoaded callback with inline config", async () => {
            const onLoaded = vi.fn();

            await Config.init({ config: {}, onLoaded });

            expect(onLoaded).toHaveBeenCalled();
        });

        it("should load config from URL", async () => {
            const mockConfig = { map: { zoom: 10 } };
            global.GeoLeaf._ConfigLoader.loadUrl.mockResolvedValue(mockConfig);

            await Config.init({ url: "/config.json" });

            expect(global.GeoLeaf._ConfigLoader.loadUrl).toHaveBeenCalledWith(
                "/config.json",
                expect.any(Object)
            );
        });

        it("should set profileId in config", async () => {
            await Config.init({ config: {}, profileId: "tourism" });

            expect(Config._config.data.activeProfile).toBe("tourism");
        });

        it("should initialize with empty config if no options", async () => {
            await Config.init({});

            expect(Config.isLoaded()).toBe(true);
        });

        it("should propagate an error raised during URL loading", async () => {
            global.GeoLeaf._ConfigLoader.loadUrl.mockRejectedValue(new Error("Load failed"));

            // 🔻 AMENDED on 19/08/2026 — `Config.loadUrl` no longer catches:
            // the failure climbs to the caller, who can finally attribute it.
            await expect(Config.init({ url: "/bad.json" })).rejects.toThrow("Load failed");

            expect(global.GeoLeaf.Log.error).toHaveBeenCalled();
        });

        it("should handle onLoaded error gracefully", async () => {
            const onLoaded = vi.fn(() => {
                throw new Error("Callback error");
            });

            await Config.init({ config: {}, onLoaded });

            expect(global.GeoLeaf.Log.error).toHaveBeenCalled();
        });
    });

    describe("loadUrl()", () => {
        it("should load and merge config from URL", async () => {
            const mockCfg = { ui: { theme: "dark" } };
            global.GeoLeaf._ConfigLoader.loadUrl.mockResolvedValue(mockCfg);

            await Config.loadUrl("/config.json");

            expect(global.GeoLeaf._ConfigStorage.deepMerge).toHaveBeenCalled();
        });

        it("should validate loaded config", async () => {
            global.GeoLeaf._ConfigLoader.loadUrl.mockResolvedValue({});

            await Config.loadUrl("/config.json");

            expect(Config.isLoaded()).toBe(true);
        });

        // 🔻 AMENDED on 19/08/2026 — returning the in-place configuration on
        // a failure was precisely what made a SUCCESS be read where nothing
        // had been loaded.
        it("should reject rather than hand back the configuration already in place", async () => {
            global.GeoLeaf._ConfigLoader.loadUrl.mockRejectedValue(new Error("fail"));
            Config._config = { existing: true };

            await expect(Config.loadUrl("/bad.json")).rejects.toThrow("fail");

            // What was in place is not destroyed — it is simply no longer
            // returned as though it had just been loaded.
            expect(Config._config.existing).toBe(true);
        });

        it("should log error when loader fails", async () => {
            global.GeoLeaf._ConfigLoader.loadUrl.mockRejectedValue(new Error("Network error"));

            // 🔻 AMENDED on 19/08/2026 — the promise rejects; the cause stays logged.
            await Config.loadUrl("/config.json").catch(() => undefined);

            expect(global.GeoLeaf.Log.error).toHaveBeenCalled();
        });
    });

    describe("get()", () => {
        it("should delegate to Storage.get", () => {
            global.GeoLeaf._ConfigStorage.get.mockReturnValue("value");

            Config.get("map.zoom");

            expect(global.GeoLeaf._ConfigStorage.get).toHaveBeenCalledWith("map.zoom", undefined);
        });

        it("should return default value if path not found", () => {
            global.GeoLeaf._ConfigStorage.get.mockReturnValue("default");

            const result = Config.get("missing", "default");

            expect(result).toBe("default");
        });
    });

    describe("set()", () => {
        it("should delegate to Storage.set", () => {
            Config.set("map.zoom", 15);

            expect(global.GeoLeaf._ConfigStorage.set).toHaveBeenCalledWith("map.zoom", 15);
        });

        it("should warn if Storage not available", () => {
            // Remove 'set' to simulate the storage-unavailable code path
            global.GeoLeaf._ConfigStorage.set = undefined;

            Config.set("key", "value");

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });
    });

    describe("getAll()", () => {
        it("should delegate to Storage.getAll", () => {
            const mockConfig = { data: "test" };
            global.GeoLeaf._ConfigStorage.getAll.mockReturnValue(mockConfig);

            const result = Config.getAll();

            expect(result).toBe(mockConfig);
        });
    });

    describe("getSection()", () => {
        it("should delegate to Storage.getSection", () => {
            global.GeoLeaf._ConfigStorage.getSection.mockReturnValue({ center: [48, 2] });

            Config.getSection("map");

            expect(global.GeoLeaf._ConfigStorage.getSection).toHaveBeenCalledWith("map", undefined);
        });
    });

    describe("loadActiveProfileResources()", () => {
        it("should delegate to Profile.loadActiveProfileResources", async () => {
            await Config.loadActiveProfileResources();

            expect(global.GeoLeaf._ConfigProfile.loadActiveProfileResources).toHaveBeenCalled();
        });

        it("should reject if Profile module not available", async () => {
            global.GeoLeaf._ConfigProfile.loadActiveProfileResources.mockRejectedValue(
                new Error("Profile error")
            );

            await expect(Config.loadActiveProfileResources()).rejects.toThrow();
        });
    });

    describe("Profile API delegations", () => {
        it("getActiveProfileId should delegate", () => {
            global.GeoLeaf._ConfigProfile.getActiveProfileId.mockReturnValue("tourism");
            expect(Config.getActiveProfileId()).toBe("tourism");
        });

        it("getActiveProfile should delegate", () => {
            const profile = { name: "Test" };
            global.GeoLeaf._ConfigProfile.getActiveProfile.mockReturnValue(profile);
            expect(Config.getActiveProfile()).toBe(profile);
        });

        it("getActiveProfileMapping should delegate", () => {
            const mapping = { mapping: {} };
            global.GeoLeaf._ConfigProfile.getActiveProfileMapping.mockReturnValue(mapping);
            expect(Config.getActiveProfileMapping()).toBe(mapping);
        });

        it("isProfilePoiMappingEnabled should delegate", () => {
            global.GeoLeaf._ConfigProfile.isProfilePoiMappingEnabled.mockReturnValue(false);
            expect(Config.isProfilePoiMappingEnabled()).toBe(false);
        });
    });

    describe("isLoaded()", () => {
        it("should return false initially", () => {
            expect(Config.isLoaded()).toBe(false);
        });

        it("should return true after init", async () => {
            await Config.init({ config: {} });
            expect(Config.isLoaded()).toBe(true);
        });
    });

    describe("getSource()", () => {
        it("should return null initially", () => {
            expect(Config.getSource()).toBe(null);
        });

        it('should return "inline" for inline config', async () => {
            await Config.init({ config: {} });
            expect(Config.getSource()).toBe("inline");
        });
    });
});
