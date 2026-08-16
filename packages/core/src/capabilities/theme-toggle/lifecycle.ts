/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-toggle capability — lifecycle / mount wiring.
 *
 * Mounts the light/dark toggle button when enabled. `registry.init()` runs AFTER
 * `loadActiveProfileResources`, so `getThemeToggleConfig()` sees the merged config
 * here — the late gate (`enabled === true`, default OFF) decides visibility
 * synchronously at `ThemeToggleModule.init()`, no `app:ready` deferral needed.
 */

import { initThemeToggleControl, _destroyThemeToggleControl } from "./theme-toggle.js";
import { getThemeToggleConfig } from "./config.js";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";

let _started = false;

/** Idempotent mount for the theme-toggle capability. Safe to call multiple times. */
export const ThemeToggleLifecycle = {
    init(map: IMapAdapter): void {
        if (_started) return;
        _started = true;
        const cfg = getThemeToggleConfig();
        // User-facing default OFF — opt-in on the merged config.
        if (cfg.enabled !== true) return;
        initThemeToggleControl(map, cfg.position);
    },

    /** Removes the button and detaches listeners (module destroy / test seam). */
    _reset(): void {
        _destroyThemeToggleControl();
        _started = false;
    },
};
