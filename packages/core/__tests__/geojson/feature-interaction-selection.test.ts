/**
 * WHICH sub-layers receive which gesture.
 *
 * A file distinct from `feature-interaction-events.test.js`, which carries
 * the other question: *what* a handler dispatches once triggered. Here the
 * payload is never looked at, only the **selection** — the defect's subject.
 *
 * 🛑 THE DEFECT, AND WHY IT OVERFLOWS WHAT THE PLAN DESCRIBES
 *
 * The click loop iterates over **all** sub-layers, where hover goes through
 * `_interactionSubLayerIds`. `maplibre-primitives.ts` (`_addSubLayers`)
 * stacks the sub-layers **by geometry and cumulatively**: a polygon receives
 * `_addPolygonSubLayers` THEN `_addLineSubLayers`. The double event is thus
 * not specific to icon points — measured: point+icon **2**, line+casing
 * **2**, polygon+casing **3**, vector tile **4**.
 *
 * ⚠️ MODELLING HYPOTHESIS, WRITTEN BECAUSE IT IS LOAD-BEARING:
 * `map.on(type, layerId, fn)` registers a listener **delegated per bound
 * sub-layer**, and MapLibre runs each of those whose sub-layer is touched by
 * the gesture. Replaying here all the captured handlers with the SAME event
 * thus models a single click on an entity rendered by several sub-layers.
 * Without this sentence, the test would assert more than it measures.
 *
 * The CONVERGENCE assertion (last block) is the one with the most value over
 * time: it keeps the two gestures from re-diverging, which no comment can do.
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

/** Fake MapLibre map: retains each `(type, sub-layer)` subscription and its handler. */
function fakeMap(layers: string[]) {
    const bound: Array<{ type: string; id: string; fn: Handler }> = [];
    return {
        __geoleafExclusiveMode: false,
        getLayer: (id: string) => layers.includes(id),
        getCanvas: () => ({ style: {} as Record<string, string> }),
        on: vi.fn((type: string, id: string, fn: Handler) => bound.push({ type, id, fn })),
        off: vi.fn(),
        _bound: bound,
    };
}

/** The sub-layers `type` was wired on, in binding order. */
function idsFor(map: ReturnType<typeof fakeMap>, type: string): string[] {
    return map._bound.filter((b) => b.type === type).map((b) => b.id);
}

/**
 * Replays the same click on all bound `click` handlers, and returns the
 * number of `geoleaf:feature:click` emitted. The counting oracle.
 */
function clicksEmitted(map: ReturnType<typeof fakeMap>): number {
    const e = {
        features: [{ id: 7, properties: {}, geometry: { type: "Point" } }],
        lngLat: { lat: 1, lng: 2 },
        point: { x: 10, y: 20 },
    };
    for (const b of map._bound) if (b.type === "click") b.fn(e);
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
 * The four real stackings, as `_addSubLayers` produces them.
 * `primary` is the sub-layer the `fill → circle → line → all` precedence designates.
 */
const GEOMETRIES = [
    { nom: "point + icône", subs: ["a-circle", "a-symbol"], primary: "a-circle", avant: 2 },
    { nom: "ligne + casing", subs: ["a-casing", "a-line"], primary: "a-line", avant: 2 },
    {
        nom: "polygone + casing",
        subs: ["a-fill", "a-casing", "a-line"],
        primary: "a-fill",
        avant: 3,
    },
    {
        nom: "tuile vectorielle",
        subs: ["a-fill", "a-casing", "a-line", "a-circle"],
        primary: "a-fill",
        avant: 4,
    },
] as const;

beforeEach(() => vi.clearAllMocks());

describe("garde de non-vacuité — le binder lie bien quelque chose", () => {
    test("une couche à sous-couche unique reçoit clic ET survol", () => {
        const map = bind(["a-fill"]);
        expect(idsFor(map, "click")).toEqual(["a-fill"]);
        expect(idsFor(map, "mousemove")).toEqual(["a-fill"]);
    });
});

describe("un geste = un événement, quelle que soit la géométrie", () => {
    for (const g of GEOMETRIES) {
        test(`${g.nom} — le clic ne se lie qu'à \`${g.primary}\` (${g.avant} événements avant)`, () => {
            const map = bind([...g.subs]);
            expect(idsFor(map, "click")).toEqual([g.primary]);
        });

        test(`${g.nom} — un clic n'émet qu'UN \`geoleaf:feature:click\``, () => {
            const map = bind([...g.subs]);
            expect(clicksEmitted(map)).toBe(1);
        });
    }
});

describe("le clic et le survol partagent la MÊME précédence", () => {
    for (const g of GEOMETRIES) {
        test(`${g.nom} — les deux gestes visent les mêmes sous-couches`, () => {
            const map = bind([...g.subs]);
            expect(idsFor(map, "click")).toEqual(idsFor(map, "mousemove"));
        });
    }
});

describe("ce que le correctif ne doit PAS emporter", () => {
    test("une sous-couche absente de la carte reste non branchée", () => {
        const map = fakeMap(["a-fill"]);
        bindFeatureInteractionEvents("L", {}, map as never, ["a-fill", "fantome-fill"]);
        expect(idsFor(map, "click")).toEqual(["a-fill"]);
    });

    test("le primaire absent de la carte ne branche aucun clic", () => {
        const map = fakeMap([]);
        bindFeatureInteractionEvents("L", {}, map as never, ["a-fill", "a-line"]);
        expect(idsFor(map, "click")).toEqual([]);
    });
});
