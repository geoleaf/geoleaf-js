/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter capability — proximity radius unit conversions.
 *
 * The proximity radius crosses three representations: the UI slider and the permalink
 * carry **kilometres**, while the filter engine, `haversine()` and `ProximityState.circle`
 * all carry **metres**. The conversion sat inline as a bare `* 1000` / `/ 1000` on seven
 * call sites across five files, with the direction legible only from the surrounding names.
 *
 * That is not a hypothetical risk here: a kilometre-returning distance function once got
 * preferred over the metre-returning one, and the proximity radius silently shifted by a
 * factor of 1000 depending on module load order (KERNEL S11 — see the warning on
 * `engine/filter-helpers.ts`). Naming the direction is what makes a wrong conversion
 * visible at the call site instead of at the far end of a filtered-to-nothing list.
 */
"use strict";

/**
 * Metres in one kilometre.
 *
 * Deliberately module-private: the two directional helpers below are the whole intended
 * surface, and exporting the bare number would re-open the inline `* 1000` this module
 * exists to close.
 */
const METRES_PER_KM = 1000;

/**
 * Converts a radius from kilometres to metres — UI/permalink → engine direction.
 *
 * @param km - Radius in kilometres.
 * @returns The same radius in metres.
 */
export function kmToMetres(km: number): number {
    return km * METRES_PER_KM;
}

/**
 * Converts a radius from metres to kilometres — engine → UI/permalink direction.
 *
 * @param metres - Radius in metres.
 * @returns The same radius in kilometres.
 */
export function metresToKm(metres: number): number {
    return metres / METRES_PER_KM;
}
