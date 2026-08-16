/*!
 * GeoLeaf Core - Theme toggle (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.ThemeToggle` facade — light/dark theme toggle button. In-core
 * capability (reclassified from `modules/built-in/ui/control-theme-toggle.ts`).
 * Mounted by `globals.ui.ts` / `globals.ui-lite.ts`.
 *
 * Opt-in: the button appears only when `modules.theme-toggle.enabled` is `true`.
 * Migrated from the former `ui.showThemeToggle` flag. The theme engine (`_UITheme`)
 * stays kernel.
 */
import { buildPublicApi } from "../capabilities/theme-toggle/public-api.js";

/** The object mounted on `GeoLeaf.ThemeToggle`. */
export const ThemeToggle = buildPublicApi();
