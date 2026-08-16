/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LayerManager — Visibility Checker
 * Validates the visibility state logical d'a layer.
 *
 * Extrait de layer-manager/renderer.ts (split Sprint 1 roadmap).
 */

import { Log } from "../../utils/log/index.js";
import { GeoJSONCore } from "../geojson/core.js";

/**
 * Checks whether a layer is visible.
 * Reads logicalState (the button's ON/OFF state) rather than current (physical state on the map).
 * The button must reflect the user/theme intent, not zoom constraints.
 */
function checkLayerVisibility(layerId: string): boolean {
    try {
        if (layerId && GeoJSONCore) {
            const layerData = GeoJSONCore.getLayerById(layerId);

            const logicalState =
                layerData &&
                layerData._visibility &&
                typeof layerData._visibility.logicalState === "boolean"
                    ? layerData._visibility.logicalState
                    : !!(layerData && layerData.visible === true);

            const result = logicalState;

            if (Log) {
                Log.debug(
                    `[LayerManager Renderer] _checkLayerVisibility(${layerId}): logicalState=${logicalState}`
                );
            }

            return result;
        }
    } catch (e) {
        if (Log) Log.error("[LayerManager Renderer] Error in _checkLayerVisibility:", e);
    }
    return false;
}

export { checkLayerVisibility };
