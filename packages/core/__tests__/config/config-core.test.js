/**
 * Tests pour config/geoleaf-config/config-core.js
 * Phase 9-C3 : tests de config-core (idempotence _initSubModules, _applyConfig, init)
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        setLevel: vi.fn(),
    },
}));

vi.mock("../../src/kernel/config/storage.js", () => ({
    ConfigStore: {
        init: vi.fn(),
        deepMerge: vi.fn((a, b) => Object.assign({}, a, b)),
        get: vi.fn(),
        set: vi.fn(),
    },
}));

vi.mock("../../src/kernel/config/profile.js", () => ({
    ProfileManager: { init: vi.fn() },
}));

vi.mock("../../src/kernel/config/normalization.js", () => ({
    ConfigNormalizer: {},
}));

import * as storageMod from "../../src/kernel/config/storage.js";
import * as profileMod from "../../src/kernel/config/profile.js";
import { Config } from "../../src/kernel/config/geoleaf-config/config-core.js";
// config-validation.js augments Config with _validateConfig (required by
// _applyConfig). Loaded for its effect, as before — relative order is
// guaranteed by its position here.
import "../../src/kernel/config/geoleaf-config/config-validation.js";
import * as logMod from "../../src/utils/log/index.js";

describe("Config (config-core.js)", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // deepMerge: simple merge for tests
        storageMod.ConfigStore.deepMerge.mockImplementation((a, b) => Object.assign({}, a, b));

        // Reinitialiser l'etat internal between chaque test
        Config._config = {};
        Config._isLoaded = false;
        Config._subModulesInitialized = false;
        Config._source = null;
        Config._options = { autoEvent: false }; // desactiver les events DOM
    });

    //  _initSubModules()  B1 idempotence guard

    describe("_initSubModules()  B1 idempotence guard", () => {
        test("should call Storage.init and Profile.init on first call", () => {
            Config._initSubModules();

            expect(storageMod.ConfigStore.init).toHaveBeenCalledTimes(1);
            expect(profileMod.ProfileManager.init).toHaveBeenCalledTimes(1);
        });

        test("should set _subModulesInitialized to true after first call", () => {
            expect(Config._subModulesInitialized).toBe(false);
            Config._initSubModules();
            expect(Config._subModulesInitialized).toBe(true);
        });

        test("should NOT call sub-modules again on second call (idempotence)", () => {
            Config._initSubModules();
            Config._initSubModules();
            Config._initSubModules();

            // Each must be called exactly once
            expect(storageMod.ConfigStore.init).toHaveBeenCalledTimes(1);
            expect(profileMod.ProfileManager.init).toHaveBeenCalledTimes(1);
        });

        test("should call sub-modules again after flag reset", () => {
            Config._initSubModules();
            Config._subModulesInitialized = false; // reset manuellement
            Config._initSubModules();

            expect(storageMod.ConfigStore.init).toHaveBeenCalledTimes(2);
        });
    });

    //  _applyConfig()

    describe("_applyConfig()", () => {
        test("should set _isLoaded to true", () => {
            expect(Config._isLoaded).toBe(false);
            Config._applyConfig({}, "inline");
            expect(Config._isLoaded).toBe(true);
        });

        test("should set _source from parameter", () => {
            Config._applyConfig({}, "url");
            expect(Config._source).toBe("url");
        });

        test("should reset _subModulesInitialized and call _initSubModules()", () => {
            // Simulate a previous init
            Config._subModulesInitialized = true;

            Config._applyConfig({ key: "value" }, "inline");

            // The flag must be reset then set back to true by _initSubModules
            expect(Config._subModulesInitialized).toBe(true);
            expect(storageMod.ConfigStore.init).toHaveBeenCalledTimes(1);
        });

        test("should call _initSubModules each time _applyConfig is called", () => {
            Config._applyConfig({}, "inline");
            Config._applyConfig({}, "reload");

            // 2 _applyConfig calls -> 2 inits (the flag is reset each time)
            expect(storageMod.ConfigStore.init).toHaveBeenCalledTimes(2);
        });

        test("should deep-merge config via ConfigStore.deepMerge", () => {
            Config._config = { existing: "value" };
            Config._applyConfig({ newKey: "newValue" }, "inline");

            expect(storageMod.ConfigStore.deepMerge).toHaveBeenCalledWith(
                expect.objectContaining({ existing: "value" }),
                expect.objectContaining({ newKey: "newValue" })
            );
        });

        test("should handle null config gracefully", () => {
            expect(() => Config._applyConfig(null, "inline")).not.toThrow();
            expect(Config._isLoaded).toBe(true);
        });

        test("should handle non-object config gracefully", () => {
            expect(() => Config._applyConfig("invalid", "inline")).not.toThrow();
            expect(Config._isLoaded).toBe(true);
        });
    });

    //  init()  inline config

    describe("init()  inline config", () => {
        test("should return a resolved Promise", async () => {
            const result = await Config.init({ config: { key: "val" } });
            expect(result).toBeDefined();
        });

        test("should mark config as loaded after init with inline config", async () => {
            await Config.init({ config: { key: 42 } });
            expect(Config.isLoaded()).toBe(true);
        });

        test('should set source to "inline"', async () => {
            await Config.init({ config: {} });
            expect(Config.getSource()).toBe("inline");
        });

        test("should call onLoaded callback if provided", async () => {
            const onLoaded = vi.fn();
            await Config.init({ config: { x: 1 }, onLoaded });
            expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ x: 1 }));
        });

        test("should apply empty config when no parameters", async () => {
            await Config.init();
            expect(Config.isLoaded()).toBe(true);
        });

        test("init with profileId only (no config) sets activeProfile and calls onLoaded", async () => {
            const onLoaded = vi.fn();
            await Config.init({ profileId: "profile1", onLoaded });
            expect(Config._config.data.activeProfile).toBe("profile1");
            expect(onLoaded).toHaveBeenCalledWith(Config._config);
        });

        test("init with onLoaded that throws logs error and still resolves", async () => {
            const onLoaded = vi.fn().mockImplementation(() => {
                throw new Error("onLoaded error");
            });
            await Config.init({ config: {}, onLoaded });
            expect(Config.isLoaded()).toBe(true);
        });
    });

    describe("init() with url (Phase 6 — coverage)", () => {
        test("init with url calls loadUrl and returns config", async () => {
            const cfg = { data: {} };
            Config.loadUrl = vi.fn().mockResolvedValue(cfg);
            const result = await Config.init({ url: "https://example.com/config.json" });
            expect(Config.loadUrl).toHaveBeenCalledWith(
                "https://example.com/config.json",
                expect.objectContaining({ strictContentType: true })
            );
            expect(result).toEqual(cfg);
        });

        test("init with url and profileId sets activeProfile after load", async () => {
            const cfg = { data: {} };
            Config.loadUrl = vi.fn().mockResolvedValue(cfg);
            Config._config = { data: {} }; // so this._config.data exists in .then
            await Config.init({ url: "https://example.com/c.json", profileId: "p1" });
            expect(cfg.data.activeProfile).toBe("p1");
        });

        test("init with url and onLoaded calls onLoaded with config", async () => {
            const cfg = {};
            Config.loadUrl = vi.fn().mockResolvedValue(cfg);
            const onLoaded = vi.fn();
            await Config.init({ url: "https://example.com/c.json", onLoaded });
            expect(onLoaded).toHaveBeenCalledWith(cfg);
        });

        test("init with url when loadUrl rejects calls onError and rethrows", async () => {
            const err = new Error("fetch failed");
            Config.loadUrl = vi.fn().mockRejectedValue(err);
            const onError = vi.fn();
            await expect(
                Config.init({ url: "https://example.com/c.json", onError })
            ).rejects.toThrow("fetch failed");
            expect(onError).toHaveBeenCalledWith(err);
        });
    });

    //  isLoaded() / getSource()

    describe("isLoaded() and getSource()", () => {
        test("isLoaded() should return false before init", () => {
            expect(Config.isLoaded()).toBe(false);
        });

        test("isLoaded() should return true after init", async () => {
            await Config.init({ config: {} });
            expect(Config.isLoaded()).toBe(true);
        });

        test("getSource() should return null before init", () => {
            expect(Config.getSource()).toBeNull();
        });

        test('getSource() should return "inline" after inline init', async () => {
            await Config.init({ config: {} });
            expect(Config.getSource()).toBe("inline");
        });
    });

    //  _maybeFireLoadedEvent()

    describe("_maybeFireLoadedEvent()", () => {
        test("should dispatch geoleaf:config:loaded event when autoEvent is true", () => {
            Config._options.autoEvent = true;
            Config._config = { test: "data" };
            Config._source = "inline";

            const dispatchSpy = vi.spyOn(document, "dispatchEvent");

            Config._maybeFireLoadedEvent();

            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: "geoleaf:config:loaded" })
            );

            dispatchSpy.mockRestore();
        });

        test("should NOT dispatch event when autoEvent is false", () => {
            Config._options.autoEvent = false;
            const dispatchSpy = vi.spyOn(document, "dispatchEvent");

            Config._maybeFireLoadedEvent();

            expect(dispatchSpy).not.toHaveBeenCalled();
            dispatchSpy.mockRestore();
        });
    });

    //  Module-level state

    describe("Module-level state", () => {
        test("_subModulesInitialized starts as false", () => {
            // After the reset in beforeEach
            expect(Config._subModulesInitialized).toBe(false);
        });

        test("_isLoaded starts as false", () => {
            expect(Config._isLoaded).toBe(false);
        });

        test("_source starts as null", () => {
            expect(Config._source).toBeNull();
        });
    });

    //  _resolveDebugFlag / _applyLoggingConfig branches

    describe("_applyConfig() — debug flag and logging level branches", () => {
        test("_applyConfig with debug:true calls Log.setLevel with 'debug'", () => {
            logMod.Log.setLevel.mockClear();
            Config._applyConfig({ debug: true }, "test");
            expect(logMod.Log.setLevel).toHaveBeenCalledWith("debug");
        });

        test("_applyConfig with logging.level calls Log.setLevel with that level", () => {
            logMod.Log.setLevel.mockClear();
            Config._applyConfig({ logging: { level: "warn" } }, "test");
            expect(logMod.Log.setLevel).toHaveBeenCalledWith("warn");
        });

        test("_applyConfig with mergedConfig.debug defined (no cfg.debug) uses mergedConfig branch", () => {
            logMod.Log.setLevel.mockClear();
            Config._config = { debug: true };
            // cfg has no debug key → falls through to mergedConfig check
            Config._applyConfig({ map: {} }, "test");
            expect(logMod.Log.setLevel).toHaveBeenCalledWith("debug");
        });

        test("_applyConfig with empty source defaults to 'inline'", () => {
            Config._applyConfig({}, "");
            expect(Config._source).toBe("inline");
        });
    });

    //  _applyConfig() — Object.assign fallback (no deepMerge)

    describe("_applyConfig() — Object.assign fallback when deepMerge is unavailable", () => {
        test("uses Object.assign when ConfigStore.deepMerge is undefined", () => {
            const origDeepMerge = storageMod.ConfigStore.deepMerge;
            storageMod.ConfigStore.deepMerge = undefined;
            Config._config = { a: 1 };
            Config._applyConfig({ b: 2 }, "test");
            expect(Config._config).toMatchObject({ a: 1, b: 2 });
            storageMod.ConfigStore.deepMerge = origDeepMerge;
        });
    });

    //  _initFromUrl() — onError throw branch

    describe("init() with url — onError callback that throws", () => {
        test("logs error when onError callback itself throws", async () => {
            const err = new Error("fetch failed");
            Config.loadUrl = vi.fn().mockRejectedValue(err);
            const onError = vi.fn().mockImplementation(() => {
                throw new Error("onError blew up");
            });
            logMod.Log.error.mockClear();
            await expect(
                Config.init({ url: "https://example.com/c.json", onError })
            ).rejects.toThrow("fetch failed");
            expect(logMod.Log.error).toHaveBeenCalledWith(
                expect.stringContaining("Error in onError"),
                expect.any(Error)
            );
        });
    });
});
