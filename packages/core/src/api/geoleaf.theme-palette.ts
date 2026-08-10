/*!
 * GeoLeaf Core - ThemePalette (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.ThemePalette` facade — accent-colour palette (orange / green / blue).
 * In-core capability.
 *
 * ⚠️ Distinct from `ThemeToggle` (light/dark) and `ThemeSelector` (MAP themes): the
 * three axes are orthogonal and cumulative.
 *
 * The selector button is opt-in (`modules.theme-palette.enabled`), but the configured
 * `default` palette applies either way.
 */
"use strict";
import {
    buildPublicApi,
    type ThemePalettePublicApi,
} from "../capabilities/theme-palette/public-api.js";

/** The object mounted on `GeoLeaf.ThemePalette`. */
export const ThemePalette: ThemePalettePublicApi = buildPublicApi();
