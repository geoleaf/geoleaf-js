/**
 * WHICH sub-layers receive which gesture.
 *
 * A file distinct from `feature-interaction-events.test.js`, which carries
 * the other question: *what* a handler dispatches once triggered. Here the
 * payload is never looked at, only the **selection** — the defect's subject.
 *
 * 🛑 TWO DEFECTS HAVE LIVED HERE, AND THEY PULL IN OPPOSITE DIRECTIONS.
 *
 * ① Binding EVERY sub-layer on its own emitted one event per sub-layer under
 * the pointer: `maplibre-primitives.ts` (`addSubLayers`) stacks the sub-layers
 * by geometry and cumulatively, so a click counted 2 events on an icon point,
 * 2 on a cased line, 3 on a cased polygon, 4 on a vector tile.
 *
 * ② Binding ONE family by precedence (fill, else circle, else line) fixed the
 * count and lost the gesture: a layer that ships EMPTY is built with the three
 * families, so only its fill was bound, and the points it was filled with
 * later were drawn and never heard.
 *
 * Both are closed by the same shape: every sub-layer that draws features, in
 * ONE subscription per gesture.
 *
 * ⚠️ MODELLING HYPOTHESIS, WRITTEN BECAUSE IT IS LOAD-BEARING:
 * `map.on(type, layerIds[], fn)` registers ONE delegated listener for the whole
 * list, and MapLibre calls it once per gesture, whatever the number of listed
 * sub-layers under the pointer. The count of `on` calls per gesture type is
 * therefore the count of events a gesture can emit — which is what is asserted
 * here. What the engine really does with the list is read by
 * `e2e/84-empty-born-layer-hears-every-geometry.spec.js`, on real pointer events.
 *
 * The CONVERGENCE assertion (last block but one) is the one with the most value
 * over time: it keeps the gestures from re-diverging, which no comment can do.
 */

import { vi, describe, test, expect, beforeEach } from "vitest";

vi.mock("../../src/kernel/events/event-bus.js", async (importActual) => ({
    ...((await importActual()) as object),
    dispatchGeoLeafEvent: vi.fn(),
}));

vi.mock("../../src/adapters/maplibre/maplibre-event-subscriptions.js", async (importActual) => ({
    ...((await importActual()) as object),
    trackMapCleanup: vi.fn(),
}));

const { bindFeatureInteractionEvents } =
    await import("../../src/kernel/geojson/feature-interaction.js");
const { dispatchGeoLeafEvent } = await import("../../src/kernel/events/event-bus.js");

type Handler = (e: unknown) => void;

/** Fake MapLibre map: retains each `(type, sub-layers)` subscription and its handler. */
function fakeMap(layers: string[]) {
    const bound: Array<{ type: string; ids: string[]; fn: Handler }> = [];
    return {
        __geoleafExclusiveMode: false,
        getLayer: (id: string) => layers.includes(id),
        getCanvas: () => ({ style: {} as Record<string, string> }),
        on: vi.fn((type: string, ids: string | string[], fn: Handler) =>
            bound.push({ type, ids: Array.isArray(ids) ? ids : [ids], fn })
        ),
        off: vi.fn(),
        _bound: bound,
    };
}

/** The subscriptions made for `type`: one list of sub-layers per `map.on` call. */
function subscriptions(map: ReturnType<typeof fakeMap>, type: string): string[][] {
    return map._bound.filter((b) => b.type === type).map((b) => b.ids);
}

/**
 * Replays ONE gesture on a feature of `geometryType`: every `click` subscription that lists a
 * sub-layer drawing that geometry is called, as the engine would. Returns the
 * `geoleaf:feature:click` emitted — the counting oracle.
 */
function clicksEmitted(map: ReturnType<typeof fakeMap>, drawnBy: string[]): number {
    const e = {
        features: [{ id: 7, properties: {}, geometry: { type: "Point" } }],
        lngLat: { lat: 1, lng: 2 },
        point: { x: 10, y: 20 },
    };
    for (const b of map._bound) {
        if (b.type === "click" && b.ids.some((id) => drawnBy.includes(id))) b.fn(e);
    }
    return vi
        .mocked(dispatchGeoLeafEvent)
        .mock.calls.filter((c) => c[0] === "geoleaf:feature:click").length;
}

/** Binds the binder on a map where ALL the sub-layers exist. */
function bind(subLayerIds: string[]) {
    const map = fakeMap(subLayerIds);
    bindFeatureInteractionEvents("L", {}, map as never, subLayerIds);
    return map;
}

/**
 * The real stackings, as `addSubLayers` produces them. `heard` is what a gesture must reach:
 * every sub-layer that draws features — the casing, which lies under its line, is not one.
 */
const GEOMETRIES = [
    { nom: "point + icône", subs: ["a-circle", "a-symbol"], heard: ["a-circle", "a-symbol"] },
    { nom: "ligne + casing", subs: ["a-casing", "a-line"], heard: ["a-line"] },
    {
        nom: "polygone + casing",
        subs: ["a-fill", "a-casing", "a-line"],
        heard: ["a-fill", "a-line"],
    },
    {
        nom: "tuile vectorielle",
        subs: ["a-fill", "a-casing", "a-line", "a-circle"],
        heard: ["a-fill", "a-line", "a-circle"],
    },
    {
        nom: "points en grappes",
        subs: ["a-clusters", "a-cluster-count", "a-circle", "a-symbol"],
        heard: ["a-circle", "a-symbol"],
    },
    { nom: "polygone extrudé", subs: ["a-fill-extrusion"], heard: ["a-fill-extrusion"] },
] as const;

/** What a layer created with NO feature is built with: the three families. */
const BORN_EMPTY = ["a-fill", "a-line", "a-circle", "a-symbol"];

beforeEach(() => vi.clearAllMocks());

describe("garde de non-vacuité — le binder lie bien quelque chose", () => {
    test("une couche à sous-couche unique reçoit clic ET survol", () => {
        const map = bind(["a-fill"]);
        expect(subscriptions(map, "click")).toEqual([["a-fill"]]);
        expect(subscriptions(map, "mousemove")).toEqual([["a-fill"]]);
    });
});

describe("une couche née vide entend ce dont elle est remplie ensuite", () => {
    test("attendu 1 — ses points : `-circle` et `-symbol` reçoivent le clic", () => {
        const map = bind(BORN_EMPTY);
        const [heard] = subscriptions(map, "click");
        expect(heard).toEqual(expect.arrayContaining(["a-circle", "a-symbol"]));
        // And the click on a point — drawn by the circle, not by the fill — is emitted.
        expect(clicksEmitted(map, ["a-circle"])).toBe(1);
    });

    test("attendu 2 — toute famille reçue plus tard est écoutée : fond, ligne, point", () => {
        const map = bind(BORN_EMPTY);
        expect(subscriptions(map, "click")).toEqual([BORN_EMPTY]);
        for (const family of ["a-fill", "a-line", "a-circle"]) {
            vi.mocked(dispatchGeoLeafEvent).mockClear();
            expect(clicksEmitted(map, [family]), family).toBe(1);
        }
    });
});

describe("attendu 3 — un geste = un événement, quelle que soit la géométrie", () => {
    for (const g of GEOMETRIES) {
        test(`${g.nom} — UNE souscription au clic, sur ${g.heard.join(" + ")}`, () => {
            const map = bind([...g.subs]);
            expect(subscriptions(map, "click")).toEqual([[...g.heard]]);
        });

        test(`${g.nom} — toutes ses sous-couches sous le pointeur : UN \`geoleaf:feature:click\``, () => {
            const map = bind([...g.subs]);
            expect(clicksEmitted(map, [...g.subs])).toBe(1);
        });
    }

    test("couche née vide — un point sur un polygone de la même couche : un seul clic", () => {
        const map = bind(BORN_EMPTY);
        expect(clicksEmitted(map, ["a-circle", "a-fill"])).toBe(1);
    });
});

describe("attendu 4 — le survol suit la même règle que le clic", () => {
    for (const g of [...GEOMETRIES, { nom: "couche née vide", subs: BORN_EMPTY }]) {
        test(`${g.nom} — \`mousemove\` et \`mouseleave\` visent les sous-couches du clic`, () => {
            const map = bind([...g.subs]);
            const click = subscriptions(map, "click");
            expect(click).toHaveLength(1);
            expect(subscriptions(map, "mousemove")).toEqual(click);
            expect(subscriptions(map, "mouseleave")).toEqual(click);
        });
    }
});

describe("ce que le correctif ne doit PAS emporter", () => {
    test("une sous-couche absente de la carte reste non branchée", () => {
        const map = fakeMap(["a-fill"]);
        bindFeatureInteractionEvents("L", {}, map as never, ["a-fill", "fantome-fill"]);
        expect(subscriptions(map, "click")).toEqual([["a-fill"]]);
    });

    test("aucune sous-couche sur la carte : aucune souscription", () => {
        const map = fakeMap([]);
        bindFeatureInteractionEvents("L", {}, map as never, ["a-fill", "a-line"]);
        expect(map.on).not.toHaveBeenCalled();
    });

    test("aucun suffixe reconnu : la liste entière est liée, en une souscription", () => {
        const map = bind(["a-heat", "a-raster"]);
        expect(subscriptions(map, "click")).toEqual([["a-heat", "a-raster"]]);
    });
});
