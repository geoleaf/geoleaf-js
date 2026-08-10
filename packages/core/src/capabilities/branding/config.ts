/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Branding capability — config reader.
 *
 * Reads `modules.branding.*` from the core Config singleton (typed import — the
 * in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and merges
 * it over the built-in defaults.
 *
 * Migrated from the former app-global root `branding` key. Opt-in
 * (`enableWhenAbsent: false`): the overlay is inert unless a profile sets
 * `modules.branding.enabled: true`. The former "branding key missing" nag box
 * (shown when the key was entirely absent) is dropped — an unconfigured branding
 * simply renders nothing.
 */
"use strict";

import { Config } from "../../kernel/config/config-primitives.js";
import { brandingConfigDefaults } from "./constants.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.branding` capability config block. */
export interface BrandingCapabilityConfig {
    /**
     * Capability gate — the overlay is inert when `false`. Opt-in
     * (`enableWhenAbsent: false`): absent → disabled.
     */
    enabled: boolean;
    /** Text displayed in the branding overlay. */
    text?: string;
    /** Overlay position on the map (e.g. `"bottomleft"`). */
    position?: string;
}

/**
 * Reads `modules.branding.*` from the running core config and merges it over the
 * built-in defaults (`brandingConfigDefaults()`, the same source
 * `BRANDING_CAPABILITY.configSchema` advertises and `Branding._options` seeds — B.24;
 * `position` used to be advertised by the schema and applied by the control, but was
 * absent here, so this reader returned a config the schema did not describe).
 */
export function getBrandingConfig(): BrandingCapabilityConfig {
    const raw = _Config.get?.<Partial<BrandingCapabilityConfig>>("modules.branding", {}) ?? {};
    return { ...brandingConfigDefaults(), ...raw };
}
