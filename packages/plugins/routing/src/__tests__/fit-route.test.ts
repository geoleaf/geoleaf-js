/**
 * Unit tests — the CONDITIONAL fit after computation.
 *
 * 🛑 The design ruled out three other rules, and each shows here in the
 * negative: the unconditional fit (moves the map of someone who just zoomed),
 * the configuration key (a preference where there is a fact), and fitting on
 * the first computation only (a stop added out of frame stays invisible).
 *
 * What is exercised is therefore mostly **when the map does NOT move**.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouteResult } from "../model.js";

const { getNativeMapMock } = vi.hoisted(() => ({ getNativeMapMock: vi.fn() }));
vi.mock("@geoleaf/host-runtime", () => ({
    coreConfigGet: () => ({}),
    getNativeMap: () => getNativeMapMock(),
    Log: { warn: () => {}, error: () => {}, info: () => {} },
}));

const { routeBbox, bboxWithin, fitRouteIfOutOfView } = await import("../fit-route.js");

/**
 * A route reduced to its points.
 *
 * @param coords The positions, as `[lon, lat]`.
 * @returns The route.
 */
function route(coords: readonly (readonly [number, number])[]): RouteResult {
    return {
        distance: 0,
        duration: 0,
        geometry: "",
        provider: "test",
        attribution: "© Test",
        legs: [],
        waypoints: coords.map((c) => ({ coordinates: c })),
    } as unknown as RouteResult;
}

/**
 * A doubled map that returns `view` and records its fits.
 *
 * @param view The current view, `[w, s, e, n]`, or `null` for a mute map.
 * @param shape Which of the two bounds shapes it exposes.
 * @returns The map and the array of requested fits.
 */
function fakeMap(view: readonly number[] | null, shape: "accessors" | "corners" = "accessors") {
    const fits: unknown[][] = [];
    const bounds =
        view === null
            ? undefined
            : shape === "accessors"
              ? {
                    getWest: () => view[0],
                    getSouth: () => view[1],
                    getEast: () => view[2],
                    getNorth: () => view[3],
                }
              : {
                    getSouthWest: () => ({ lng: view[0] as number, lat: view[1] as number }),
                    getNorthEast: () => ({ lng: view[2] as number, lat: view[3] as number }),
                };
    return {
        fits,
        map: {
            getBounds: () => bounds,
            fitBounds: (...a: unknown[]) => fits.push(a),
        },
    };
}

describe("routeBbox — construite sur les POINTS, pas sur la ligne", () => {
    it("englobe tous les points", () => {
        expect(
            routeBbox(
                route([
                    [2, 1],
                    [4, 3],
                    [0, 5],
                ])
            )
        ).toEqual([0, 1, 4, 5]);
    });

    it("un point unique donne une boîte dégénérée, pas `null`", () => {
        // A one-point route is a transient panel state, not an error.
        expect(routeBbox(route([[2, 1]]))).toEqual([2, 1, 2, 1]);
    });

    it("ignore les positions non finies plutôt que de rendre `NaN`", () => {
        const r = route([
            [2, 1],
            [Number.NaN, 3],
            [4, 5],
        ]);
        expect(routeBbox(r)).toEqual([2, 1, 4, 5]);
    });

    it("un itinéraire sans point rend `null`", () => {
        expect(routeBbox(route([]))).toBeNull();
    });
});

describe("bboxWithin — sans marge, et c'est délibéré", () => {
    it("une boîte strictement intérieure est dedans", () => {
        expect(bboxWithin([1, 1, 2, 2], [0, 0, 3, 3])).toBe(true);
    });

    it("🛑 une boîte qui TOUCHE le bord est dedans — pas de marge de confort", () => {
        // A line at the view's edge IS on screen. Inventing a margin would
        // make the rule unpredictable from what you see: the map would move
        // for a route that was plainly already there.
        expect(bboxWithin([0, 0, 3, 3], [0, 0, 3, 3])).toBe(true);
    });

    it("un débordement d'un seul côté suffit à sortir", () => {
        expect(bboxWithin([0, 0, 3.1, 3], [0, 0, 3, 3])).toBe(false);
        expect(bboxWithin([-0.1, 0, 3, 3], [0, 0, 3, 3])).toBe(false);
    });
});

describe("fitRouteIfOutOfView — ce qui compte est quand elle NE bouge PAS", () => {
    beforeEach(() => getNativeMapMock.mockReset());

    it("🛑 un itinéraire DÉJÀ visible ne déplace pas la carte", () => {
        // The assertion carrying the whole decision. The unconditional fit
        // would turn it red, and that is exactly the behaviour ruled out:
        // moving the map of someone who just zoomed, at the moment they act
        // on what they were looking at.
        const { map, fits } = fakeMap([0, 0, 10, 10]);
        getNativeMapMock.mockReturnValue(map);
        expect(
            fitRouteIfOutOfView(
                route([
                    [2, 2],
                    [8, 8],
                ])
            )
        ).toBe(false);
        expect(fits).toHaveLength(0);
    });

    it("un itinéraire hors champ recadre, avec sa marge", () => {
        const { map, fits } = fakeMap([0, 0, 10, 10]);
        getNativeMapMock.mockReturnValue(map);
        expect(
            fitRouteIfOutOfView(
                route([
                    [20, 20],
                    [30, 30],
                ])
            )
        ).toBe(true);
        expect(fits).toHaveLength(1);
        expect(fits[0]?.[0]).toEqual([
            [20, 20],
            [30, 30],
        ]);
        expect(fits[0]?.[1]).toMatchObject({ padding: 48, essential: true });
    });

    it("un débordement PARTIEL recadre aussi", () => {
        // The most frequent case after adding a stop: half the line is visible.
        const { map, fits } = fakeMap([0, 0, 10, 10]);
        getNativeMapMock.mockReturnValue(map);
        expect(
            fitRouteIfOutOfView(
                route([
                    [5, 5],
                    [15, 5],
                ])
            )
        ).toBe(true);
        expect(fits).toHaveLength(1);
    });

    it("🛑 lit AUSSI la forme à coins des bornes", () => {
        // Two shapes exist. Reading only one works against the engine it was
        // written for and returns `null` forever against the other — which
        // reads "never in view" and refits at every computation.
        const { map, fits } = fakeMap([0, 0, 10, 10], "corners");
        getNativeMapMock.mockReturnValue(map);
        expect(
            fitRouteIfOutOfView(
                route([
                    [2, 2],
                    [8, 8],
                ])
            )
        ).toBe(false);
        expect(fits).toHaveLength(0);
    });

    it("une carte qui ne sait pas dire sa vue est CADRÉE, pas ignorée", () => {
        // It is a freshly created map, and fitting there is exactly right.
        const { map, fits } = fakeMap(null);
        getNativeMapMock.mockReturnValue(map);
        expect(
            fitRouteIfOutOfView(
                route([
                    [2, 2],
                    [8, 8],
                ])
            )
        ).toBe(true);
        expect(fits).toHaveLength(1);
    });

    it("sans carte, rien ne se passe et rien ne jette", () => {
        getNativeMapMock.mockReturnValue(undefined);
        expect(
            fitRouteIfOutOfView(
                route([
                    [2, 2],
                    [8, 8],
                ])
            )
        ).toBe(false);
    });

    it("un itinéraire sans point ne cadre pas", () => {
        const { map, fits } = fakeMap([0, 0, 10, 10]);
        getNativeMapMock.mockReturnValue(map);
        expect(fitRouteIfOutOfView(route([]))).toBe(false);
        expect(fits).toHaveLength(0);
    });
});
