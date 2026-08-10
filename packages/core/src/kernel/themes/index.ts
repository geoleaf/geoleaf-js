/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the theme engine.
 *
 * Mediated entry point for the `capabilities/ → kernel/` boundary (backlog R.8).
 *
 * The split is the one ARCHI S8 F2 decided (Design B): the **engine** stays kernel
 * (`theme-loader`, `theme-applier/*`, the `geoleaf:theme:applied` event), the **selector
 * UI** is a capability (`capabilities/theme-selector/`). This barrel is the seam between
 * the two — and the reason it re-exports types alongside values: `theme-loader.ts` is a
 * regular module, not a `*-types.ts` hub, so its types have no other mediated route.
 */

export type { NormalizedTheme, ValidatedThemesConfig } from "./theme-loader.js";
export type { ThemeConfig } from "./theme-applier/core.js";

export { ThemeLoader } from "./theme-loader.js";
export { ThemeApplierCore } from "./theme-applier/core.js";
