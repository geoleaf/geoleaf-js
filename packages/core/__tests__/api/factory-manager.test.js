/**
 * Phase 60 — Step 2.2: src/kernel/api/factory-manager.ts (0% → 60%)
 *
 * The manager no longer owns a `mapInstances` mirror; every accessor reads
 * `Core` through `getModule`. The fake below is therefore a REGISTRY, not a stub
 * returning fixed values: asserting delegation against a `vi.fn()` that always
 * answers the same thing would pass just as happily on a manager that still kept
 * its own map.
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { APIFactoryManager } from "../../src/kernel/api/factory-manager.js";

/** Minimal stand-in for `GeoLeaf.Core`, with the registry semantics that matter here. */
function makeCore(overrides = {}) {
    const instances = new Map();
    return {
        instances,
        init: (opts) => {
            const adapter = { id: opts.target };
            instances.set(opts.target, adapter);
            return adapter;
        },
        getMap: (id) =>
            id ? (instances.get(id) ?? null) : (instances.values().next().value ?? null),
        listMaps: () => Array.from(instances.keys()),
        hasMap: (id) => instances.has(id),
        destroy: (id) => instances.delete(id),
        ...overrides,
    };
}

describe("api/factory-manager (step 2.2)", () => {
    let manager;
    let core;

    beforeEach(() => {
        manager = new APIFactoryManager();
        core = makeCore();
    });

    /** Wires the manager onto `core`. */
    const wire = () => manager.init((name) => (name === "Core" ? core : null));

    it("instancie avec isReady et sans registre propre", () => {
        expect(manager.isReady).toBe(true);
        expect(manager.stats.mapsCreated).toBe(0);
        // The mirror is gone — its absence is the whole point of the rewrite.
        expect(manager.mapInstances).toBeUndefined();
    });

    it("init exige getModule function", () => {
        expect(manager.init(null)).toBe(false);
        expect(manager.init("not a function")).toBe(false);
        expect(manager.init(() => ({}))).toBe(true);
    });

    it("getMapInstance et getAllMapInstances sans map", () => {
        wire();
        expect(manager.getMapInstance("id")).toBeNull();
        expect(manager.getAllMapInstances()).toEqual([]);
    });

    it("rend null/[] avant init, sans jeter", () => {
        expect(manager.getMapInstance("id")).toBeNull();
        expect(manager.getAllMapInstances()).toEqual([]);
        expect(manager.getStats().activeInstances).toBe(0);
    });

    it("createMap without targetId fails", () => {
        wire();
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

    it("createMap with Core.init returns instance, lue depuis Core", () => {
        wire();
        const result = manager.createMap("target", {}, manager.getModule);
        expect(result).toBe(core.instances.get("target"));
        expect(manager.getMapInstance("target")).toBe(result);
        expect(manager.getAllMapInstances()).toHaveLength(1);
    });

    it("voit une carte que Core enregistre SANS passer par createMap", () => {
        wire();
        core.init({ target: "posée-ailleurs" });
        // The mirror could never have seen this one: `GeoLeaf.getMap()` returned null
        // for every map the boot path created. That is the defect, from the reading side.
        expect(manager.getMapInstance("posée-ailleurs")).not.toBeNull();
        expect(manager.getAllMapInstances()).toHaveLength(1);
    });

    it("removeMapInstance returns false si pas d’instance", () => {
        wire();
        expect(manager.removeMapInstance("unknown")).toBe(false);
    });

    it("removeMapInstance DÉTRUIT l’instance dans Core", () => {
        wire();
        manager.createMap("t1", {}, manager.getModule);
        expect(manager.removeMapInstance("t1")).toBe(true);
        expect(manager.getMapInstance("t1")).toBeNull();
        expect(core.instances.has("t1")).toBe(false);
    });

    it("getStats compte ce que Core tient", () => {
        wire();
        expect(manager.getStats().activeInstances).toBe(0);
        manager.createMap("a", {}, manager.getModule);
        manager.createMap("b", {}, manager.getModule);
        expect(manager.getStats().activeInstances).toBe(2);
    });

    it("reset remet SON état, sans détruire les cartes vivantes", () => {
        wire();
        manager.createMap("a", {}, manager.getModule);
        manager.reset();
        expect(manager.getModule).toBeNull();
        expect(manager.stats.mapsCreated).toBe(0);
        // The maps outlive the manager's reset — clearing a mirror never stopped them.
        expect(core.instances.has("a")).toBe(true);
    });
});
