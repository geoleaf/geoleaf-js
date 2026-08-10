/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Great-circle distance between two {lat, lng} points using the Haversine formula.
 *
 * @version 2.0.0
 */

/**
 * Earth radius in **metres** (WGS-84 mean) — the single source of truth for every
 * spherical-earth computation that works in metres.
 *
 * Exported since CAPACITÉS S10 because `filter/panel/proximity/proximity-circle.ts` held
 * its own `6371008.8` (the IUGG mean radius). The drawn proximity circle and the predicate
 * that decides which features fall inside it were therefore built on two different earths.
 * The gap is tiny — 1,4 ppm, about 1,4 cm on a 10 km radius — but it is two sources of
 * truth for one physical constant, which is the failure mode the S10 guards target.
 *
 * ⚠️ `general-utils.getDistance` keeps its own `R = 6371` **kilometres**. That is a
 * deliberate, documented divergence (it is published as `GeoLeaf.Utils.getDistance`) — see
 * the warning on that function. Do not unify it here: the units differ, not just the value.
 */
export const EARTH_RADIUS_M = 6_371_000;

/** Local alias — keeps the formula below readable. */
const R = EARTH_RADIUS_M;

/**
 * Returns the great-circle distance in **metres** between two points.
 *
 * @param a - First point `{ lat, lng }` in decimal degrees.
 * @param b - Second point `{ lat, lng }` in decimal degrees.
 */
export function haversineDistance(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
): number {
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
        sinLat * sinLat +
        Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
    return 2 * R * Math.asin(Math.sqrt(h));
}
