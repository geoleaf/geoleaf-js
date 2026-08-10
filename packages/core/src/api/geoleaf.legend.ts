/*!
 * GeoLeaf Core - Legend (facade public)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

"use strict";
/**
 *
 * Public `GeoLeaf.Legend` facade — manages the cartographic legend panel.
 *
 * The Legend is an **in-core capability** (`capabilities/legend/`), shipped
 * inline in both the Full and Lite bundles (no lazy loader). It is gated by
 * `modules.legend.enabled` (opt-out) and mounted on `geoleaf:app:ready` by
 * `LegendLifecycle`. It generates legend entries automatically from the active
 * profile's layer styles (style JSON files). Sections, symbols, collapse/expand
 * behaviour and layer visibility are all synchronised automatically with the
 * active layers.
 *
 * @example — Basic initialisation (after `geoleaf:app:ready`)
 * ```ts
 * document.addEventListener("geoleaf:app:ready", () => {
 *   const map = GeoLeaf.Core.getMap();
 *   GeoLeaf.Legend.init(map, { position: "bottomleft", collapsed: false });
 * });
 * ```
 *
 * @example — Manual layer legend load
 * ```ts
 * GeoLeaf.Legend.loadLayerLegend("restaurants", "default", layerConfig);
 * ```
 *
 * @example — Toggle visibility from an external layer switch
 * ```ts
 * // ⚠️ `addEventListener` type le paramètre en `Event`, qui ne porte pas `detail` :
 * // il faut le déclarer `CustomEvent` pour que l'exemple compile chez l'intégrateur
 * // (corrigé le 27/07/2026, défaut trouvé par `typecheck-docs-examples`).
 * document.addEventListener("geoleaf:layer:toggle", (e: Event) => {
 *   const { layerId, visible } = (e as CustomEvent).detail;
 *   GeoLeaf.Legend.setLayerVisibility(layerId, visible);
 * });
 * ```
 *
 * @example — Check whether the legend panel is visible
 * ```ts
 * if (GeoLeaf.Legend.isLegendVisible()) {
 *   console.log("Legend is active with", GeoLeaf.Legend.getAllLayers().size, "layers");
 * }
 * ```
 *
 * ---
 * ## Public API summary
 *
 * | Method | Description |
 * |---|---|
 * | `init(map, options?)` | Initialise the legend — must be called first |
 * | `loadLayerLegend(layerId, styleId, layerConfig)` | Load legend data for a specific layer |
 * | `setLayerVisibility(layerId, visible)` | Show / hide a layer entry in the legend |
 * | `getAllLayers()` | Return the internal layer registry (`Map<string, LayerInfo>`) |
 * | `hideLegend()` | Hide the legend panel without removing it |
 * | `removeLegend()` | Remove all legend data and destroy the panel |
 * | `isLegendVisible()` | Returns `true` if the panel is mounted and has entries |
 * | `showLoadingOverlay()` | Display a loading spinner over the legend panel |
 * | `hideLoadingOverlay()` | Hide the loading spinner |
 * | `toggleAccordion(layerId)` | Toggle accordion state (managed visually by the renderer) |
 *
 * @see {@link Legend}
 * @see {@link ../capabilities/legend/public-api.ts} — the capability facade
 * @see {@link ../capabilities/legend/legend.ts} — the runtime it re-exports
 */
export { Legend } from "../capabilities/legend/public-api.js";
