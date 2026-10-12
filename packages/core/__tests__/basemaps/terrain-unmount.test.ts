/**
 * What the terrain manager keeps of a map that went away.
 *
 * The basemap registry forgets its map when an application is unmounted
 * (`resetBasemapRegistry`, from `UIModule.destroy()`). The terrain manager holds a state of its
 * own — whether a relief is on, and for which basemap — and nothing reset it: the next map
 * inherited a relief it never had.
 *
 * The registry and the terrain manager are the real ones here. The registry test next door
 * replaces the terrain module with a stand-in, which is exactly why it could not see this.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const Log = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log }));

import {
    setMap,
    registerBaseLayer,
    setBaseLayer,
    resetBasemapRegistry,
} from "../../src/kernel/basemaps/registry.ts";
import {
    isTerrainActive,
    getActiveTerrainBasemapKey,
    _resetTerrainStateForTesting,
} from "../../src/kernel/basemaps/terrain.ts";

const g = globalThis as unknown as { GeoLeaf?: { Core?: unknown } };
g.GeoLeaf = { ...(g.GeoLeaf ?? {}), Core: null };

/** A native map that settles at once: style loaded, every write accepted. */
function makeMap() {
    // The terrain is held, as the engine holds it: the manager reads it back.
    let terrain: unknown = null;
    return {
        getTerrain: vi.fn(() => terrain),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        getLayer: vi.fn(() => null),
        getSource: vi.fn(() => null),
        getStyle: vi.fn(() => ({ layers: [] })),
        setStyle: vi.fn(),
        setTerrain: vi.fn((options: unknown) => {
            terrain = options;
        }),
        easeTo: vi.fn(),
        jumpTo: vi.fn(),
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        loaded: vi.fn(() => true),
        isStyleLoaded: vi.fn(() => true),
    };
}

const PLAN = { url: "https://tiles.example.com/plan/{z}/{x}/{y}.png" };
const RELIEF = {
    url: "https://tiles.example.com/relief/{z}/{x}/{y}.png",
    terrain: {
        enabled: true,
        demUrl: "https://dem.example.com/{z}/{x}/{y}.png",
        default3D: true,
        pitch: 60,
        bearing: 30,
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    resetBasemapRegistry();
    _resetTerrainStateForTesting();
});

describe("the terrain manager across an unmount", () => {
    it("forgets the relief of the map the registry forgets", () => {
        const map = makeMap();
        setMap(map as never);
        registerBaseLayer("relief", RELIEF as never);
        setBaseLayer("relief");
        expect(isTerrainActive(), "le relief n'a pas été activé : le test ne prouve rien").toBe(
            true
        );

        resetBasemapRegistry();

        expect(isTerrainActive(), "le relief de la carte démontée est encore tenu pour actif").toBe(
            false
        );
        expect(getActiveTerrainBasemapKey()).toBeNull();
    });

    // 🛑 THE CONSEQUENCE, AND IT IS A CAMERA ONE. A relief still held for active makes the first
    // basemap of the next map "leave" it: `deactivateTerrain` runs on a map that never had a
    // relief, and eases its camera to `pitch: 0, bearing: 0` — flattening and un-rotating a view
    // the application had just opened.
    it("does not flatten the camera of the next map", () => {
        const first = makeMap();
        setMap(first as never);
        registerBaseLayer("relief", RELIEF as never);
        setBaseLayer("relief");
        expect(first.setTerrain, "le relief n'a pas été posé sur la première carte").toBeCalled();

        resetBasemapRegistry();

        const second = makeMap();
        setMap(second as never);
        registerBaseLayer("plan", PLAN as never);
        setBaseLayer("plan");

        expect(second.addSource, "le fond de la seconde carte n'a pas été posé").toBeCalled();
        expect(second.easeTo, "la caméra de la carte neuve a été remise à plat").not.toBeCalled();
        expect(
            second.setTerrain,
            "un relief a été retiré d'une carte qui n'en avait pas"
        ).not.toBeCalled();
    });

    it("writes nothing on the map that goes away", () => {
        const map = makeMap();
        setMap(map as never);
        registerBaseLayer("relief", RELIEF as never);
        setBaseLayer("relief");
        map.setTerrain.mockClear();
        map.easeTo.mockClear();
        map.jumpTo.mockClear();

        resetBasemapRegistry();

        expect(
            map.setTerrain,
            "le démontage a écrit le relief d'une carte qui part"
        ).not.toBeCalled();
        expect(map.easeTo).not.toBeCalled();
        expect(map.jumpTo).not.toBeCalled();
    });
});
