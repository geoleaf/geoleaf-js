/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Theme Applier - UI Sync
 * Synchronization of the UI : selector de style, legend, fitBounds
 */
"use strict";

import { ThemeApplierCore as _TA } from "./core.js";
import type { ThemeApplierModule, ThemeBounds } from "./core.js";
import { GeoJSONShared } from "../../shared/geojson-state.js";
import { LayerVisibilityManager } from "../../shared/layer-visibility-state.js";
import { LegendContract } from "../../../capabilities/legend/legend-seam.js";
import type { LegendLayerConfig } from "../../../contracts/legend.contract.js";
import { Core } from "../../../api/geoleaf.core.js";

const TA: ThemeApplierModule = _TA;

// ── Local structural views (loose runtime collaborators) ────────────────────

/** Registered layer record (members read in this file). */
interface UISyncLayerData {
    config?: LegendLayerConfig;
    bounds?: ThemeBounds;
    layer?: unknown;
    visible?: boolean;
}

/** Minimal map surface used by the fit-bounds path. */
interface MapLike {
    getBounds(): ThemeBounds;
    fitBounds(bounds: ThemeBounds, options: { padding: { x: number; y: number } }): void;
}

/** Visibility manager subset used here. */
interface VisibilityManagerLike {
    getVisibilityState(layerId: string): { current?: boolean } | null | undefined;
}

/** Window members assigned at runtime by the loading screen. */
interface LoadingWindow {
    _glLoadingScreen?: { updateProgress?: (p: number) => void };
}

/**
 * Updates the selector de style dans l'UI
 * @param {string} layerId - Identifier de the layer
 * @param {string} styleId - Identifier du style
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
 * @param {string} layerId - ID de the layer
 * @param {string} styleId - ID du style
 * @private
 */
TA._loadLegendForStyle = function (layerId: string, styleId: string | undefined) {
    if (!LegendContract.isAvailable()) {
        return;
    }

    // Retrieve les information de the layer
    const layersMap = GeoJSONShared.state.layers;
    const layerInfo = layersMap instanceof Map ? layersMap.get(layerId) : layersMap?.[layerId];

    const layerConfig = (layerInfo as UISyncLayerData | undefined)?.config;
    if (!layerInfo || !layerConfig) {
        return;
    }

    // Utiliser la nouvelle API qui generates the legend from the style
    LegendContract.loadLayerLegend(layerId, styleId, layerConfig);
};

/**
 * Zoom sur l'emprise de toutes the layers loadedes
 * @private
 */

/**
 * Collects bounds from all registered layers (GeoJSON, POI, Route)
 * and returns a merged GeoLeafBounds or null if no valid data found.
 */
function _collectAllBounds(): ThemeBounds | null {
    let north = -90,
        south = 90,
        east = -180,
        west = 180;
    let hasData = false;

    if (GeoJSONShared.getLayers) {
        GeoJSONShared.getLayers().forEach((entry: unknown) => {
            const layerData = entry as UISyncLayerData;
            if (layerData.bounds) {
                try {
                    const b = layerData.bounds;
                    if (b.north > north) north = b.north;
                    if (b.south < south) south = b.south;
                    if (b.east > east) east = b.east;
                    if (b.west < west) west = b.west;
                    hasData = true;
                } catch (_e) {
                    /* silent */
                }
            }
        });
    }

    // Fallback: use the adapter's current bounds if layers provide no explicit bounds
    // but we know layers exist
    if (!hasData) {
        let layerCount = 0;
        if (GeoJSONShared.getLayers) {
            GeoJSONShared.getLayers().forEach((entry: unknown) => {
                const layerData = entry as UISyncLayerData;
                if (layerData.layer) layerCount++;
            });
        }
        if (layerCount > 0) {
            // Use the adapter's current viewport as a reasonable fallback
            const map = Core?.getMap() as unknown as MapLike | null | undefined;
            if (map && typeof map.getBounds === "function") {
                return map.getBounds();
            }
        }
    }

    return hasData ? { north, south, east, west } : null;
}

function _fitAndReveal(map: MapLike, bounds: ThemeBounds) {
    const mapContainer =
        document.getElementById("geoleaf-map") ||
        document.querySelector(".maplibregl-map")?.parentElement;
    if (mapContainer) {
        (mapContainer as HTMLElement).style.opacity = "1";
    }
    map.fitBounds(bounds, { padding: { x: 50, y: 50 } });
    setTimeout(() => {
        try {
            document.dispatchEvent(
                new CustomEvent("geoleaf:map:ready", { detail: { time: Date.now() } })
            );
        } catch (_e) {
            /* fallback */
        }
    }, 800);
}

TA._fitBoundsOnAllLayers = function () {
    const map = Core?.getMap() as unknown as MapLike | null | undefined;
    if (!map) {
        return;
    }

    const w = window as unknown as LoadingWindow;
    if (w._glLoadingScreen?.updateProgress) {
        w._glLoadingScreen.updateProgress(99);
    }

    const bounds = _collectAllBounds();
    if (bounds) {
        _fitAndReveal(map, bounds);
    }
};

/**
 * Synchronise l'visibility state de toutes the layers dans the legend
 * @private
 */
TA._syncLegendVisibility = function () {
    if (!LegendContract.isAvailable()) {
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
        LegendContract.setLayerVisibility(layerId, isVisible);
    });
};

export { TA as ThemeApplierUISync };
