/*!
 * @geoleaf-plugins/routing — Per-leg summaries
 *
 * Pairs each leg of a computed route with the waypoints it runs between, so a step list can show
 * the time and distance since the previous point.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteResult, Waypoint } from "./model.js";

/**
 * ## Why this pairing needs a function at all
 *
 * `RouteLeg` already carries its distance and duration — the model has since it was frozen, and
 * the corpus proves the values are right. What it does NOT carry is which two points it runs
 * between, because a leg does not know its own index.
 *
 * The pairing is `legs[i]` runs from `waypoints[i]` to `waypoints[i + 1]`, and it holds by
 * construction: a provider answers one leg per consecutive pair. Writing it once, here, is what
 * keeps the off-by-one out of the panel — where it would render as a distance attributed to the
 * wrong stop, which looks like a routing error and is not one.
 *
 * ⚠️ **The waypoints used are the route's SNAPPED ones, not the ones that were asked for.** A
 * destination clicked in the middle of a block routes from the nearest road, and pairing against
 * the asked-for points would put the leg between two places the route never touched.
 */

/** One leg, told with the points it runs between. */
export interface LegSummary {
    /** Position of the leg, from 0. The step number shown is `index + 2` — see below. */
    readonly index: number;
    /** Where this leg starts. */
    readonly from: Waypoint;
    /** Where it ends. */
    readonly to: Waypoint;
    /** Length of this leg, in METRES. */
    readonly distance: number;
    /** Expected time for this leg, in SECONDS. */
    readonly duration: number;
    /**
     * Cumulative distance from the origin to the END of this leg, in METRES.
     *
     * Carried rather than left to the caller because "distance so far" and "distance of this
     * leg" are two different columns in the same list, and a caller summing as it renders has
     * to hold state across rows — which is where a re-render halfway through goes wrong.
     */
    readonly distanceFromStart: number;
    /** Cumulative time from the origin to the end of this leg, in SECONDS. */
    readonly durationFromStart: number;
}

/**
 * Pairs every leg of a route with its endpoints.
 *
 * @param route A computed route.
 * @returns One summary per leg, in travel order. Empty when the route has no legs.
 */
export function legSummaries(route: RouteResult): LegSummary[] {
    const out: LegSummary[] = [];
    let distance = 0;
    let duration = 0;

    for (let i = 0; i < route.legs.length; i += 1) {
        const leg = route.legs[i];
        const from = route.waypoints[i];
        const to = route.waypoints[i + 1];
        // A provider that answered more legs than it has waypoint pairs is malformed, and the
        // normaliser is what should have caught it. Stopping here rather than emitting a summary
        // with an undefined endpoint keeps the defect where it can be seen.
        if (!leg || !from || !to) break;

        distance += leg.distance;
        duration += leg.duration;
        out.push({
            index: i,
            from,
            to,
            distance: leg.distance,
            duration: leg.duration,
            distanceFromStart: distance,
            durationFromStart: duration,
        });
    }
    return out;
}

/**
 * The step number a waypoint carries in the list, from its position.
 *
 * Derived and never stored — the same reason as in `composition.ts`. A stored number survives a
 * reorder and starts lying.
 *
 * @param index Position in the waypoint list.
 * @returns The number shown, from 1.
 */
export function stepNumber(index: number): number {
    return index + 1;
}
