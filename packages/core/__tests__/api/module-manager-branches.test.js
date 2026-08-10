/**
 * Branch-coverage tests for APIModuleManager
 * Covers all conditional paths: init idempotency, scan logic, alias setup,
 * getModule resolution chain, registration validation, hasModule 3-operand,
 * getModuleList deduplication, refresh, reset, and error paths.
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { APIModuleManager } from "../../src/kernel/api/module-manager.js";

describe("APIModuleManager — branch coverage", () => {
    let mgr;
    const _g = typeof globalThis !== "undefined" ? globalThis : {};

    beforeEach(() => {
        mgr = new APIModuleManager();
        _g.GeoLeaf = {};
    });

    afterEach(() => {
        _g.GeoLeaf = {};
    });

    // ── constructor ───────────────────────────────────────────────────────
    it("constructor initialises empty maps and stats", () => {
        expect(mgr.modules.size).toBe(0);
        expect(mgr.aliases.size).toBe(0);
        expect(mgr.isInitialized).toBe(false);
        expect(mgr.stats.totalModules).toBe(0);
        expect(mgr.stats.accessCount).toBe(0);
        expect(mgr.stats.errors).toBe(0);
    });

    // ── init ──────────────────────────────────────────────────────────────
    it("init scans hardcoded module list from GeoLeaf namespace", () => {
        _g.GeoLeaf = { Core: {}, UI: {}, Config: {}, POI: {} };
        const result = mgr.init();
        expect(result).toBe(true);
        expect(mgr.isInitialized).toBe(true);
        expect(mgr.modules.has("Core")).toBe(true);
        expect(mgr.modules.has("UI")).toBe(true);
        expect(mgr.modules.has("Config")).toBe(true);
        expect(mgr.modules.has("POI")).toBe(true);
        expect(mgr.stats.totalModules).toBe(4);
    });

    it("init ne ramasse plus une clé `_` inconnue du catalogue (API S4.3f)", () => {
        // Ce test assertait l'inverse jusqu'au S4.3f : le balayage prenait TOUTE clé commençant
        // par `_`. C'était le défaut, pas la fonctionnalité — il promouvait au rang de module
        // une chaîne (`_version`), un sac d'état (`_app`) et un ACCESSEUR qu'il déclenchait
        // (`_APIController`, en pleine construction de l'APIController qui l'appelle).
        // La découverte est désormais déclarative.
        _g.GeoLeaf = { _PrivateModule: { foo: 1 }, _AnotherPrivate: { bar: 2 } };
        mgr.init();
        expect(mgr.modules.has("_PrivateModule")).toBe(false);
        expect(mgr.modules.has("_AnotherPrivate")).toBe(false);
        // …mais elles restent atteignables : `getModule` se replie sur le namespace.
        expect(mgr.getModule("_PrivateModule")).toEqual({ foo: 1 });
    });

    it("init ignore une entrée du catalogue posée à undefined", () => {
        _g.GeoLeaf = { Core: undefined, UI: {} };
        mgr.init();
        expect(mgr.modules.has("Core")).toBe(false);
        expect(mgr.modules.has("UI")).toBe(true);
    });

    it("init ramasse une clé `_` DU catalogue", () => {
        // Le pendant du test ci-dessus : le catalogue n'est pas un refus global, c'est une
        // liste. Sans cette assertion, désarmer entièrement la boucle laisserait le test
        // précédent vert.
        _g.GeoLeaf = { _UITheme: { toggleTheme: () => {} } };
        mgr.init();
        expect(mgr.modules.has("_UITheme")).toBe(true);
    });

    it("init returns true on second call (idempotency branch)", () => {
        mgr.init();
        const result = mgr.init();
        expect(result).toBe(true);
    });

    it("init sets up aliases for existing modules (Baselayers <-> BaseLayers)", () => {
        _g.GeoLeaf = { BaseLayers: {} };
        mgr.init();
        expect(mgr.aliases.has("Baselayers")).toBe(true);
    });

    it("init sets up Logger <-> Log alias when Log module exists", () => {
        _g.GeoLeaf = { Log: {} };
        mgr.init();
        expect(mgr.aliases.has("Logger")).toBe(true);
    });

    it("init does NOT set alias when target module missing", () => {
        _g.GeoLeaf = {};
        mgr.init();
        expect(mgr.aliases.has("Baselayers")).toBe(false);
        expect(mgr.aliases.has("Logger")).toBe(false);
    });

    it("init scans all 17 hardcoded module names", () => {
        const allMods = {};
        [
            "Core",
            "UI",
            "Config",
            "Baselayers",
            "BaseLayers",
            "POI",
            "GeoJSON",
            "Route",
            "Legend",
            "LayerManager",
            "Storage",
            "Log",
            "Security",
            "Utils",
            "Constants",
            "Validators",
            "Errors",
        ].forEach((n) => {
            allMods[n] = {};
        });
        _g.GeoLeaf = allMods;
        mgr.init();
        // 18 → 17 : `Filters` a quitté `moduleList` avec `GeoLeaf.Filters` (API S4.5).
        expect(mgr.stats.totalModules).toBe(17);
    });

    it("init skips modules not present in GeoLeaf namespace", () => {
        _g.GeoLeaf = { Core: {} };
        mgr.init();
        expect(mgr.modules.has("UI")).toBe(false);
    });

    it("init returns false when _scanExistingModules throws", () => {
        const original = Object.getOwnPropertyDescriptor(_g, "GeoLeaf");
        Object.defineProperty(_g, "GeoLeaf", {
            get() {
                throw new Error("access denied");
            },
            configurable: true,
        });
        const result = mgr.init();
        expect(result).toBe(false);
        expect(mgr.stats.errors).toBe(1);
        if (original) Object.defineProperty(_g, "GeoLeaf", original);
        else delete _g.GeoLeaf;
        _g.GeoLeaf = {};
    });

    it("_scanExistingModules handles null GeoLeaf (early return)", () => {
        _g.GeoLeaf = undefined;
        mgr.init();
        expect(mgr.stats.totalModules).toBe(0);
        _g.GeoLeaf = {};
    });

    // ── getModule ─────────────────────────────────────────────────────────
    it("getModule returns null for null name", () => {
        expect(mgr.getModule(null)).toBeNull();
        expect(mgr.stats.errors).toBe(1);
    });

    it("getModule returns null for undefined name", () => {
        expect(mgr.getModule(undefined)).toBeNull();
    });

    it("getModule returns null for empty string", () => {
        expect(mgr.getModule("")).toBeNull();
    });

    it("getModule returns null for non-string (number)", () => {
        expect(mgr.getModule(42)).toBeNull();
    });

    it("getModule returns module from direct cache", () => {
        const mod = { test: true };
        mgr.modules.set("MyMod", mod);
        expect(mgr.getModule("MyMod")).toBe(mod);
        expect(mgr.stats.accessCount).toBe(1);
    });

    it("getModule resolves through alias", () => {
        const mod = { val: 1 };
        mgr.modules.set("BaseLayers", mod);
        mgr.aliases.set("Baselayers", "BaseLayers");
        expect(mgr.getModule("Baselayers")).toBe(mod);
    });

    it("getModule returns null when alias target is missing from cache", () => {
        mgr.aliases.set("Ghost", "Missing");
        expect(mgr.getModule("Ghost")).toBeNull();
    });

    it("getModule falls back to GeoLeaf global and caches", () => {
        const mod = { global: true };
        _g.GeoLeaf = { DynMod: mod };
        const result = mgr.getModule("DynMod");
        expect(result).toBe(mod);
        expect(mgr.modules.has("DynMod")).toBe(true);
    });

    it("getModule returns null when module not found anywhere", () => {
        _g.GeoLeaf = {};
        const result = mgr.getModule("NoSuchModule");
        expect(result).toBeNull();
    });

    it("getModule increments accessCount on every call", () => {
        mgr.getModule("a");
        mgr.getModule("b");
        mgr.getModule("c");
        expect(mgr.stats.accessCount).toBe(3);
    });

    // ── registerModule ────────────────────────────────────────────────────
    it("registerModule succeeds with valid name and module", () => {
        const result = mgr.registerModule("Test", { x: 1 });
        expect(result).toBe(true);
        expect(mgr.modules.has("Test")).toBe(true);
        expect(mgr.stats.totalModules).toBe(1);
    });

    it("registerModule fails with empty name", () => {
        const result = mgr.registerModule("", {});
        expect(result).toBe(false);
        expect(mgr.stats.errors).toBe(1);
    });

    it("registerModule fails with null name", () => {
        expect(mgr.registerModule(null, {})).toBe(false);
    });

    it("registerModule fails with null module", () => {
        expect(mgr.registerModule("Foo", null)).toBe(false);
    });

    it("registerModule fails with undefined module", () => {
        expect(mgr.registerModule("Foo", undefined)).toBe(false);
    });

    it("registerModule overwrites existing module", () => {
        mgr.registerModule("Mod", { v: 1 });
        mgr.registerModule("Mod", { v: 2 });
        expect(mgr.modules.get("Mod").v).toBe(2);
    });

    // ── hasModule ─────────────────────────────────────────────────────────
    it("hasModule returns true for cached module", () => {
        mgr.modules.set("A", {});
        expect(mgr.hasModule("A")).toBe(true);
    });

    it("hasModule returns true for aliased module", () => {
        mgr.aliases.set("AliasX", "TargetX");
        expect(mgr.hasModule("AliasX")).toBe(true);
    });

    it("hasModule returns true for GeoLeaf global module", () => {
        _g.GeoLeaf = { GlobalMod: {} };
        expect(mgr.hasModule("GlobalMod")).toBe(true);
    });

    it("hasModule returns false when module not found", () => {
        _g.GeoLeaf = {};
        expect(mgr.hasModule("Nothing")).toBe(false);
    });

    // ── getModuleList ─────────────────────────────────────────────────────
    it("getModuleList returns sorted unique list from cache + globals", () => {
        mgr.modules.set("B", {});
        mgr.modules.set("A", {});
        _g.GeoLeaf = { C: {}, A: {} };
        const list = mgr.getModuleList();
        expect(list).toEqual(["A", "B", "C"]);
    });

    it("getModuleList returns empty when no modules and no GeoLeaf", () => {
        _g.GeoLeaf = undefined;
        expect(mgr.getModuleList()).toEqual([]);
        _g.GeoLeaf = {};
    });

    // ── getStats ──────────────────────────────────────────────────────────
    it("getStats returns combined stats with cachedModules and aliases", () => {
        mgr.modules.set("X", {});
        mgr.aliases.set("Y", "X");
        mgr.isInitialized = true;
        mgr.stats.accessCount = 5;
        const stats = mgr.getStats();
        expect(stats.cachedModules).toBe(1);
        expect(stats.aliases).toBe(1);
        expect(stats.isInitialized).toBe(true);
        expect(stats.accessCount).toBe(5);
    });

    // ── refresh ───────────────────────────────────────────────────────────
    it("refresh clears and re-scans modules", () => {
        mgr.modules.set("Old", {});
        _g.GeoLeaf = { Core: {}, UI: {} };
        mgr.refresh();
        expect(mgr.modules.has("Old")).toBe(false);
        expect(mgr.modules.has("Core")).toBe(true);
        expect(mgr.modules.has("UI")).toBe(true);
    });

    // ── reset ─────────────────────────────────────────────────────────────
    it("reset clears all state", () => {
        mgr.modules.set("X", {});
        mgr.aliases.set("Y", "Z");
        mgr.isInitialized = true;
        mgr.stats.accessCount = 10;
        mgr.reset();
        expect(mgr.modules.size).toBe(0);
        expect(mgr.aliases.size).toBe(0);
        expect(mgr.isInitialized).toBe(false);
        expect(mgr.stats.accessCount).toBe(0);
    });
});
