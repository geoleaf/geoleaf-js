/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `theme-toggle` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('theme-toggle')`
 * work at runtime. Reclassified from `modules/built-in/ui/control-theme-toggle.ts` —
 * the light/dark theme toggle button (the theme engine stays kernel).
 *
 * Config gate: `modules.theme-toggle.enabled`. `enableWhenAbsent: true` governs
 * *module registration only* (the capability is profile-level, so the pre-merge boot
 * gate must register the module to allow late opt-in). The *user-facing default is
 * OFF*: the button appears only when the merged `modules.theme-toggle.enabled === true`
 * (enforced by ThemeToggleLifecycle, with `getThemeToggleConfig().enabled` defaulting
 * to `false`). Migrated from the former `ui.showThemeToggle` flag.
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the light/dark theme toggle button. */
export const THEME_TOGGLE_CAPABILITY: ICapabilityDeclaration = {
    id: "theme-toggle",
    label: "Theme toggle",
    description: "Light / dark theme toggle button on the map.",
    gate: {
        configPath: "modules.theme-toggle.enabled",
        // Registration-only (profile-level): registers the module pre-merge. The button
        // defaults OFF — visibility is gated late on the merged config (opt-in).
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: false,
            description: "Show the light/dark theme toggle button (opt-in).",
        },
        position: {
            type: "string",
            default: "topleft",
            description: "Button position on the map.",
        },
    },
    // No loader: inline (eager with the UI bundle). Gated via config.
};
