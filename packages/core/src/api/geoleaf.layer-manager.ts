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
 * // ⚠️ This example used to call `toggleLayer(...)`, which **never existed** on this facade
 * // (fixed on 27/07/2026, defect found by `typecheck-docs-examples`). The public surface
 * // is `init()` and `refresh()`; layer visibility is driven through
 * // `GeoLeaf.Legend.setLayerVisibility(...)` or the `geoleaf:layer:toggle` event.
 * GeoLeaf.LayerManager.refresh();
 * ```
 */

export { LayerManager } from "../kernel/layer-manager/layer-manager-api.js";
