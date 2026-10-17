/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Theme Applier - UI Sync
 * Synchronization of the UI : style selector, legend
 */

/**
 * @sideEffectGraft packages/core/src/globals/globals.ui.ts
 *
 * ✅ ASSUMED as a module-level state, decided 24-25/08/2026 — not a side effect awaiting
 * conversion. Converting the graft to plain exports would force the anchor to know every
 * member it re-exports, for nothing measurable: the graft is declared (this mark), anchored
 * (the bare import the mark names), and guarded (the graft gate reddens if either
 * disappears). What would REOPEN the decision is a second writer grafting onto the same
 * base — not a re-reading of this file.
 *
 * ⚠️ **SIDE-EFFECT module**: grafts its members onto `ThemeApplierCore` at import;
 * `core.ts` CALLS them without defining them. It exports nothing that is consumed, so
 * no dead-code instrument can see it live — ESLint, `check-orphan-exports` and a
 * human read all declared it dead **in concert, and all three were wrong**. A
 * side-effect module has no consumer, by definition.
 *
 * **Its only anchor is a BARE import in `globals.ui.ts`.** Removing it drops
 * this file from the graph **silently**: the test suite stays green, and the
 * symptom is a production `TypeError`. It happened (July 2026, caught within the
 * hour). `GRAFT-03` now guards that the anchor still imports it.
 */
import { ThemeApplierCore as _TA } from "./core.js";
import type { ThemeApplierModule } from "./core.js";
import { GeoJSONShared } from "../../shared/geojson-state.js";
import { LayerVisibilityManager } from "../../shared/layer-visibility-state.js";
import { availableLegend } from "../../shared/legend-slot.js";
import type { LegendLayerConfig } from "../../../contracts/legend.contract.js";

const TA: ThemeApplierModule = _TA;

// ── Local structural views (loose runtime collaborators) ────────────────────

/** Registered layer record (members read in this file). */
interface UISyncLayerData {
    config?: LegendLayerConfig;
    visible?: boolean;
}

/** Visibility manager subset used here. */
interface VisibilityManagerLike {
    getVisibilityState(layerId: string): { current?: boolean } | null | undefined;
}

/**
 * Updates the style selector in the UI
 * @param {string} layerId - Layer identifier
 * @param {string} styleId - Style identifier
 * @private
 */
TA._updateStyleSelector = function (layerId: string, styleId: string | undefined) {
    const selectId = "style-selector-" + layerId;
    const select = document.getElementById(selectId);

    if (select) {
        (select as HTMLSelectElement).value = styleId as string;
    }
};

/**
 * Loads the legend correspondant au style applied
 * @param {string} layerId - Layer ID
 * @param {string} styleId - Style ID
 * @private
 */
TA._loadLegendForStyle = function (layerId: string, styleId: string | undefined) {
    const legend = availableLegend();
    if (!legend) {
        return;
    }

    // Retrieve the layer's information
    const layersMap = GeoJSONShared.state.layers;
    const layerInfo = layersMap instanceof Map ? layersMap.get(layerId) : layersMap?.[layerId];

    const layerConfig = (layerInfo as UISyncLayerData | undefined)?.config;
    if (!layerInfo || !layerConfig) {
        return;
    }

    // Use the new API that generates the legend from the style
    legend.loadLayerLegend(layerId, styleId, layerConfig);
};

/**
 * Synchronises the visibility state of all layers in the legend
 * @private
 */
TA._syncLegendVisibility = function () {
    const legend = availableLegend();
    if (!legend) {
        return;
    }

    if (!GeoJSONShared.getLayers) {
        return;
    }

    const VisibilityManager = LayerVisibilityManager as unknown as VisibilityManagerLike;
    if (!VisibilityManager) {
        return;
    }

    // Parcourir toutes the layers et synchronize leur state
    GeoJSONShared.getLayers().forEach((entry: unknown, layerId: string) => {
        const layerData = entry as UISyncLayerData;
        const visState = VisibilityManager.getVisibilityState(layerId);
        const isVisible = visState ? visState.current : layerData.visible;
        legend.setLayerVisibility(layerId, isVisible);
    });
};

export { TA as ThemeApplierUISync };
