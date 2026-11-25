/**
 * The terrain is not put on below a zoom floor — in both activation modes.
 *
 * Tilted at 60° over a continent (zoom 4.4, the profile `tourism` framing its whole extent), the
 * engine's terrain draws nothing past a distance: a band of empty background across the top of
 * the map, with a cut corner, on the desktop and the phone alike. Measured in a browser: the band
 * goes with the terrain (gone without it, the extent kept), and from zoom 5.5 on with it. Below
 * the floor the map stays tilted, flat, and covers the screen; the terrain comes back as soon as
 * the camera comes to rest at or above it. Red on the code before the fix: the terrain was on at
 * zoom 4.4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const Log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../../src/utils/log/index.js", () => ({ Log }));
vi.mock("../../src/kernel/basemaps/wmts-resolver.js", () => ({
    buildWmsUrl: vi.fn(() => null),
    resolveWmtsTilesUrl: vi.fn(),
}));

import {
    _baseLayers,
    _resetStateForTesting,
    registerBaseLayer,
    setBaseLayer,
    setMap,
} from "../../src/kernel/basemaps/registry.ts";
import { _resetTerrainStateForTesting } from "../../src/kernel/basemaps/terrain.ts";
import { createStyleEngine, type StyleEngine } from "../_helpers/style-engine.ts";

const DEM = "https://dem.example.com/{z}/{x}/{y}.png";
const g = globalThis as unknown as { GeoLeaf?: { Core?: unknown } };
let previousCore: unknown;
let engine: StyleEngine;

function useBasemap(terrain: Record<string, unknown>): void {
    registerBaseLayer("relief", {
        id: "relief",
        label: "relief",
        url: "https://a.example.com/{z}/{x}/{y}.png",
        terrain: { enabled: true, demUrl: DEM, ...terrain },
    } as never);
    setBaseLayer("relief");
}

beforeEach(() => {
    vi.clearAllMocks();
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

describe("relief posé par la sélection du fond (default3D)", () => {
    it("🛑 sous le plancher : la carte est inclinée, à plat, sans relief", () => {
        engine.setZoom(4.4);
        useBasemap({ default3D: true, pitch: 60 });
        expect(engine.getTerrain()).toBeNull();
        // The camera is still posted: tilted, flat.
        expect(engine.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 60 }));
    });

    it("le zoom franchit le plancher à l'arrêt : le relief vient, puis repart en dézoomant", () => {
        engine.setZoom(4.4);
        useBasemap({ default3D: true, pitch: 60 });
        engine.zoomTo(7);
        expect(engine.getTerrain()).not.toBeNull();
        engine.zoomTo(4.4);
        expect(engine.getTerrain()).toBeNull();
    });

    it("au-dessus du plancher : posé dès la sélection (inchangé)", () => {
        useBasemap({ default3D: true, pitch: 60 });
        expect(engine.getTerrain()).not.toBeNull();
    });
});

describe("relief qui suit l'inclinaison (activation: pitch)", () => {
    it("🛑 inclinée sous le plancher : pas de relief ; au-dessus, il vient", () => {
        engine.setZoom(4.4);
        useBasemap({ activation: "pitch" });
        engine.rest(45);
        expect(engine.getTerrain()).toBeNull();
        engine.zoomTo(7);
        expect(engine.getTerrain()).not.toBeNull();
    });
});
