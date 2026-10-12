/**
 * A terrain put on by the SELECTION of its basemap (`terrain.default3D`), where it meets what
 * the engine does behind the kernel's back: a source of that id already in the style, a removal
 * the engine refuses, a style it rebuilds, a basemap applied again.
 *
 * The kernel is real — registry, strategies, terrain — and only the engine is faked
 * (`createStyleEngine`): its `removeSource` refuses with an `error` event while a layer reads the
 * source, and a style it rebuilds comes back with no terrain.
 *
 * `terrain-pitch.test.ts`, next door, holds the terrain that follows the tilt and the hand-over
 * between the two modes.
 *
 * What only the real engine can say: a style replayed AS IT WAS carries its terrain, and the
 * engine puts it back itself. Measured in Chromium, the terrain is lost when the incoming style
 * does not declare it — the case `landRebuild` plays here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const Log = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log }));

const resolveWmtsTilesUrl = vi.hoisted(() => vi.fn());
const buildWmsUrl = vi.hoisted(() => vi.fn());
vi.mock("../../src/kernel/basemaps/wmts-resolver.js", () => ({ buildWmsUrl, resolveWmtsTilesUrl }));

import {
    _baseLayers,
    _resetStateForTesting,
    refreshBasemap,
    registerBaseLayer,
    resetBasemapRegistry,
    setBaseLayer,
    setMap,
} from "../../src/kernel/basemaps/registry.ts";
import {
    _resetTerrainStateForTesting,
    activateTerrain,
    getActiveTerrainBasemapKey,
    isTerrainActive,
} from "../../src/kernel/basemaps/terrain.ts";
import { createStyleEngine, type StyleEngine, type StyleJSON } from "../_helpers/style-engine.ts";

const BASEMAP_SOURCE = "__geoleaf_basemap__";
const BASEMAP_LAYER = "__geoleaf_basemap_layer__";
const TERRAIN_SOURCE = "terrain-dem";
const DEM = "https://dem.example.com/{z}/{x}/{y}.png";
const DEM_B = "https://dem-b.example.com/{z}/{x}/{y}.png";
const TILES_A = "https://a.example.com/{z}/{x}/{y}.png";
const TILES_B = "https://b.example.com/{z}/{x}/{y}.png";
const STYLE_A = "https://styles.example.com/a.json";
const STYLE_B = "https://styles.example.com/b.json";
const REMOVED = "[TerrainManager] raster-dem source removed.";

/** A terrain put on by the selection of its basemap, on the elevation source `demUrl`. */
const selected = (extra: Record<string, unknown> = {}) => ({
    enabled: true,
    demUrl: DEM,
    default3D: true,
    pitch: 60,
    bearing: 30,
    ...extra,
});

function vectorStyle(name: string): StyleJSON {
    return {
        version: 8,
        name,
        sources: { base: { type: "vector", url: `https://tiles.test/${name}.json` } },
        layers: [{ id: "land", type: "fill", source: "base" }],
    };
}

const g = globalThis as unknown as { GeoLeaf?: { Core?: unknown } };
let previousCore: unknown;
let engine: StyleEngine;

function register(id: string, definition: Record<string, unknown>): void {
    registerBaseLayer(id, { id, label: id, ...definition } as never);
}
const tiles = (url: string, extra: Record<string, unknown> = {}) => ({ url, ...extra });

type Spy = { mock: { calls: unknown[][] } };
const spy = (name: keyof StyleEngine, from: StyleEngine = engine): Spy =>
    from[name] as unknown as Spy;

/** Every terrain write the kernel made, oldest first. */
const writes = (): string[] =>
    spy("setTerrain").mock.calls.map(([options]) => (options ? "on" : "off"));

/** The elevation source the live style declares for the terrain, or `undefined`. */
const demUrl = (): unknown =>
    (engine.style().sources[TERRAIN_SOURCE]?.tiles as unknown[] | undefined)?.[0];

/** Calls made to a spied engine method with the terrain's source id. */
const demCalls = (name: "addSource" | "removeSource"): number =>
    spy(name).mock.calls.filter(([id]) => id === TERRAIN_SOURCE).length;

/** How many handlers the kernel holds on `event` right now: registered and not taken back. */
function listening(event: string, from: StyleEngine = engine): number {
    const of = (name: "on" | "off"): number =>
        spy(name, from).mock.calls.filter(([type]) => type === event).length;
    return of("on") - of("off");
}

/** What the log said, at `level`, as one string per call. */
const said = (level: keyof typeof Log): string[] =>
    Log[level].mock.calls.map((args) => args.map(String).join(" "));

/** A hillshade layer that reads the terrain's source — what makes the engine refuse a removal. */
function holdDemSource(): void {
    engine.addLayer({ id: "ombrage", type: "hillshade", source: TERRAIN_SOURCE });
}

beforeEach(() => {
    vi.clearAllMocks();
    buildWmsUrl.mockReturnValue(null);
    previousCore = g.GeoLeaf?.Core;
    g.GeoLeaf = { ...(g.GeoLeaf ?? {}), Core: null };
    engine = createStyleEngine();
    setMap(engine as never);
});

afterEach(() => {
    for (const key of Object.keys(_baseLayers)) delete _baseLayers[key];
    _resetStateForTesting();
    _resetTerrainStateForTesting();
    setMap(null);
    g.GeoLeaf = { ...(g.GeoLeaf ?? {}), Core: previousCore };
});

describe("relief par sélection — la source d'altitude", () => {
    it("deux fonds d'altitudes différentes : le second lit la sienne, et la garde au rendu suivant", () => {
        register("a", tiles(TILES_A, { terrain: selected() }));
        register("b", tiles(TILES_B, { terrain: selected({ demUrl: DEM_B }) }));
        setBaseLayer("a");

        setBaseLayer("b");

        expect(demUrl(), "le second fond lit l'altitude du premier").toBe(DEM_B);
        expect(engine.getTerrain()).toEqual({ source: TERRAIN_SOURCE, exaggeration: 1.5 });

        engine.fire("render");
        expect(demUrl(), "le retrait armé par le fond parti a emporté la source").toBe(DEM_B);
        expect(engine.getTerrain()).not.toBeNull();
        expect(engine.refusals()).toEqual([]);
        expect(getActiveTerrainBasemapKey()).toBe("b");
    });

    it("deux fonds de même altitude : la source est gardée, ni retirée ni redéclarée", () => {
        register("a", tiles(TILES_A, { terrain: selected() }));
        register("b", tiles(TILES_B, { terrain: selected() }));
        setBaseLayer("a");

        setBaseLayer("b");
        engine.fire("render");

        expect(demCalls("addSource")).toBe(1);
        expect(demCalls("removeSource")).toBe(0);
        expect(demUrl()).toBe(DEM);
        expect(engine.getTerrain()).not.toBeNull();
    });

    it("relief quitté, source partie : le journal dit le retrait", () => {
        register("relief", tiles(TILES_A, { terrain: selected() }));
        register("plat", tiles(TILES_B));
        setBaseLayer("relief");

        setBaseLayer("plat");
        engine.fire("render");

        expect(demUrl()).toBeUndefined();
        expect(said("debug")).toContain(REMOVED);
    });

    it("relief quitté, retrait refusé par le moteur : le journal ne dit pas la source retirée", () => {
        register("relief", tiles(TILES_A, { terrain: selected() }));
        register("plat", tiles(TILES_B));
        setBaseLayer("relief");
        holdDemSource();

        setBaseLayer("plat");
        engine.fire("render");

        expect(demUrl(), "la doublure a laissé partir une source lue par une couche").toBe(DEM);
        expect(said("debug"), "le journal dit retirée une source gardée").not.toContain(REMOVED);
        expect(said("warn").some((line) => line.includes("left in place"))).toBe(true);
    });

    it("une source d'une autre altitude tenue par une couche : ni relief, ni caméra, et c'est dit", () => {
        engine.addSource(TERRAIN_SOURCE, {
            type: "raster-dem",
            tiles: [DEM_B],
            encoding: "terrarium",
            tileSize: 256,
            maxzoom: 15,
        });
        holdDemSource();
        register("relief", tiles(TILES_A, { terrain: selected() }));

        setBaseLayer("relief");

        expect(engine.getTerrain(), "le relief est drapé sur l'altitude d'un autre").toBeNull();
        expect(spy("jumpTo").mock.calls, "la caméra a été posée sans relief").toEqual([]);
        expect(isTerrainActive()).toBe(false);
        expect(said("warn").some((line) => line.includes("could not be replaced"))).toBe(true);
    });
});

describe("relief par sélection — un style reconstruit par le moteur", () => {
    beforeEach(() => {
        register("relief", tiles(TILES_A, { terrain: selected() }));
        register("plat", tiles(TILES_B));
        setBaseLayer("relief");
        spy("setTerrain").mock.calls.length = 0;
        spy("jumpTo").mock.calls.length = 0;
    });

    it("le relief revient avec sa source, et la caméra n'est pas touchée", () => {
        engine.startRebuild();
        engine.landRebuild();

        expect(demUrl()).toBe(DEM);
        expect(engine.getTerrain()).toEqual({ source: TERRAIN_SOURCE, exaggeration: 1.5 });
        expect(writes()).toEqual(["on"]);
        expect(spy("jumpTo").mock.calls, "la reconstruction a reposé la caméra").toEqual([]);
        expect(spy("easeTo").mock.calls).toEqual([]);
        expect(isTerrainActive()).toBe(true);
    });

    it("relief effacé dans le dos du module : l'état le dit", () => {
        engine.setTerrain(null);

        expect(isTerrainActive(), "le module dit posé un relief que la carte n'a plus").toBe(false);
    });

    it("contexte WebGL perdu puis restauré : le moteur a gardé le relief, rien n'est réécrit", () => {
        spy("addSource").mock.calls.length = 0;

        engine.loseContext();
        engine.restoreContext();

        expect(writes()).toEqual([]);
        expect(demCalls("addSource")).toBe(0);
        expect(isTerrainActive()).toBe(true);
    });

    it("le fond quitté : son écouteur de style est repris, et rien ne repose le relief", () => {
        expect(listening("style.load")).toBe(1);

        setBaseLayer("plat");
        expect(listening("style.load"), "un écouteur `style.load` est resté").toBe(0);

        engine.fire("render");
        engine.startRebuild();
        engine.landRebuild();
        expect(engine.getTerrain(), "le fond parti a reposé son relief").toBeNull();
    });

    it("démontage : l'écouteur est repris, rien n'est écrit sur la carte qui part", () => {
        resetBasemapRegistry();

        expect(listening("style.load")).toBe(0);
        expect(writes()).toEqual([]);
    });
});

describe("relief par sélection — une activation rejouée", () => {
    it("`activateTerrain` deux fois sans retrait : les écouteurs ne sont pas doublés", () => {
        activateTerrain(engine as never, selected() as never, "relief");
        activateTerrain(engine as never, selected() as never, "relief");

        expect(listening("style.load")).toBe(1);
        expect(listening("error")).toBe(1);
        expect(demCalls("addSource")).toBe(1);
    });
});

describe("relief par sélection — une bascule de style du noyau", () => {
    it("deux fonds vectoriels à relief : coupé avant le style, posé une fois à son arrivée", () => {
        register("a", { type: "maplibre", style: STYLE_A, terrain: selected() });
        register("b", { type: "maplibre", style: STYLE_B, terrain: selected() });
        setBaseLayer("a");
        engine.deliver(vectorStyle("a"));
        expect(writes()).toEqual(["on"]);

        setBaseLayer("b");
        expect(writes()).toEqual(["on", "off"]);

        engine.deliver(vectorStyle("b"));
        expect(writes(), "le relief a été posé deux fois à l'arrivée du style").toEqual([
            "on",
            "off",
            "on",
        ]);
    });
});

describe("relief par sélection — un fond rafraîchi", () => {
    // `refreshBasemap` re-applies a basemap whose source went missing. The camera is posted by
    // the SELECTION of a basemap, never by its refresh: a visitor who turned the map since keeps
    // their angle.
    it("le fond revient, le relief n'est pas réécrit et la caméra n'est pas reposée", () => {
        register("relief", tiles(TILES_A, { terrain: selected() }));
        setBaseLayer("relief");
        engine.removeLayer(BASEMAP_LAYER);
        engine.removeSource(BASEMAP_SOURCE);

        refreshBasemap();

        expect(engine.getSource(BASEMAP_SOURCE), "le fond n'a pas été reposé").toBeDefined();
        expect(writes()).toEqual(["on"]);
        expect(spy("jumpTo").mock.calls, "le rafraîchissement a reposé la caméra").toEqual([
            [{ pitch: 60, bearing: 30 }],
        ]);
        expect(spy("easeTo").mock.calls).toEqual([]);
        expect(isTerrainActive()).toBe(true);
        expect(listening("error"), "l'écouteur d'erreurs d'altitude a été doublé").toBe(1);
        expect(listening("style.load")).toBe(1);
    });
});
