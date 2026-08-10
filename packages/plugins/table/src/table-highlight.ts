/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table – Highlight and geometry utilities.
 */

import { Log } from "@geoleaf/host-runtime";
import { tableState, fireEvent, getSelectedFeatures } from "./table-state.js";
import type { TableBounds, TableFeature, TableGeometry, TableMap } from "./types.js";

/** Removes all highlight layers from the map. */
export function clearHighlightLayers(): void {
    tableState._highlightLayers.forEach((layerId: string) => {
        try {
            if (tableState._map && typeof tableState._map.removeLayer === "function") {
                tableState._map.removeLayer(layerId);
            }
        } catch (_e) {
            // Silent
        }
    });
    tableState._highlightLayers = [];
}

/** Extends map bounds from a GeoJSON geometry. */
export function extendBoundsFromGeometry(bounds: TableBounds, geometry: TableGeometry): void {
    // One guarded reader for all six branches. A GeoJSON position is [lng, lat, alt?]; a
    // shorter one is malformed, and extending the bounds with `undefined` would poison them
    // for every later feature (qualite Q5).
    const extend = (c: number[]): void => {
        const [lng, lat] = c;
        if (lng === undefined || lat === undefined) return;
        bounds.extend([lat, lng]);
    };
    const type = geometry.type;
    if (type === "Point") {
        extend(geometry.coordinates as number[]);
    } else if (type === "LineString" || type === "MultiPoint") {
        (geometry.coordinates as number[][]).forEach(extend);
    } else if (type === "MultiLineString") {
        (geometry.coordinates as number[][][]).forEach((line) => line.forEach(extend));
    } else if (type === "Polygon") {
        (geometry.coordinates as number[][][])[0]?.forEach(extend);
    } else if (type === "MultiPolygon") {
        (geometry.coordinates as number[][][][]).forEach((poly) => poly[0]?.forEach(extend));
    }
}

/** Counter for unique highlight layer IDs. */
let _highlightCounter = 0;

/** Shared style for every highlight overlay (identical across features). */
const _HIGHLIGHT_STYLE = {
    color: "#FFD600",
    weight: 4,
    opacity: 1,
    fillOpacity: 0.15,
    fillColor: "#FFD600",
    interactive: false,
};

/**
 * Draws a single highlight overlay covering every selected feature that has a
 * geometry, in one addGeoJSONLayer call. Features without geometry are dropped
 * before the call, so one invalid feature can no longer bring down the whole
 * overlay. Stores the layer ID in tableState._highlightLayers for later cleanup.
 */
function _addHighlightOverlay(features: TableFeature[]): void {
    const drawable = features.filter((f) => f.geometry);
    if (drawable.length === 0) return;
    try {
        const layerId = `__gl_table_highlight_${++_highlightCounter}`;
        const fc = { type: "FeatureCollection", features: drawable };
        // Caller (highlightSelection) guarantees _map + addGeoJSONLayer are present;
        // a missing handle still throws here (caught below) as before.
        const map = tableState._map as TableMap;
        (map.addGeoJSONLayer as NonNullable<TableMap["addGeoJSONLayer"]>)(
            layerId,
            fc,
            _HIGHLIGHT_STYLE
        );
        tableState._highlightLayers.push(layerId);
    } catch (e) {
        Log.warn("[Table] Highlight overlay error:", e);
    }
}

/** Activates or deactivates highlight of selected entities on the map. */
export function highlightSelection(active: boolean): void {
    clearHighlightLayers();
    tableState._highlightActive = active;

    if (!active) {
        Log.debug("[Table] Highlight disabled");
        fireEvent("table:highlightSelection", {
            layerId: tableState._currentLayerId,
            selectedIds: Array.from(tableState._selectedIds),
            active: false,
        });
        return;
    }

    if (tableState._selectedIds.size === 0) {
        Log.warn("[Table] No entity selected for highlighting");
        return;
    }

    const selectedFeatures = getSelectedFeatures();
    if (selectedFeatures.length === 0) {
        Log.warn("[Table] No feature found for highlighting");
        return;
    }

    if (!tableState._map || typeof tableState._map.addGeoJSONLayer !== "function") {
        Log.warn("[Table] Map adapter unavailable for highlightSelection");
        return;
    }

    _addHighlightOverlay(selectedFeatures);

    fireEvent("table:highlightSelection", {
        layerId: tableState._currentLayerId,
        selectedIds: Array.from(tableState._selectedIds),
        active: true,
    });

    Log.debug("[Table] Highlight enabled for", selectedFeatures.length, "entities");
}
