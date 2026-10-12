/**
 * `refreshBasemap()` on a WMTS basemap.
 *
 * A WMTS basemap has no tile URL of its own: `setBaseLayer` resolves one from the service's
 * GetCapabilities, then builds the source from it. `refreshBasemap` — called by a plugin when it
 * finds the basemap source gone — re-applied the registered definition as it stood, that is
 * WITHOUT any tile: during the resolution it took the slot the resolution was about to fill, and
 * after it, it put back a basemap that requests nothing.
 *
 * The kernel is real; only the engine's style half is faked (`createStyleEngine`) and the
 * GetCapabilities resolution is a promise the test holds.
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
vi.mock("../../src/kernel/basemaps/wmts-resolver.js", () => ({
    buildWmsUrl: vi.fn(() => null),
    resolveWmtsTilesUrl,
}));

import {
    _baseLayers,
    _resetStateForTesting,
    getActiveKey,
    refreshBasemap,
    registerBaseLayer,
    setBaseLayer,
    setMap,
} from "../../src/kernel/basemaps/registry.ts";
import { createStyleEngine, type StyleEngine } from "../_helpers/style-engine.ts";

const BASEMAP_SOURCE_ID = "__geoleaf_basemap__";
const BASEMAP_LAYER_ID = "__geoleaf_basemap_layer__";
const TILES = "https://wmts.example.com/plan/{z}/{x}/{y}.png";

const WMTS = {
    id: "plan-wmts",
    label: "Plan WMTS",
    type: "wmts",
    wmts: { getCapabilitiesUrl: "https://wmts.example.com/caps.xml", layer: "plan" },
};

/** Lets the resolution's `.then` and its `.catch` run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise the test settles when it chooses. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

let engine: StyleEngine;
let changes: string[];
const onChange = (event: Event): void => {
    changes.push((event as CustomEvent<{ key: string }>).detail.key);
};

beforeEach(() => {
    vi.clearAllMocks();
    engine = createStyleEngine();
    setMap(engine as never);
    registerBaseLayer(WMTS.id, WMTS as never);
    changes = [];
    document.addEventListener("geoleaf:basemap:change", onChange);
});

afterEach(() => {
    document.removeEventListener("geoleaf:basemap:change", onChange);
    for (const key of Object.keys(_baseLayers)) delete _baseLayers[key];
    _resetStateForTesting();
    setMap(null);
});

describe("refreshBasemap sur un fond WMTS", () => {
    it("🔴 pendant la résolution : rien n'est posé, et la résolution pose le fond", async () => {
        const flight = deferred<string | null>();
        resolveWmtsTilesUrl.mockReturnValueOnce(flight.promise);

        setBaseLayer(WMTS.id);
        expect(getActiveKey()).toBe(WMTS.id);

        refreshBasemap();
        expect(
            engine.style().sources[BASEMAP_SOURCE_ID],
            "le fond non résolu a pris le créneau"
        ).toBeUndefined();

        flight.resolve(TILES);
        await flush();

        expect(engine.style().sources[BASEMAP_SOURCE_ID]?.tiles).toEqual([TILES]);
        expect(engine.order()).toContain(BASEMAP_LAYER_ID);
        expect(Log.error).not.toHaveBeenCalled();
        expect(changes).toEqual([WMTS.id]);
    });

    it("🔴 après la résolution : la source disparue revient avec ses tuiles résolues", async () => {
        resolveWmtsTilesUrl.mockResolvedValue(TILES);
        setBaseLayer(WMTS.id);
        await flush();
        expect(engine.style().sources[BASEMAP_SOURCE_ID]?.tiles).toEqual([TILES]);

        // The loss `refreshBasemap` exists for: the source is gone, the basemap is still active.
        engine.removeLayer(BASEMAP_LAYER_ID);
        engine.removeSource(BASEMAP_SOURCE_ID);
        changes.length = 0;

        refreshBasemap();
        await flush();

        expect(engine.style().sources[BASEMAP_SOURCE_ID]?.tiles).toEqual([TILES]);
        expect(engine.order()).toContain(BASEMAP_LAYER_ID);
        // A refresh is not a basemap change.
        expect(changes).toEqual([]);
    });

    it("🔴 une résolution rejetée ne condamne pas le rafraîchissement suivant", async () => {
        const flight = deferred<string | null>();
        resolveWmtsTilesUrl.mockReturnValueOnce(flight.promise);
        setBaseLayer(WMTS.id);
        flight.reject(new Error("réseau"));
        await flush();
        expect(engine.style().sources[BASEMAP_SOURCE_ID]).toBeUndefined();

        resolveWmtsTilesUrl.mockResolvedValueOnce(TILES);
        refreshBasemap();
        await flush();

        expect(engine.style().sources[BASEMAP_SOURCE_ID]?.tiles).toEqual([TILES]);
    });

    it("un fond en tuiles reste reposé de façon synchrone", () => {
        registerBaseLayer("plan", {
            id: "plan",
            label: "Plan",
            url: "https://tiles.example.com/{z}/{x}/{y}.png",
        } as never);
        setBaseLayer("plan");
        engine.removeLayer(BASEMAP_LAYER_ID);
        engine.removeSource(BASEMAP_SOURCE_ID);

        refreshBasemap();

        expect(engine.style().sources[BASEMAP_SOURCE_ID]?.tiles).toEqual([
            "https://tiles.example.com/{z}/{x}/{y}.png",
        ]);
        expect(resolveWmtsTilesUrl).not.toHaveBeenCalled();
    });
});
