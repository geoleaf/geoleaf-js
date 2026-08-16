/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `theme-palette` capability.
 *
 * ⚠️ Three neighbours carry the word "theme" and are ORTHOGONAL:
 *   - `theme-palette` (this one) — the ACCENT COLOUR (`data-gl-palette` on `<html>`);
 *   - `theme-toggle` — light / dark mode (`gl-theme-*` class on `<body>`);
 *   - `theme-selector` — MAP themes (layer/style sets from `themes.json`).
 *
 * Config gate: `modules.theme-palette.enabled`, `enableWhenAbsent: true` for module
 * registration only; the user-facing default is OFF (late gate in the lifecycle).
 * NOTE: the configured `default` palette applies even when the SELECTOR is disabled —
 * that is the majority production case (integrator fixes a brand colour, offers no
 * choice).
 */

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the UI accent palette. */
export const THEME_PALETTE_CAPABILITY: ICapabilityDeclaration = {
    id: "theme-palette",
    label: "Theme palette",
    description: "Accent-colour palette selector (orange / green / blue).",
    gate: {
        configPath: "modules.theme-palette.enabled",
        // Registration-only: the module must register so the configured `default`
        // palette is applied even when the selector itself stays hidden.
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: false,
            description: "Show the palette selector button (opt-in).",
        },
        default: {
            type: "string",
            default: "default",
            description:
                "Palette applied when the user has no stored choice. Also the fixed palette when `enabled` is false.",
        },
        palettes: {
            type: "array",
            default: [],
            description:
                "Offered palettes ({ id, label, swatch }). Empty/absent uses the three built-ins.",
        },
    },
    // No loader: inline (eager with the UI bundle). Gated via config.
};
