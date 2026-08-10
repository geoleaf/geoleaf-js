/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table – Layer data and map event logic.
 */

import { Log } from "@geoleaf/host-runtime";
import { tableState, _g } from "./table-state.js";
import { TablePanel as _TablePanel } from "./panel.js";
import type {
    TableAvailableLayer,
    TableFeature,
    TableGeoJSONApi,
    TableLayerData,
    TableMapEvent,
    TableVisibilityManager,
} from "./types.js";

/** Reads the `GeoLeaf.GeoJSON` accessor surface from the global namespace. */
function _getGeoJSON(): TableGeoJSONApi | undefined {
    return _g.GeoLeaf.GeoJSON as TableGeoJSONApi | undefined;
}

/** Returns all features of a layer without row limit (for full-layer export). */
export function getAllLayerFeatures(layerId: string): TableFeature[] {
    const geojson = _getGeoJSON();
    if (!geojson || typeof geojson.getLayerData !== "function") {
        Log.warn("[Table] Module GeoJSON non disponible");
        return [];
    }
    const layerData = geojson.getLayerData(layerId);
    if (!layerData || !layerData.features) {
        Log.warn("[Table] No data for layer:", layerId);
        return [];
    }
    return layerData.features || [];
}

/** Returns a layer's features, applying the row limit. */
export function getLayerFeatures(layerId: string): TableFeature[] {
    const geojson = _getGeoJSON();
    if (!geojson || typeof geojson.getLayerData !== "function") {
        Log.warn("[Table] Module GeoJSON non disponible");
        return [];
    }
    const layerData = geojson.getLayerData(layerId);
    if (!layerData || !layerData.features) {
        Log.warn("[Table] No data for layer:", layerId);
        return [];
    }
    Log.debug("[Table] _getLayerFeatures - Nombre de features:", layerData.features.length);
    const maxRows = tableState._config?.maxRowsPerLayer || 1000;
    if (layerData.features.length > maxRows) {
        Log.warn(
            "[Table] Large dataset (" +
                layerData.features.length +
                " entities). Limited to " +
                maxRows
        );
        return layerData.features.slice(0, maxRows);
    }
    return layerData.features || [];
}

/** Returns all layers with `table.enabled = true`. */
export function getAvailableLayers(): TableAvailableLayer[] {
    const geojson = _getGeoJSON();
    if (!geojson || typeof geojson.getAllLayers !== "function") {
        return [];
    }
    const allLayers = geojson.getAllLayers();
    const availableLayers: TableAvailableLayer[] = [];
    allLayers.forEach((layer: TableLayerData) => {
        const layerData = geojson.getLayerData?.(layer.id as string);
        if (
            layerData &&
            layerData.config &&
            layerData.config.table &&
            layerData.config.table.enabled
        ) {
            availableLayers.push({
                id: layer.id as string,
                label: layer.label || (layer.id as string),
                config: layerData.config.table,
            });
        }
    });
    return availableLayers;
}

/** Returns the layers that are available AND visible on the map. */
export function getAvailableVisibleLayers(): TableAvailableLayer[] {
    const available = getAvailableLayers();
    const VisibilityManager = _g.GeoLeaf._LayerVisibilityManager as
        | TableVisibilityManager
        | undefined;
    const geojson = _getGeoJSON();
    return available.filter((layer: TableAvailableLayer) => {
        if (VisibilityManager && typeof VisibilityManager.getVisibilityState === "function") {
            const visState = VisibilityManager.getVisibilityState(layer.id);
            return visState && visState.current === true;
        }
        const layerData = geojson?.getLayerData?.(layer.id);
        return layerData && layerData._visibility && layerData._visibility.current === true;
    });
}

/**
 * Attaches the map and DOM event listeners.
 * @param refreshCallback   - Called to refresh the table data
 * @param setLayerCallback  - Called to change the active layer
 */
export function attachMapEvents(
    refreshCallback: () => void,
    setLayerCallback: (id: string) => void
): void {
    const map = tableState._map;
    if (!map) return;

    let refreshSelectorTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefreshSelector = () => {
        if (refreshSelectorTimer) clearTimeout(refreshSelectorTimer);
        refreshSelectorTimer = setTimeout(() => {
            if (_TablePanel && typeof _TablePanel.refreshLayerSelector === "function") {
                _TablePanel.refreshLayerSelector();
            }
        }, 150);
    };

    map.on("geoleaf:filters:changed", () => {
        if (tableState._isVisible && tableState._currentLayerId) {
            refreshCallback();
        }
    });

    map.on("geoleaf:geojson:layers-loaded", () => {
        Log.debug("[Table] layers-loaded event received, refreshing selector");
        debouncedRefreshSelector();
    });

    document.addEventListener("geoleaf:theme:applied", () => {
        Log.debug("[Table] theme:applied event received, refreshing selector");
        debouncedRefreshSelector();
    });

    map.on("geoleaf:geojson:visibility-changed", (e: TableMapEvent) => {
        debouncedRefreshSelector();
        if (tableState._currentLayerId === e.layerId) {
            if (e.visible) {
                refreshCallback();
            } else {
                setTimeout(() => {
                    const [firstLayer] = getAvailableVisibleLayers();
                    if (firstLayer) {
                        setLayerCallback(firstLayer.id);
                        const select = document.querySelector(
                            "[data-table-layer-select]"
                        ) as HTMLSelectElement | null;
                        if (select) select.value = firstLayer.id;
                    } else {
                        setLayerCallback("");
                    }
                }, 200);
            }
        }
    });
}
