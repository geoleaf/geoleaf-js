/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Geolocation capability — ESM singleton store for geolocation state.
 *
 * Relocated from `modules/built-in/ui/geolocation-state.ts` (in-core capability
 * reclassification). All reads/writes go through this module. Only two in-core
 * consumers import it directly — the control and `capabilities/filter` proximity;
 * everything else reads a snapshot via `GeoLeaf.Geolocation.getState()`, including the
 * mobile toolbar shell (deliberately, to avoid a static import of the capability) and
 * external plugins.
 */

import type { UserPositionState } from "../../contracts/ui-controls.contract.js";

/** Mutable singleton holding geolocation tracking state. */
const GeoLocationState: {
    active: boolean;
    watchId: number | null;
    userPosition: UserPositionState | null;
} = {
    /** Whether the geolocation watch is currently active */
    active: false,
    /** ID returned by navigator.geolocation.watchPosition(), or null */
    watchId: null,
    /** Last known user position, or null if geolocation has never succeeded. Its
     * `accuracy` field carries the last known accuracy in metres. */
    userPosition: null,
};

export { GeoLocationState };
