/*!
 * @geoleaf-plugins/routing — Bringing a computed route into view
 *
 * Moves the map only when it has to, which is the whole design.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getNativeMap } from "@geoleaf/host-runtime";
import type { RouteResult } from "./model.js";

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
}

/** Margin left around a fitted route, in pixels. */
const FIT_PADDING_PX = 48;

/** How long the fit takes, in milliseconds. Long enough to be followed by the eye. */
const FIT_DURATION_MS = 600;

/**
 * The bounding box of a route's waypoints and geometry.
 *
 * ⚠️ Built from the WAYPOINTS and not the decoded line, and the difference matters at the ends: a
 * provider snaps stops to the network, so a waypoint can sit a few metres off the line it
 * produced. Fitting the line alone can leave a marker just outside the frame — the one thing a
 * user looks for first.
 *
 * @param route The computed route.
 * @returns The box, or `null` when the route carries no usable position.
 */
export function routeBbox(route: RouteResult): Bbox | null {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

    for (const wp of route.waypoints) {
        const [lon, lat] = wp.coordinates;
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

    const view = currentBbox(map);
    // No readable view is not a reason to refuse: a map that cannot say where it is looking is one
    // that has just been created, and fitting is exactly right there.
    if (view && bboxWithin(box, view)) return false;

    map.fitBounds(
        [
            [box[0], box[1]],
            [box[2], box[3]],
        ],
        {
            padding: FIT_PADDING_PX,
            duration: FIT_DURATION_MS,
            // The move is the plugin's, not a gesture: reporting it as user-originated makes the
            // map's own "the user has interacted" logic cancel follow modes elsewhere in the core.
            essential: true,
        }
    );
    return true;
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
