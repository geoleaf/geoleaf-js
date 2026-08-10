/**
 * Phase 60 — Step 2.1: src/kernel/api/controller.ts (0% → 60%)
 * APIController depends on _g.GeoLeaf.API avec APIModuleManager, APIInitializationManager, APIFactoryManager
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { APIModuleManager } from "../../src/kernel/api/module-manager.js";
import { APIInitializationManager } from "../../src/kernel/api/initialization-manager.js";
import { APIFactoryManager } from "../../src/kernel/api/factory-manager.js";

globalThis.GeoLeaf = globalThis.GeoLeaf || {};
globalThis.GeoLeaf.API = {
    APIModuleManager,
    APIInitializationManager,
    APIFactoryManager,
};

import { APIController } from "../../src/kernel/api/controller.js";

describe("api/controller (step 2.1)", () => {
    it("exporte APIController", () => {
        expect(APIController).toBeDefined();
        expect(typeof APIController).toBe("function");
    });

    it("instancie avec isInitialized false et managers vides", () => {
        const ctrl = new APIController();
        expect(ctrl.isInitialized).toBe(false);
        expect(ctrl.managers).toEqual({});
        expect(ctrl.moduleAccessFn).toBeNull();
    });

    it("init loads les managers et configure moduleAccessFn", () => {
        const ctrl = new APIController();
        expect(ctrl.init()).toBe(true);
        expect(ctrl.isInitialized).toBe(true);
        expect(ctrl.managers.module).toBeInstanceOf(APIModuleManager);
        expect(ctrl.managers.initialization).toBeInstanceOf(APIInitializationManager);
        expect(ctrl.managers.factory).toBeInstanceOf(APIFactoryManager);
        expect(typeof ctrl.moduleAccessFn).toBe("function");
    });

    it("getHealthStatus returns state", () => {
        const ctrl = new APIController();
        ctrl.init();
        const health = ctrl.getHealthStatus();
        expect(health.isInitialized).toBe(true);
        expect(health.managersCount).toBe(3);
        expect(health.hasModuleAccess).toBe(true);
    });

    it("geoleafInit without init returns null", () => {
        const ctrl = new APIController();
        expect(ctrl.geoleafInit({})).toBeNull();
    });

    it("geoleafInit with init delegates to initialization manager", () => {
        const ctrl = new APIController();
        ctrl.init();
        const getModule = (name) => (name === "Core" ? { init: () => ({}) } : null);
        ctrl.moduleAccessFn = getModule;
        ctrl.managers.initialization.init = vi.fn().mockReturnValue({ map: true });
        const result = ctrl.geoleafInit({ target: "#map" });
        expect(result).toEqual({ map: true });
    });

    it("geoleafSetTheme with init delegates to initialization manager", () => {
        const ctrl = new APIController();
        ctrl.init();
        ctrl.managers.initialization.setTheme = vi.fn().mockReturnValue(true);
        expect(ctrl.geoleafSetTheme("dark")).toBe(true);
        expect(ctrl.managers.initialization.setTheme).toHaveBeenCalledWith(
            "dark",
            ctrl.moduleAccessFn
        );
    });

    it("geoleafLoadConfig with init returns promesse", async () => {
        const ctrl = new APIController();
        ctrl.init();
        ctrl.managers.initialization.loadConfig = vi.fn().mockResolvedValue({});
        const p = ctrl.geoleafLoadConfig("https://example.com");
        expect(p).toBeInstanceOf(Promise);
        await expect(p).resolves.toEqual({});
    });

    it("moduleAccessFn avec nom invalid returns null", () => {
        const ctrl = new APIController();
        ctrl.init();
        expect(ctrl.moduleAccessFn(null)).toBeNull();
        expect(ctrl.moduleAccessFn(123)).toBeNull();
    });

    it("geoleafSetTheme without init returns false", () => {
        const ctrl = new APIController();
        expect(ctrl.geoleafSetTheme("dark")).toBe(false);
    });

    it("reset resets l’state", () => {
        const ctrl = new APIController();
        ctrl.init();
        ctrl.reset();
        expect(ctrl.isInitialized).toBe(false);
        expect(ctrl.managers).toEqual({});
        expect(ctrl.moduleAccessFn).toBeNull();
    });
});
