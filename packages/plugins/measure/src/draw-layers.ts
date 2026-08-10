/*!
 * @geoleaf-plugins/measure — Draw layers
 * © 2026 Mattieu Pottier — MIT License
 *
 * Manages MapLibre GL sources and layers for all measure geometries.
 * All source/layer IDs are prefixed with "gl-measure-" to avoid collisions.
 * https://geoleaf.dev
 */
import { withClosingVertex } from "./compute.js";
import { _getNativeMap } from "./internal.js";
import type { MeasureMap } from "./types.js";

// ---------------------------------------------------------------------------
// Source / layer IDs
// ---------------------------------------------------------------------------

const SRC_LINES = "gl-measure-lines";
const SRC_POLYGONS = "gl-measure-polygons";
const SRC_VERTICES = "gl-measure-vertices";
const SRC_LABELS = "gl-measure-labels";
const SRC_PREVIEW = "gl-measure-preview";

const LYR_LINES = "gl-measure-lines-layer";
const LYR_POLY_FILL = "gl-measure-polygons-fill";
const LYR_POLY_LINE = "gl-measure-polygons-line";
const LYR_VERTICES = "gl-measure-vertices-layer";
const LYR_LABELS = "gl-measure-labels-layer";
const LYR_PREVIEW = "gl-measure-preview-layer";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _map: MeasureMap | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _emptyFC(): GeoJSON.FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

function _pointFC(coords: [number, number][]): GeoJSON.FeatureCollection {
    return {
        type: "FeatureCollection",
        features: coords.map((c) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: c },
            properties: {},
        })),
    };
}

function _labelFC(
    labels: Array<{
        coord: [number, number];
        text: string;
        bearing?: number;
        color?: string;
        offsetType?: string;
    }>
): GeoJSON.FeatureCollection {
    return {
        type: "FeatureCollection",
        features: labels.map((l) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: l.coord },
            properties: {
                text: l.text,
                bearing: l.bearing ?? 0,
                color: l.color ?? null,
                offsetType: l.offsetType ?? "above",
            },
        })),
    };
}

/** Safely sets data on a GeoJSON source (no-op if source or setData missing). */
function _setData(sourceId: string, fc: GeoJSON.FeatureCollection): void {
    const src = _map?.getSource?.(sourceId);
    if (src?.setData) src.setData(fc);
}

/** Adds a source only if it does not already exist. */
function _addSource(map: MeasureMap, id: string): void {
    if (map.getSource?.(id)) return;
    map.addSource(id, { type: "geojson", data: _emptyFC() });
}

/** Adds a layer only if it does not already exist. */
function _addLayer(map: MeasureMap, spec: Record<string, unknown>): void {
    if (map.getLayer?.(spec["id"] as string)) return;
    map.addLayer(spec);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates all measure sources and layers on the map.
 * Idempotent: safe to call multiple times.
 */
export function initLayers(map: MeasureMap): void {
    _map = map;

    _addSource(map, SRC_LINES);
    _addSource(map, SRC_POLYGONS);
    _addSource(map, SRC_VERTICES);
    _addSource(map, SRC_LABELS);
    _addSource(map, SRC_PREVIEW);

    _addLayer(map, {
        id: LYR_POLY_FILL,
        type: "fill",
        source: SRC_POLYGONS,
        paint: { "fill-color": "#0078FF", "fill-opacity": 0.1 },
    });
    _addLayer(map, {
        id: LYR_POLY_LINE,
        type: "line",
        source: SRC_POLYGONS,
        paint: { "line-color": "#0078FF", "line-width": 2 },
    });
    _addLayer(map, {
        id: LYR_LINES,
        type: "line",
        source: SRC_LINES,
        paint: { "line-color": "#0078FF", "line-width": 2 },
    });
    _addLayer(map, {
        id: LYR_PREVIEW,
        type: "line",
        source: SRC_PREVIEW,
        paint: {
            "line-color": "#0078FF",
            "line-width": 1.5,
            "line-dasharray": [3, 3],
            "line-opacity": 0.6,
        },
    });
    _addLayer(map, {
        id: LYR_VERTICES,
        type: "circle",
        source: SRC_VERTICES,
        paint: {
            "circle-radius": 5,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#0078FF",
            "circle-stroke-width": 2,
        },
    });
    _addLayer(map, {
        id: LYR_LABELS,
        type: "symbol",
        source: SRC_LABELS,
        layout: {
            "text-field": ["get", "text"],
            "text-size": 12,
            "text-offset": [
                "case",
                ["==", ["get", "offsetType"], "below"],
                ["literal", [0, 1.0]],
                ["literal", [0, -0.7]],
            ],
            "text-anchor": "center",
            "text-rotate": ["get", "bearing"],
            "text-rotation-alignment": "map",
        },
        paint: {
            "text-color": ["coalesce", ["get", "color"], "#0078FF"],
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
        },
    });
}

/** Updates finished line features in the lines source. */
export function updateLines(features: GeoJSON.Feature[]): void {
    _setData(SRC_LINES, { type: "FeatureCollection", features });
}

/** Updates finished polygon features in the polygons source. */
export function updatePolygons(features: GeoJSON.Feature[]): void {
    _setData(SRC_POLYGONS, { type: "FeatureCollection", features });
}

/** Updates vertex markers (circle layer). */
export function updateVertices(coords: [number, number][]): void {
    _setData(SRC_VERTICES, _pointFC(coords));
}

/** Updates label features (cote midpoints + area/total/perimeter labels). */
export function updateLabels(
    labels: Array<{
        coord: [number, number];
        text: string;
        bearing?: number;
        color?: string;
        offsetType?: string;
    }>
): void {
    _setData(SRC_LABELS, _labelFC(labels));
}

/**
 * Updates the preview source with the elastic-line / in-progress geometry.
 * @param coords Vertices in `[lng, lat]` order — the GeoJSON convention, not `[lat, lng]`.
 * @param closed If true, adds a closing segment back to the first vertex.
 */
export function updatePreview(coords: [number, number][], closed = false): void {
    if (coords.length < 2) {
        _setData(SRC_PREVIEW, _emptyFC());
        return;
    }
    const ring = closed ? withClosingVertex(coords) : coords;
    _setData(SRC_PREVIEW, {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                geometry: { type: "LineString", coordinates: ring },
                properties: {},
            },
        ],
    });
}

/** Clears the preview source. */
export function clearPreview(): void {
    _setData(SRC_PREVIEW, _emptyFC());
}

/** Empties all measure sources (finished geometries + preview). */
export function clearAll(): void {
    for (const src of [SRC_LINES, SRC_POLYGONS, SRC_VERTICES, SRC_LABELS, SRC_PREVIEW]) {
        _setData(src, _emptyFC());
    }
}

/** Sets the map cursor style. */
export function setCursor(cursor: string): void {
    const map = _map ?? _getNativeMap();
    if (map?.getCanvas) {
        map.getCanvas().style.cursor = cursor;
    }
}

/** Disables map pan (call before a drag-based drawing interaction). */
export function disableDragPan(): void {
    const map = _map ?? _getNativeMap();
    map?.dragPan?.disable?.();
}

/** Re-enables map pan (call after a drag-based drawing interaction ends). */
export function enableDragPan(): void {
    const map = _map ?? _getNativeMap();
    map?.dragPan?.enable?.();
}
