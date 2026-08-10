/**
 * Cycle de vie create → destroy → recreate — livrable clé du filet S0
 * (roadmap boot-di-lifecycle).
 *
 * Documente la FUITE actuelle : `Core.destroy(mapId)` ne nettoie que l'adapter
 * MapLibre + le slot `_instances` ; l'état métier des stores singletons (POI,
 * GeoJSON, LayerManager, Profile) survit → au recreate, doublons + références
 * d'adapter mort. Voir _docs_projet/travail/rapports/rapport_etat-partage-inter-modules.md.
 *
 * Deux niveaux :
 *  - CARACTÉRISATION (vert aujourd'hui) : pin l'état fuyant après destroy.
 *  - CIBLE `it.fails` (rouge aujourd'hui → vert en S3) : après destroy+recreate,
 *    l'état doit être revenu à l'initial. Quand S3 implémente le teardown réel,
 *    ces assertions passeront → RETIRER `.fails` à ce moment-là.
 *
 * Stratégie : mêmes mocks que core-multi-instance (adapter/map-container/theme/log)
 * pour que Core.init/destroy tournent sans vraie carte maplibre, + import des
 * stores réels pour seeder/asserter l'état partagé.
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

/** Remet tous les stores à leur état initial (simule un démarrage applicatif neuf). */
function resetStoresToInitial() {
    GeoJSONShared.reset(); // layers, layerIdCounter, adapter, map, options → initial

    LayerManager._reset();

    ProfileManager._activeProfileId = null;
    ProfileManager._activeProfile = null;
    ProfileManager._activeProfileData = { mapping: null };
}

/** Seede l'état partagé comme si une carte avait chargé profil + mapping + couches. */
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

        // Le slot adapter est libéré…
        expect(Core.listMaps()).toEqual([]);
        // … ET l'état métier est nettoyé (la fuite documentée en S0 est corrigée).
        expect(GeoJSONShared.state.layers.size).toBe(0);
        expect(GeoJSONShared.state.adapter).toBeNull();
        expect(ProfileManager._activeProfile).toBeNull();
        expect(LayerManager._map).toBeNull();
    });
});

describe("cycle de vie — cible S3 (vert depuis S3)", () => {
    // Livrable clé du chantier : après destroy + recreate, l'état partagé est
    // revenu à l'initial (aucun résidu). Le `.fails` historique a été retiré en
    // S3 quand les destroy() réels + le teardown du seam ont été implémentés.
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
