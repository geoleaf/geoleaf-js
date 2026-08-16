/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Coordinates capability — public API surface.
 *
 * Returns the `CoordinatesDisplay` runtime control augmented with capability read
 * helpers (`isEnabled` / `getConfig`). Mounted on `GeoLeaf.Coordinates` via
 * `geoleaf.coordinates.ts` (Full + Lite builds).
 */

import { CoordinatesDisplay } from "./coordinates.js";
import { getCoordinatesConfig, type CoordinatesCapabilityConfig } from "./config.js";
import type { CoordinatesControl } from "./types.js";

/** Read helpers added to the CoordinatesDisplay control for integrators / studio. */
export interface CoordinatesReadApi {
    /** Returns `true` when the readout is enabled (`modules.coordinates.enabled !== false`). */
    isEnabled(): boolean;
    /** Returns the resolved `modules.coordinates` config (merged over the built-in defaults). */
    getConfig(): CoordinatesCapabilityConfig;
}

/** The object mounted on `GeoLeaf.Coordinates` — the runtime control + read helpers. */
export type CoordinatesPublicApi = CoordinatesControl & CoordinatesReadApi;

/** Builds the object mounted on `GeoLeaf.Coordinates`. */
export function buildPublicApi(): CoordinatesPublicApi {
    return Object.assign(CoordinatesDisplay, {
        isEnabled: (): boolean => getCoordinatesConfig().enabled !== false,
        getConfig: (): CoordinatesCapabilityConfig => getCoordinatesConfig(),
    });
}
