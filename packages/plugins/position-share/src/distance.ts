/*!
 * @geoleaf-plugins/position-share — Distance guard
 *
 * Great-circle distance, and the rule that decides whether a new fix has moved far enough to be
 * worth sending. The first fix of a session always goes out, whatever the threshold: "not
 * moving" is not the same fact as "not there".
 *
 * The core has `packages/core/src/utils/geo/haversine.ts`, and this file deliberately does NOT
 * import it: it is internal to the core, so a deep import would violate `PCB-01`. Ten lines on
 * site cost less than a frontier — and `PSF-01` is not in play either, since the canonical
 * symbol lives in the core, not in `@geoleaf/host-runtime`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Mean Earth radius in metres (IUGG). A sphere is accurate to a few tenths of a percent, which
 * is far below the accuracy of any consumer GPS fix — an ellipsoidal formula would add cost
 * without changing a single emit-or-skip decision.
 */
const EARTH_RADIUS_M = 6371008.8;

/** One point, in the shape `GeoLeaf.Geolocation.getState()` reports. */
export interface LatLng {
    lat: number;
    lng: number;
}

function toRadians(deg: number): number {
    return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two points, in metres.
 *
 * @param a - First point.
 * @param b - Second point.
 * @returns The distance in metres.
 *
 * @example
 * ```ts
 * distanceMetres({ lat: 48.85, lng: 2.35 }, { lat: 48.86, lng: 2.35 });
 * // → about 1112
 * ```
 */
export function distanceMetres(a: LatLng, b: LatLng): number {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);

    const h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Decides whether a new fix has moved far enough to be worth sending.
 *
 * `last === null` returns `true`: the FIRST fix of a session always goes out, whatever the
 * threshold. Without that, a stationary user would never appear at all — and "not moving" is
 * not the same fact as "not there".
 *
 * @param last - The previously emitted point, or `null` if none was.
 * @param next - The candidate point.
 * @param minDistanceM - Threshold in metres.
 * @returns `true` when the sample should be emitted.
 */
export function hasMovedEnough(last: LatLng | null, next: LatLng, minDistanceM: number): boolean {
    if (!last) return true;
    if (!(minDistanceM > 0)) return true;
    return distanceMetres(last, next) >= minDistanceM;
}
