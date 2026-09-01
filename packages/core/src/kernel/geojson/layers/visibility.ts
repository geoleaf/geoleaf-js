/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Layer Manager - Visibility
 * Show/hide/toggle layers, zoom-based visibility
 */

import { GeoJSONShared } from "../shared.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import { calculateMapScale, isScaleInRange } from "../../../utils/general/scale-utils.js";
import type { GeoJSONLayerEntry } from "../core-types.js";

const getState = () => GeoJSONShared.state;
const ScaleUtils = { calculateMapScale, isScaleInRange };

/** Per-layer visibility bookkeeping (`layerData._visibility`). */
type VisibilityMeta = GeoJSONLayerEntry["_visibility"];

/** Source enum + setters exposed by the centralized `_LayerVisibilityManager`. */
interface VisibilityManagerLike {
    VisibilitySource: { USER: string; ZOOM: string; [key: string]: string };
    setVisibility(layerId: string, visible: boolean, source: string): boolean;
    getVisibilityState(layerId: string): {
        current?: boolean;
        /** User intent (button ON/OFF) — unaffected by zoom. Drive toggles from this. */
        logicalState?: boolean;
    } | null;
}

/** Labels module surface used by the visibility slice. */
interface LabelsLike {
    hasLabelConfig(layerId: string): boolean;
    enableLabels(layerId: string, options: Record<string, unknown>, immediate?: boolean): void;
    areLabelsEnabled(layerId: string): boolean;
    refreshLabels(layerId: string): void;
    disableLabels(layerId: string): void;
}

/** Label-button sync module surface. */
interface LabelButtonManagerLike {
    syncImmediate(layerId: string): void;
}

function _normalizeScaleValue(value: unknown): number | null {
    if (typeof value !== "number") return null;
    return value <= 0 ? null : value;
}

function _resolveBaseVisibility(meta: VisibilityMeta | undefined): boolean {
    if (meta && meta.userOverride) return !!meta.logicalState;
    if (meta && meta.themeOverride) return !!meta.themeDesired;
    return true;
}

/** Public surface assembled onto `_GeoJSONLayerManager` by this slice. */
interface LayerManagerVisibilityShape {
    showLayer(layerId: string): void;
    hideLayer(layerId: string): void;
    toggleLayer(layerId: string): void;
    updateLayerVisibilityByZoom(): void;
    /** Provided by the integration slice at runtime (merged at boot). */
    _loadLayerLegend?(layerId: string, layerData: GeoJSONLayerEntry): void;
}

const LayerManager = {} as LayerManagerVisibilityShape;

/**
 * Shows a layer.
 *
 * @param {string} layerId - Layer id
 */

LayerManager.showLayer = function (layerId: string) {
    const state = getState();
    const Log = getLog();
    const layerData = state.layers.get(layerId);

    if (!layerData) {
        Log.warn("[GeoLeaf.GeoJSON] showLayer: layer not found:", layerId);
        return;
    }

    // Go through the centralized visibility manager
    const GeoLeaf = getGeoLeaf();
    const VisibilityManager = GeoLeaf?._LayerVisibilityManager as VisibilityManagerLike | undefined;
    if (!VisibilityManager) {
        Log.error("[GeoLeaf.GeoJSON] LayerVisibilityManager not available");
        return;
    }

    const changed = VisibilityManager.setVisibility(
        layerId,
        true,
        VisibilityManager.VisibilitySource.USER
    );

    // IMPORTANT: recompute the physical visibility against the current zoom
    // setVisibility updates logicalState (the button), but `current` must be recomputed too
    LayerManager.updateLayerVisibilityByZoom();

    // Load the legend if available (only if change was made)
    if (changed) {
        // _loadLayerLegend is defined in integration.ts, on a separate LayerManager object.
        // After Object.assign in globals.geojson.ts, the method exists on _GeoJSONLayerManager.
        // Resolved via the global rather than the local object to avoid "is not a function".
        const _unifiedMgr = GeoLeaf?._GeoJSONLayerManager as
            | { _loadLayerLegend?: (layerId: string, layerData: GeoJSONLayerEntry) => void }
            | undefined;
        if (_unifiedMgr && typeof _unifiedMgr._loadLayerLegend === "function") {
            _unifiedMgr._loadLayerLegend(layerId, layerData);
        }

        // Handle labels at activation time
        const Labels = GeoLeaf?.Labels as LabelsLike | undefined;
        if (Labels && Labels.hasLabelConfig(layerId)) {
            // Check whether visibleByDefault is true for those labels
            const visibleByDefault =
                (layerData.currentStyle?.label as { visibleByDefault?: boolean } | undefined)
                    ?.visibleByDefault === true;

            if (visibleByDefault) {
                // Enable and show the labels straight away
                Labels.enableLabels(layerId, {}, true);
            } else if (Labels.areLabelsEnabled(layerId)) {
                // Otherwise just refresh, if already enabled
                Labels.refreshLabels(layerId);
            }
        }
        const LabelButtonManager = GeoLeaf?._LabelButtonManager as
            LabelButtonManagerLike | undefined;
        if (LabelButtonManager) {
            LabelButtonManager.syncImmediate(layerId);
        }

        Log.debug("[GeoLeaf.GeoJSON] Layer shown:", layerId);
    }
};

/**
 * Hides a layer.
 *
 * @param {string} layerId - Layer id
 */
LayerManager.hideLayer = function (layerId: string) {
    const state = getState();
    const Log = getLog();
    const layerData = state.layers.get(layerId);

    if (!layerData) {
        Log.warn("[GeoLeaf.GeoJSON] hideLayer: layer not found:", layerId);
        return;
    }

    // Go through the centralized visibility manager
    const GeoLeaf = getGeoLeaf();
    const VisibilityManager = GeoLeaf?._LayerVisibilityManager as VisibilityManagerLike | undefined;
    if (!VisibilityManager) {
        Log.error("[GeoLeaf.GeoJSON] LayerVisibilityManager not available");
        return;
    }

    const changed = VisibilityManager.setVisibility(
        layerId,
        false,
        VisibilityManager.VisibilitySource.USER
    );

    // IMPORTANT: recompute the physical visibility (even on hide, to ensure consistency)
    LayerManager.updateLayerVisibilityByZoom();

    if (changed) {
        // Hide the labels and update the button
        const Labels = GeoLeaf?.Labels as LabelsLike | undefined;
        if (Labels) {
            Labels.disableLabels(layerId);
        }
        const LabelButtonManager = GeoLeaf?._LabelButtonManager as
            LabelButtonManagerLike | undefined;
        if (LabelButtonManager) {
            LabelButtonManager.syncImmediate(layerId);
        }

        Log.debug("[GeoLeaf.GeoJSON] Layer hidden:", layerId);
    }
};

/**
 * Toggles a layer's visibility.
 *
 * @param {string} layerId - Layer id
 */
LayerManager.toggleLayer = function (layerId: string) {
    const state = getState();
    const Log = getLog();
    const layerData = state.layers.get(layerId);

    if (!layerData) {
        Log.warn("[GeoLeaf.GeoJSON] toggleLayer: layer not found:", layerId);
        return;
    }

    // Read the current state through the visibility manager
    const VisibilityManager = getGeoLeaf()?._LayerVisibilityManager as
        VisibilityManagerLike | undefined;
    if (!VisibilityManager) {
        Log.error("[GeoLeaf.GeoJSON] LayerVisibilityManager not available");
        return;
    }

    // Read the LOGICAL state, not the physical one. `current` is what is on screen, and
    // the zoom can force it to `false`; `logicalState` is the ON/OFF the button shows and
    // the zoom never touches it. Reading `current` here meant that on a layer logically
    // ON but hidden by zoom, a click called `showLayer()` — so the button would not switch
    // it off (backlog B.19). Same fallback as `store.getAllLayers()`, which feeds the
    // button, so the two cannot disagree.
    const visState = VisibilityManager.getVisibilityState(layerId);
    const currentlyVisible =
        visState && typeof visState.logicalState === "boolean"
            ? visState.logicalState
            : layerData.visible;

    // Toggle
    if (currentlyVisible) {
        LayerManager.hideLayer(layerId);
    } else {
        LayerManager.showLayer(layerId);
    }
};

/**
 * Updates layer visibility according to the active style's zoomConfig.
 * Honours user preferences (manual or theme-driven deactivation).
 * Goes through the centralized visibility manager with source 'zoom'.
 * Immediate execution for reactivity during zoom (LayerManager.refresh debounce avoids UI jitter).
 */
LayerManager.updateLayerVisibilityByZoom = function () {
    const state = getState();
    const Log = getLog();
    if (!state.map) return;

    const VisibilityManager = getGeoLeaf()?._LayerVisibilityManager as
        VisibilityManagerLike | undefined;
    if (!VisibilityManager) {
        Log.error("[GeoLeaf.GeoJSON] LayerVisibilityManager unavailable");
        return;
    }

    const currentScale =
        ScaleUtils && typeof ScaleUtils.calculateMapScale === "function"
            ? ScaleUtils.calculateMapScale(state.map as Parameters<typeof calculateMapScale>[0], {
                  logger: Log,
              })
            : 0;

    state.layers.forEach((layerData: GeoJSONLayerEntry, layerId: string) => {
        const config = layerData.config;
        if (!config) return;

        // `scaleConfig` bounds are SCALE DENOMINATORS (1:X), not MapLibre zoom levels.
        // The key is named `minScale`/`maxScale` for that reason: the former
        // `zoomConfig.minZoom` name claimed otherwise and profile authors wrote zoom
        // levels into it, which `isScaleInRange` then read as denominators — hiding
        // those layers at every zoom. Absent `scaleConfig` = no constraint.
        const styleScale = layerData.currentStyle?.scaleConfig ?? null;

        const minScale = _normalizeScaleValue(styleScale && styleScale.minScale);
        const maxScale = _normalizeScaleValue(styleScale && styleScale.maxScale);

        const shouldBeVisibleByScale =
            ScaleUtils && typeof ScaleUtils.isScaleInRange === "function"
                ? ScaleUtils.isScaleInRange(currentScale, minScale, maxScale, Log)
                : true;

        const baseVisible = _resolveBaseVisibility(layerData._visibility);

        // The scale window is now binding: ticking a layer no longer overrides it. The old
        // `userForcedVisible` bypass existed to dodge a race — this function re-hid, on the
        // next line, what `showLayer` had just shown — and that race is gone: since S5/N-1b
        // the engine owns the rendering (`minzoom`/`maxzoom` per sub-layer) and this pass
        // only reports. Keeping the bypass would now LIE: it would light the legend up for
        // a layer MapLibre keeps hidden, which is exactly what masked N-1 for ~3 months
        // (ticked layer visible at every zoom, no threshold honoured).
        const shouldBeVisible = baseVisible && shouldBeVisibleByScale;

        VisibilityManager.setVisibility(
            layerId,
            shouldBeVisible,
            VisibilityManager.VisibilitySource.ZOOM
        );
    });
};

// ─── Zoom event binding ──────────────────────────────────────────────────────
// The engine renders the scale window (`minzoom`/`maxzoom`, S5/N-1b); this pass keeps the
// REPORTED state in step with it — legend, labels and `geoleaf:layer:toggle`. It stays on
// `zoomend` because that is all the UI needs; the rendering itself is already continuous.
if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:map:zoom", () => {
        LayerManager.updateLayerVisibilityByZoom();
    });
}

export { LayerManager as LayerManagerVisibility };
