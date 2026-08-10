/**
 * Phase 60 — Step 2.2: src/kernel/api/factory-manager.ts (0% → 60%)
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { APIFactoryManager } from "../../src/kernel/api/factory-manager.js";

describe("api/factory-manager (step 2.2)", () => {
    let manager;

    beforeEach(() => {
        manager = new APIFactoryManager();
    });

    it("instancie avec isReady et mapInstances", () => {
        expect(manager.isReady).toBe(true);
        expect(manager.mapInstances).toBeInstanceOf(Map);
        expect(manager.stats.mapsCreated).toBe(0);
    });

    it("init exige getModule function", () => {
        expect(manager.init(null)).toBe(false);
        expect(manager.init("not a function")).toBe(false);
        expect(manager.init(() => ({}))).toBe(true);
    });

    it("getMapInstance et getAllMapInstances sans map", () => {
        expect(manager.getMapInstance("id")).toBeNull();
        expect(manager.getAllMapInstances()).toEqual([]);
    });

    it("createMap without targetId fails", () => {
        manager.init((name) => (name === "Core" ? { init: vi.fn() } : null));
        expect(manager.createMap(null, {}, manager.getModule)).toBeNull();
    });

    it("createMap without getModule fails", () => {
        manager.init((name) => (name === "Core" ? null : {}));
        expect(manager.createMap("target", {}, manager.getModule)).toBeNull();
    });

    it("createMap with Core without init fails", () => {
        manager.init((name) => (name === "Core" ? {} : null));
        expect(manager.createMap("target", {}, manager.getModule)).toBeNull();
    });

    it("createMap with Core.init returns instance", () => {
        const fakeMap = {};
        manager.init((name) => (name === "Core" ? { init: () => fakeMap } : null));
        const result = manager.createMap("target", {}, manager.getModule);
        expect(result).toBe(fakeMap);
        expect(manager.getMapInstance("target")).toBe(fakeMap);
        expect(manager.getAllMapInstances()).toHaveLength(1);
    });

    it("removeMapInstance returns false si pas d’instance", () => {
        expect(manager.removeMapInstance("unknown")).toBe(false);
    });

    it("removeMapInstance supprime l’instance", () => {
        manager.init((name) => (name === "Core" ? { init: () => ({}) } : null));
        manager.createMap("t1", {}, manager.getModule);
        expect(manager.removeMapInstance("t1")).toBe(true);
        expect(manager.getMapInstance("t1")).toBeNull();
    });

    it("getStats et reset", () => {
        expect(manager.getStats().activeInstances).toBe(0);
        manager.reset();
        expect(manager.mapInstances.size).toBe(0);
        expect(manager.getModule).toBeNull();
    });
});
