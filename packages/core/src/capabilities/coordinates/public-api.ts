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
 * `geoleaf.coordinates.ts`.
 *
 * ⚠️ This header named the « Lite build » until 2026-08-19. **That build no longer exists** — its removal is motivated where it happened, in the bundle configuration, and the alternate mounting site these headers implied does not exist either. A build distinction that is gone does not read as stale: it reads as a live constraint, and a reader plans around it. Here it announced a PRESENCE in both — there is only one build.
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
