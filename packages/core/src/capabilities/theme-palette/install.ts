/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `theme-palette` capability.
 */

// ── Stylesheets ─────────────────────────────────────────────────────────────
// The button/popover CSS *and* the palette blocks enter the module graph from HERE.
// That is what makes them tree-shakeable: an entry that omits this installer ships
// neither the code nor the two palettes. It also replaces the demo layer's injected
// <link>, which sat outside the graph and outside the @layer cascade.
import "./css/theme-palette.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { THEME_PALETTE_CAPABILITY } from "./theme-palette-capability.js";
import { ThemePaletteModule } from "./module.js";
import { ThemePalette } from "../../api/geoleaf.theme-palette.js";

/** Self-sufficient installer for the accent-palette capability. */
export const THEME_PALETTE_INSTALLER: CapabilityInstaller = {
    declaration: THEME_PALETTE_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        gl.ThemePalette = ThemePalette;
    },

    createModule() {
        return new ThemePaletteModule();
    },
};
