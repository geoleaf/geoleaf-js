/**
 * Core multi-instance — keyed registry behaviour.
 *
 * Verifies that Core manages N coexisting maps keyed by mapId, exposes
 * destroy/hasMap/listMaps, and keeps getMap(mapId?) backward compatible.
 *
 * Strategy: import Core directly from map/facade.js with the heavy collaborators
 * (MaplibreAdapter, map-container, theme) mocked so no real maplibre-gl.Map is created.
 */
"use strict";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/constants/constants.js", () => ({
    CONSTANTS: { DEFAULT_ZOOM: 13, DEFAULT_CENTER: [45.764, 4.835], TILE_SIZE: 256 },
}));

// Each `new MaplibreAdapter()` yields a distinct object with its own spies.
vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    MaplibreAdapter: vi.fn().mockImplementation(
        // Vitest 4: constructable mock. Each `new` runs the constructor afresh →
        // a distinct object with its own spies (as the test requires).
        class {
            constructor() {
                return {
                    init: vi.fn(),
                    destroy: vi.fn(),
                    getNativeMap: vi.fn(() => null),
                };
            }
        }
    ),
}));

vi.mock("../../src/kernel/map/map-container.js", () => ({
    resolveMapContainer: vi.fn(() => document.createElement("div")),
    applyThemeSafe: vi.fn(),
}));

vi.mock("../../src/kernel/map/theme.js", () => ({
    setTheme: vi.fn(),
    getTheme: vi.fn(() => "light"),
}));

let Core;
let Log;
let mapFactory;

beforeAll(async () => {
    ({ Core } = await import("../../src/kernel/map/facade.js"));
    ({ Log } = await import("../../src/utils/log/index.js"));
    mapFactory = await import("../../src/kernel/map/map-container.js");
});

beforeEach(() => {
    // Reset the registry between tests so each starts from a clean slate.
    Core.listMaps().forEach((id) => Core.destroy(id));
    vi.clearAllMocks();
});

describe("Core multi-instance — init / registry", () => {
    it("init() without mapId returns null, logs an error, registers nothing", () => {
        const result = Core.init({});
        expect(result).toBeNull();
        expect(Log.error).toHaveBeenCalled();
        expect(Core.listMaps()).toEqual([]);
    });

    it("init() with mapId registers a keyed instance", () => {
        const adapter = Core.init({ mapId: "map-1", center: [0, 0], zoom: 5 });
        expect(adapter).toBeTruthy();
        expect(Core.hasMap("map-1")).toBe(true);
        expect(Core.listMaps()).toEqual(["map-1"]);
    });

    it("supports N coexisting maps — listMaps tracks every id", () => {
        const a1 = Core.init({ mapId: "map-1" });
        const a2 = Core.init({ mapId: "map-2" });
        const a3 = Core.init({ mapId: "map-3" });

        expect(Core.listMaps()).toEqual(["map-1", "map-2", "map-3"]);
        // Each map owns a distinct adapter instance.
        expect(a1).not.toBe(a2);
        expect(a2).not.toBe(a3);
    });

    it("re-init of an existing mapId returns the same instance and warns", () => {
        const first = Core.init({ mapId: "map-1" });
        const second = Core.init({ mapId: "map-1" });

        expect(second).toBe(first);
        expect(Log.warn).toHaveBeenCalled();
        expect(Core.listMaps()).toEqual(["map-1"]);
    });
});

describe("Core multi-instance — getMap accessor", () => {
    it("getMap(mapId) returns the targeted instance", () => {
        const a1 = Core.init({ mapId: "map-1" });
        const a2 = Core.init({ mapId: "map-2" });

        expect(Core.getMap("map-1")).toBe(a1);
        expect(Core.getMap("map-2")).toBe(a2);
    });

    it("getMap() without arg returns the first active instance (backward compat)", () => {
        const a1 = Core.init({ mapId: "solo" });
        expect(Core.getMap()).toBe(a1);
        expect(Core.getMap("solo")).toBe(a1);
        // getAdapter is the same accessor.
        expect(Core.getAdapter("solo")).toBe(a1);
    });

    it("getMap(unknown) returns null", () => {
        Core.init({ mapId: "map-1" });
        expect(Core.getMap("nope")).toBeNull();
    });
});

describe("Core multi-instance — destroy", () => {
    it("destroy(mapId) calls adapter.destroy, frees the slot, returns true", () => {
        const adapter = Core.init({ mapId: "map-1" });
        const ok = Core.destroy("map-1");

        expect(ok).toBe(true);
        expect(adapter.destroy).toHaveBeenCalledTimes(1);
        expect(Core.hasMap("map-1")).toBe(false);
        expect(Core.listMaps()).toEqual([]);
    });

    it("destroying one of several maps leaves the others intact", () => {
        Core.init({ mapId: "map-1" });
        const a2 = Core.init({ mapId: "map-2" });
        Core.init({ mapId: "map-3" });

        Core.destroy("map-2");

        expect(Core.listMaps()).toEqual(["map-1", "map-3"]);
        expect(Core.getMap("map-2")).toBeNull();
        expect(a2.destroy).toHaveBeenCalledTimes(1);
    });

    it("destroy(unknown) returns false and warns", () => {
        const ok = Core.destroy("ghost");
        expect(ok).toBe(false);
        expect(Log.warn).toHaveBeenCalled();
    });

    it("destroy all then re-init starts from a clean registry", () => {
        Core.init({ mapId: "map-1" });
        Core.init({ mapId: "map-2" });
        Core.listMaps().forEach((id) => Core.destroy(id));

        expect(Core.listMaps()).toEqual([]);
        Core.init({ mapId: "map-4" });
        expect(Core.listMaps()).toEqual(["map-4"]);
    });
});

describe("Core multi-instance — global theme scope", () => {
    it("applies theme only for the first instance", () => {
        Core.init({ mapId: "map-1" });
        Core.init({ mapId: "map-2" });
        Core.init({ mapId: "map-3" });

        expect(mapFactory.applyThemeSafe).toHaveBeenCalledTimes(1);
    });
});
