/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Scale capability — public API surface.
 *
 * Returns the `ScaleControl` runtime singleton augmented with capability read
 * helpers (`isEnabled` / `getConfig`). Mounted on `GeoLeaf.Scale` via
 * `geoleaf.scale.ts`.
 *
 * ⚠️ This header named the « Lite build » until 2026-08-19. **That build no longer exists** — its removal is motivated where it happened, in the bundle configuration, and the alternate mounting site these headers implied does not exist either. A build distinction that is gone does not read as stale: it reads as a live constraint, and a reader plans around it. Here it announced a PRESENCE in both — there is only one build.
 */

import { ScaleControl } from "./scale-control.js";
import { getScaleConfig, type ScaleCapabilityConfig } from "./config.js";

/** Read helpers added to the ScaleControl singleton for integrators / studio. */
export interface ScaleReadApi {
    /** Returns `true` when the scale control is enabled (`modules.scale.enabled !== false`). */
    isEnabled(): boolean;
    /** Returns the resolved `modules.scale` config (merged over the built-in defaults). */
    getConfig(): ScaleCapabilityConfig;
}

/** The object mounted on `GeoLeaf.Scale` — the runtime singleton + read helpers. */
export type ScalePublicApi = typeof ScaleControl & ScaleReadApi;

/** Builds the object mounted on `GeoLeaf.Scale`. */
export function buildPublicApi(): ScalePublicApi {
    return Object.assign(ScaleControl, {
        isEnabled: (): boolean => getScaleConfig().enabled !== false,
        getConfig: (): ScaleCapabilityConfig => getScaleConfig(),
    });
}
