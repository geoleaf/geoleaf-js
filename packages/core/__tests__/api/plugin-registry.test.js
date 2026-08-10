/**
 * @fileoverview Unit tests for PluginRegistry — register, isLoaded, canActivate, load
 * @phase C12 — Coverage push (ESM: import)
 */

import { PluginRegistry } from "../../src/kernel/api/plugin-registry.js";

describe("PluginRegistry", () => {
    beforeAll(() => {
        global.GeoLeaf = global.GeoLeaf || {};
    });

    beforeEach(() => {
        // Clear state between tests for isolation
        PluginRegistry._registry.clear();
        PluginRegistry._lazyResolvers.clear();
        vi.clearAllMocks();
    });

    // ─── Structure ────────────────────────────────────────────────────────────

    describe("Module structure", () => {
        test("PluginRegistry should be defined", () => {
            expect(PluginRegistry).toBeDefined();
        });

        test("should expose required API methods", () => {
            expect(typeof PluginRegistry.register).toBe("function");
            expect(typeof PluginRegistry.registerLazy).toBe("function");
            expect(typeof PluginRegistry.isLoaded).toBe("function");
            expect(typeof PluginRegistry.canActivate).toBe("function");
            expect(typeof PluginRegistry.load).toBe("function");
            expect(typeof PluginRegistry.getLoadedPlugins).toBe("function");
            expect(typeof PluginRegistry.getAvailableModules).toBe("function");
            expect(typeof PluginRegistry.getInfo).toBe("function");
        });
    });

    // ─── register ─────────────────────────────────────────────────────────────

    describe("register()", () => {
        test("should register a plugin as loaded", () => {
            PluginRegistry.register("core");
            expect(PluginRegistry.isLoaded("core")).toBe(true);
        });

        test("should store version metadata", () => {
            PluginRegistry.register("storage", { version: "1.2.0" });
            const info = PluginRegistry.getInfo("storage");
            expect(info.version).toBe("1.2.0");
        });

        test("should store requires dependencies", () => {
            PluginRegistry.register("addpoi", { requires: ["core", "storage"] });
            const info = PluginRegistry.getInfo("addpoi");
            expect(info.requires).toEqual(["core", "storage"]);
        });

        test("should store optional dependencies", () => {
            PluginRegistry.register("labels", { optional: ["poi", "route"] });
            const info = PluginRegistry.getInfo("labels");
            expect(info.optional).toEqual(["poi", "route"]);
        });

        test("should set loaded=true", () => {
            PluginRegistry.register("myPlugin");
            const info = PluginRegistry.getInfo("myPlugin");
            expect(info.loaded).toBe(true);
        });

        test("should record loadedAt timestamp", () => {
            const before = Date.now();
            PluginRegistry.register("timestamped");
            const after = Date.now();
            const info = PluginRegistry.getInfo("timestamped");
            expect(info.loadedAt).toBeGreaterThanOrEqual(before);
            expect(info.loadedAt).toBeLessThanOrEqual(after);
        });

        test("should use defaults when metadata is omitted", () => {
            PluginRegistry.register("bare");
            const info = PluginRegistry.getInfo("bare");
            expect(info.version).toBeNull();
            expect(info.requires).toEqual([]);
            expect(info.optional).toEqual([]);
        });

        test("register with same name overwrites previous entry (conflit de nom)", () => {
            PluginRegistry.register("myPlugin", { version: "1.0.0" });
            expect(PluginRegistry.getInfo("myPlugin").version).toBe("1.0.0");
            PluginRegistry.register("myPlugin", { version: "2.0.0" });
            expect(PluginRegistry.getInfo("myPlugin").version).toBe("2.0.0");
        });
    });

    // ─── registerLayerLoader / getLayerLoader (S10) ────────────────────────────

    describe("registerLayerLoader() / getLayerLoader()", () => {
        beforeEach(() => {
            PluginRegistry._layerLoaders.clear();
        });

        test("registers and resolves a layer loader by plugin id", () => {
            const loader = vi.fn();
            PluginRegistry.registerLayerLoader("flatgeobuf", loader);
            expect(PluginRegistry.getLayerLoader("flatgeobuf")).toBe(loader);
        });

        test("returns undefined for an unregistered plugin id", () => {
            expect(PluginRegistry.getLayerLoader("ghost")).toBeUndefined();
        });

        test("ignores a non-function loader", () => {
            PluginRegistry.registerLayerLoader("bad", "not-a-function");
            expect(PluginRegistry.getLayerLoader("bad")).toBeUndefined();
        });
    });

    // ─── isLoaded ─────────────────────────────────────────────────────────────

    describe("isLoaded()", () => {
        test("should return true for a registered plugin", () => {
            PluginRegistry.register("loaded-plugin");
            expect(PluginRegistry.isLoaded("loaded-plugin")).toBe(true);
        });

        test("should return false for an unregistered plugin", () => {
            expect(PluginRegistry.isLoaded("never-registered")).toBe(false);
        });
    });

    // ─── canActivate ──────────────────────────────────────────────────────────

    describe("canActivate()", () => {
        test("should return true when all requires are loaded", () => {
            PluginRegistry.register("core");
            PluginRegistry.register("storage");
            PluginRegistry.register("addpoi", { requires: ["core", "storage"] });
            expect(PluginRegistry.canActivate("addpoi")).toBe(true);
        });

        test("should return false when a required dependency is missing", () => {
            PluginRegistry.register("core");
            // 'storage' not registered
            PluginRegistry.register("addpoi", { requires: ["core", "storage"] });
            expect(PluginRegistry.canActivate("addpoi")).toBe(false);
        });

        test("should return true for a plugin with no dependencies", () => {
            PluginRegistry.register("standalone");
            expect(PluginRegistry.canActivate("standalone")).toBe(true);
        });

        test("should return true for an unregistered plugin that has a lazy resolver", () => {
            PluginRegistry.registerLazy("lazy-module", vi.fn().mockResolvedValue());
            expect(PluginRegistry.canActivate("lazy-module")).toBe(true);
        });

        test("should return false for completely unknown plugin", () => {
            expect(PluginRegistry.canActivate("completely-unknown")).toBe(false);
        });
    });

    // ─── registerLazy / load ──────────────────────────────────────────────────

    describe("registerLazy() / load()", () => {
        test("should register a lazy resolver", () => {
            const resolver = vi.fn().mockResolvedValue();
            PluginRegistry.registerLazy("lazy-feature", resolver);
            expect(PluginRegistry.getAvailableModules()).toContain("lazy-feature");
        });

        test("load() should call the lazy resolver", async () => {
            const resolver = vi.fn().mockResolvedValue();
            PluginRegistry.registerLazy("load-me", resolver);
            await PluginRegistry.load("load-me");
            expect(resolver).toHaveBeenCalledTimes(1);
        });

        test("load() should skip resolver if plugin is already loaded", async () => {
            const resolver = vi.fn().mockResolvedValue();
            PluginRegistry.registerLazy("already-loaded", resolver);
            PluginRegistry.register("already-loaded"); // mark as loaded
            await PluginRegistry.load("already-loaded");
            expect(resolver).not.toHaveBeenCalled();
        });

        test("load() should throw for unknown module", async () => {
            await expect(PluginRegistry.load("unknown-xyz")).rejects.toThrow("Module inconnu");
        });

        test("load() error message should list available modules", async () => {
            PluginRegistry.registerLazy("module-a", vi.fn());
            PluginRegistry.registerLazy("module-b", vi.fn());
            try {
                await PluginRegistry.load("no-such-module");
                expect(true).toBe(false);
            } catch (err) {
                expect(err.message).toContain("module-a");
                expect(err.message).toContain("module-b");
            }
        });
    });

    // ─── getLoadedPlugins ─────────────────────────────────────────────────────

    describe("getLoadedPlugins()", () => {
        test("should return empty array when nothing is registered", () => {
            expect(PluginRegistry.getLoadedPlugins()).toEqual([]);
        });

        test("should return names of registered plugins", () => {
            PluginRegistry.register("core");
            PluginRegistry.register("storage");
            const loaded = PluginRegistry.getLoadedPlugins();
            expect(loaded).toContain("core");
            expect(loaded).toContain("storage");
            expect(loaded.length).toBe(2);
        });

        test("should NOT include lazy-only modules (unregistered)", () => {
            PluginRegistry.registerLazy("pending-lazy", vi.fn());
            const loaded = PluginRegistry.getLoadedPlugins();
            expect(loaded).not.toContain("pending-lazy");
        });
    });

    // ─── getAvailableModules ──────────────────────────────────────────────────

    describe("getAvailableModules()", () => {
        test("should include both loaded and lazy-registered modules", () => {
            PluginRegistry.register("core");
            PluginRegistry.registerLazy("lazy-thing", vi.fn());
            const available = PluginRegistry.getAvailableModules();
            expect(available).toContain("core");
            expect(available).toContain("lazy-thing");
        });

        test("should deduplicate when same name is both loaded and lazy", () => {
            PluginRegistry.register("both");
            PluginRegistry.registerLazy("both", vi.fn());
            const available = PluginRegistry.getAvailableModules();
            expect(available.filter((n) => n === "both").length).toBe(1);
        });

        test("should return empty array when empty", () => {
            expect(PluginRegistry.getAvailableModules()).toEqual([]);
        });
    });

    // ─── getInfo ──────────────────────────────────────────────────────────────

    describe("getInfo()", () => {
        test("should return full metadata for registered plugin", () => {
            PluginRegistry.register("detailed", { version: "1.2.3", requires: ["core"] });
            const info = PluginRegistry.getInfo("detailed");
            expect(info).not.toBeNull();
            expect(info.name).toBe("detailed");
            expect(info.version).toBe("1.2.3");
            expect(info.loaded).toBe(true);
        });

        test("should return null for unknown plugin", () => {
            expect(PluginRegistry.getInfo("doesnt-exist")).toBeNull();
        });
    });

    // One report, merged from a former pair in ARCHI S2 (04/07/2026).
    describe("reportPlugins()", () => {
        test("does not throw when only core modules are loaded", () => {
            PluginRegistry.register("core");
            PluginRegistry.register("labels");
            expect(() => PluginRegistry.reportPlugins()).not.toThrow();
        });

        test("is silent when only core modules are loaded", () => {
            const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
            const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
            PluginRegistry.register("core");
            PluginRegistry.register("labels");
            PluginRegistry.reportPlugins();
            expect(groupSpy).not.toHaveBeenCalled();
            expect(infoSpy).not.toHaveBeenCalled();
            groupSpy.mockRestore();
            infoSpy.mockRestore();
        });

        test("calls console.groupCollapsed when a plugin is loaded", () => {
            const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
            PluginRegistry.register("storage", { version: "1.0.0" });
            PluginRegistry.reportPlugins();
            expect(groupSpy).toHaveBeenCalled();
            groupSpy.mockRestore();
        });

        // Regression guard for the bug that motivated the merge: the two former
        // reports partitioned on a `type` manifest field, but each was backed by a
        // hard-coded name set that OVERRODE the declared value — and the two sets
        // disagreed with it in opposite directions, so `storage` and `editor` were
        // each printed by BOTH reports at every boot.
        test("lists each loaded plugin exactly once", () => {
            const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            PluginRegistry.register("storage", { label: "Storage", version: "1.0.0" });
            PluginRegistry.register("editor", { label: "Editor", version: "1.0.0" });
            PluginRegistry.reportPlugins();
            const lines = logSpy.mock.calls.map((c) => String(c[0]));
            expect(lines.filter((l) => l.includes("Storage"))).toHaveLength(1);
            expect(lines.filter((l) => l.includes("Editor"))).toHaveLength(1);
            groupSpy.mockRestore();
            logSpy.mockRestore();
        });

        // The merged report inherits the former standard behaviour (warnUnhealthy:
        // false): `connector` is legitimately "not connected" at boot, so warning
        // would be a false alarm at every page load. The unhealthy state is still
        // visible on the listed line, just not escalated to console.warn.
        test("does not warn when healthCheck returns false, but marks the line", () => {
            const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            PluginRegistry.register("storage", { label: "Storage", healthCheck: () => false });
            PluginRegistry.reportPlugins();
            expect(warnSpy).not.toHaveBeenCalled();
            const call = logSpy.mock.calls.find((c) => String(c[0]).includes("Storage"));
            expect(call).toBeDefined();
            expect(call[0]).toContain("non connecté");
            groupSpy.mockRestore();
            logSpy.mockRestore();
            warnSpy.mockRestore();
        });

        test("shows empty version string when plugin has no version", () => {
            const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            PluginRegistry.register("storage", { label: "Storage" });
            PluginRegistry.reportPlugins();
            const call = logSpy.mock.calls.find((c) => String(c[0]).includes("Storage"));
            expect(call).toBeDefined();
            expect(call[0]).not.toContain(" v");
            groupSpy.mockRestore();
            logSpy.mockRestore();
        });
    });
});
