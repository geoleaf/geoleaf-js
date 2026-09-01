/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Vector-tiles capability — type definitions.
 *
 * Structural interfaces consumed by `vector-tiles.ts`. Originally extracted to keep that
 * file under the 700-line limit; since a later refactor moved the
 * MapLibre building to `adapters/maplibre/maplibre-vector-tiles.ts` the orchestrator is far
 * below it, and this split now stands on its own merit — a type boundary the layer-data
 * builder shares.
 */

import type { GeoJSONCurrentStyle } from "../../kernel/geojson/core-types.js";

/** The `vectorTiles` config block on a layer definition. */
export interface VtConfig {
    enabled?: boolean;
    /** Absolute or relative tile-URL template. */
    tilesUrl?: string;
    /** Directory name holding `{z}/{x}/{y}.pbf` tiles when no explicit URL. */
    tilesDirectory?: string;
    /** Source-layer name inside the MVT (falls back to `def.id`). */
    layerName?: string;
    minZoom?: number;
    maxZoom?: number;
    /** Max native zoom served by the source (MapLibre `maxzoom`). */
    maxNativeZoom?: number;
    /** Tile grid scheme — `"tms"` (y-up) or default XYZ. */
    scheme?: string;
    /** Source bounds `[w, s, e, n]`. */
    bounds?: number[];
    /** When `false`, popups/tooltips are not bound. */
    interactive?: boolean;
    [key: string]: unknown;
}

/** Tooltip field descriptor used by VT hover tooltips. */
interface VtTooltipField {
    field?: string;
    [key: string]: unknown;
}

/**
 * Layer definition consumed by the vector-tiles module. Superset of the
 * config-time options, including the internal profile metadata fields.
 */
export interface VtLayerDef {
    id?: string;
    geometry?: string;
    geometryType?: string;
    zIndex?: number;
    vectorTiles?: VtConfig;
    data?: { vectorTiles?: VtConfig; [key: string]: unknown };
    styles?: { default?: string; directory?: string; [key: string]: unknown };
    popup?: { enabled?: boolean; fields?: unknown[]; [key: string]: unknown };
    tooltip?: { enabled?: boolean; fields?: VtTooltipField[]; [key: string]: unknown };
    legends?: unknown;
    _profileId?: string;
    _layerDirectory?: string;
    [key: string]: unknown;
}

// ─── Lazily-accessed global module surfaces (on `GeoLeaf`'s `unknown` tail) ───

/** Layer-config module surface (default-style loading). */
export interface LayerConfigModuleLike {
    loadDefaultStyle?: (layerId: string, def: VtLayerDef) => Promise<GeoJSONCurrentStyle | null>;
}

/** Layer-manager surface (zoom-based visibility recompute). */
export interface LayerManagerModuleLike {
    updateLayerVisibilityByZoom?: () => void;
}
