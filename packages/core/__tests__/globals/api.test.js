/**
 */
/* T22 — modules/globals.api.ts branch coverage
 *
 * Targets:
 *   MISS[10,11,14] if(Log) in catch blocks
 *   MISS[15,16]    createMap ctrl.geoleafCreateMap path
 *   MISS[17,18]    getMap ctrl.managers.factory path
 *   MISS[19,20]    getAllMaps ctrl.managers.factory path
 *   MISS[23,24]    getModule ctrl.moduleAccessFn path
 *   MISS[25,26]    hasModule ctrl.moduleAccessFn path
 *   MISS[30,31]    getHealth both branches
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/kernel/api/controller.js", () => ({ APIController: {} }));
vi.mock("../../src/kernel/api/factory-manager.js", () => ({ APIFactoryManager: {} }));
vi.mock("../../src/kernel/api/initialization-manager.js", () => ({
    APIInitializationManager: {},
}));
vi.mock("../../src/kernel/api/module-manager.js", () => ({ APIModuleManager: {} }));
vi.mock("../../src/api/geoleaf.baselayers.js", () => ({ Baselayers: {} }));
vi.mock("../../src/api/geoleaf.core.js", () => ({ Core: {} }));
vi.mock("../../src/api/geoleaf.helpers.js", () => ({ Helpers: {} }));
vi.mock("../../src/api/geoleaf.layer-manager.js", () => ({ LayerManager: {} }));
vi.mock("../../src/api/geoleaf.legend.js", () => ({ Legend: {} }));
vi.mock("../../src/api/geoleaf.poi.js", () => ({ POI: {} }));
vi.mock("../../src/api/geoleaf.ui.js", () => ({ UI: {} }));
vi.mock("../../src/api/geoleaf.validators.js", () => ({ Validators: {} }));
vi.mock("../../src/kernel/api/boot-info.js", () => ({ BootInfo: {} }));
vi.mock("../../src/kernel/api/plugin-registry.js", () => ({
    PluginRegistry: { register: vi.fn() },
}));
vi.mock("../../src/kernel/poi/renderers/field-renderers.js", () => ({
    FieldRenderers: {},
}));
vi.mock("../../src/kernel/poi/renderers/media-renderers.js", () => ({
    MediaRenderers: {},
}));
// geoleaf.permalink (Lot 6) and geoleaf.pwa / geoleaf.sync (Lot 7) are no longer imported
// by globals.api.ts.
vi.mock("../../src/api/geoleaf.events.js", () => ({ Events: {} }));

import "../../src/globals/globals.api.js";

import { Log } from "../../src/utils/log/index.js";
const GL = globalThis.GeoLeaf;

describe("globals.api — T22 branch coverage", () => {
    beforeEach(() => {
        GL._APIController = null;
    });

    // ── catch blocks: if (Log) ────────────────────────────────────────────────
    //
    // ⚠️ The three fake controllers below now carry
    // `isInitialized: true`, and that is LOAD-BEARING. `init`, `setTheme`
    // and `loadConfig` now go through `requireController()`, which refuses a
    // failed controller BEFORE delegating. Without this flag, the three
    // tests receive "APIController in failed state" instead of the
    // delegate's error — they no longer reach the `catch` block they exist
    // to cover.
    //
    // Not a workaround: the validation is exactly what was carried over from
    // `kernel/api/geoleaf-api.ts` before its duplicate was deleted, and
    // without it a failed controller makes the boot HANG silently (see
    // `requireController`'s note). The fakes thus declare what a live real
    // controller declares.

    it("GeoLeaf.init: catch block runs if(Log) when _APIController.geoleafInit throws (MISS[10])", () => {
        GL._APIController = {
            isInitialized: true,
            geoleafInit: vi.fn(() => {
                throw new Error("init-err");
            }),
        };
        expect(() => GL.init({})).toThrow("init-err");
        expect(Log.error).toHaveBeenCalledWith("[GeoLeaf.init]", expect.any(Error));
    });

    it("GeoLeaf.setTheme: catch block runs if(Log) when geoleafSetTheme throws (MISS[11])", () => {
        GL._APIController = {
            isInitialized: true,
            geoleafSetTheme: vi.fn(() => {
                throw new Error("theme-err");
            }),
        };
        expect(() => GL.setTheme("dark")).toThrow("theme-err");
        expect(Log.error).toHaveBeenCalledWith("[GeoLeaf.setTheme]", expect.any(Error));
    });

    it("GeoLeaf.loadConfig: catch block runs if(Log) when geoleafLoadConfig throws (MISS[14])", () => {
        GL._APIController = {
            isInitialized: true,
            geoleafLoadConfig: vi.fn(() => {
                throw new Error("cfg-err");
            }),
        };
        expect(() => GL.loadConfig("http://x.example/config.json")).toThrow("cfg-err");
        expect(Log.error).toHaveBeenCalledWith("[GeoLeaf.loadConfig]", expect.any(Error));
    });

    // ── createMap ─────────────────────────────────────────────────────────────

    it("GeoLeaf.createMap: calls ctrl.geoleafCreateMap when present (MISS[15] cond[0], MISS[16] binary[1])", () => {
        const geoleafCreateMap = vi.fn(() => "mapInst");
        GL._APIController = { geoleafCreateMap };
        expect(GL.createMap("map1", { zoom: 5 })).toBe("mapInst");
        expect(geoleafCreateMap).toHaveBeenCalledWith("map1", { zoom: 5 });
    });

    // ── getMap ────────────────────────────────────────────────────────────────

    it("GeoLeaf.getMap: returns null when ctrl.managers is null (MISS[18] binary[1])", () => {
        GL._APIController = { managers: null };
        expect(GL.getMap("m1")).toBeNull();
    });

    it("GeoLeaf.getMap: calls factory.getMapInstance when fully available (MISS[17] cond[0], MISS[18] binary[2])", () => {
        const getMapInstance = vi.fn(() => "instance1");
        GL._APIController = { managers: { factory: { getMapInstance } } };
        expect(GL.getMap("m1")).toBe("instance1");
        expect(getMapInstance).toHaveBeenCalledWith("m1");
    });

    // ── getAllMaps ─────────────────────────────────────────────────────────────

    it("GeoLeaf.getAllMaps: returns [] when ctrl.managers is null (MISS[20] binary[1])", () => {
        GL._APIController = { managers: null };
        expect(GL.getAllMaps()).toEqual([]);
    });

    it("GeoLeaf.getAllMaps: calls factory.getAllMapInstances when fully available (MISS[19] cond[0], MISS[20] binary[2])", () => {
        const getAllMapInstances = vi.fn(() => ["m1", "m2"]);
        GL._APIController = { managers: { factory: { getAllMapInstances } } };
        expect(GL.getAllMaps()).toEqual(["m1", "m2"]);
    });

    // ── getModule ─────────────────────────────────────────────────────────────

    it("GeoLeaf.getModule: calls ctrl.moduleAccessFn when available (MISS[23] cond[0], MISS[24] binary[1])", () => {
        const moduleAccessFn = vi.fn(() => "myMod");
        GL._APIController = { moduleAccessFn };
        expect(GL.getModule("MyModule")).toBe("myMod");
        expect(moduleAccessFn).toHaveBeenCalledWith("MyModule");
    });

    // ── hasModule ─────────────────────────────────────────────────────────────

    it("GeoLeaf.hasModule: returns true when ctrl.moduleAccessFn returns truthy (MISS[25] cond[0], MISS[26] binary[1])", () => {
        GL._APIController = { moduleAccessFn: vi.fn(() => "mod") };
        expect(GL.hasModule("MyModule")).toBe(true);
    });

    // ── getHealth ─────────────────────────────────────────────────────────────

    it("GeoLeaf.getHealth: returns null when ctrl is null (MISS[30] cond[1], MISS[31] binary[0])", () => {
        GL._APIController = null;
        expect(GL.getHealth()).toBeNull();
    });

    it("GeoLeaf.getHealth: calls ctrl.getHealthStatus when available (MISS[30] cond[0], MISS[31] binary[1])", () => {
        const getHealthStatus = vi.fn(() => ({ status: "ok" }));
        GL._APIController = { getHealthStatus };
        expect(GL.getHealth()).toEqual({ status: "ok" });
        expect(getHealthStatus).toHaveBeenCalled();
    });

    // ── B11 — new namespace assignments ────────────────────────────────────────

    // GeoLeaf.PWA + GeoLeaf.Sync migrated to capabilities/{pwa,offline}/install.ts (S2 Lot 7)
    // — asserted in __tests__/capabilities/pwa-offline-installers.test.js.
    // GeoLeaf.Permalink migrated to capabilities/permalink/install.ts (S2 Lot 6) —
    // asserted in __tests__/capabilities/permalink-share-installer.test.js.

    it("GeoLeaf.events is assigned from Events module", () => {
        expect(GL.events).toBeDefined();
        expect(GL.events).toBeTypeOf("object");
    });
});
