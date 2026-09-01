/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the kernel UI primitives consumed by capabilities.
 *
 * Mediated entry point for the `capabilities/ → kernel/` boundary (backlog R.8).
 *
 * ⚠️ **Deliberately narrow.** `kernel/ui/` is the largest kernel sub-tree, and most of
 * it is internal (desktop panel, mobile toolbar, layer manager rendering). This barrel
 * exposes only what capabilities legitimately reuse — shared component builders and the
 * theme surface. Widening it is a decision, not a formality.
 *
 * ⚠️ `desktop/desktop-tabs-seam.ts` is NOT re-exported: a seam is already a mediated
 * boundary, and it is consumed as a type only.
 */

export { _UIComponents } from "./components.js";
export { createPillSearchInput } from "./pill-search.js";
export { _UITheme } from "./theme.js";

// `collapsible-toggle.ts` comes from `utils/controls/` (it reads the core's i18n
// and builds `gl-*` DOM, it is not publishable outside GeoLeaf). Its sole consumer
// is `capabilities/legend/legend-control.ts`, and the boundary rule forbids it to
// dive there directly. Widening the barrel is the gesture the rule DESIGNATES, not
// a workaround — and this is where it is motivated: an accordion is a shared
// component, exactly the category this barrel claims.
export { createCollapsibleToggle, applyToggleCollapsed } from "./collapsible-toggle.js";
