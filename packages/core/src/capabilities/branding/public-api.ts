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
 * `geoleaf.branding.ts` (Full + Lite builds).
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
