/**
 * create → destroy → recreate lifecycle — key deliverable of the safety net.
 *
 * Documents the ORIGINAL leak: `Core.destroy(mapId)` only cleaned the
 * MapLibre adapter + the `_instances` slot; the singleton stores' business
 * state (POI, GeoJSON, LayerManager, Profile) survived → on recreate,
 * duplicates + dead adapter references.
 *
 * Two levels:
 *  - CHARACTERISATION (green then): pinned the leaking state after destroy.
 *  - TARGET `it.fails` (red then → green now): after destroy+recreate, the
 *    state must be back to initial. When the real teardown landed, these
 *    assertions passed → `.fails` was REMOVED at that point.
 *
 * Strategy: same mocks as core-multi-instance (adapter/map-container/theme/log)
 * so Core.init/destroy run without a real maplibre map, + import of the
 * real stores to seed/assert the shared state.
 */
"use strict";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/constants/constants.js", () => ({
    CONSTANTS: {
        DEFAULT_ZOOM: 13,
        DEFAULT_CENTER: [45.764, 4.835],
        TILE_SIZE: 256,
        POI_MARKER_SIZE: 16,
        POI_MAX_ZOOM: 18,
    },
}));

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    MaplibreAdapter: vi.fn().mockImplementation(
        class {
            constructor() {
                return { init: vi.fn(), destroy: vi.fn(), getNativeMap: vi.fn(() => null) };
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
let GeoJSONShared;
let LayerManager;
let ProfileManager;

beforeAll(async () => {
    ({ Core } = await import("../../src/kernel/map/facade.js"));
    ({ GeoJSONShared } = await import("../../src/kernel/geojson/shared.js"));
    ({ LayerManager } = await import("../../src/kernel/layer-manager/layer-manager-api.js"));
    ({ ProfileManager } = await import("../../src/kernel/config/profile.js"));
});

/** Resets all stores to their initial state (simulates a fresh app start). */
function resetStoresToInitial() {
    GeoJSONShared.reset(); // layers, layerIdCounter, adapter, map, options → initial

    LayerManager._reset();

    ProfileManager._activeProfileId = null;
    ProfileManager._activeProfile = null;
    ProfileManager._activeProfileData = { mapping: null };
}

/** Seeds the shared state as though a map had loaded profile + mapping + layers. */
function seedLoadedState(adapter) {
    GeoJSONShared.state.layers.set("layer-1", { features: [] });
    GeoJSONShared.state.layers.set("layer-2", { features: [] });
    GeoJSONShared.state.layerIdCounter = 2;
    GeoJSONShared.state.adapter = adapter || {};
    GeoJSONShared.state.map = {};

    // Seed the REAL module singleton — not a side object. A test that seeds the
    // state it then asserts on proves nothing about the module under test.
    LayerManager._map = {};
    LayerManager._control = { refresh() {} };
    LayerManager._options.sections = [{ id: "geojson", label: "Layers", items: [] }];

    ProfileManager._activeProfileId = "demo";
    ProfileManager._activeProfile = { id: "demo" };
    ProfileManager._activeProfileData = { mapping: {} };
}

beforeEach(() => {
    Core.listMaps().forEach((id) => Core.destroy(id));
    resetStoresToInitial();
    vi.clearAllMocks();
});

describe("cycle de vie — adapter teardown (déjà correct)", () => {
    it("destroy() nettoie l'adapter et libère le slot du registre", () => {
        const adapter = Core.init({ mapId: "map-1" });
        const ok = Core.destroy("map-1");

        expect(ok).toBe(true);
        expect(adapter.destroy).toHaveBeenCalledTimes(1);
        expect(Core.hasMap("map-1")).toBe(false);
        expect(Core.listMaps()).toEqual([]);
    });
});

describe("cycle de vie — teardown de l'état métier (corrigé en S3)", () => {
    it("destroy() vide l'état métier des stores quand la dernière carte ferme", () => {
        const adapter = Core.init({ mapId: "map-1" });
        seedLoadedState(adapter);

        Core.destroy("map-1");

        // The adapter slot is freed…
        expect(Core.listMaps()).toEqual([]);
        // … AND the business state is cleaned (the documented leak is fixed).
        expect(GeoJSONShared.state.layers.size).toBe(0);
        expect(GeoJSONShared.state.adapter).toBeNull();
        expect(ProfileManager._activeProfile).toBeNull();
        expect(LayerManager._map).toBeNull();
    });
});

describe("cycle de vie — cible S3 (vert depuis S3)", () => {
    // Key deliverable: after destroy + recreate, the shared state is back
    // to initial (no residue). The historical `.fails` was removed when the
    // real destroy()s + the seam teardown were implemented.
    it("create → destroy → recreate revient à l'état initial (aucun résidu)", () => {
        const adapter = Core.init({ mapId: "map-1" });
        seedLoadedState(adapter);
        Core.destroy("map-1");
        Core.init({ mapId: "map-2" }); // recreate

        expect(GeoJSONShared.state.layers.size).toBe(0);
        expect(GeoJSONShared.state.layerIdCounter).toBe(0);
        expect(GeoJSONShared.state.adapter).toBeNull();
        expect(ProfileManager._activeProfileId).toBeNull();
        expect(ProfileManager._activeProfile).toBeNull();
        expect(ProfileManager._activeProfileData.mapping).toBeNull();
        expect(LayerManager._map).toBeNull();
        expect(LayerManager._control).toBeNull();
        expect(LayerManager._options.sections).toEqual([]);
        expect(Core.listMaps()).toEqual(["map-2"]);
    });
});
