/**
 * Phase 60 — Step 2.6: src/kernel/api/module-manager.ts (0% → 60%)
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { APIModuleManager } from "../../src/kernel/api/module-manager.js";

describe("api/module-manager (step 2.6)", () => {
    let manager;

    beforeEach(() => {
        manager = new APIModuleManager();
        globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    });

    it("instancie avec modules Map et isInitialized false", () => {
        expect(manager.modules).toBeInstanceOf(Map);
        expect(manager.isInitialized).toBe(false);
        expect(manager.stats.totalModules).toBe(0);
    });

    it("init scanne GeoLeaf et enregistre les modules", () => {
        globalThis.GeoLeaf.Core = {};
        globalThis.GeoLeaf.UI = {};
        expect(manager.init()).toBe(true);
        expect(manager.isInitialized).toBe(true);
        expect(manager.getModule("Core")).toBe(globalThis.GeoLeaf.Core);
        expect(manager.getModule("UI")).toBe(globalThis.GeoLeaf.UI);
    });

    it("init idempotent returns true", () => {
        globalThis.GeoLeaf.Core = {};
        expect(manager.init()).toBe(true);
        expect(manager.init()).toBe(true);
    });

    it("getModule avec nom invalid returns null", () => {
        manager.init();
        expect(manager.getModule()).toBeNull();
        expect(manager.getModule(null)).toBeNull();
        expect(manager.getModule(123)).toBeNull();
    });

    it("registerModule et hasModule", () => {
        expect(manager.registerModule("", {})).toBe(false);
        expect(manager.registerModule("X", null)).toBe(false);
        expect(manager.registerModule("Custom", { foo: 1 })).toBe(true);
        expect(manager.getModule("Custom")).toEqual({ foo: 1 });
        expect(manager.hasModule("Custom")).toBe(true);
        expect(manager.hasModule("Missing")).toBe(false);
    });

    it("getModule fallback towards GeoLeaf", () => {
        globalThis.GeoLeaf.Other = { bar: 2 };
        manager.init();
        expect(manager.getModule("Other")).toEqual({ bar: 2 });
    });
});
