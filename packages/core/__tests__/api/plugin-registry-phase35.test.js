/**
 */
/* Phase 3.5 — src/kernel/api/plugin-registry.ts */

/*
 * ⚠️ DETTE (STRUCT S7) — doublon strict avec `api/plugin-registry.test.js`.
 * Ses 7 describe (register, isLoaded, getLoadedPlugins, canActivate, getInfo,
 * getAvailableModules, registerLazy/load) sont TOUS inclus dans les 11 de l'autre
 * fichier, sur le même SUT et le même import. Le doublon était invisible tant que
 * les deux vivaient sous des dossiers différents (`modules/` vs `api/`) ; le
 * réalignement du miroir le met à nu, et c'est bien tout ce qu'on lui demande.
 * Le suffixe `-phase35` est un MARQUEUR, pas une résolution : S7 corrige des noms,
 * il ne fusionne pas de suites (S7.4). Fusion inscrite au backlog technique.
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PluginRegistry } from "../../src/kernel/api/plugin-registry.js";

describe("api/plugin-registry — Phase 3.5", () => {
    beforeEach(() => {
        PluginRegistry._registry.clear();
        PluginRegistry._lazyResolvers.clear();
    });

    describe("register", () => {
        it("registers a plugin with metadata", () => {
            PluginRegistry.register("test-module", { version: "1.0.0" });
            expect(PluginRegistry.isLoaded("test-module")).toBe(true);
            const info = PluginRegistry.getInfo("test-module");
            expect(info).toBeTruthy();
            expect(info.version).toBe("1.0.0");
            expect(info.loaded).toBe(true);
        });

        it("registers without metadata", () => {
            PluginRegistry.register("minimal");
            expect(PluginRegistry.isLoaded("minimal")).toBe(true);
        });
    });

    describe("isLoaded", () => {
        it("returns false for unregistered plugin", () => {
            expect(PluginRegistry.isLoaded("missing")).toBe(false);
        });

        it("returns true after register", () => {
            PluginRegistry.register("core");
            expect(PluginRegistry.isLoaded("core")).toBe(true);
        });
    });

    describe("getLoadedPlugins", () => {
        it("returns empty array when none registered", () => {
            expect(PluginRegistry.getLoadedPlugins()).toEqual([]);
        });

        it("returns names of registered plugins", () => {
            PluginRegistry.register("a");
            PluginRegistry.register("b");
            expect(PluginRegistry.getLoadedPlugins()).toContain("a");
            expect(PluginRegistry.getLoadedPlugins()).toContain("b");
        });
    });

    describe("canActivate", () => {
        it("returns true for registered plugin with no requires", () => {
            PluginRegistry.register("standalone");
            expect(PluginRegistry.canActivate("standalone")).toBe(true);
        });

        it("returns false when dependency not loaded", () => {
            PluginRegistry.register("child", { requires: ["parent"] });
            expect(PluginRegistry.canActivate("child")).toBe(false);
        });

        it("returns true when dependencies loaded", () => {
            PluginRegistry.register("parent");
            PluginRegistry.register("child", { requires: ["parent"] });
            expect(PluginRegistry.canActivate("child")).toBe(true);
        });
    });

    describe("getInfo", () => {
        it("returns null for unknown plugin", () => {
            expect(PluginRegistry.getInfo("x")).toBeNull();
        });

        it("returns metadata for registered plugin", () => {
            PluginRegistry.register("m", { version: "2.0", label: "Module M" });
            const info = PluginRegistry.getInfo("m");
            expect(info.version).toBe("2.0");
            expect(info.label).toBe("Module M");
        });
    });

    describe("getAvailableModules", () => {
        it("includes loaded and lazy modules", () => {
            PluginRegistry.register("loaded");
            PluginRegistry.registerLazy("lazy", () => Promise.resolve());
            const avail = PluginRegistry.getAvailableModules();
            expect(avail).toContain("loaded");
            expect(avail).toContain("lazy");
        });
    });

    describe("registerLazy and load", () => {
        it("load resolves and marks plugin loaded", async () => {
            let resolved = false;
            PluginRegistry.registerLazy("lazyMod", () => {
                resolved = true;
                PluginRegistry.register("lazyMod");
                return Promise.resolve();
            });
            expect(PluginRegistry.isLoaded("lazyMod")).toBe(false);
            await PluginRegistry.load("lazyMod");
            expect(resolved).toBe(true);
            expect(PluginRegistry.isLoaded("lazyMod")).toBe(true);
        });

        it("load throws when module unknown", async () => {
            await expect(PluginRegistry.load("unknown-module")).rejects.toThrow(/Module inconnu/);
        });
    });
});
