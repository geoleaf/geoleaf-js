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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RouteResult } from "../model.js";

const { getNativeMapMock } = vi.hoisted(() => ({ getNativeMapMock: vi.fn() }));
vi.mock("@geoleaf/host-runtime", async (importOriginal) => ({
    // The real occlusion geometry: what covers the map is what these tests exercise.
    ...(await importOriginal<typeof import("@geoleaf/host-runtime")>()),
    coreConfigGet: () => ({}),
    getNativeMap: () => getNativeMapMock(),
    Log: { warn: () => {}, error: () => {}, info: () => {} },
}));

const { routeBbox, bboxWithin, fitRouteIfOutOfView } = await import("../fit-route.js");
const { encodePolyline } = await import("../polyline.js");

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

describe("routeBbox — construite sur les points ET la ligne", () => {
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

    // A route along a coast bulges far past its stops: fitted on the stops alone, 364 of its 1417
    // vertices fell under the phone's toolbar and 260 off the canvas.
    it("englobe aussi la ligne quand elle sort de la boîte des points", () => {
        const r = {
            ...route([
                [2, 1],
                [4, 3],
            ]),
            geometry: encodePolyline(
                [
                    [2, 1],
                    [1, 2],
                    [4, 3],
                ],
                5
            ),
        } as RouteResult;
        expect(routeBbox(r)).toEqual([1, 1, 4, 3]);
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

describe("the visible area — what the application lays over the map", () => {
    /** A 1440 × 900 map container, and a side panel covering it from x = 1084. */
    function stage(panel: boolean) {
        document.body.innerHTML = "";
        const container = document.createElement("div");
        document.body.append(container);
        const rect = (l: number, t: number, w: number, h: number) =>
            ({
                left: l,
                top: t,
                right: l + w,
                bottom: t + h,
                width: w,
                height: h,
                x: l,
                y: t,
            }) as DOMRect;
        container.getBoundingClientRect = () => rect(0, 0, 1440, 900);
        if (panel) {
            const p = document.createElement("div");
            p.id = "gl-right-panel";
            p.getBoundingClientRect = () => rect(1084, 0, 356, 900);
            p.getClientRects = () => [rect(1084, 0, 356, 900)] as unknown as DOMRectList;
            document.body.append(p);
        }
        return container;
    }

    /** A map that projects longitude 0..1 onto x 0..1440, and records its fits. */
    function projectingMap(container: Element) {
        const fits: unknown[][] = [];
        const map = {
            getContainer: () => container,
            project: ([lng, lat]: [number, number]) => ({ x: lng * 1440, y: lat * 900 }),
            getBounds: () => ({
                getWest: () => 0,
                getSouth: () => 0,
                getEast: () => 1,
                getNorth: () => 1,
            }),
            fitBounds: (...a: unknown[]) => fits.push(a),
        };
        getNativeMapMock.mockReturnValue(map);
        return fits;
    }

    it("refits a route whose arrival sits under the side panel, padding that edge", () => {
        const fits = projectingMap(stage(true));
        // Arrival at x = 1334: inside the canvas, under the panel.
        expect(
            fitRouteIfOutOfView(
                route([
                    [0.2, 0.5],
                    [0.926, 0.5],
                ])
            )
        ).toBe(true);
        const padding = (fits[0]![1] as { padding: { right: number; left: number } }).padding;
        expect(padding.right).toBeGreaterThanOrEqual(356);
        expect(padding.left).toBeLessThan(100);
    });

    it("leaves the map alone when the route is in the uncovered part", () => {
        const fits = projectingMap(stage(true));
        expect(
            fitRouteIfOutOfView(
                route([
                    [0.2, 0.5],
                    [0.6, 0.5],
                ])
            )
        ).toBe(false);
        expect(fits).toHaveLength(0);
    });

    it("without anything over the map, the same arrival needs no move", () => {
        const fits = projectingMap(stage(false));
        expect(
            fitRouteIfOutOfView(
                route([
                    [0.2, 0.5],
                    [0.926, 0.5],
                ])
            )
        ).toBe(false);
        expect(fits).toHaveLength(0);
    });
});

describe("the visible area on a phone — the bottom sheet", () => {
    const rect = (l: number, t: number, w: number, h: number) =>
        ({
            left: l,
            top: t,
            right: l + w,
            bottom: t + h,
            width: w,
            height: h,
            x: l,
            y: t,
        }) as DOMRect;

    /** A 412 × 915 map container, the open sheet covering it from y = 412, full width. */
    function phone(): Element {
        document.body.innerHTML = "";
        const container = document.createElement("div");
        container.getBoundingClientRect = () => rect(0, 0, 412, 915);
        const sheet = document.createElement("div");
        sheet.className = "gl-sheet-panel";
        sheet.getBoundingClientRect = () => rect(0, 412, 412, 503);
        sheet.getClientRects = () => [rect(0, 412, 412, 503)] as unknown as DOMRectList;
        document.body.append(container, sheet);
        return container;
    }

    it("a full-width sheet hugging the bottom pads the bottom edge, not the left one", () => {
        const container = phone();
        const fits: unknown[][] = [];
        getNativeMapMock.mockReturnValue({
            getContainer: () => container,
            project: ([lng, lat]: [number, number]) => ({ x: lng * 412, y: lat * 915 }),
            fitBounds: (...a: unknown[]) => fits.push(a),
        });
        // Arrival at y = 732: inside the canvas, under the sheet.
        expect(
            fitRouteIfOutOfView(
                route([
                    [0.3, 0.2],
                    [0.6, 0.8],
                ])
            )
        ).toBe(true);
        const padding = fits[0]![1] as { padding: { bottom: number; left: number } };
        expect(padding.padding.bottom).toBeGreaterThanOrEqual(503);
        expect(padding.padding.left).toBeLessThan(100);
    });
});

describe("a pitched camera — the engine fits the box flat", () => {
    /**
     * The desktop stage of the pitched case: 1440 × 900, the side panel from x = 1084.
     *
     * The engine computes a fit on the flat ground box and keeps the pitch; at 60° the near side
     * of the box widens on screen. Replayed on the engine's own camera code under Node, the
     * Buenos Aires stop lands at x = 1075 — 9 px from the panel — where a flat camera puts it 96 px
     * away. The double below reproduces that outcome: positions before the fit, after the first
     * fit, and after any further one.
     */
    function pitchedStage() {
        document.body.innerHTML = "";
        const rect = (l: number, t: number, w: number, h: number) =>
            ({
                left: l,
                top: t,
                right: l + w,
                bottom: t + h,
                width: w,
                height: h,
                x: l,
                y: t,
            }) as DOMRect;
        const container = document.createElement("div");
        container.getBoundingClientRect = () => rect(0, 0, 1440, 900);
        const panel = document.createElement("div");
        panel.id = "gl-right-panel";
        panel.getBoundingClientRect = () => rect(1084, 0, 356, 900);
        panel.getClientRects = () => [rect(1084, 0, 356, 900)] as unknown as DOMRectList;
        document.body.append(container, panel);

        const positions: Record<number, readonly { x: number; y: number }[]> = {
            0: [
                { x: 1300, y: 800 },
                { x: 600, y: 200 },
            ],
            1: [
                { x: 1075, y: 703 },
                { x: 259, y: 305 },
            ],
            2: [
                { x: 1020, y: 700 },
                { x: 280, y: 310 },
            ],
        };
        const fits: unknown[][] = [];
        const listeners: (() => void)[] = [];
        const camera = { zoom: 8.02, center: { lng: -59.5, lat: -33.8 } };
        let landed = camera;
        const map = {
            getContainer: () => container,
            project: ([lng]: [number, number]) => {
                const set = positions[Math.min(fits.length, 2)]!;
                return set[lng === 1 ? 0 : 1]!;
            },
            fitBounds: (...a: unknown[]) => fits.push(a),
            once: (type: string, cb: () => void) => {
                if (type === "moveend") listeners.push(cb);
            },
            cameraForBounds: () => camera,
            getZoom: () => landed.zoom,
            getCenter: () => landed.center,
        };
        getNativeMapMock.mockReturnValue(map);
        const moveEnd = (where = camera) => {
            landed = where;
            listeners.splice(0).forEach((cb) => cb());
        };
        const setLanded = (at: readonly { x: number; y: number }[]) => {
            positions[1] = at;
        };
        return { fits, moveEnd, setLanded };
    }

    const twoStops = () =>
        route([
            [1, 0],
            [0, 0],
        ]);

    it("refits once when a stop lands within the margin of the panel after the fit", () => {
        const { fits, moveEnd } = pitchedStage();
        expect(fitRouteIfOutOfView(twoStops())).toBe(true);
        expect(fits).toHaveLength(1);
        moveEnd();
        expect(fits).toHaveLength(2);
        const first = (fits[0]![1] as { padding: { right: number; left: number } }).padding;
        const second = (fits[1]![1] as { padding: { right: number; left: number } }).padding;
        // 9 px left of the 48 wanted: the right padding grows by twice the deficit.
        expect(second.right).toBe(first.right + 2 * (48 - 9));
        expect(second.left).toBe(first.left);
        // One correction, never a chase.
        moveEnd();
        expect(fits).toHaveLength(2);
    });

    // A flat fit leaves a stop at 48 px minus a rounding error: a second, identical fit went off
    // for 1.8e-10 px of "deficit".
    it("does not refit for a sub-pixel shortfall", () => {
        const { fits, moveEnd, setLanded } = pitchedStage();
        fitRouteIfOutOfView(twoStops());
        setLanded([
            { x: 1084 - 48 + 1e-10, y: 700 },
            { x: 280, y: 310 },
        ]);
        moveEnd();
        expect(fits).toHaveLength(1);
    });

    it("does not refit a flight that ended elsewhere — interrupted by the user, or clamped", () => {
        const { fits, moveEnd } = pitchedStage();
        fitRouteIfOutOfView(twoStops());
        moveEnd({ zoom: 8.58, center: { lng: -59.5, lat: -33.8 } });
        expect(fits).toHaveLength(1);
    });
});

describe("a camera the profile's bounds hold back, under the open mobile sheet", () => {
    const rect = (l: number, t: number, w: number, h: number) =>
        ({
            left: l,
            top: t,
            right: l + w,
            bottom: t + h,
            width: w,
            height: h,
            x: l,
            y: t,
        }) as DOMRect;

    /**
     * A Pixel 7 stage: a 412 × 839 map, the sheet covering it from y = 336. Lowering the sheet
     * leaves only its 57 px header. The engine announces zoom 8.04 for the fit, and the profile's
     * bounds stop the camera at 8.58 — the reunion-eclairage measurement.
     */
    function heldBackStage(lowers: boolean, arrivalY = 558) {
        document.body.innerHTML = "";
        const container = document.createElement("div");
        container.getBoundingClientRect = () => rect(0, 0, 412, 839);
        const sheet = document.createElement("div");
        sheet.className = "gl-sheet-panel";
        let sheetRect = rect(0, 336, 412, 503);
        sheet.getBoundingClientRect = () => sheetRect;
        sheet.getClientRects = () => [sheetRect] as unknown as DOMRectList;
        document.body.append(container, sheet);

        const setPaneSize = vi.fn(async (size: string) => {
            if (!lowers) return false;
            if (size === "peek") sheetRect = rect(0, 782, 412, 57);
            return true;
        });
        (globalThis as { GeoLeaf?: unknown }).GeoLeaf = { UI: { setPaneSize } };

        const fits: unknown[][] = [];
        const listeners: (() => void)[] = [];
        const announced = { zoom: 8.04, center: { lng: 55.5, lat: -21.1 } };
        let landed = announced;
        getNativeMapMock.mockReturnValue({
            getContainer: () => container,
            // Departure on screen, arrival under the sheet, whatever the camera.
            project: ([lng]: [number, number]) =>
                lng === 1 ? { x: 200, y: arrivalY } : { x: 150, y: 287 },
            fitBounds: (...a: unknown[]) => fits.push(a),
            once: (type: string, cb: () => void) => {
                if (type === "moveend") listeners.push(cb);
            },
            cameraForBounds: () => announced,
            getZoom: () => landed.zoom,
            getCenter: () => landed.center,
        });
        const moveEnd = (where = announced) => {
            landed = where;
            listeners.splice(0).forEach((cb) => cb());
        };
        return { fits, moveEnd, setPaneSize };
    }

    const twoStops = () =>
        route([
            [0, 0],
            [1, 0],
        ]);
    const heldBack = { zoom: 8.58, center: { lng: 55.5, lat: -21.1 } };
    const flush = () => new Promise((r) => setTimeout(r, 0));

    afterEach(() => {
        delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
    });

    it("lowers the sheet to its header, then fits once more against what is left", async () => {
        const { fits, moveEnd, setPaneSize } = heldBackStage(true);
        expect(fitRouteIfOutOfView(twoStops())).toBe(true);
        const first = (fits[0]![1] as { padding: { bottom: number } }).padding;
        expect(first.bottom).toBeGreaterThanOrEqual(503);
        moveEnd(heldBack);
        await flush();
        expect(setPaneSize).toHaveBeenCalledWith("peek");
        expect(fits).toHaveLength(2);
        const second = (fits[1]![1] as { padding: { bottom: number } }).padding;
        // Re-measured after the sheet settled: its header and the margin, nothing more.
        expect(second.bottom).toBe(57 + 48);
        // Once: the second landing is accepted as it is.
        moveEnd(heldBack);
        await flush();
        expect(fits).toHaveLength(2);
        expect(setPaneSize).toHaveBeenCalledTimes(1);
    });

    it("leaves the sheet alone when the camera landed where the engine said", async () => {
        const { fits, moveEnd, setPaneSize } = heldBackStage(true);
        fitRouteIfOutOfView(twoStops());
        moveEnd();
        await flush();
        expect(setPaneSize).not.toHaveBeenCalled();
        expect(fits.length).toBeLessThanOrEqual(2);
    });

    it("does not refit when no sheet could be lowered — a desktop, or an older kernel", async () => {
        const { fits, moveEnd, setPaneSize } = heldBackStage(false);
        fitRouteIfOutOfView(twoStops());
        moveEnd(heldBack);
        await flush();
        expect(setPaneSize).toHaveBeenCalledWith("peek");
        expect(fits).toHaveLength(1);
    });

    it("keeps the sheet open when the held-back camera still shows every stop", async () => {
        const { fits, moveEnd, setPaneSize } = heldBackStage(true, 300);
        // Out of view before the fit: the arrival under the sheet.
        const stage = getNativeMapMock();
        getNativeMapMock.mockReturnValue({
            ...stage,
            project: (() => {
                let calls = 0;
                return ([lng]: [number, number]) =>
                    lng === 1 ? { x: 200, y: calls++ < 1 ? 558 : 300 } : { x: 150, y: 287 };
            })(),
        });
        fitRouteIfOutOfView(twoStops());
        moveEnd(heldBack);
        await flush();
        expect(setPaneSize).not.toHaveBeenCalled();
        expect(fits).toHaveLength(1);
    });

    it("does not lower the sheet for a camera that stopped SHORT of the zoom — a user's gesture", async () => {
        const { moveEnd, setPaneSize } = heldBackStage(true);
        fitRouteIfOutOfView(twoStops());
        moveEnd({ zoom: 7.5, center: { lng: 55.5, lat: -21.1 } });
        await flush();
        expect(setPaneSize).not.toHaveBeenCalled();
    });
});
