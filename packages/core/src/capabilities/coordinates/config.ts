/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Coordinates capability — config reader.
 *
 * Reads `modules.coordinates.*` from the core Config singleton and merges it over
 * the built-in defaults. Migrated from the former profile-level `ui.showCoordinates`
 * flag. Opt-out (`enableWhenAbsent: true`): active unless a profile sets
 * `modules.coordinates.enabled: false`.
 */
"use strict";

import { Config } from "../../kernel/config/config-primitives.js";
import { DEFAULT_COORDINATES_DECIMALS } from "./constants.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.coordinates` capability config block. */
export interface CoordinatesCapabilityConfig {
    /** Capability gate — inert when `false`. Opt-out (absent → active). */
    enabled: boolean;
    /** Control position on the map (standalone fallback). */
    position: string;
    /** Number of decimals shown for lat/lng. */
    decimals: number;
}

/** Built-in defaults (mirror the pre-migration hardcoded values). */
const DEFAULTS: CoordinatesCapabilityConfig = {
    enabled: true,
    position: "bottomleft",
    decimals: DEFAULT_COORDINATES_DECIMALS,
};

/**
 * Reads `modules.coordinates.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getCoordinatesConfig(): CoordinatesCapabilityConfig {
    const raw =
        _Config.get?.<Partial<CoordinatesCapabilityConfig>>("modules.coordinates", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
