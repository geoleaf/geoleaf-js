/*!
 * @geoleaf-plugins/routing — Distance between a stop and its route
 *
 * Tells whether the engine attached a stop to a road far from where it was placed.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Waypoint } from "./model.js";

/**
 * ## Why an engine's success is checked here
 *
 * An engine attaches each stop to the nearest road it can find, and answers a success whatever
 * that distance is: measured on the local Valhalla, a stop placed at sea rendered a 34 km route
 * and no signal of any kind. The waypoints of its response are the ones it was sent, so they
 * cannot tell either. Only the geometry shows where the route really goes.
 *
 * ⚠️ Compared against the vertices, not the segments: engines place a vertex where they attach a
 * stop, on both shapes this package reads, so the nearest vertex IS the attachment point.
 */

/** Beyond this distance, a stop is worth telling the user about. METRES. */
const FAR_FROM_ROAD_METRES = 500;

/** Metres per degree of latitude. */
const METRES_PER_DEGREE = 111_320;

/**
 * Whether a stop lies far from the route computed for it.
 *
 * @param stops The stops as the user placed them.
 * @param line The decoded route geometry, `[longitude, latitude]`.
 * @returns `true` when at least one stop is further than the threshold from the whole line.
 */
export function hasStopFarFromRoad(
    stops: readonly Waypoint[],
    line: readonly (readonly [number, number])[]
): boolean {
    if (line.length === 0) return false;
    return stops.some((stop) => {
        const [lon, lat] = stop.coordinates;
        const scale = Math.cos((lat * Math.PI) / 180);
        const nearest = line.reduce((best, [x, y]) => {
            const dx = (x - lon) * scale;
            const dy = y - lat;
            return Math.min(best, dx * dx + dy * dy);
        }, Infinity);
        return Math.sqrt(nearest) * METRES_PER_DEGREE > FAR_FROM_ROAD_METRES;
    });
}
