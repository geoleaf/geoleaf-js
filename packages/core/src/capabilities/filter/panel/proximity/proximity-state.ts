/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Filter Panel - Proximity State
 * Shared state of the proximity module (every module-local variable, centralised).
 */
import type { IProximityState } from "../../../../contracts/ui-controls.contract.js";

/**
 * Shared state across every proximity sub-module.
 * Replaces the former module-local variables of proximity.ts.
 */
export const ProximityState: IProximityState = {
    /** Whether proximity mode is active. */
    mode: false,
    /** Current proximity circle */
    circle: null,
    /** Current proximity marker */
    marker: null,
    /** Reference to the map */
    map: null,
    /** Manual click handler bound on the map. */
    clickHandler: null,
    /** Pre-selected radius before the marker is placed */
    pendingRadius: null,
    /** Cleanups for the registered event listeners. */
    eventCleanups: [],
};
