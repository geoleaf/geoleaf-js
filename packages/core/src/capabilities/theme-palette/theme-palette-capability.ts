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
 * ## No `gate` — deliberately
 *
 * The capability has two halves and only the second is opt-in: it always applies the
 * configured `default` palette — the majority production case, an integrator fixing a brand
 * colour and offering no choice — and mounts the selector button only on
 * `modules.theme-palette.enabled: true` (read by the lifecycle). A declaration gate on that
 * same key turned `enabled: false` into « do not register the module »: the first half never
 * ran, and the interface stayed orange. Embarked, the capability is always active; `enabled`
 * governs the button alone.
 */

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the UI accent palette. */
export const THEME_PALETTE_CAPABILITY: ICapabilityDeclaration = {
    id: "theme-palette",
    label: "Theme palette",
    description: "Accent-colour palette selector (orange / green / blue).",
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
    // No loader: inline (eager with the UI bundle). No gate: see the header.
};
