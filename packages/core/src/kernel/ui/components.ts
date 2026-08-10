/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Components - Common shared module
 * Reusable UI components for Legend and LayerManager
 *
 * Extracted common code shared by:
 * - legend-renderer.js
 * - layer-manager/renderer.js
 *
 * Since KERNEL S8 this file is an aggregate only — the implementation lives in
 * ui/legend-symbols.ts (symbol rendering) and ui/widgets.ts (accordion + toggle).
 * It keeps its name and its single exported object on purpose: `_UIComponents`
 * is mounted on the global namespace (globals.ui.ts), frozen by two boot contract
 * tests, read by plugin-print through `gl._UIComponents`, and referenced by path
 * in 11 test files (7 of them via `vi.mock`). Splitting the export surface would
 * break all four.
 *
 * DEPENDENCIES:
 * - ui/legend-symbols.js
 * - ui/widgets.js
 *
 * EXPOSE:
 * - _UIComponents
 */

import { _LegendSymbols } from "./legend-symbols.js";
import { _UIWidgets } from "./widgets.js";

/**
 * Module UI Components
 * @namespace _UIComponents
 * @private
 */
const _UIComponents = {
    ..._LegendSymbols,
    ..._UIWidgets,
};

// ── ESM Export ──
export { _UIComponents };
