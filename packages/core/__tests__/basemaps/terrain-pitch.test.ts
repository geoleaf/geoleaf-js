/**
 * A terrain that FOLLOWS THE TILT (`terrain.activation: "pitch"`): absent while the map is flat,
 * put on once the camera comes to rest tilted past a threshold, removed once it comes to rest
 * under a lower one — and the camera never moved by any of it.
 *
 * What these cases prove is a DECISION and a LIFECYCLE, so the kernel is real — registry,
 * strategies, terrain — and only the engine is faked (`createStyleEngine`): its `setTerrain`
 * throws while a style is rebuilt and fires `terrain`, a rebuilt style resets the terrain by
 * itself, and the camera is driven by hand, so that a test says when a movement ENDS.
 *
 * `terrain.test.js`, next door, holds the direct contract of `activateTerrain` and
 * `deactivateTerrain`; `terrain-selection.test.ts`, what that mode does when the engine acts
 * behind its back.
 *
 * What only the real engine can say — that a flat map requests no elevation tile, that nothing
 * is written during a real gesture, that a style swap is still diffed — is judged by
 * `e2e/83-terrain-follows-pitch.spec.js`.
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
    isTerrainActive,
    syncTerrainToBasemap,
} from "../../src/kernel/basemaps/terrain.ts";
import { createStyleEngine, type StyleEngine, type StyleJSON } from "../_helpers/style-engine.ts";

const BASEMAP_SOURCE = "__geoleaf_basemap__";
const BASEMAP_LAYER = "__geoleaf_basemap_layer__";
const TERRAIN_SOURCE = "terrain-dem";
const DEM = "https://dem.example.com/{z}/{x}/{y}.png";
const DEM_B = "https://dem-b.example.com/{z}/{x}/{y}.png";
const TILES_A = "https://a.example.com/{z}/{x}/{y}.png";
const TILES_B = "https://b.example.com/{z}/{x}/{y}.png";
const STYLE_URL = "https://styles.example.com/plan.json";

/** A terrain that follows the tilt, on the elevation source `demUrl`. */
const follows = (extra: Record<string, unknown> = {}) => ({
    enabled: true,
    demUrl: DEM,
    activation: "pitch",
    ...extra,
});
/** A terrain put on by the selection of its basemap — the mode that must not change. */
const SELECTED = { enabled: true, demUrl: DEM, default3D: true, pitch: 60, bearing: 30 };

function vectorStyle(name = "plan"): StyleJSON {
    return {
        version: 8,
        name,
        sources: { base: { type: "vector", url: `https://tiles.test/${name}.json` } },
        layers: [
            { id: "land", type: "fill", source: "base" },
            { id: "place", type: "symbol", source: "base" },
        ],
    };
}

const g = globalThis as unknown as { GeoLeaf?: { Core?: unknown } };
let previousCore: unknown;
let engine: StyleEngine;

function register(id: string, definition: Record<string, unknown>): void {
    registerBaseLayer(id, { id, label: id, ...definition } as never);
}
const tiles = (url: string, extra: Record<string, unknown> = {}) => ({ url, ...extra });
const vector = (style: unknown, extra: Record<string, unknown> = {}) => ({
    type: "maplibre",
    style,
    ...extra,
});

type Spy = { mock: { calls: unknown[][]; invocationCallOrder: number[] } };
const spy = (name: keyof StyleEngine, from: StyleEngine = engine): Spy =>
    from[name] as unknown as Spy;

/** Every terrain write the kernel made, oldest first. */
const writes = (from: StyleEngine = engine): string[] =>
    spy("setTerrain", from).mock.calls.map(([options]) => (options ? "on" : "off"));

/** The elevation source the live style declares for the terrain, or `undefined`. */
const demUrl = (): unknown =>
    (engine.style().sources[TERRAIN_SOURCE]?.tiles as unknown[] | undefined)?.[0];

/** Calls made to a spied engine method with the terrain's source id. */
const demCalls = (name: "addSource" | "removeSource"): number =>
    spy(name).mock.calls.filter(([id]) => id === TERRAIN_SOURCE).length;

/**
 * How many handlers the kernel holds on `event` right now: registered and not taken back. The
 * fake keeps a handler registered twice twice — the engine would not —, which is what makes a
 * forgotten `off` countable here.
 */
function listening(event: string, from: StyleEngine = engine): number {
    const of = (name: "on" | "off"): unknown[] =>
        spy(name, from)
            .mock.calls.filter(([type]) => type === event)
            .map(([, handler]) => handler);
    return of("on").length - of("off").length;
}

/** The camera was not moved: neither posted nor animated. */
function expectCameraUntouched(from: StyleEngine = engine): void {
    expect(spy("jumpTo", from).mock.calls, "la caméra a été posée").toEqual([]);
    expect(spy("easeTo", from).mock.calls, "la caméra a été animée").toEqual([]);
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

describe("relief à l'inclinaison — la décision", () => {
    beforeEach(() => {
        register("tuiles", tiles(TILES_A, { terrain: follows() }));
        setBaseLayer("tuiles");
    });

    it("carte à plat : rien n'est écrit, aucune source d'altitude, la caméra n'est pas touchée", () => {
        engine.rest(0);

        expect(writes()).toEqual([]);
        expect(engine.getTerrain()).toBeNull();
        expect(demUrl(), "une source d'altitude est déclarée sur une carte à plat").toBeUndefined();
        expectCameraUntouched();
        expect(isTerrainActive(), "le drapeau du mode par sélection a été levé").toBe(false);
        expect(listening("moveend"), "le fond actif n'écoute pas la fin des mouvements").toBe(1);
        expect(listening("pitch"), "la décision est branchée sur le geste lui-même").toBe(0);
    });

    it("seuil haut atteint, à l'arrêt : le relief est posé une fois, sur sa source, sans déplacer la caméra", () => {
        engine.rest(12);

        expect(writes()).toEqual(["on"]);
        expect(engine.getTerrain()).toEqual({ source: TERRAIN_SOURCE, exaggeration: 1.5 });
        expect(engine.style().sources[TERRAIN_SOURCE]).toEqual({
            type: "raster-dem",
            tiles: [DEM],
            encoding: "terrarium",
            tileSize: 256,
            maxzoom: 15,
        });
        expectCameraUntouched();
    });

    // 🛑 NOTHING IS WRITTEN DURING A MOVEMENT. While a terrain is on, the engine keeps a copy of
    // the camera for as long as a movement lasts; a terrain removed then put back inside ONE
    // movement resumes from that stale copy.
    it("un geste entier, plusieurs événements `pitch` : rien pendant, une écriture à l'arrêt", () => {
        for (const tilt of [3, 7, 11, 13, 20, 35, 40]) engine.move(tilt);
        expect(writes(), "le relief a été écrit pendant le geste").toEqual([]);

        engine.stop();

        expect(writes()).toEqual(["on"]);
    });

    it("aller-retour sous le seuil bas puis au-dessus du haut, dans UN geste : aucune écriture", () => {
        engine.rest(40);
        expect(writes()).toEqual(["on"]);

        engine.move(3);
        engine.move(20);
        expect(writes(), "le relief a été retiré en plein geste").toEqual(["on"]);
        engine.stop();

        expect(writes(), "le relief a été réécrit pour un état qui n'a pas changé").toEqual(["on"]);
    });

    it("bornes et bande morte : posé à 12, gardé jusqu'à 6 compris, retiré sous 6, absent jusqu'à 12", () => {
        const seen: Array<[number, boolean]> = [];
        for (const tilt of [11.9, 12, 9, 6, 5.9, 9, 11.9, 12]) {
            engine.rest(tilt);
            seen.push([tilt, engine.getTerrain() !== null]);
        }

        expect(seen).toEqual([
            [11.9, false],
            [12, true],
            [9, true],
            [6, true],
            [5.9, false],
            [9, false],
            [11.9, false],
            [12, true],
        ]);
        expect(writes()).toEqual(["on", "off", "on"]);
    });

    it("retour sous le seuil bas : relief retiré, source gardée déclarée, caméra intacte", () => {
        engine.rest(40);
        engine.rest(2);

        expect(writes()).toEqual(["on", "off"]);
        expect(engine.getTerrain()).toBeNull();
        // Declared and read by nothing, the source requests no tile: no removal to replay at
        // every gesture.
        expect(demUrl()).toBe(DEM);
        expect(demCalls("removeSource")).toBe(0);
        expectCameraUntouched();
    });

    it("cinq arrêts à 45°, déplacements et zooms compris : une seule écriture", () => {
        for (let i = 0; i < 5; i++) engine.rest(45);

        expect(writes()).toEqual(["on"]);
        expect(demCalls("addSource")).toBe(1);
    });

    // The state is READ ON THE MAP: a terrain taken away behind the module's back — the engine
    // does it whenever it rebuilds a style — is put back, where a flag would say "already on".
    it("relief effacé dans le dos du module : reposé à l'arrêt suivant", () => {
        engine.rest(45);
        engine.setTerrain(null);
        spy("setTerrain").mock.calls.length = 0;

        engine.rest(45);

        expect(writes()).toEqual(["on"]);
    });
});

describe("relief à l'inclinaison — les seuils du profil", () => {
    it("`activateFromPitch` et `deactivateBelowPitch` sont lus", () => {
        register(
            "tuiles",
            tiles(TILES_A, {
                terrain: follows({ activateFromPitch: 30, deactivateBelowPitch: 20 }),
            })
        );
        setBaseLayer("tuiles");

        engine.rest(25);
        expect(writes()).toEqual([]);
        engine.rest(30);
        engine.rest(21);
        expect(writes()).toEqual(["on"]);
        engine.rest(19);
        expect(writes()).toEqual(["on", "off"]);
        expect(Log.error).not.toHaveBeenCalled();
    });

    it("sans `deactivateBelowPitch` : la moitié de `activateFromPitch`", () => {
        register("tuiles", tiles(TILES_A, { terrain: follows({ activateFromPitch: 40 }) }));
        setBaseLayer("tuiles");

        engine.rest(40);
        engine.rest(20);
        expect(writes(), "retiré à la moitié du seuil, qui n'est pas dessous").toEqual(["on"]);
        engine.rest(19.9);
        expect(writes()).toEqual(["on", "off"]);
    });

    // One threshold for both is the defect the two exist against: a camera that comes to rest
    // around it puts the terrain on and off at every movement.
    it("seuil bas qui n'est pas sous le seuil haut : dit à l'enregistrement, et remplacé par la moitié", () => {
        register(
            "tuiles",
            tiles(TILES_A, {
                terrain: follows({ activateFromPitch: 10, deactivateBelowPitch: 10 }),
            })
        );
        expect(Log.error).toHaveBeenCalledWith(expect.stringContaining("deactivateBelowPitch"));
        setBaseLayer("tuiles");

        engine.rest(10);
        engine.rest(9.9);
        engine.rest(5);
        expect(writes(), "un seul seuil sert aux deux bascules").toEqual(["on"]);
        engine.rest(4.9);
        expect(writes()).toEqual(["on", "off"]);
    });

    it.each([[-3], [0], [120], [Number.NaN]])(
        "seuil haut impossible (%s) : dit à l'enregistrement, et remplacé par 12",
        (activateFromPitch) => {
            register("tuiles", tiles(TILES_A, { terrain: follows({ activateFromPitch }) }));
            expect(Log.error).toHaveBeenCalledWith(expect.stringContaining("activateFromPitch"));
            setBaseLayer("tuiles");

            engine.rest(11.9);
            expect(writes()).toEqual([]);
            engine.rest(12);
            expect(writes()).toEqual(["on"]);
        }
    );

    it("`map.maxPitch` sous le seuil de pose : averti à l'attache — le relief ne viendrait jamais", () => {
        (engine.getMaxPitch as unknown as { mockReturnValue: (v: number) => void }).mockReturnValue(
            10
        );
        register("tuiles", tiles(TILES_A, { terrain: follows() }));

        setBaseLayer("tuiles");

        expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("never show"));
    });
});

describe("relief à l'inclinaison — les clés de l'autre mode", () => {
    it("`pitch`, `bearing` et `default3D` déclarés : nommés à l'enregistrement, jamais lus", () => {
        register(
            "tuiles",
            tiles(TILES_A, { terrain: follows({ pitch: 60, bearing: 30, default3D: true }) })
        );
        const warned = Log.warn.mock.calls.map(([message]) => String(message)).join("\n");
        expect(warned).toContain("terrain.pitch");
        expect(warned).toContain("terrain.bearing");
        expect(warned).toContain("terrain.default3D");

        setBaseLayer("tuiles");
        expect(writes(), "`default3D` a posé le relief à la sélection").toEqual([]);
        engine.rest(45);

        expect(writes()).toEqual(["on"]);
        expectCameraUntouched();
    });

    it('seuils déclarés sans `activation: "pitch"` : nommés à l\'enregistrement, non lus', () => {
        register("tuiles", tiles(TILES_A, { terrain: { ...SELECTED, activateFromPitch: 5 } }));
        expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("activateFromPitch"));

        setBaseLayer("tuiles");

        // The mode by selection, untouched: posed at once, camera posted.
        expect(writes()).toEqual(["on"]);
        expect(spy("jumpTo").mock.calls).toEqual([[{ pitch: 60, bearing: 30 }]]);
    });

    it("un profil sans clé neuve se comporte comme avant : posé à la sélection, `jumpTo` à l'arrivée, `easeTo` à plat au départ, et aucun suivi", () => {
        register("relief", tiles(TILES_A, { terrain: SELECTED }));
        register("plat", tiles(TILES_B));

        setBaseLayer("relief");
        expect(writes()).toEqual(["on"]);
        expect(spy("jumpTo").mock.calls).toEqual([[{ pitch: 60, bearing: 30 }]]);
        expect(isTerrainActive()).toBe(true);

        // The tilt decides nothing in this mode.
        engine.rest(0);
        engine.rest(45);
        expect(writes(), "le relief par sélection a suivi l'inclinaison").toEqual(["on"]);

        setBaseLayer("plat");
        expect(writes()).toEqual(["on", "off"]);
        expect(spy("easeTo").mock.calls).toEqual([[{ pitch: 0, bearing: 0 }]]);
        expect(isTerrainActive()).toBe(false);
    });
});

describe("relief par sélection — un fond rafraîchi", () => {
    // `refreshBasemap` re-applies a basemap whose source went missing. The terrain put on by
    // selection is neither taken off nor posted again: no flattening, and the camera stays where
    // the visitor left it. `terrain-selection.test.ts` holds the rest of that mode.
    it("le relief n'est ni retiré ni réécrit : un seul `jumpTo`, celui de la sélection, jamais `easeTo`", () => {
        register("relief", tiles(TILES_A, { terrain: SELECTED }));
        setBaseLayer("relief");
        engine.removeLayer(BASEMAP_LAYER);
        engine.removeSource(BASEMAP_SOURCE);

        refreshBasemap();

        expect(writes()).toEqual(["on"]);
        expect(spy("jumpTo").mock.calls).toHaveLength(1);
        expect(spy("easeTo").mock.calls, "le rafraîchissement a remis la caméra à plat").toEqual(
            []
        );
        expect(isTerrainActive()).toBe(true);
    });
});

describe("relief à l'inclinaison — le style", () => {
    beforeEach(() => {
        register("tuiles", tiles(TILES_A, { terrain: follows() }));
        setBaseLayer("tuiles");
    });

    it("style reconstruit sous une caméra inclinée : source redéclarée, relief reposé", () => {
        engine.rest(45);
        spy("setTerrain").mock.calls.length = 0;

        engine.startRebuild();
        engine.landRebuild();

        expect(writes()).toEqual(["on"]);
        expect(demUrl()).toBe(DEM);
        expect(engine.getTerrain()).toEqual({ source: TERRAIN_SOURCE, exaggeration: 1.5 });
        expectCameraUntouched();
    });

    // 🛑 THE LATCH IS REMEMBERED, AND IT HAS TO BE. Between the two thresholds a map the engine
    // just reset no longer says whether its terrain was wanted.
    it("reconstruit à 9°, le relief étant posé : il revient — le verrou ne se lit pas sur la carte", () => {
        engine.rest(45);
        engine.rest(9);
        expect(engine.getTerrain(), "le relief est parti entre les deux seuils").not.toBeNull();

        engine.startRebuild();
        engine.landRebuild();

        expect(engine.getTerrain(), "le relief n'a pas survécu à la reconstruction").not.toBeNull();
    });

    it("écriture refusée pendant la reconstruction : rien ne remonte, et elle est rejouée au `style.load`", () => {
        engine.startRebuild();

        expect(() => engine.rest(45)).not.toThrow();
        expect(engine.getTerrain()).toBeNull();

        engine.landRebuild();

        expect(engine.getTerrain()).toEqual({ source: TERRAIN_SOURCE, exaggeration: 1.5 });
    });

    it("dix arrêts pendant la reconstruction : une seule tentative", () => {
        engine.startRebuild();

        for (let i = 0; i < 10; i++) engine.rest(45);

        expect(demCalls("addSource")).toBe(1);
        expect(writes()).toEqual([]);
    });

    it("`style.load` pendant un mouvement : rien n'est écrit avant l'arrêt", () => {
        engine.rest(45);
        spy("setTerrain").mock.calls.length = 0;
        engine.move(45);

        engine.startRebuild();
        engine.landRebuild();
        expect(writes(), "le relief a été reposé en plein mouvement").toEqual([]);

        engine.stop();
        expect(writes()).toEqual(["on"]);
    });

    it("contexte WebGL perdu : rien n'est écrit ; restauré, le moteur a gardé le relief et rien n'est réécrit", () => {
        engine.rest(45);
        spy("setTerrain").mock.calls.length = 0;
        spy("addSource").mock.calls.length = 0;

        engine.loseContext();
        engine.setCamera(2);
        engine.stop();
        expect(writes(), "le relief a été écrit sur un contexte perdu").toEqual([]);
        expect(demCalls("addSource")).toBe(0);

        engine.setCamera(45);
        engine.restoreContext();

        // The engine replayed its style with its terrain: writing it again would only make it
        // throw the mesh away and rebuild it.
        expect(writes()).toEqual([]);
        expect(engine.getTerrain()).not.toBeNull();
    });
});

describe("relief à l'inclinaison — le changement de fond", () => {
    it("vers un fond sans relief : écouteurs détachés, relief et source retirés, caméra intacte", () => {
        register("tuiles", tiles(TILES_A, { terrain: follows() }));
        register("plat", tiles(TILES_B));
        setBaseLayer("tuiles");
        engine.rest(45);

        setBaseLayer("plat");

        expect(writes()).toEqual(["on", "off"]);
        expect(demUrl(), "la source d'altitude a survécu au fond qui la déclarait").toBeUndefined();
        expectCameraUntouched();

        engine.rest(45);
        expect(writes(), "le fond parti suit encore l'inclinaison").toEqual(["on", "off"]);
        for (const event of ["moveend", "style.load", "webglcontextlost", "remove"]) {
            expect(listening(event), `un écouteur \`${event}\` est resté sur la carte`).toBe(0);
        }
    });

    it("vers un fond sans relief, carte à plat : rien n'est écrit", () => {
        register("tuiles", tiles(TILES_A, { terrain: follows() }));
        register("plat", tiles(TILES_B));
        setBaseLayer("tuiles");
        engine.rest(0);

        setBaseLayer("plat");

        expect(writes()).toEqual([]);
        expect(engine.refusals()).toEqual([]);
    });

    it("vers un autre fond qui suit l'inclinaison, même altitude : rien n'est écrit", () => {
        register("a", tiles(TILES_A, { terrain: follows() }));
        register("b", tiles(TILES_B, { terrain: follows() }));
        setBaseLayer("a");
        engine.rest(45);
        spy("setTerrain").mock.calls.length = 0;
        spy("addSource").mock.calls.length = 0;

        setBaseLayer("b");

        expect(writes()).toEqual([]);
        expect(demCalls("addSource")).toBe(0);
        expect(demCalls("removeSource")).toBe(0);
        expect(engine.getTerrain()).not.toBeNull();
        expect(listening("moveend"), "le passage de relais a doublé les écouteurs").toBe(1);
    });

    it("même altitude, autre exagération : une écriture, la source gardée", () => {
        register("a", tiles(TILES_A, { terrain: follows() }));
        register("b", tiles(TILES_B, { terrain: follows({ exaggeration: 2 }) }));
        setBaseLayer("a");
        engine.rest(45);

        setBaseLayer("b");

        expect(writes()).toEqual(["on", "on"]);
        expect(engine.getTerrain()).toEqual({ source: TERRAIN_SOURCE, exaggeration: 2 });
        expect(demCalls("removeSource")).toBe(0);
    });

    // The engine's rule is an ORDER: the terrain off, then its source.
    it("autre altitude : relief coupé, source retirée, source posée, relief reposé — dans cet ordre", () => {
        register("a", tiles(TILES_A, { terrain: follows() }));
        register("b", tiles(TILES_B, { terrain: follows({ demUrl: DEM_B }) }));
        setBaseLayer("a");
        engine.rest(45);
        const from = spy("setTerrain").mock.calls.length;

        setBaseLayer("b");

        expect(demUrl()).toBe(DEM_B);
        expect(writes().slice(from)).toEqual(["off", "on"]);
        const [cut, posed] = spy("setTerrain").mock.invocationCallOrder.slice(from);
        const removed = spy("removeSource").mock.invocationCallOrder.at(-1) as number;
        const added = spy("addSource").mock.invocationCallOrder.at(-1) as number;
        const order = [cut as number, removed, added, posed as number];
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(engine.refusals()).toEqual([]);
        expectCameraUntouched();
    });

    it("à 9°, le relief étant posé : le verrou passe au fond suivant", () => {
        register("a", tiles(TILES_A, { terrain: follows() }));
        register("b", tiles(TILES_B, { terrain: follows({ demUrl: DEM_B }) }));
        setBaseLayer("a");
        engine.rest(45);
        engine.rest(9);

        setBaseLayer("b");

        expect(engine.getTerrain(), "le fond suivant a perdu le relief à 9°").not.toBeNull();
        expect(demUrl()).toBe(DEM_B);
    });

    it("fond qui suit l'inclinaison → fond à `default3D` : sa source, son relief, sa caméra", () => {
        register("a", tiles(TILES_A, { terrain: follows() }));
        register("b", tiles(TILES_B, { terrain: { ...SELECTED, demUrl: DEM_B } }));
        setBaseLayer("a");
        engine.rest(45);

        setBaseLayer("b");

        expect(demUrl(), "le fond suivant lit l'altitude du fond précédent").toBe(DEM_B);
        expect(spy("jumpTo").mock.calls).toEqual([[{ pitch: 60, bearing: 30 }]]);
        expect(spy("easeTo").mock.calls, "quitter ce mode a remis la caméra à plat").toEqual([]);
        expect(isTerrainActive()).toBe(true);

        // The binding is gone with its basemap.
        engine.rest(0);
        expect(engine.getTerrain(), "le relief par sélection a suivi l'inclinaison").not.toBeNull();
    });

    describe("fond à `default3D` → fond qui suit l'inclinaison", () => {
        beforeEach(() => {
            register("a", tiles(TILES_A, { terrain: SELECTED }));
            register("b", tiles(TILES_B, { terrain: follows() }));
            setBaseLayer("a");
            // The camera sits where `jumpTo` put it, and leaving the basemap animates it flat.
            engine.setCamera(60);
            (
                engine.easeTo as unknown as { mockImplementation: (f: () => unknown) => void }
            ).mockImplementation(() => {
                engine.setCamera(60, true);
                return engine;
            });
        });

        it("la remise à plat est celle d'avant, et rien n'est posé pendant qu'elle court", () => {
            setBaseLayer("b");

            expect(spy("easeTo").mock.calls).toEqual([[{ pitch: 0, bearing: 0 }]]);
            expect(writes(), "le relief a été reposé en pleine animation").toEqual(["on", "off"]);

            engine.rest(0);
            expect(writes()).toEqual(["on", "off"]);
            // Nobody claimed the source: the removal armed by the basemap that left runs.
            engine.fire("render");
            expect(demUrl()).toBeUndefined();
        });

        it("animation interrompue à 30° : le relief est posé, et sa source n'est pas retirée", () => {
            setBaseLayer("b");

            engine.rest(30);
            expect(writes()).toEqual(["on", "off", "on"]);

            // The removal armed by the basemap that left finds the source claimed, and gives up.
            engine.fire("render");
            expect(demUrl(), "la source reprise a été retirée par le fond parti").toBe(DEM);
            expect(engine.getTerrain()).not.toBeNull();
        });
    });

    it("`refreshBasemap` : ni caméra, ni réécriture du relief", () => {
        register("tuiles", tiles(TILES_A, { terrain: follows() }));
        setBaseLayer("tuiles");
        engine.rest(45);
        engine.removeLayer(BASEMAP_LAYER);
        engine.removeSource(BASEMAP_SOURCE);
        spy("setTerrain").mock.calls.length = 0;

        refreshBasemap();

        expect(engine.getSource(BASEMAP_SOURCE), "le fond n'a pas été reposé").toBeDefined();
        expect(writes()).toEqual([]);
        expect(engine.getTerrain()).not.toBeNull();
        expectCameraUntouched();
    });
});

describe("relief à l'inclinaison — un changement de style", () => {
    beforeEach(() => {
        register("tuiles", tiles(TILES_A, { terrain: follows() }));
        register("plan", vector(STYLE_URL, { terrain: follows() }));
        setBaseLayer("tuiles");
        engine.rest(45);
    });

    // Left on, the terrain keeps the engine from diffing the two styles: it rebuilds the
    // incoming one from scratch, every source reloaded.
    it("le relief est coupé AVANT que le style soit demandé, sans caméra", () => {
        setBaseLayer("plan");

        expect(engine.pendingUrl()).toBe(STYLE_URL);
        expect(writes()).toEqual(["on", "off"]);
        const cut = spy("setTerrain").mock.invocationCallOrder.at(-1) as number;
        const asked = spy("setStyle").mock.invocationCallOrder.at(-1) as number;
        expect(cut, "le style a été demandé relief encore posé").toBeLessThan(asked);
        expectCameraUntouched();
    });

    // A style given by URL leaves the outgoing one ALIVE while it downloads.
    it("pendant le téléchargement, incliner n'écrit rien sur le style qui part", () => {
        setBaseLayer("plan");
        const before = writes();

        expect(listening("moveend"), "le suivi est resté attaché au style qui part").toBe(0);

        engine.rest(2);
        engine.rest(50);

        expect(writes(), "le relief a été reposé sur le style sortant").toEqual(before);
    });

    it("à l'arrivée du style, sous une caméra restée inclinée : le relief est retrouvé", () => {
        setBaseLayer("plan");

        engine.deliver(vectorStyle());

        expect(engine.getTerrain()).toEqual({ source: TERRAIN_SOURCE, exaggeration: 1.5 });
        expect(demUrl()).toBe(DEM);
        expectCameraUntouched();
        expect(listening("moveend")).toBe(1);
        // And it follows the tilt again.
        engine.rest(0);
        expect(engine.getTerrain()).toBeNull();
    });

    it("à l'arrivée d'un fond sans relief : rien n'est reposé, et le suivi est oublié", () => {
        register("nu", vector("https://styles.example.com/nu.json"));
        setBaseLayer("nu");
        engine.deliver(vectorStyle("nu"));
        const before = writes();

        engine.rest(45);

        expect(writes()).toEqual(before);
        expect(engine.getTerrain()).toBeNull();
        expectCameraUntouched();
    });

    it("deux fonds vectoriels au même style : aucun style demandé, le relief suit le fond", () => {
        const style = vectorStyle();
        register("nu", vector(style));
        register("relief", vector(style, { terrain: follows() }));
        setBaseLayer("nu");
        expect(engine.getTerrain(), "le fond sans relief en a gardé un").toBeNull();
        const asked = spy("setStyle").mock.calls.length;

        setBaseLayer("relief");

        expect(spy("setStyle").mock.calls.length, "le style a été redemandé").toBe(asked);
        expect(engine.getTerrain(), "incliné à 45°, le fond n'a pas son relief").not.toBeNull();

        setBaseLayer("nu");
        expect(engine.getTerrain()).toBeNull();
        expectCameraUntouched();
    });
});

describe("relief à l'inclinaison — la carte qui s'en va", () => {
    beforeEach(() => {
        register("tuiles", tiles(TILES_A, { terrain: follows() }));
        setBaseLayer("tuiles");
        engine.rest(45);
        spy("setTerrain").mock.calls.length = 0;
    });

    it("démontage : écouteurs détachés, rien d'écrit sur la carte qui part", () => {
        resetBasemapRegistry();

        expect(writes(), "le démontage a écrit le relief d'une carte qui part").toEqual([]);
        expect(listening("moveend"), "la carte démontée garde un écouteur").toBe(0);
        engine.rest(0);
        expect(writes(), "la carte démontée est encore suivie").toEqual([]);
        expectCameraUntouched();
    });

    it("événement `remove` de la carte : le suivi est oublié", () => {
        engine.fire("remove");

        expect(listening("moveend")).toBe(0);
        engine.rest(0);
        expect(writes()).toEqual([]);
    });

    it("une autre carte prend le relais : l'ancienne ne reçoit plus rien", () => {
        const other = createStyleEngine();
        other.setCamera(45);

        syncTerrainToBasemap(
            other as never,
            { id: "tuiles", label: "tuiles", url: TILES_A, terrain: follows() } as never,
            "tuiles"
        );

        expect(writes(other)).toEqual(["on"]);
        expect(listening("moveend"), "l'ancienne carte est encore écoutée").toBe(0);
        engine.rest(0);
        expect(writes(), "le relief de l'ancienne carte a été écrit").toEqual([]);
        // The new one is listened to, and it alone.
        expect(listening("moveend", other)).toBe(1);
        other.rest(0);
        expect(writes(other), "la nouvelle carte n'est pas suivie").toEqual(["on", "off"]);
    });
});
