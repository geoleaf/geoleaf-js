/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Layer Manager - Store
 * Layer CRUD operations: get, query, remove, z-index
 */

import { GeoJSONShared } from "../shared.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import type { GeoJSONAdapter, GeoJSONLayerDef, GeoJSONLayerEntry } from "../core-types.js";
import type { GeoJSONFeature } from "../geojson-types.js";

const getState = () => GeoJSONShared.state;

/** Entry shape returned by `getAllLayers()`. */
interface LayerSummary {
    id: string;
    label?: string;
    visible: boolean;
    type: string;
    featureCount: number;
}

/** Data view returned by `getLayerData()` (consumed by the Themes module). */
interface LayerDataView {
    geojson: unknown;
    features: GeoJSONFeature[];
    geometryType: string;
    config: GeoJSONLayerDef;
    layer: unknown;
}

/** The store slice of the GeoJSON layer manager (assembled with sibling slices at boot). */
interface LayerManagerStoreShape {
    getLayerById(layerId: string): GeoJSONLayerEntry | null;
    getLayerData(layerId: string): LayerDataView | null;
    getAllLayers(): LayerSummary[];
    detectLayerType(layer: unknown): string;
    removeLayer(layerId: string): void;
    /** Provided by the visibility slice at runtime (merged onto the same object at boot). */
    hideLayer(layerId: string): void;
}

const LayerManager = {} as LayerManagerStoreShape;

/**
 * Retrieves a specific layer by id.
 *
 * @param {string} layerId - Layer id
 * @returns {Object|null} - { id, label, layer, visible, config, clusterGroup } or null
 */
LayerManager.getLayerById = function (layerId: string) {
    const state = getState();
    return state.layers.get(layerId) || null;
};

/**
 * Retrieves a layer's data (geojson, geometryType, config).
 * Used by the Themes module to apply styles.
 *
 * @param {string} layerId - Layer id
 * @returns {Object|null} - { geojson, geometryType, config } or null
 */
LayerManager.getLayerData = function (layerId: string) {
    const state = getState();
    const layerData = state.layers.get(layerId);
    if (!layerData) return null;

    return {
        geojson: layerData.geojson || null,
        features: layerData.features || [],
        geometryType: layerData.geometryType || "unknown",
        config: layerData.config || {},
        layer: layerData.layer,
    };
};

/**
 * Retrieves every loaded layer.
 *
 * @returns {Array<Object>} - Array of { id, label, visible, type, featureCount }
 *
 * Note: 'visible' returns the layer's LOGICAL state (enabled/disabled by the user or the theme),
 * not its physical state on the map (which the zoom may hide).
 * This is the state that must be reflected by the ON/OFF toggle button.
 */
LayerManager.getAllLayers = function () {
    const state = getState();
    const layers: LayerSummary[] = [];
    state.layers.forEach((layerData, id) => {
        // Use logicalState, which is independent of the zoom
        const meta = layerData._visibility;
        const logicalVisible =
            meta && typeof meta.logicalState === "boolean"
                ? meta.logicalState
                : layerData.visible || false;

        layers.push({
            id: id,
            label: layerData.label ?? id,
            visible: logicalVisible,
            // Perf 6.1.2: Use cached geometryType instead of O(n) detectLayerType() per call
            type: layerData.geometryType || LayerManager.detectLayerType(layerData.layer),
            // KERNEL S6: the former fallback called `layer.getLayers().length`, a Leaflet
            // `L.LayerGroup` API. MapLibre layer handles do not expose it, so this branch
            // threw a TypeError whenever `features` was empty and `layer` was set.
            featureCount: layerData.features ? layerData.features.length : 0,
        });
    });
    return layers;
};

/**
 * Fallback geometry type for a layer whose `geometryType` was not cached.
 *
 * KERNEL S6: the body used to count geometries by walking the layer with
 * `eachLayer()`, a Leaflet `L.LayerGroup` API. No MapLibre layer handle exposes it,
 * so the guard short-circuited on every call and the counting code was unreachable —
 * `"mixed"` was already the only value this function could return in production.
 * The dominant type is now resolved upstream and cached as `layerData.geometryType`
 * (see `getAllLayers`), which is the value callers actually read.
 *
 * @param _layer - Unused; kept so the call sites and the interface stay stable.
 * @returns Always `"mixed"`.
 */
LayerManager.detectLayerType = function (_layer: unknown) {
    return "mixed";
};

/**
 * Removes a layer.
 *
 * @param {string} layerId - Layer id
 */
LayerManager.removeLayer = function (layerId: string) {
    const state = getState();
    const Log = getLog();
    const layerData = state.layers.get(layerId);

    if (!layerData) {
        Log.warn("[GeoLeaf.GeoJSON] removeLayer: layer not found:", layerId);
        return;
    }

    // Remove from the map
    if (layerData.visible) {
        LayerManager.hideLayer(layerId);
    }

    // Destroy engine objects via adapter
    const adapter =
        state.adapter ||
        (
            getGeoLeaf()?.Core as { getMap?: () => GeoJSONAdapter | undefined } | undefined
        )?.getMap?.();
    if (adapter && adapter.hasLayer(layerId)) {
        adapter.removeLayer(layerId);
    }

    // Remove from the Map
    state.layers.delete(layerId);
    // featureCache removed (Sprint 1)

    Log.debug("[GeoLeaf.GeoJSON] Layer removed:", layerId);
};

export { LayerManager as LayerManagerStore };
