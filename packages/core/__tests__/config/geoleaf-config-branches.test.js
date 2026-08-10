/**
 * Branch coverage for geoleaf-config module — uses static imports so Istanbul
 * instruments the source files (require() bypasses Vite's transform pipeline).
 *
 * Targets: config-core.ts, config-accessors.ts, config-loaders.ts, config-validation.ts
 * Goal: ≥ 70% branches on src/kernel/config/geoleaf-config/
 */

// ─── vi.hoisted : mock vars available before static imports ──────────────────
const mocks = vi.hoisted(() => ({
    Log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        setLevel: vi.fn(),
    },
    ConfigStore: {
        init: vi.fn(),
        deepMerge: vi.fn((a, b) => ({ ...a, ...b })),
        get: vi.fn(),
        getAll: vi.fn().mockReturnValue({}),
        set: vi.fn(),
        getSection: vi.fn(),
    },
    ProfileManager: {
        init: vi.fn(),
        loadActiveProfileResources: vi.fn().mockResolvedValue({}),
        getActiveProfileId: vi.fn().mockReturnValue(null),
        getActiveProfile: vi.fn().mockReturnValue(null),
        getActiveProfileMapping: vi.fn().mockReturnValue(null),
        isProfilePoiMappingEnabled: vi.fn().mockReturnValue(true),
    },
    ConfigNormalizer: {},
    ConfigLoader: { loadUrl: vi.fn().mockResolvedValue({}) },
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log: mocks.Log }));
vi.mock("../../src/kernel/config/storage.js", () => ({
    ConfigStore: mocks.ConfigStore,
}));
vi.mock("../../src/kernel/config/profile.js", () => ({
    ProfileManager: mocks.ProfileManager,
}));
vi.mock("../../src/kernel/config/normalization.js", () => ({
    ConfigNormalizer: mocks.ConfigNormalizer,
}));
vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: mocks.ConfigLoader,
}));

// ─── Static imports → Istanbul instruments these files ───────────────────────
import { Config } from "../../src/kernel/config/geoleaf-config/config-core.js";
import "../../src/kernel/config/geoleaf-config/config-loaders.js";
import "../../src/kernel/config/geoleaf-config/config-accessors.js";
import "../../src/kernel/config/geoleaf-config/config-validation.js";

// ─── helpers ─────────────────────────────────────────────────────────────────
const resetConfig = () => {
    Config._config = {};
    Config._isLoaded = false;
    Config._subModulesInitialized = false;
    Config._source = null;
    Config._options = { autoEvent: false };
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.ConfigStore.deepMerge.mockImplementation((a, b) => ({ ...a, ...b }));
    mocks.ConfigStore.getAll.mockReturnValue({});
    mocks.ConfigLoader.loadUrl.mockResolvedValue({});
    resetConfig();
});

// ─────────────────────────────────────────────────────────────────────────────
// _applyProfileId (exercised via init)
// ─────────────────────────────────────────────────────────────────────────────
describe("config-core / _applyProfileId via init()", () => {
    it("profileId undefined → false-branch, data not created", async () => {
        await Config.init({ config: {} });
        expect(Config._config.data?.activeProfile).toBeUndefined();
    });

    it("profileId empty string → false-branch", async () => {
        await Config.init({ config: {}, profileId: "" });
        expect(Config._config.data?.activeProfile).toBeUndefined();
    });

    it("profileId non-string → false-branch", async () => {
        await Config.init({ config: {}, profileId: 42 });
        expect(Config._config.data?.activeProfile).toBeUndefined();
    });

    it("valid profileId → cfg.data created, activeProfile set", async () => {
        await Config.init({ config: {}, profileId: "profile-a" });
        expect(Config._config.data.activeProfile).toBe("profile-a");
    });

    it("valid profileId with existing cfg.data → activeProfile overwritten", async () => {
        await Config.init({ config: { data: { activeProfile: "old" } }, profileId: "new" });
        expect(Config._config.data.activeProfile).toBe("new");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _resolveDebugFlag / _resolveLogLevel (exercised via _applyConfig)
// ─────────────────────────────────────────────────────────────────────────────
describe("config-core / _resolveDebugFlag + _resolveLogLevel via _applyConfig()", () => {
    it('cfg.debug = true → log level "debug"', () => {
        Config._applyConfig({ debug: true }, "inline");
        expect(mocks.Log.setLevel).toHaveBeenCalledWith("debug");
    });

    it('cfg.debug = false → log level "info"', () => {
        Config._applyConfig({ debug: false }, "inline");
        expect(mocks.Log.setLevel).toHaveBeenCalledWith("info");
    });

    it('mergedConfig.debug = true → log level "debug"', () => {
        Config._config = { debug: true };
        Config._applyConfig({}, "inline");
        expect(mocks.Log.setLevel).toHaveBeenCalledWith("debug");
    });

    it("cfg.logging.level present → used as level", () => {
        Config._applyConfig({ logging: { level: "warn" } }, "inline");
        expect(mocks.Log.setLevel).toHaveBeenCalledWith("warn");
    });

    it("mergedConfig.logging.level → used when cfg.logging absent", () => {
        Config._config = { logging: { level: "error" } };
        Config._applyConfig({}, "inline");
        expect(mocks.Log.setLevel).toHaveBeenCalledWith("error");
    });

    it('no debug, no logging → default "info"', () => {
        Config._applyConfig({}, "inline");
        expect(mocks.Log.setLevel).toHaveBeenCalledWith("info");
    });

    it("Log.setLevel absent → no crash", () => {
        const orig = mocks.Log.setLevel;
        mocks.Log.setLevel = undefined;
        expect(() => Config._applyConfig({}, "inline")).not.toThrow();
        mocks.Log.setLevel = orig;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _applyConfig — storage branches
// ─────────────────────────────────────────────────────────────────────────────
describe("config-core / _applyConfig() branches", () => {
    it("cfg = null → converted to {} without crash", () => {
        expect(() => Config._applyConfig(null, "inline")).not.toThrow();
        expect(Config._isLoaded).toBe(true);
    });

    it("cfg = string → converted to {} without crash", () => {
        expect(() => Config._applyConfig("invalid", "inline")).not.toThrow();
    });

    it("ConfigStore.deepMerge present → deepMerge called", () => {
        Config._applyConfig({ k: 1 }, "inline");
        expect(mocks.ConfigStore.deepMerge).toHaveBeenCalled();
    });

    it("ConfigStore.deepMerge absent → Object.assign fallback", () => {
        const orig = mocks.ConfigStore.deepMerge;
        mocks.ConfigStore.deepMerge = undefined;
        Config._config = { a: 1 };
        Config._applyConfig({ b: 2 }, "inline");
        expect(Config._config).toMatchObject({ a: 1, b: 2 });
        mocks.ConfigStore.deepMerge = orig;
    });

    it("_applyLoggingConfig throws → catch (Log.warn), no rethrow", () => {
        mocks.Log.setLevel = vi.fn().mockImplementation(() => {
            throw new Error("boom");
        });
        expect(() => Config._applyConfig({ debug: true }, "inline")).not.toThrow();
        expect(mocks.Log.warn).toHaveBeenCalledWith(
            expect.stringContaining("Unable to apply log level"),
            expect.any(Error)
        );
        mocks.Log.setLevel = vi.fn();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _initSubModules
// ─────────────────────────────────────────────────────────────────────────────
describe("config-core / _initSubModules()", () => {
    it("already initialized → early return, no sub-module calls", () => {
        Config._subModulesInitialized = true;
        Config._initSubModules();
        expect(mocks.ConfigStore.init).not.toHaveBeenCalled();
    });

    it("Storage.init absent → no crash", () => {
        const orig = mocks.ConfigStore.init;
        mocks.ConfigStore.init = undefined;
        expect(() => Config._initSubModules()).not.toThrow();
        mocks.ConfigStore.init = orig;
    });

    it("Profile.init absent → no crash", () => {
        const orig = mocks.ProfileManager.init;
        mocks.ProfileManager.init = undefined;
        expect(() => Config._initSubModules()).not.toThrow();
        mocks.ProfileManager.init = orig;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _callOnLoaded (via init)
// ─────────────────────────────────────────────────────────────────────────────
describe("config-core / _callOnLoaded via init()", () => {
    it("onLoaded not a function → ignored", async () => {
        await expect(
            Config.init({ config: {}, onLoaded: "not-a-function" })
        ).resolves.toBeDefined();
    });

    it("onLoaded function → called with cfg", async () => {
        const cb = vi.fn();
        await Config.init({ config: { x: 1 }, onLoaded: cb });
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ x: 1 }));
    });

    it("onLoaded throws → error logged, init() still resolves", async () => {
        const cb = vi.fn().mockImplementation(() => {
            throw new Error("cb crash");
        });
        await expect(Config.init({ config: {}, onLoaded: cb })).resolves.toBeDefined();
        expect(mocks.Log.error).toHaveBeenCalledWith(
            expect.stringContaining("Error in onLoaded"),
            expect.any(Error)
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// init() — main branches
// ─────────────────────────────────────────────────────────────────────────────
describe("config-core / init() branches", () => {
    it("autoEvent = false → stored in _options", async () => {
        await Config.init({ config: {}, autoEvent: false });
        expect(Config._options.autoEvent).toBe(false);
    });

    it("autoEvent = true → stored in _options", async () => {
        await Config.init({ config: {}, autoEvent: true });
        expect(Config._options.autoEvent).toBe(true);
    });

    it("autoEvent non-boolean → existing value kept", async () => {
        Config._options.autoEvent = true;
        await Config.init({ config: {}, autoEvent: "yes" });
        expect(Config._options.autoEvent).toBe(true);
    });

    it("options.config object → inline path", async () => {
        const result = await Config.init({ config: { map: { zoom: 5 } } });
        expect(Config.getSource()).toBe("inline");
        expect(result).toBeDefined();
    });

    it("options.url non-empty string → url path (_initFromUrl)", async () => {
        mocks.ConfigLoader.loadUrl.mockResolvedValue({ map: {} });
        await Config.init({ url: "/config.json" });
        expect(Config.getSource()).toBe("url");
    });

    it('neither config nor url → empty path (applyConfig({}, "inline"))', async () => {
        await Config.init({});
        expect(Config.isLoaded()).toBe(true);
        expect(Config.getSource()).toBe("inline");
    });

    it("url empty string → empty path, NOT _initFromUrl", async () => {
        await Config.init({ url: "" });
        expect(mocks.ConfigLoader.loadUrl).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _initFromUrl — mappingUrl + error branches
// ─────────────────────────────────────────────────────────────────────────────
describe("config-core / _initFromUrl branches", () => {
    it("loadUrl rejects (via Config.loadUrl override) + onError → onError called, init() rejects", async () => {
        // config-loaders.loadUrl swallows ConfigLoader errors — override Config.loadUrl directly
        // to make _initFromUrl's outer .catch reachable
        const err = new Error("load fail");
        const origLoadUrl = Config.loadUrl;
        Config.loadUrl = vi.fn().mockRejectedValue(err);
        const onErr = vi.fn();
        await expect(Config.init({ url: "/c.json", onError: onErr })).rejects.toThrow("load fail");
        expect(onErr).toHaveBeenCalledWith(err);
        Config.loadUrl = origLoadUrl;
    });

    it("loadUrl rejects + onError throws → error logged, init() still rejects", async () => {
        const origLoadUrl = Config.loadUrl;
        Config.loadUrl = vi.fn().mockRejectedValue(new Error("load fail"));
        const onErr = vi.fn().mockImplementation(() => {
            throw new Error("onError crash");
        });
        await expect(Config.init({ url: "/c.json", onError: onErr })).rejects.toBeDefined();
        expect(mocks.Log.error).toHaveBeenCalledWith(
            expect.stringContaining("Error in onError"),
            expect.any(Error)
        );
        Config.loadUrl = origLoadUrl;
    });

    it("strictContentType = false → passed to loadUrl", async () => {
        mocks.ConfigLoader.loadUrl.mockResolvedValue({});
        await Config.init({ url: "/c.json", strictContentType: false });
        expect(mocks.ConfigLoader.loadUrl).toHaveBeenCalledWith(
            "/c.json",
            expect.objectContaining({ strictContentType: false })
        );
    });

    it("strictContentType non-boolean → defaults to true", async () => {
        mocks.ConfigLoader.loadUrl.mockResolvedValue({});
        await Config.init({ url: "/c.json", strictContentType: "yes" });
        expect(mocks.ConfigLoader.loadUrl).toHaveBeenCalledWith(
            "/c.json",
            expect.objectContaining({ strictContentType: true })
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _maybeFireLoadedEvent
// ─────────────────────────────────────────────────────────────────────────────
describe("config-core / _maybeFireLoadedEvent()", () => {
    it("autoEvent = false → return early, dispatchEvent not called", () => {
        const spy = vi.spyOn(document, "dispatchEvent");
        Config._options.autoEvent = false;
        Config._maybeFireLoadedEvent();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("autoEvent = true + document available → dispatchEvent called", () => {
        const spy = vi.spyOn(document, "dispatchEvent").mockImplementation(() => {});
        Config._options.autoEvent = true;
        Config._maybeFireLoadedEvent();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it("new CustomEvent throws → legacy createEvent path used", () => {
        const origCustomEvent = global.CustomEvent;
        global.CustomEvent = function () {
            throw new Error("CustomEvent unavailable");
        };
        const createEventSpy = vi.spyOn(document, "createEvent").mockReturnValue({
            initCustomEvent: vi.fn(),
        });
        const dispatchSpy = vi.spyOn(document, "dispatchEvent").mockImplementation(() => {});
        Config._options.autoEvent = true;
        Config._maybeFireLoadedEvent();
        expect(createEventSpy).toHaveBeenCalledWith("CustomEvent");
        global.CustomEvent = origCustomEvent;
        createEventSpy.mockRestore();
        dispatchSpy.mockRestore();
    });

    it("both try blocks fail → Log.warn", () => {
        const origCustomEvent = global.CustomEvent;
        global.CustomEvent = function () {
            throw new Error("no CustomEvent");
        };
        const createEventSpy = vi.spyOn(document, "createEvent").mockImplementation(() => {
            throw new Error("no createEvent");
        });
        Config._options.autoEvent = true;
        expect(() => Config._maybeFireLoadedEvent()).not.toThrow();
        expect(mocks.Log.warn).toHaveBeenCalledWith(
            expect.stringContaining("Unable to dispatch geoleaf:config:loaded")
        );
        global.CustomEvent = origCustomEvent;
        createEventSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-accessors.ts — fallback paths (method absent on module)
// ─────────────────────────────────────────────────────────────────────────────
describe("config-accessors / fallback paths", () => {
    it("getAll: Storage.getAll absent → returns this._config", () => {
        Config._isLoaded = true;
        const orig = mocks.ConfigStore.getAll;
        mocks.ConfigStore.getAll = undefined;
        Config._config = { fallback: true };
        expect(Config.getAll()).toMatchObject({ fallback: true });
        mocks.ConfigStore.getAll = orig;
    });

    it("getAll: !isLoaded → _initSubModules called", () => {
        Config._isLoaded = false;
        Config.getAll();
        expect(mocks.ConfigStore.init).toHaveBeenCalled();
    });

    it("get: Storage.get absent → returns defaultValue", () => {
        Config._isLoaded = true;
        const orig = mocks.ConfigStore.get;
        mocks.ConfigStore.get = undefined;
        expect(Config.get("any.path", "default")).toBe("default");
        mocks.ConfigStore.get = orig;
    });

    it("get: !isLoaded → _initSubModules called", () => {
        Config._isLoaded = false;
        mocks.ConfigStore.get.mockReturnValue("val");
        Config.get("k");
        expect(mocks.ConfigStore.init).toHaveBeenCalled();
    });

    it("set: Storage.set absent → Log.warn", () => {
        const orig = mocks.ConfigStore.set;
        mocks.ConfigStore.set = undefined;
        Config.set("k", "v");
        expect(mocks.Log.warn).toHaveBeenCalledWith(
            expect.stringContaining("Storage module unavailable")
        );
        mocks.ConfigStore.set = orig;
    });

    it("getSection: Storage.getSection absent → returns defaultValue", () => {
        const orig = mocks.ConfigStore.getSection;
        mocks.ConfigStore.getSection = undefined;
        expect(Config.getSection("ui", 42)).toBe(42);
        mocks.ConfigStore.getSection = orig;
    });

    it("getActiveProfileId: Profile method absent → null", () => {
        const orig = mocks.ProfileManager.getActiveProfileId;
        mocks.ProfileManager.getActiveProfileId = undefined;
        expect(Config.getActiveProfileId()).toBeNull();
        mocks.ProfileManager.getActiveProfileId = orig;
    });

    it("getActiveProfileMapping: Profile method absent → null", () => {
        const orig = mocks.ProfileManager.getActiveProfileMapping;
        mocks.ProfileManager.getActiveProfileMapping = undefined;
        expect(Config.getActiveProfileMapping()).toBeNull();
        mocks.ProfileManager.getActiveProfileMapping = orig;
    });

    it("isProfilePoiMappingEnabled: Profile method absent → true", () => {
        const orig = mocks.ProfileManager.isProfilePoiMappingEnabled;
        mocks.ProfileManager.isProfilePoiMappingEnabled = undefined;
        expect(Config.isProfilePoiMappingEnabled()).toBe(true);
        mocks.ProfileManager.isProfilePoiMappingEnabled = orig;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-loaders.ts — delegation + error branches
// ─────────────────────────────────────────────────────────────────────────────
describe("config-loaders / branches", () => {
    it("loadActiveProfileResources delegates to ProfileManager", async () => {
        if (typeof Config.loadActiveProfileResources !== "function") return;
        mocks.ProfileManager.loadActiveProfileResources.mockResolvedValue({ loaded: true });
        await Config.loadActiveProfileResources();
        expect(mocks.ProfileManager.loadActiveProfileResources).toHaveBeenCalled();
    });

    it("loadUrl error → returns existing config (error swallowed)", async () => {
        mocks.ConfigLoader.loadUrl.mockRejectedValue(new Error("net error"));
        const result = await Config.loadUrl("/bad.json");
        expect(mocks.Log.error).toHaveBeenCalledWith(
            expect.stringContaining("Error loading config"),
            expect.any(Error)
        );
        expect(result).toBeDefined(); // returns current _config
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-validation.ts — branches (now Istanbul-tracked via static import)
// ─────────────────────────────────────────────────────────────────────────────
describe("config-validation / validateConfig branches", () => {
    const validate = (cfg) => Config._validateConfig(cfg);

    it("cfg = null → no-op", () => expect(() => validate(null)).not.toThrow());
    it("cfg = non-object → no-op", () => expect(() => validate("str")).not.toThrow());
    it("cfg.map.center invalid → throw", () => {
        expect(() => validate({ map: { center: [1] } })).toThrow(/center/);
    });
    it("cfg.map.center valid", () => {
        expect(() => validate({ map: { center: [48, 2] } })).not.toThrow();
    });
    it("cfg.map.zoom valid", () => expect(() => validate({ map: { zoom: 10 } })).not.toThrow());
    it("cfg.map.zoom out of range → throw", () => {
        expect(() => validate({ map: { zoom: 25 } })).toThrow(/zoom/);
    });
    it("cfg.map.positionFixed non-boolean → throw", () => {
        expect(() => validate({ map: { positionFixed: 1 } })).toThrow(/positionFixed/);
    });
    it("cfg.map.initialMaxZoom = 0 → throw", () => {
        expect(() => validate({ map: { initialMaxZoom: 0 } })).toThrow(/initialMaxZoom/);
    });
    it("cfg.map.boundsMargin = -0.1 → throw", () => {
        expect(() => validate({ map: { boundsMargin: -0.1 } })).toThrow(/boundsMargin/);
    });
    it("basemaps = null → throw", () => {
        expect(() => validate({ basemaps: null })).toThrow(/basemaps/);
    });
});
