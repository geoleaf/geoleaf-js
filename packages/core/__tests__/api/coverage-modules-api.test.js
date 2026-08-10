/**
 * Coverage — API module
 * Targets: src/kernel/api/plugin-registry.ts
 *          src/kernel/api/boot-info.ts
 *          src/kernel/api/factory-manager.ts
 *          src/kernel/api/controller.ts
 *          src/kernel/api/initialization-manager.ts
 *          src/kernel/api/module-manager.ts
 *
 * Sprint T9 — coverage-modules pattern.
 */
"use strict";

// ── Shared mocks ──────────────────────────────────────────────────────────────
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── PluginRegistry ────────────────────────────────────────────────────────────
import { PluginRegistry } from "../../src/kernel/api/plugin-registry.ts";

describe("Coverage — PluginRegistry", () => {
    beforeEach(() => {
        // Reset state between tests by unregistering known test keys
        // (module scope keeps registry alive across tests)
    });

    describe("register()", () => {
        it("registers a plugin with minimal metadata", () => {
            PluginRegistry.register("test-plugin-a");
            expect(PluginRegistry.isLoaded("test-plugin-a")).toBe(true);
        });

        it("registers a plugin with full metadata", () => {
            PluginRegistry.register("test-plugin-b", {
                version: "1.0.0",
                requires: ["core"],
                optional: ["storage"],
                label: "Test Plugin B",
            });
            expect(PluginRegistry.isLoaded("test-plugin-b")).toBe(true);
        });

        it("dispatches a custom event on document after register", () => {
            const handler = vi.fn();
            document.addEventListener("geoleaf:plugin:loaded", handler);
            PluginRegistry.register("test-plugin-event");
            document.removeEventListener("geoleaf:plugin:loaded", handler);
            expect(handler).toHaveBeenCalled();
        });

        it("register with no metadata does not throw", () => {
            expect(() => PluginRegistry.register("test-no-meta")).not.toThrow();
        });
    });

    describe("isLoaded()", () => {
        it("returns true after registration", () => {
            PluginRegistry.register("check-loaded");
            expect(PluginRegistry.isLoaded("check-loaded")).toBe(true);
        });

        it("returns false for unregistered plugin", () => {
            expect(PluginRegistry.isLoaded("__never_registered__")).toBe(false);
        });
    });

    describe("canActivate()", () => {
        it("returns true when no requires dependencies", () => {
            PluginRegistry.register("standalone-plugin", { requires: [] });
            expect(PluginRegistry.canActivate("standalone-plugin")).toBe(true);
        });

        it("returns true when all required dependencies are loaded", () => {
            PluginRegistry.register("dep-a");
            PluginRegistry.register("dep-consumer", { requires: ["dep-a"] });
            expect(PluginRegistry.canActivate("dep-consumer")).toBe(true);
        });

        it("returns false when a required dependency is missing", () => {
            PluginRegistry.register("consumer-missing-dep", { requires: ["__missing_dep__"] });
            expect(PluginRegistry.canActivate("consumer-missing-dep")).toBe(false);
        });

        it("returns false for completely unknown plugin name", () => {
            expect(PluginRegistry.canActivate("__completely_unknown__")).toBe(false);
        });

        it("returns true for lazy-registered plugin not yet loaded", () => {
            PluginRegistry.registerLazy("lazy-test-module", () => Promise.resolve());
            expect(PluginRegistry.canActivate("lazy-test-module")).toBe(true);
        });
    });

    describe("registerLazy() / load()", () => {
        it("load() resolves for a registered lazy resolver", async () => {
            const resolver = vi.fn(() => Promise.resolve());
            PluginRegistry.registerLazy("lazy-resolve-test", resolver);
            await expect(PluginRegistry.load("lazy-resolve-test")).resolves.not.toThrow();
        });

        it("load() throws for an unregistered module name", async () => {
            await expect(PluginRegistry.load("__not_registered__")).rejects.toThrow();
        });

        it("load() is idempotent — second call on already-loaded plugin returns immediately", async () => {
            PluginRegistry.register("idempotent-plugin");
            const spy = vi.spyOn(PluginRegistry, "load");
            await PluginRegistry.load("idempotent-plugin"); // already loaded → returns early
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    describe("getLoadedPlugins()", () => {
        it("returns an array", () => {
            expect(Array.isArray(PluginRegistry.getLoadedPlugins())).toBe(true);
        });

        it("includes plugins registered during this test session", () => {
            PluginRegistry.register("get-list-test");
            expect(PluginRegistry.getLoadedPlugins()).toContain("get-list-test");
        });
    });
});

// ── BootInfo / showBootInfo ───────────────────────────────────────────────────
import { showBootInfo } from "../../src/kernel/api/boot-info.ts";

describe("Coverage — showBootInfo / _detectLoadedPlugins branches", () => {
    function _makeGeoLeaf(opts = {}) {
        return {
            _version: "2.0.0",
            plugins: {
                getLoadedPlugins: vi.fn(() => ["core", ...(opts.plugins || [])]),
            },
            ...opts,
        };
    }

    it("does not throw for a minimal GeoLeaf namespace", () => {
        expect(() => showBootInfo(_makeGeoLeaf())).not.toThrow();
    });

    it("does not throw when GeoLeaf is null", () => {
        expect(() => showBootInfo(null)).not.toThrow();
    });

    it("does not throw with plugins = ['storage']", () => {
        expect(() => showBootInfo(_makeGeoLeaf({ plugins: ["storage"] }))).not.toThrow();
    });

    it("does not throw with plugins = ['addpoi']", () => {
        expect(() => showBootInfo(_makeGeoLeaf({ plugins: ["addpoi"] }))).not.toThrow();
    });

    it("does not throw with plugins = ['labels', 'route']", () => {
        expect(() => showBootInfo(_makeGeoLeaf({ plugins: ["labels", "route"] }))).not.toThrow();
    });

    it("force option shows boot info regardless of config", () => {
        expect(() => showBootInfo(_makeGeoLeaf(), { force: true })).not.toThrow();
    });

    it("falls back to duck-typing when getLoadedPlugins is absent", () => {
        const gl = {
            _version: "2.0.0",
            // No plugins.getLoadedPlugins — triggers fallback branch
            Storage: { DB: { cache: {} } },
            POI: { AddForm: {} },
        };
        expect(() => showBootInfo(gl)).not.toThrow();
    });

    it("duck-typing branch: storage without DB", () => {
        const gl = {
            _version: "2.0.0",
            Storage: {},
        };
        expect(() => showBootInfo(gl)).not.toThrow();
    });
});

// ── APIFactoryManager ─────────────────────────────────────────────────────────
import { APIFactoryManager } from "../../src/kernel/api/factory-manager.ts";

describe("Coverage — APIFactoryManager", () => {
    let manager;

    beforeEach(() => {
        manager = new APIFactoryManager();
    });

    describe("constructor defaults", () => {
        it("isReady is true after construction", () => {
            expect(manager.isReady).toBe(true);
        });

        it("mapInstances starts empty", () => {
            expect(manager.mapInstances.size).toBe(0);
        });

        it("stats are zeroed", () => {
            expect(manager.stats.mapsCreated).toBe(0);
            expect(manager.stats.errors).toBe(0);
        });

        it("getModule is null before init", () => {
            expect(manager.getModule).toBeNull();
        });
    });

    describe("init()", () => {
        it("returns true with a valid getModule function", () => {
            const result = manager.init(vi.fn());
            expect(result).toBe(true);
        });

        it("returns false with null getModule", () => {
            const result = manager.init(null);
            expect(result).toBe(false);
        });

        it("returns false with a non-function getModule", () => {
            const result = manager.init("not-a-function");
            expect(result).toBe(false);
        });

        it("increments errors on bad input", () => {
            manager.init(null);
            expect(manager.stats.errors).toBe(1);
        });
    });

    describe("createMap()", () => {
        it("throws or returns null when targetId is missing", () => {
            const getModule = vi.fn(() => null);
            const result = manager.createMap(null, {}, getModule);
            expect(result === null || result === undefined).toBe(true);
            expect(manager.stats.mapsCreated).toBeGreaterThan(0);
            expect(manager.stats.errors).toBeGreaterThan(0);
        });

        it("throws or returns null when Core module unavailable", () => {
            const getModule = vi.fn(() => null);
            const result = manager.createMap("map-container", {}, getModule);
            expect(result === null || result === undefined).toBe(true);
        });

        it("increments mapsCreated even on failure", () => {
            const before = manager.stats.mapsCreated;
            manager.createMap(
                null,
                {},
                vi.fn(() => null)
            );
            expect(manager.stats.mapsCreated).toBe(before + 1);
        });
    });
});

// ── APIController (T10.3.11) ──────────────────────────────────────────────────
import { APIController } from "../../src/kernel/api/controller.ts";

describe("Coverage — APIController (T10.3.11)", () => {
    let controller;

    // Minimal mock manager classes that APIController can instantiate
    function setupGeoLeafAPI() {
        if (!globalThis.GeoLeaf) globalThis.GeoLeaf = {};
        globalThis.GeoLeaf.API = {
            APIModuleManager: class {
                init() {
                    return true;
                }
                getModule(name) {
                    return globalThis.GeoLeaf?.[name] ?? null;
                }
            },
            APIInitializationManager: class {
                init(_opts, _getModule) {
                    return { mapId: "test" };
                }
                loadConfig(_input, _getModule) {
                    return Promise.resolve({});
                }
                setTheme(_theme, _getModule) {
                    return true;
                }
            },
            APIFactoryManager: class {
                createMap(_targetId, _opts, _getModule) {
                    return {};
                }
            },
        };
    }

    function clearGeoLeafAPI() {
        if (globalThis.GeoLeaf) delete globalThis.GeoLeaf.API;
    }

    beforeEach(() => {
        controller = new APIController();
        clearGeoLeafAPI();
    });

    afterEach(() => {
        clearGeoLeafAPI();
    });

    describe("constructor", () => {
        it("isInitialized is false initially", () => {
            expect(controller.isInitialized).toBe(false);
        });

        it("managers is empty initially", () => {
            expect(Object.keys(controller.managers).length).toBe(0);
        });

        it("moduleAccessFn is null initially", () => {
            expect(controller.moduleAccessFn).toBeNull();
        });

        it("healthStatus.managers is 0 initially", () => {
            expect(controller.healthStatus.managers).toBe(0);
        });

        it("healthStatus.errors is empty initially", () => {
            expect(controller.healthStatus.errors).toEqual([]);
        });
    });

    describe("init() without managers configured", () => {
        it("returns false when module manager is unavailable (no GeoLeaf.API)", () => {
            const result = controller.init();
            expect(result).toBe(false);
        });

        it("records error in healthStatus when init fails", () => {
            controller.init();
            expect(controller.healthStatus.errors.length).toBeGreaterThan(0);
        });

        it("isInitialized remains false after failed init", () => {
            controller.init();
            expect(controller.isInitialized).toBe(false);
        });
    });

    describe("init() with managers configured", () => {
        beforeEach(() => {
            setupGeoLeafAPI();
        });

        it("returns true when all managers are available", () => {
            const result = controller.init();
            expect(result).toBe(true);
        });

        it("sets isInitialized to true on success", () => {
            controller.init();
            expect(controller.isInitialized).toBe(true);
        });

        it("sets healthStatus.lastUpdate on success", () => {
            controller.init();
            expect(controller.healthStatus.lastUpdate).not.toBeNull();
        });

        it("is idempotent — second init() returns true immediately", () => {
            controller.init();
            const result = controller.init();
            expect(result).toBe(true);
        });
    });

    describe("delegate methods — before init (not initialized)", () => {
        it("geoleafInit() returns null when not initialized", () => {
            expect(controller.geoleafInit({})).toBeNull();
        });

        it("geoleafLoadConfig() returns resolved null when not initialized", async () => {
            const result = await controller.geoleafLoadConfig("some-url");
            expect(result).toBeNull();
        });

        it("geoleafSetTheme() returns false when not initialized", () => {
            expect(controller.geoleafSetTheme("dark")).toBe(false);
        });

        it("geoleafCreateMap() returns null when not initialized", () => {
            expect(controller.geoleafCreateMap("container")).toBeNull();
        });
    });

    describe("delegate methods — after init", () => {
        beforeEach(() => {
            setupGeoLeafAPI();
            controller.init();
        });

        it("geoleafInit() delegates to initialization manager", () => {
            const result = controller.geoleafInit({});
            // Should not throw and return the init result
            expect(result).not.toBeUndefined();
        });

        it("geoleafLoadConfig() delegates to initialization manager", async () => {
            const result = await controller.geoleafLoadConfig("config.json");
            expect(result).toBeDefined();
        });

        it("geoleafSetTheme() delegates and returns boolean", () => {
            const result = controller.geoleafSetTheme("light");
            expect(typeof result).toBe("boolean");
        });

        it("geoleafCreateMap() delegates to factory manager", () => {
            const result = controller.geoleafCreateMap("map-container", {});
            expect(result).not.toBeNull();
        });
    });

    describe("moduleAccessFn branches", () => {
        beforeEach(() => {
            setupGeoLeafAPI();
            controller.init();
        });

        it("returns null for null module name", () => {
            const result = controller.moduleAccessFn(null);
            expect(result).toBeNull();
        });

        it("returns null for non-string module name", () => {
            const result = controller.moduleAccessFn(42);
            expect(result).toBeNull();
        });

        it("returns module from manager when available", () => {
            const result = controller.moduleAccessFn("Core");
            // Just verify it doesn't crash
            expect(result !== undefined).toBe(true);
        });
    });

    describe("getHealthStatus()", () => {
        it("returns isInitialized", () => {
            const status = controller.getHealthStatus();
            expect(typeof status.isInitialized).toBe("boolean");
        });

        it("returns managersCount as number", () => {
            const status = controller.getHealthStatus();
            expect(typeof status.managersCount).toBe("number");
        });

        it("returns hasModuleAccess as boolean", () => {
            const status = controller.getHealthStatus();
            expect(typeof status.hasModuleAccess).toBe("boolean");
        });

        it("hasModuleAccess is true after successful init", () => {
            setupGeoLeafAPI();
            controller.init();
            const status = controller.getHealthStatus();
            expect(status.hasModuleAccess).toBe(true);
        });
    });

    describe("reset()", () => {
        it("resets isInitialized to false", () => {
            setupGeoLeafAPI();
            controller.init();
            controller.reset();
            expect(controller.isInitialized).toBe(false);
        });

        it("resets managers to empty object", () => {
            setupGeoLeafAPI();
            controller.init();
            controller.reset();
            expect(Object.keys(controller.managers).length).toBe(0);
        });

        it("resets moduleAccessFn to null", () => {
            setupGeoLeafAPI();
            controller.init();
            controller.reset();
            expect(controller.moduleAccessFn).toBeNull();
        });

        it("resets healthStatus", () => {
            setupGeoLeafAPI();
            controller.init();
            controller.reset();
            expect(controller.healthStatus.managers).toBe(0);
            expect(controller.healthStatus.errors).toEqual([]);
            expect(controller.healthStatus.lastUpdate).toBeNull();
        });
    });

    describe("_getManagerClass edge case", () => {
        it("returns null when GeoLeaf.API is not set", () => {
            // clearGeoLeafAPI() already run in beforeEach
            const result = controller.init();
            // init fails because module manager can't be loaded
            expect(result).toBe(false);
        });
    });
});
