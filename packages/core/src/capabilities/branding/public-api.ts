/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Branding capability — public API surface.
 *
 * Returns the `Branding` runtime control augmented with capability read helpers
 * (`isEnabled` / `getConfig`). Mounted on `GeoLeaf.Branding` via
 * `geoleaf.branding.ts`.
 *
 * ⚠️ This header named the « Lite build » until 2026-08-19. **That build no longer exists** — its removal is motivated where it happened, in the bundle configuration, and the alternate mounting site these headers implied does not exist either. A build distinction that is gone does not read as stale: it reads as a live constraint, and a reader plans around it. Here it announced a PRESENCE in both — there is only one build.
 */

import { Branding } from "./branding.js";
import { getBrandingConfig, type BrandingCapabilityConfig } from "./config.js";
import type { BrandingControl } from "./types.js";

/** Read helpers added to the Branding control for integrators / no-code studio. */
export interface BrandingReadApi {
    /** Returns `true` when the branding overlay is enabled (`modules.branding.enabled === true`). */
    isEnabled(): boolean;
    /** Returns the resolved `modules.branding` config (merged over the built-in defaults). */
    getConfig(): BrandingCapabilityConfig;
}

/** The object mounted on `GeoLeaf.Branding` — the runtime control + read helpers. */
export type BrandingPublicApi = BrandingControl & BrandingReadApi;

/** Builds the object mounted on `GeoLeaf.Branding`. */
export function buildPublicApi(): BrandingPublicApi {
    return Object.assign(Branding, {
        isEnabled: (): boolean => getBrandingConfig().enabled === true,
        getConfig: (): BrandingCapabilityConfig => getBrandingConfig(),
    });
}
