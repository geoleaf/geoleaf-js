/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * @description Facade public of the LayerManager module.
 * Exposes {@link LayerManager} for building and managing the layer control panel:
 * section creation, item toggling, basemap selector integration, and
 * theme selector coordination.
 *
 * @see `kernel/layer-manager/layer-manager-api.ts` for the full implementation
 *
 * @example
 * ```ts
 * GeoLeaf.LayerManager.init({ map, config: profileConfig });
 * // ⚠️ Cet exemple appelait `toggleLayer(...)`, qui **n'a jamais existé** sur cette façade
 * // (corrigé le 27/07/2026, défaut trouvé par `typecheck-docs-examples`). La surface
 * // publique est `init()` et `refresh()` ; la visibilité d'une couche se pilote par
 * // `GeoLeaf.Legend.setLayerVisibility(...)` ou l'événement `geoleaf:layer:toggle`.
 * GeoLeaf.LayerManager.refresh();
 * ```
 */
"use strict";

export { LayerManager } from "../kernel/layer-manager/layer-manager-api.js";
