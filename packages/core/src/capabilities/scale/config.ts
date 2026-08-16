/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Scale capability — config reader.
 *
 * Reads `modules.scale.*` from the core Config singleton and merges it over the
 * built-in defaults. Migrated from the former profile-level `ui.showScale` flag +
 * `scaleConfig` block. Opt-out (`enableWhenAbsent: true`): active unless a profile
 * sets `modules.scale.enabled: false`. The built-in defaults reproduce the uniform
 * `scaleConfig` of the real profiles (all scale types on, position bottomleft), so
 * the readout renders by default without any profile config.
 */

import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.scale` capability config block. */
export interface ScaleCapabilityConfig {
    /** Capability gate — inert when `false`. Opt-out (absent → active). */
    enabled: boolean;
    /** Show the graphical scale bar. */
    scaleGraphic: boolean;
    /** Show the numeric scale (1:N). */
    scaleNumeric: boolean;
    /** Make the numeric scale editable. */
    scaleNumericEditable: boolean;
    /** Show the zoom level indicator ("Niveau"). */
    scaleNivel: boolean;
    /** Control position on the map. */
    position: string;
}

/** Built-in defaults (mirror the uniform `scaleConfig` of the real profiles). */
const DEFAULTS: ScaleCapabilityConfig = {
    enabled: true,
    scaleGraphic: true,
    scaleNumeric: true,
    scaleNumericEditable: true,
    scaleNivel: true,
    position: "bottomleft",
};

/**
 * Reads `modules.scale.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getScaleConfig(): ScaleCapabilityConfig {
    const raw = _Config.get?.<Partial<ScaleCapabilityConfig>>("modules.scale", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
