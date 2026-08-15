/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table – Selection and export logic.
 */

import { Log } from "@geoleaf/host-runtime";
import { tableState, fireEvent, getSelectedFeatures } from "./table-state.js";
import { downloadFeatures, type ExportFormat, type ExportOptions } from "./export.js";
import { getAllLayerFeatures } from "./table-layer.js";
import { TableRenderer as _TableRenderer } from "./renderer.js";
import type { TableConfig, TableFeature, TableGeometry } from "./types.js";

/** Returns the IDs of the selected entities. */
export function getSelectedIds(): string[] {
    return Array.from(tableState._selectedIds);
}

/**
 * Selects or deselects entities.
 * @param ids - IDs to select
 * @param add - Add to the existing selection (true) or replace it (false)
 */
export function setSelection(ids: unknown[], add = false): void {
    if (!add) {
        tableState._selectedIds.clear();
    }
    ids.forEach((id: unknown) => tableState._selectedIds.add(String(id)));
    fireEvent("geoleaf:table:selectionChanged", {
        layerId: tableState._currentLayerId,
        selectedIds: Array.from(tableState._selectedIds),
    });
    if (_TableRenderer && typeof _TableRenderer.updateSelection === "function") {
        _TableRenderer.updateSelection(tableState._container, tableState._selectedIds);
    }
    Log.debug("[Table] Selection updated:", tableState._selectedIds.size, "entities");
}

/** Clears the entire selection. */
export function clearSelection(): void {
    tableState._selectedIds.clear();
    fireEvent("geoleaf:table:selectionChanged", {
        layerId: tableState._currentLayerId,
        selectedIds: [],
    });
    if (_TableRenderer && typeof _TableRenderer.updateSelection === "function") {
        _TableRenderer.updateSelection(tableState._container, tableState._selectedIds);
    }
    Log.debug("[Table] Selection cleared");
}

/** Zoom on selected entities via the adapter. */
export function zoomToSelection(): void {
    if (tableState._selectedIds.size === 0) {
        Log.warn("[Table] No entity selected for zoom");
        return;
    }
    const selectedFeatures = getSelectedFeatures();
    if (selectedFeatures.length === 0) {
        Log.warn("[Table] No feature found for selected IDs");
        return;
    }
    // Compute GeoLeafBounds from feature geometries
    let north = -90,
        south = 90,
        east = -180,
        west = 180;
    let hasCoords = false;
    selectedFeatures.forEach((feature: TableFeature) => {
        if (feature.geometry && feature.geometry.coordinates) {
            _extendBoundsBox(feature.geometry, (lng: number, lat: number) => {
                if (lat > north) north = lat;
                if (lat < south) south = lat;
                if (lng > east) east = lng;
                if (lng < west) west = lng;
                hasCoords = true;
            });
        }
    });
    if (hasCoords && north >= south && east >= west) {
        const map = tableState._map;
        if (map && typeof map.fitBounds === "function") {
            map.fitBounds({ north, south, east, west }, { padding: { x: 50, y: 50 } });
        }
        fireEvent("geoleaf:table:zoomToSelection", {
            layerId: tableState._currentLayerId,
            selectedIds: Array.from(tableState._selectedIds),
        });
        Log.debug("[Table] Zoom on selection (", selectedFeatures.length, "entities)");
    } else {
        Log.warn("[Table] Invalid bounds for selection");
    }
}

/** Walks geometry coordinates and calls `cb(lng, lat)` for each point. */
function _extendBoundsBox(geometry: TableGeometry, cb: (lng: number, lat: number) => void): void {
    // Same guarded position reader as `extendBoundsFromGeometry` (qualite Q5).
    const emit = (c: number[]): void => {
        const [lng, lat] = c;
        if (lng !== undefined && lat !== undefined) cb(lng, lat);
    };
    const type = geometry.type;
    if (type === "Point") {
        emit(geometry.coordinates as number[]);
    } else if (type === "LineString" || type === "MultiPoint") {
        (geometry.coordinates as number[][]).forEach(emit);
    } else if (type === "MultiLineString" || type === "Polygon") {
        (geometry.coordinates as number[][][]).forEach((ring) => ring.forEach(emit));
    } else if (type === "MultiPolygon") {
        (geometry.coordinates as number[][][][]).forEach((poly) =>
            poly.forEach((ring) => ring.forEach(emit))
        );
    }
}

function _resolveOptions(options?: ExportOptions): ExportOptions {
    const cfg: TableConfig = tableState._config ?? {};
    const csvSeparator = options?.csvSeparator ?? cfg.csvSeparator;
    const csvIncludeGeometry = options?.csvIncludeGeometry ?? cfg.csvIncludeGeometry;
    return {
        ...(csvSeparator !== undefined && { csvSeparator }),
        ...(csvIncludeGeometry !== undefined && { csvIncludeGeometry }),
    };
}

/** Exports selected entities in the given format (default: geojson). */
export function exportSelection(format: ExportFormat = "geojson", options?: ExportOptions): void {
    if (tableState._selectedIds.size === 0) {
        Log.warn("[Table] No entity selected for export");
        return;
    }
    const selectedFeatures = getSelectedFeatures();
    if (selectedFeatures.length === 0) {
        Log.warn("[Table] No feature found for export");
        return;
    }
    const layerId = tableState._currentLayerId ?? "";
    downloadFeatures(
        selectedFeatures,
        format,
        layerId,
        "selection",
        _resolveOptions(options)
    ).catch((e) => {
        Log.error("[Table] Error during export:", e);
    });
    Log.info("[Table] Export (" + format + "):", selectedFeatures.length, "entities");
    fireEvent("geoleaf:table:exportSelection", {
        layerId,
        format,
        selectedIds: Array.from(tableState._selectedIds),
        rows: selectedFeatures,
    });
}

/** Exports all features of the current layer in the given format (default: geojson). */
export function exportLayerAll(format: ExportFormat = "geojson", options?: ExportOptions): void {
    const layerId = tableState._currentLayerId ?? "";
    if (!layerId) {
        Log.warn("[Table] No active layer for export");
        return;
    }
    const features = getAllLayerFeatures(layerId);
    if (features.length === 0) {
        Log.warn("[Table] No features found in layer:", layerId);
        return;
    }
    downloadFeatures(features, format, layerId, "layer", _resolveOptions(options)).catch((e) => {
        Log.error("[Table] Error during layer export:", e);
    });
    Log.info("[Table] Layer export (" + format + "):", features.length, "features");
    fireEvent("geoleaf:table:exportLayer", { layerId, format, count: features.length });
}
