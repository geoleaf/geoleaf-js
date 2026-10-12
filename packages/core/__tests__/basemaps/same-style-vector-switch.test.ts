/**
 * Switching between two vector basemaps that share ONE style.
 *
 * "Plan" and "Plan + relief": the same `style`, and a `terrain` block on the second only — the
 * natural way to offer a map with and without relief. The switch went through `setStyle`, whose
 * diff found nothing to do: MapLibre's `Style.setState` then returns before it fires anything,
 * `style.load` never comes, and the handler that finishes the switch never runs. Measured in a
 * browser on the real engine: the selector showed the second basemap, the map kept no relief,
 * and `geoleaf:basemap:change` was not emitted.
 *
 * Some styles hid the defect: the filters patched on OpenFreeMap's "liberty" make the live style
 * differ from the incoming one, so its diff is never empty.
 *
 * The kernel is real; only the engine's style half is faked (`createStyleEngine`), and it is
 * faithful on the one point that matters here — an empty diff emits nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const Log = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log }));

import {
    _baseLayers,
    _resetStateForTesting,
    getActiveKey,
    registerBaseLayer,
    setBaseLayer,
    setMap,
} from "../../src/kernel/basemaps/registry.ts";
// A namespace import: `_landedStyleKey` is a live binding, read where it is asserted.
import * as basemapsState from "../../src/kernel/basemaps/basemaps-state.ts";
import { _resetTerrainStateForTesting } from "../../src/kernel/basemaps/terrain.ts";
import { createStyleEngine, type StyleEngine, type StyleJSON } from "../_helpers/style-engine.ts";

const STYLE_URL = "https://tiles.test/styles/plan.json";
const DEM = "https://dem.example.com/{z}/{x}/{y}.png";
const TERRAIN = { enabled: true, demUrl: DEM, default3D: true, pitch: 60 };

function planStyle(): StyleJSON {
    return {
        version: 8,
        sources: { base: { type: "vector", url: "https://tiles.test/base.json" } },
        layers: [
            { id: "land", type: "fill", source: "base" },
            { id: "place", type: "symbol", source: "base" },
        ],
    };
}

let engine: StyleEngine;
let changes: string[];
const onChange = (event: Event): void => {
    changes.push((event as CustomEvent<{ key: string }>).detail.key);
};

/** Registers a vector basemap; `extra` carries what tells it from its twin. */
function register(id: string, style: unknown, extra: Record<string, unknown> = {}): void {
    registerBaseLayer(id, { id, label: id, type: "maplibre", style, ...extra } as never);
}

beforeEach(() => {
    vi.clearAllMocks();
    engine = createStyleEngine();
    setMap(engine as never);
    changes = [];
    document.addEventListener("geoleaf:basemap:change", onChange);
});

afterEach(() => {
    document.removeEventListener("geoleaf:basemap:change", onChange);
    for (const key of Object.keys(_baseLayers)) delete _baseLayers[key];
    _resetStateForTesting();
    _resetTerrainStateForTesting();
    setMap(null);
});

describe("bascule entre deux fonds vectoriels au même style", () => {
    it("🔴 le second s'active : relief posé, événement émis, style non redemandé", () => {
        register("plan", planStyle());
        // Equal by content, not by identity: two entries of a profile never share an object.
        register("plan-relief", planStyle(), { terrain: TERRAIN });

        setBaseLayer("plan");
        expect(changes).toEqual(["plan"]);
        expect(engine.getTerrain()).toBeNull();

        setBaseLayer("plan-relief");

        expect(getActiveKey()).toBe("plan-relief");
        expect(changes, "la bascule ne s'est pas achevée").toEqual(["plan", "plan-relief"]);
        expect(engine.getTerrain()).toEqual({ source: "terrain-dem", exaggeration: 1.5 });
        expect(engine.setStyle).toHaveBeenCalledTimes(1);
        // The basemap's own layers were never touched.
        expect(engine.order()).toEqual(["land", "place"]);
    });

    it("🔴 le retour retire le relief", () => {
        register("plan", planStyle());
        register("plan-relief", planStyle(), { terrain: TERRAIN });
        setBaseLayer("plan");
        setBaseLayer("plan-relief");

        setBaseLayer("plan");

        expect(changes).toEqual(["plan", "plan-relief", "plan"]);
        expect(engine.getTerrain()).toBeNull();
        expect(engine.setStyle).toHaveBeenCalledTimes(1);
    });

    it("`silent` n'émet pas, et la bascule s'achève quand même", () => {
        register("plan", planStyle());
        register("plan-relief", planStyle(), { terrain: TERRAIN });
        setBaseLayer("plan");

        setBaseLayer("plan-relief", { silent: true });

        expect(changes).toEqual(["plan"]);
        expect(getActiveKey()).toBe("plan-relief");
        expect(engine.getTerrain()).not.toBeNull();
    });

    it("un style encore en téléchargement n'ouvre pas le raccourci", () => {
        // The first basemap is ACTIVE by key but its style has not arrived: finishing the second
        // one now would set the relief on the style about to be replaced.
        register("plan", STYLE_URL);
        register("plan-relief", STYLE_URL, { terrain: TERRAIN });

        setBaseLayer("plan");
        expect(engine.pendingUrl()).toBe(STYLE_URL);
        setBaseLayer("plan-relief");

        expect(engine.setStyle).toHaveBeenCalledTimes(2);
        expect(changes).toEqual([]);
        expect(engine.getTerrain()).toBeNull();

        engine.deliver(planStyle());

        expect(changes).toEqual(["plan-relief"]);
        expect(engine.getTerrain()).not.toBeNull();
    });

    it("le jumeau d'un fond encore en téléchargement n'ouvre pas le raccourci non plus", () => {
        // The map holds the FIRST basemap's style; the active key names the second, still
        // downloading. Its twin shares a style the map does not hold.
        const other = planStyle();
        other.layers = [{ id: "sea", type: "fill", source: "base" }];
        register("mer", other);
        register("plan", STYLE_URL);
        register("plan-relief", STYLE_URL, { terrain: TERRAIN });
        setBaseLayer("mer");
        setBaseLayer("plan");

        setBaseLayer("plan-relief");

        expect(engine.setStyle).toHaveBeenCalledTimes(3);
        expect(engine.getTerrain()).toBeNull();
        engine.deliver(planStyle());
        expect(changes).toEqual(["mer", "plan-relief"]);
        expect(engine.order()).toEqual(["land", "place"]);
    });

    it("un style par URL, une fois arrivé, ouvre le raccourci", () => {
        register("plan", STYLE_URL);
        register("plan-relief", STYLE_URL, { terrain: TERRAIN });
        setBaseLayer("plan");
        engine.deliver(planStyle());

        setBaseLayer("plan-relief");

        expect(engine.setStyle).toHaveBeenCalledTimes(1);
        expect(changes).toEqual(["plan", "plan-relief"]);
    });

    it("un crédit différent redemande le style", () => {
        // The credit travels in the incoming style: only a `setStyle` can change it.
        register("plan", planStyle());
        register("plan-credite", planStyle(), { attribution: "© Autre source" });
        setBaseLayer("plan");

        setBaseLayer("plan-credite");

        expect(engine.setStyle).toHaveBeenCalledTimes(2);
    });

    it("un style différent redemande le style", () => {
        const other = planStyle();
        other.layers = [{ id: "sea", type: "fill", source: "base" }];
        register("plan", planStyle());
        register("mer", other);
        setBaseLayer("plan");

        setBaseLayer("mer");

        expect(engine.setStyle).toHaveBeenCalledTimes(2);
        expect(changes).toEqual(["plan", "mer"]);
        expect(engine.order()).toEqual(["sea"]);
    });

    it("un fond en image s'intercale : le raccourci ne survit pas au changement de style", () => {
        register("plan", planStyle());
        register("plan-relief", planStyle(), { terrain: TERRAIN });
        registerBaseLayer("tuiles", {
            id: "tuiles",
            label: "Tuiles",
            url: "https://tiles.example.com/{z}/{x}/{y}.png",
        } as never);
        setBaseLayer("plan");
        expect(basemapsState._landedStyleKey).toBe("plan");
        setBaseLayer("tuiles");
        // The map holds the empty style a raster basemap is applied over: no vector style.
        expect(basemapsState._landedStyleKey).toBeNull();

        setBaseLayer("plan-relief");

        // plan → tuiles → plan-relief: three styles asked for, none skipped.
        expect(engine.setStyle).toHaveBeenCalledTimes(3);
        expect(changes).toEqual(["plan", "tuiles", "plan-relief"]);
        expect(engine.order()).toEqual(["land", "place"]);
    });
});
