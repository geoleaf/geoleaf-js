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
 * ⚠️ **SIDE-EFFECT module**: grafts 4 members onto `ThemeApplierCore` at import;
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
    if (!LegendContract.isAvailable()) {
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
    LegendContract.loadLayerLegend(layerId, styleId, layerConfig);
};

/**
 * Zooms to the extent of all loaded layers
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
        mapContainer.style.opacity = "1";
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
 * Synchronises the visibility state of all layers in the legend
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
