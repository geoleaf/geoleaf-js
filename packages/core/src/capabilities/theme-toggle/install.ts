/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `theme-toggle` capability — presets build (S2).
 * Single self-sufficient anchor (declaration + facade globals + module factory).
 * Profile-level; button defaults OFF (opt-in), gated late by the lifecycle.
 * NB: the theme engine itself (`_UITheme`, `ui.applyTheme`) stays kernel.
 */

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { THEME_TOGGLE_CAPABILITY } from "./theme-toggle-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { ThemeToggleModule } from "./module.js";
import { ThemeToggle } from "../../api/geoleaf.theme-toggle.js";

/** Self-sufficient installer for the light/dark theme-toggle button capability. */
export const THEME_TOGGLE_INSTALLER: CapabilityInstaller = {
    declaration: THEME_TOGGLE_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B9).
        gl.ThemeToggle = ThemeToggle;
    },

    createModule() {
        return new ThemeToggleModule();
    },
};
