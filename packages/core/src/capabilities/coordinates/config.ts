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
 *
 * 🛑 **An ABSENT `enabled` depends on the pointer.** The readout follows `mousemove` only: under
 * `(pointer: coarse)` it would show « Lat : --, Lng : -- » for good. So an absent key means
 * "shown on a fine pointer, not under a coarse one", while an explicit `true` shows it everywhere
 * and an explicit `false` hides it everywhere. This works because the capability's `configSchema`
 * injects no default into the running config: the RAW block still tells an absent key from `true`.
 */

import { Config } from "../../kernel/config/config-primitives.js";
import { DEFAULT_COORDINATES_DECIMALS } from "./constants.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.coordinates` capability config block. */
export interface CoordinatesCapabilityConfig {
    /**
     * Capability gate — inert when `false`. Opt-out: absent → active on a fine pointer, not under
     * `(pointer: coarse)`; `true` → active everywhere.
     */
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
 * Whether the primary pointer is coarse (a finger). `false` where `matchMedia` does not exist.
 *
 * @returns `true` under `(pointer: coarse)`.
 */
function _coarsePointer(): boolean {
    return (
        typeof globalThis.matchMedia === "function" &&
        globalThis.matchMedia("(pointer: coarse)").matches
    );
}

/**
 * Reads `modules.coordinates.*` from the running core config and merges it over the
 * built-in defaults, with `enabled` RESOLVED against the pointer.
 *
 * @returns The effective config: `enabled` is `false` under a coarse pointer unless the profile
 *   sets it to `true`, and `false` everywhere when the profile sets it to `false`.
 * @example
 * // profile without `modules.coordinates.enabled`, on a phone
 * getCoordinatesConfig().enabled; // false
 */
export function getCoordinatesConfig(): CoordinatesCapabilityConfig {
    const raw =
        _Config.get?.<Partial<CoordinatesCapabilityConfig>>("modules.coordinates", {}) ?? {};
    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : !_coarsePointer();
    return { ...DEFAULTS, ...raw, enabled };
}
