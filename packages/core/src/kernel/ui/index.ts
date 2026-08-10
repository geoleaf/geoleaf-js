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

// STRUCT S8 — `collapsible-toggle.ts` arrive de `utils/controls/` (E2 : il lit l'i18n du
// core et construit du DOM `gl-*`, il n'est pas publiable hors GeoLeaf). Son unique
// consommateur est `capabilities/legend/legend-control.ts`, et la règle R.8 lui interdit
// d'y plonger directement. Élargir le baril est le geste que la règle DÉSIGNE, pas un
// contournement — et c'est ici qu'il se motive : un accordéon est un composant partagé,
// exactement la catégorie que ce baril revendique.
export { createCollapsibleToggle, applyToggleCollapsed } from "./collapsible-toggle.js";
