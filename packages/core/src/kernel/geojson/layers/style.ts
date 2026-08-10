/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Layer Manager - Style
 * Style application via MapLibre adapter.
 */
"use strict";

import { GeoJSONShared } from "../shared.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import type { GeoJSONAdapter, GeoJSONCurrentStyle } from "../core-types.js";

const getState = () => GeoJSONShared.state;

/** Vector tiles module surface used to forward style updates for VT layers. */
interface VectorTilesLike {
    updateLayerStyle(layerId: string, styleConfig: GeoJSONCurrentStyle): void;
}

/** Adapter surface exposing the layer-style setter. */
interface StyleAdapterLike {
    setLayerStyle(layerId: string, styleConfig: GeoJSONCurrentStyle): void;
}

/** Public surface assembled onto `_GeoJSONLayerManager` by this slice. */
interface LayerManagerStyleShape {
    setLayerStyle(layerId: string, styleConfig: GeoJSONCurrentStyle): boolean;
}

const LayerManager = {} as LayerManagerStyleShape;

/**
 * Applies a style to an existing layer.
 * Used by the Themes module to dynamically change appearance.
 *
 * @param {string} layerId - Layer ID
 * @param {Object} styleConfig - Style configuration { style, styleRules }
 * @returns {boolean} - true if the style was applied successfully
 */
LayerManager.setLayerStyle = function (layerId: string, styleConfig: GeoJSONCurrentStyle) {
    const state = getState();
    const Log = getLog();
    const layerData = state.layers.get(layerId);

    if (!layerData) {
        Log.warn("[GeoLeaf.GeoJSON] setLayerStyle: layer not found:", layerId);
        return false;
    }

    // VT layers — delegate to VectorTiles module
    const GeoLeaf = getGeoLeaf();
    const VectorTiles = GeoLeaf?._VectorTiles as VectorTilesLike | undefined;
    if (layerData.isVectorTile && VectorTiles) {
        VectorTiles.updateLayerStyle(layerId, styleConfig);
        return true;
    }

    // Delegate to adapter
    const coreModule = GeoLeaf?.Core as { getMap?: () => GeoJSONAdapter | undefined } | undefined;
    const adapter = (state.adapter || coreModule?.getMap?.()) as StyleAdapterLike | undefined;
    if (adapter && typeof adapter.setLayerStyle === "function") {
        adapter.setLayerStyle(layerId, styleConfig);
        layerData.currentStyle = styleConfig;
        Log.debug("[GeoLeaf.GeoJSON] Style applied:", layerId);
        return true;
    }
    return false;
};

export { LayerManager as LayerManagerStyle };
