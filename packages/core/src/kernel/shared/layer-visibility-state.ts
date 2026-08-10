/*!
 * GeoLeaf Core – Shared / Layer Visibility State
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description ESM singleton store for LayerVisibilityManager — Phase 10-B Pattern D
 *
 * Re-exports VisibilityManager from geojson/visibility-manager.js under the
 * canonical name LayerVisibilityManager — ESM singleton, no runtime namespace lookup.
 *
 * The module is part of the main bundle (globals.geojson.js Block B5), so a
 * static import has no bundle-size impact.
 *
 * Available API:
 *   LayerVisibilityManager.setLayerVisibility(layerId, visible)
 *   LayerVisibilityManager.isLayerVisible(layerId)          → boolean
 *   LayerVisibilityManager.getHiddenLayers()                → Set<layerId>
 *
 * @example
 * import { LayerVisibilityManager } from './layer-visibility-state.js';
 * LayerVisibilityManager.setLayerVisibility(layerId, false);
 */
export { VisibilityManager as LayerVisibilityManager } from "../geojson/visibility-manager.js";
