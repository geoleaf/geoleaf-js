/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-toggle capability — config reader.
 *
 * Reads `modules.theme-toggle.*` from the core Config singleton and merges it over
 * the built-in defaults. Migrated from the former profile-level `ui.showThemeToggle`
 * flag. Opt-in — the button is inert unless a profile sets
 * `modules.theme-toggle.enabled: true` (real default OFF, enforced by the lifecycle's
 * late gate on the merged config).
 */
"use strict";

import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.theme-toggle` capability config block. */
export interface ThemeToggleCapabilityConfig {
    /** Capability gate — the button is inert unless `true`. Opt-in (default OFF). */
    enabled: boolean;
    /** Button position on the map. */
    position: string;
}

/** Built-in defaults. `enabled` is `false` — the toggle is opt-in. */
const DEFAULTS: ThemeToggleCapabilityConfig = { enabled: false, position: "topleft" };

/**
 * Reads `modules.theme-toggle.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getThemeToggleConfig(): ThemeToggleCapabilityConfig {
    const raw =
        _Config.get?.<Partial<ThemeToggleCapabilityConfig>>("modules.theme-toggle", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
