/*!
 * @geoleaf-plugins/routing — Bringing a computed route into view
 *
 * Moves the map only when it has to, which is the whole design.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coveredInsets, getNativeMap, paddingClearOf, type Insets } from "@geoleaf/host-runtime";
import type { RouteResult } from "./model.js";
import { decodePolyline } from "./polyline.js";
import { lowerSheet } from "./ui-seam.js";

/**
 * ## 🛑 The map moves only when the route is NOT already visible
 *
 * Three other rules were on the table and each is worse in a way worth naming.
 *
 * **Unconditional** is the obvious one: every computation refits. It is predictable, and it takes
 * the map away from someone who had just zoomed in on a junction to decide where to add their next
 * stop — at the exact moment they act on that decision. The one gesture guaranteed to trigger it
 * is the one where the user was looking at something.
 *
 * **A configuration key** hands the choice to the integrator. It also puts a key on five gated
 * surfaces — schema, inventory, sheet, README, reference profile — to encode a decision that the
 * geometry can simply answer. A setting that exists because nobody wanted to decide is a setting
 * every integrator then has to.
 *
 * **First computation only** never surprises, and never helps either: add a stop outside the
 * current view and it stays outside, silently.
 *
 * Reading the geometry answers it without asking anyone: **if the route is already on screen,
 * moving is noise; if it is not, not moving is a blank map.** There is no configuration because
 * there is no preference — there is a fact.
 *
 * ## ⚠️ What this deliberately does not handle
 *
 * A route crossing the antimeridian. Its bounding box degenerates into one spanning the whole
 * planet, and the fit would zoom out to the world. Handling it properly means splitting the
 * geometry, which is a real piece of work with no consumer here — this repository's routes are
 * regional. **Named rather than silently wrong**: a future engine covering the Pacific will need
 * it, and will find this paragraph instead of a mystery.
 */

/** A bounding box, `[west, south, east, north]`. */
export type Bbox = readonly [number, number, number, number];

/** The map surface this needs. */
interface FittableMap {
    getBounds?(): unknown;
    fitBounds?(bounds: unknown, options?: unknown): void;
    getContainer?(): Element;
    project?(lngLat: readonly [number, number]): { x: number; y: number };
    once?(type: "moveend", listener: () => void): unknown;
    cameraForBounds?(bounds: unknown, options?: unknown): Camera | undefined;
    getZoom?(): number;
    getCenter?(): { lng: number; lat: number };
}

/** Where a fit sends the camera, as the engine computes it before moving. */
interface Camera {
    readonly zoom: number;
    readonly center: { readonly lng: number; readonly lat: number };
}

/** Margin left around a fitted route, in pixels. */
const FIT_PADDING_PX = 48;

/** How long the fit takes, in milliseconds. Long enough to be followed by the eye. */
const FIT_DURATION_MS = 600;

/**
 * The bounding box of a route's waypoints and geometry.
 *
 * ⚠️ Built from the WAYPOINTS AND the decoded line, and each covers what the other misses. A
 * provider snaps stops to the network, so a waypoint can sit a few metres off the line it
 * produced: fitting the line alone can leave a marker just outside the frame — the one thing a
 * user looks for first. And a line along a coast bulges far past its stops: fitted on the stops
 * alone, 364 of 1417 vertices fell under a phone's toolbar. The line is decoded at precision 5,
 * the one every normaliser of this package re-encodes to.
 *
 * @param route The computed route.
 * @returns The box, or `null` when the route carries no usable position.
 */
export function routeBbox(route: RouteResult): Bbox | null {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

    const line = route.geometry ? decodePolyline(route.geometry, 5) : [];
    const points = [...route.waypoints.map((wp) => wp.coordinates), ...line];
    for (const [lon, lat] of points) {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
    }

    if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
    return [west, south, east, north];
}

/**
 * Whether `inner` lies entirely within `outer`.
 *
 * ⚠️ No inset, no tolerance. A route touching the edge of the view IS on screen, and inventing a
 * comfort margin here would make the rule impossible to predict from what one can see — the user
 * would watch the map move for a route that was plainly already there.
 *
 * @param inner The route's box.
 * @param outer The current view's box.
 * @returns `true` when nothing of `inner` falls outside `outer`.
 */
export function bboxWithin(inner: Bbox, outer: Bbox): boolean {
    return (
        inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
    );
}

/**
 * Brings `route` into view, if it is not already.
 *
 * @param route The computed route.
 * @returns `true` when the map was moved. `false` covers three different situations that share an
 *          outcome — no map, no usable geometry, and a route already on screen — and the caller has
 *          no reason to tell them apart: in all three, the right thing happened.
 */
export function fitRouteIfOutOfView(route: RouteResult): boolean {
    const map = getNativeMap<FittableMap>();
    if (typeof map?.fitBounds !== "function") return false;

    const box = routeBbox(route);
    if (!box) return false;

    // 🛑 « On screen » means on the part of the map the user can SEE. Judged against the whole
    // canvas, a route under the side panel or the theme bar counted as visible and the map did
    // not move; fitted with a uniform margin, the arrival landed under the panel — measured at
    // x = 1334 of 1440, the panel covering from x ≈ 1084, the camera pitched at 60°.
    const container = map.getContainer?.();
    const insets = container ? coveredInsets(container) : null;
    const visible = insets && container ? routeInVisibleArea(map, route, container, insets) : null;
    if (visible === true) return false;
    if (visible === null) {
        const view = currentBbox(map);
        // No readable view is not a reason to refuse: a map that cannot say where it is looking
        // is one that has just been created, and fitting is exactly right there.
        if (view && bboxWithin(box, view)) return false;
    }

    const padding = fitPadding(insets, container);
    // Armed BEFORE the move: an engine that has nothing to animate ends it within the call.
    if (insets && container && typeof padding !== "number") {
        settleInView(map, route, box, container, insets, padding);
    }
    fit(map, box, padding, FIT_DURATION_MS);
    return true;
}

/** `box` as the south-west and north-east corners a map's fit takes. */
function lngLatPair(box: Bbox): [[number, number], [number, number]] {
    return [
        [box[0], box[1]],
        [box[2], box[3]],
    ];
}

/** Asks the map to fit `box` with `padding`. */
function fit(map: FittableMap, box: Bbox, padding: number | Insets, duration: number): void {
    map.fitBounds?.(lngLatPair(box), {
        padding,
        duration,
        // The move is the plugin's, not a gesture: reporting it as user-originated makes the
        // map's own "the user has interacted" logic cancel follow modes elsewhere in the core.
        essential: true,
    });
}

/**
 * Whether the map's camera is the one `target` describes — zoom within a hundredth, centre within
 * about a pixel.
 *
 * @returns `false` when the map cannot say where it is.
 */
function landedOn(map: FittableMap, target: Camera): boolean {
    const zoom = map.getZoom?.();
    const center = map.getCenter?.();
    if (typeof zoom !== "number" || !center) return false;
    // One pixel, in degrees of longitude, at this zoom — 512 px tiles.
    const pixel = 360 / (512 * 2 ** zoom);
    return (
        Math.abs(zoom - target.zoom) < 0.01 &&
        Math.abs(center.lng - target.center.lng) < pixel &&
        Math.abs(center.lat - target.center.lat) < pixel
    );
}

/**
 * Once the fit has landed, corrects it if a stop came out closer than the margin to an edge.
 *
 * 🛑 The engine fits a pitched camera FLAT. It sizes and centres the ground box as if seen from
 * above, then keeps the pitch — and at 60° the near side of the box widens on screen. Replayed on
 * the engine's own camera code, the stop at the bottom right of a Buenos Aires route landed 9 px
 * from the side panel where a flat camera leaves 96; the padding that keeps the toolbar clear
 * (106 px on the left) had pushed it there. Only the projection AFTER the move says where the
 * stops are, so it is read then.
 *
 * Each edge short of the margin gets twice its deficit as extra padding: in a flat fit, an
 * asymmetric padding shifts the box by half its difference, so a stop moves by half of what is
 * added. The pitch amplifies that shift near the camera, which the doubling leaves as slack.
 *
 * ⚠️ ONE correction, never a chase: a second short landing is accepted as it is — a fit that kept
 * moving would take the map from the user for good. And only a fit that LANDED where the engine
 * said it would: a flight the user interrupted (the engine ends it with the same `moveend`, with
 * no trace of the gesture) is theirs, and a camera the profile's bounds clamped cannot be helped
 * by more padding — that one gets the room of the mobile sheet instead, see `revealPastSheet`.
 */
function settleInView(
    map: FittableMap,
    route: RouteResult,
    box: Bbox,
    container: Element,
    insets: Insets,
    padding: Insets
): void {
    if (typeof map.once !== "function" || typeof map.project !== "function") return;
    const target = map.cameraForBounds?.(lngLatPair(box), { padding });
    if (!target) return;
    map.once("moveend", () => {
        if (!landedOn(map, target)) {
            if (heldBack(map, target)) revealPastSheet(map, route, box, container, insets);
            return;
        }
        const room = roomAround(map, route, container, insets);
        if (!room) return;
        // A deficit under half a pixel is the engine's rounding, not a stop under a surface: a
        // flat fit leaves one at 48 px minus 1.8e-10, and refitting for it moved nothing.
        const extra = (gap: number): number => {
            const deficit = FIT_PADDING_PX - gap;
            return deficit < 0.5 ? 0 : 2 * deficit;
        };
        const corrected = {
            top: padding.top + extra(room.top),
            right: padding.right + extra(room.right),
            bottom: padding.bottom + extra(room.bottom),
            left: padding.left + extra(room.left),
        };
        const sum = (p: Insets): number => p.top + p.right + p.bottom + p.left;
        if (sum(corrected) === sum(padding)) return;
        // Re-checked against the canvas: a padding that no longer fits makes the engine refuse.
        const usable = paddingClearOf(container, corrected, 0);
        if (usable) fit(map, box, usable, FIT_DURATION_MS / 2);
    });
}

/**
 * Whether the camera stopped CLOSER than the fit asked — the mark of the profile's bounds.
 *
 * A camera held inside bounds that a lower zoom would overflow is pushed in, never out; a camera
 * further out than announced is a user's gesture, and theirs.
 */
function heldBack(map: FittableMap, target: Camera): boolean {
    const zoom = map.getZoom?.();
    return typeof zoom === "number" && zoom > target.zoom + 0.01;
}

/**
 * Lowers the mobile sheet to its header, then fits `box` once more against what is left.
 *
 * 🛑 The bounds cannot be argued with: on a phone, the open sheet leaves a band too short for the
 * zoom the route needs, and the camera stops at the zoom the bounds allow — measured at 8.58 for a
 * fit asking 8.04, the arrival under the sheet. More padding only asks for a lower zoom still.
 * Giving the route the room the sheet holds is the one move left, and the kernel's to make:
 * `setPaneSize("peek")` answers `false` at desktop widths, where no sheet is open, and an older
 * kernel has no such member — both leave the landing as it is.
 *
 * ⚠️ Measured AFTER the sheet has settled: it slides down, and a box read during the slide is the
 * sheet's old height. And ONE fit, never followed by another correction.
 */
function revealPastSheet(
    map: FittableMap,
    route: RouteResult,
    box: Bbox,
    container: Element,
    insets: Insets
): void {
    // A camera held back that still shows every stop needs nothing.
    if (routeInVisibleArea(map, route, container, insets) !== false) return;
    void lowerSheet().then((lowered) => {
        if (!lowered) return;
        fit(map, box, fitPadding(coveredInsets(container), container), FIT_DURATION_MS);
    });
}

/**
 * How far the stops of `route` sit from each edge of the uncovered area, in pixels — the closest
 * stop per edge, negative when it is beyond it.
 *
 * @returns `null` when the map cannot project or the container has no extent.
 */
function roomAround(
    map: FittableMap,
    route: RouteResult,
    container: Element,
    insets: Insets
): Insets | null {
    if (typeof map.project !== "function") return null;
    const { width, height } = container.getBoundingClientRect();
    if (!(width > 0 && height > 0) || route.waypoints.length === 0) return null;
    const project = map.project.bind(map);
    const points = route.waypoints.map((wp) => project(wp.coordinates));
    return {
        top: Math.min(...points.map((p) => p.y)) - insets.top,
        right: width - insets.right - Math.max(...points.map((p) => p.x)),
        bottom: height - insets.bottom - Math.max(...points.map((p) => p.y)),
        left: Math.min(...points.map((p) => p.x)) - insets.left,
    };
}

/**
 * Whether every stop of `route` projects inside the uncovered part of the map.
 *
 * Read on screen positions rather than a geographic box: a pitched camera does not show a
 * rectangle of the ground, and only the projection says what the user sees.
 *
 * @returns `null` when the map cannot project — the caller then falls back to the view's box.
 */
function routeInVisibleArea(
    map: FittableMap,
    route: RouteResult,
    container: Element,
    insets: Insets
): boolean | null {
    if (typeof map.project !== "function") return null;
    const { width, height } = container.getBoundingClientRect();
    if (!(width > 0 && height > 0)) return null;
    const project = map.project.bind(map);
    return route.waypoints.every((wp) => {
        const p = project(wp.coordinates);
        return (
            p.x >= insets.left &&
            p.x <= width - insets.right &&
            p.y >= insets.top &&
            p.y <= height - insets.bottom
        );
    });
}

/**
 * The fit's padding: the uniform margin, plus what covers each edge.
 *
 * ⚠️ Falls back to the uniform margin when the covered edges leave no room — a padding larger than
 * the canvas makes the engine refuse the fit, which would leave the route where nobody sees it.
 */
function fitPadding(insets: Insets | null, container: Element | undefined): number | Insets {
    if (!insets || !container) return FIT_PADDING_PX;
    return paddingClearOf(container, insets, FIT_PADDING_PX) ?? FIT_PADDING_PX;
}

/**
 * The map's current view as a box.
 *
 * ⚠️ Reads both shapes a map bounds object comes in — the accessor pair (`getWest()`…) and the
 * corner pair (`getSouthWest()`…). Reading only one works against the engine it was written for
 * and answers `null` forever against the other, which looks like "the route is never in view" and
 * makes the map move on every computation.
 *
 * @param map The native map.
 * @returns The box, or `null` when the map cannot say.
 */
function currentBbox(map: FittableMap): Bbox | null {
    const b = map.getBounds?.() as
        | {
              getWest?(): number;
              getSouth?(): number;
              getEast?(): number;
              getNorth?(): number;
              getSouthWest?(): { lng: number; lat: number };
              getNorthEast?(): { lng: number; lat: number };
          }
        | undefined;
    if (!b) return null;

    if (typeof b.getWest === "function" && typeof b.getNorth === "function") {
        // ⚠️ Each bound is read then CHECKED one by one, without building a
        // tuple that would then have to be asserted to the compiler. A type
        // assertion here would say "trust me" about exactly the four numbers
        // whose absence refits the map at every computation — and the repo's
        // debt checker refuses any NEW assertion.
        return finiteBbox(b.getWest(), b.getSouth?.(), b.getEast?.(), b.getNorth());
    }

    const sw = b.getSouthWest?.();
    const ne = b.getNorthEast?.();
    if (!sw || !ne) return null;
    return finiteBbox(sw.lng, sw.lat, ne.lng, ne.lat);
}

/**
 * A box from four values, when all four are real numbers.
 *
 * @param west West edge.
 * @param south South edge.
 * @param east East edge.
 * @param north North edge.
 * @returns The box, or `null` when any of the four is missing or not finite.
 */
function finiteBbox(west: unknown, south: unknown, east: unknown, north: unknown): Bbox | null {
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    return ok(west) && ok(south) && ok(east) && ok(north) ? [west, south, east, north] : null;
}
