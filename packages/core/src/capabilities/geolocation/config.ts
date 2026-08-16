/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Geolocation capability — config reader.
 *
 * Reads `modules.geolocation.*` from the core Config singleton and merges it over
 * the built-in defaults. Migrated from the former profile-level `ui.showGeolocation`
 * flag. Opt-out (`enableWhenAbsent: true`): the button is active unless a profile
 * sets `modules.geolocation.enabled: false`.
 */

import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.geolocation` capability config block. */
export interface GeolocationCapabilityConfig {
    /** Capability gate — inert when `false`. Opt-out (absent → active). */
    enabled: boolean;
    /** Control position on the map. */
    position: string;
}

/** Built-in defaults. `enabled` is `true` — geolocation is opt-out. */
const DEFAULTS: GeolocationCapabilityConfig = { enabled: true, position: "topleft" };

/**
 * Reads `modules.geolocation.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getGeolocationConfig(): GeolocationCapabilityConfig {
    const raw =
        _Config.get?.<Partial<GeolocationCapabilityConfig>>("modules.geolocation", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
