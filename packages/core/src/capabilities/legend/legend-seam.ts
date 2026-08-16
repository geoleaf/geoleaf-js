/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Legend contract — runtime membrane over the in-core Legend capability.
 *
 * Guarded accessor to the `Legend` capability. Callers check `isAvailable()`
 * before forwarding, so they never depend on the Legend init lifecycle
 * (map + profile) nor touch the global namespace. Kept out of `contracts/`
 * (which is a pure type surface); the structural `LegendLayerConfig` type still
 * lives in `contracts/legend.contract.ts`.
 *
 * Usage:
 *   import { LegendContract } from "../../capabilities/legend/legend-seam.js";
 *
 *   if (LegendContract.isAvailable()) {
 *       LegendContract.loadLayerLegend(layerId, styleId, layerConfig);
 *   }
 *
 * The `Legend` facade (geoleaf.legend.js) depends on the init runtime; this
 * contract encapsulates the initialization guard and provides a typed entry
 * point without exposing the global namespace.
 */

import { Legend as _Legend } from "../../api/geoleaf.legend.js";
import type { LegendLayerConfig } from "../../contracts/legend.contract.js";

/**
 * Minimal membrane view of the Legend facade methods used by this contract.
 *
 * `visible` is typed `boolean | undefined` (wider than the underlying
 * `Legend.setLayerVisibility(visible: boolean)`) so that callers forwarding an
 * optional visibility flag compile without any value coercion at this boundary.
 */
interface LegendModuleLike {
    loadLayerLegend?(
        layerId: string | undefined,
        styleId: string | undefined,
        layerConfig: LegendLayerConfig
    ): void;
    setLayerVisibility?(layerId: string, visible: boolean | undefined): void;
}

const Legend = _Legend as LegendModuleLike;

/**
 * Interface contract for the Legend module.
 * @namespace LegendContract
 */
const LegendContract = {
    /**
     * Returns true when Legend is initialized (map loaded).
     * @returns {boolean}
     */
    isAvailable() {
        return !!Legend && typeof Legend.loadLayerLegend === "function";
    },

    /**
     * Loads and displays the legend for a layer with given styles.
     *
     * `layerId` / `styleId` are typed `string | undefined` (wider than the
     * underlying facade) so callers forwarding optional ids compile without any
     * value coercion at this boundary; the facade no-ops on an unknown id.
     * @param {string | undefined} layerId
     * @param {string | undefined} styleId
     * @param {LegendLayerConfig} layerConfig
     */
    loadLayerLegend(
        layerId: string | undefined,
        styleId: string | undefined,
        layerConfig: LegendLayerConfig
    ) {
        if (typeof Legend.loadLayerLegend === "function") {
            Legend.loadLayerLegend(layerId, styleId, layerConfig);
        }
    },

    /**
     * Updates the visibility of a layer in the legend.
     * @param {string} layerId
     * @param {boolean | undefined} visible
     */
    setLayerVisibility(layerId: string, visible: boolean | undefined) {
        if (typeof Legend.setLayerVisibility === "function") {
            Legend.setLayerVisibility(layerId, visible);
        }
    },
};

export { LegendContract };
