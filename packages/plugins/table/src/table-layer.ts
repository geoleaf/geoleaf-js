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
import { tLabel as getLabel } from "@geoleaf/host-runtime";
import { tableState, _g } from "./table-state.js";
import { TablePanel as _TablePanel } from "./panel.js";
import type {
    TableAvailableLayer,
    TableFeature,
    TableGeoJSONApi,
    TableLayerData,
    TableMapEvent,
    TableLayersApi,
} from "./types.js";

/**
 * Row cap applied when the profile declares none.
 *
 * 30 000 is the scale this repository gates and measures — the dose of the performance
 * baseline's scale bench, and of the end-to-end proof that the table selects across a whole
 * layer. A higher default would promise an order of magnitude nothing here measures: past
 * this point the cost is no longer the render, which is windowed, but the O(N) search scan.
 */
const DEFAULT_MAX_ROWS = 30000;

/**
 * Layers already warned about, for this session.
 *
 * ⚠️ Per layer AND per page session, the shape `truncation-notice.ts` settled on at task
 * 2.4: the table refreshes on map events, and a warning that fires on every refresh teaches
 * the user to dismiss it without reading — a slower way of being silent. A reload re-arms
 * it, because a reload is also when the integrator may have raised the cap. There is
 * deliberately no reset hook: one would have no caller, and an exported function nothing
 * calls is indistinguishable from a forgotten one.
 */
const _capNotified = new Set<string>();

/**
 * Tells the user their layer was cut short — the channel the cut never had.
 *
 * 🛑 Until this change the only witness was a `Log.warn`. A table reduced to its first rows
 * looks exactly like a complete one, so an operator read a whole-looking parc that was a
 * subset. The message names BOTH numbers because both are known here: the kept count and
 * the total it RECEIVED — not the collection's, which this module does not know and does not
 * invent: that was the lesson of 2.4, where a message almost announced "10 000 out of 10 999"
 * for a layer of 31 337.
 */
function _noticeCap(layerId: string, total: number, kept: number): void {
    if (_capNotified.has(layerId)) return;
    _capNotified.add(layerId);
    const message = getLabel("ui.table.capped")
        .replace("{kept}", String(kept))
        .replace("{total}", String(total));
    _g.GeoLeaf?.notify?.(message, "warning");
}

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
    const maxRows = tableState._config?.maxRowsPerLayer ?? DEFAULT_MAX_ROWS;
    const total = layerData.features.length;
    if (total > maxRows) {
        Log.warn("[Table] Large dataset (" + total + " entities). Limited to " + maxRows);
        _noticeCap(layerId, total, maxRows);
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
    const Layers = _g.GeoLeaf.Layers as TableLayersApi | undefined;
    const geojson = _getGeoJSON();
    return available.filter((layer: TableAvailableLayer) => {
        if (Layers && typeof Layers.isVisible === "function") return Layers.isVisible(layer.id);
        const layerData = geojson?.getLayerData?.(layer.id);
        return layerData && layerData._visibility && layerData._visibility.current === true;
    });
}

/**
 * Attaches the map and DOM event listeners.
 *
 * @param refreshCallback   - Called to refresh the table data
 * @param setLayerCallback  - Called to change the active layer
 * @returns Removes every listener attached here and cancels the pending refreshes — what the
 *   teardown of the application calls. Without it the listeners stayed on `document` and on the
 *   map that went away, and refreshed a panel that no longer existed. A no-op without a map.
 */
export function attachMapEvents(
    refreshCallback: () => void,
    setLayerCallback: (id: string) => void
): () => void {
    const map = tableState._map;
    if (!map) return () => undefined;

    /** Set by the returned function: a timer already armed must not act on a torn-down table. */
    let detached = false;
    let refreshSelectorTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefreshSelector = () => {
        if (refreshSelectorTimer) clearTimeout(refreshSelectorTimer);
        refreshSelectorTimer = setTimeout(() => {
            if (_TablePanel && typeof _TablePanel.refreshLayerSelector === "function") {
                _TablePanel.refreshLayerSelector();
            }
        }, 150);
    };

    // 🛑 THIS SUBSCRIPTION WAS DEAD TWICE OVER, and the file carried the proof
    // three lines away. It read `map.on("geoleaf:filters:changed", …)`:
    //
    //   ① the NAME is emitted by nothing — the real one is
    //     `geoleaf:filters:applied` (`core/capabilities/filter/apply.ts`,
    //     `filter/public-api.ts`);
    //   ② the BUS is the wrong one — `filters:applied` leaves through
    //     `dispatchGeoLeafEvent()`, hence on `document`. The MapLibre bus only
    //     carries THREE events, all emitted by `kernel/geojson/` via
    //     `map.fire()`. **Fixing the name alone would have left the
    //     subscription just as dead**, on a channel where nobody speaks.
    //
    // Consequence for the user: the table **never** refreshed when applying a
    // filter. Not a comfort issue — the displayed rows contradicted the map.
    //
    // ⚠️ The two neighbouring lines show both correct patterns: `map.on()` for
    // `layers-loaded` (really `fire()`d on the map bus) and
    // `document.addEventListener()` for `theme:applied`. The defect was not
    // ignorance of the model, it was a copied name.
    const onFiltersApplied = (): void => {
        if (tableState._isVisible && tableState._currentLayerId) {
            refreshCallback();
        }
    };
    document.addEventListener("geoleaf:filters:applied", onFiltersApplied);

    // 🛑 The layer's STORE changed — a creation, an edit, a deletion, a restore. The open table
    // kept its rows until the next filter or visibility change, and they contradicted the map
    // exactly as they did while the subscription above was dead. Only the layer on display
    // refreshes, and a burst (a restore, a merge) refreshes once.
    let refreshRowsTimer: ReturnType<typeof setTimeout> | null = null;
    const onLayerUpdated = (e: Event): void => {
        const layerId = (e as CustomEvent<{ layerId?: string }>).detail?.layerId;
        if (!tableState._isVisible || !layerId || tableState._currentLayerId !== layerId) return;
        if (refreshRowsTimer) clearTimeout(refreshRowsTimer);
        refreshRowsTimer = setTimeout(refreshCallback, 150);
    };
    document.addEventListener("geoleaf:layer:updated", onLayerUpdated);

    const onLayersLoaded = (): void => {
        Log.debug("[Table] layers-loaded event received, refreshing selector");
        debouncedRefreshSelector();
    };
    map.on("geoleaf:geojson:layers-loaded", onLayersLoaded);

    const onThemeApplied = (): void => {
        Log.debug("[Table] theme:applied event received, refreshing selector");
        debouncedRefreshSelector();
    };
    document.addEventListener("geoleaf:theme:applied", onThemeApplied);

    const onVisibilityChanged = (e: TableMapEvent): void => {
        debouncedRefreshSelector();
        if (tableState._currentLayerId === e.layerId) {
            if (e.visible) {
                refreshCallback();
            } else {
                setTimeout(() => {
                    if (detached) return;
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
    };
    map.on("geoleaf:geojson:visibility-changed", onVisibilityChanged);

    return () => {
        detached = true;
        if (refreshSelectorTimer) clearTimeout(refreshSelectorTimer);
        if (refreshRowsTimer) clearTimeout(refreshRowsTimer);
        refreshSelectorTimer = null;
        refreshRowsTimer = null;
        document.removeEventListener("geoleaf:filters:applied", onFiltersApplied);
        document.removeEventListener("geoleaf:layer:updated", onLayerUpdated);
        document.removeEventListener("geoleaf:theme:applied", onThemeApplied);
        map.off?.("geoleaf:geojson:layers-loaded", onLayersLoaded);
        map.off?.("geoleaf:geojson:visibility-changed", onVisibilityChanged);
    };
}
