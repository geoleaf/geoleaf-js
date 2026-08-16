/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-toggle capability — public API surface.
 *
 * Exposes capability read helpers (`isEnabled` / `getConfig`) on
 * `GeoLeaf.ThemeToggle`. The button itself is managed by the lifecycle (there is no
 * imperative public control — the toggle is fire-and-forget, driven by config).
 */

import { getThemeToggleConfig, type ThemeToggleCapabilityConfig } from "./config.js";

/** The object mounted on `GeoLeaf.ThemeToggle`. */
export interface ThemeTogglePublicApi {
    /** Returns `true` when the toggle button is enabled (`modules.theme-toggle.enabled === true`). */
    isEnabled(): boolean;
    /** Returns the resolved `modules.theme-toggle` config (merged over the built-in defaults). */
    getConfig(): ThemeToggleCapabilityConfig;
}

/** Builds the object mounted on `GeoLeaf.ThemeToggle`. */
export function buildPublicApi(): ThemeTogglePublicApi {
    return {
        isEnabled: (): boolean => getThemeToggleConfig().enabled === true,
        getConfig: (): ThemeToggleCapabilityConfig => getThemeToggleConfig(),
    };
}
