/*!
 * GeoLeaf FlatGeobuf Plugin — Type Definitions
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { FeatureCollection } from "geojson";

/** Bounding box for spatial filtering (FlatGeobuf R-tree index). */
export interface FgbBbox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Options shared by all FlatGeobuf load functions. */
export interface FgbLoadOptions {
    /** Maximum number of features to accumulate (anti-DoS). Default: 100 000. */
    maxFeatures?: number;
    /** AbortSignal for cooperative cancellation. */
    signal?: AbortSignal;
    /** Callback invoked with the FGB header metadata after deserialization starts. */
    onHeader?: (meta: Record<string, unknown>) => void;
}

/** Extended options for bbox-filtered loading with optional auto-refresh. */
export interface FgbBboxOptions extends FgbLoadOptions {
    /** Re-fetch when the map viewport changes (listens to `moveend`). */
    autoRefresh?: boolean;
    /** Debounce delay in ms for auto-refresh (default: 300). */
    debounceMs?: number;
}

/** Options for `loadAsLayer` / `loadBboxAsLayer`. */
export interface FgbLayerOptions extends FgbBboxOptions {
    /** Explicit layer ID (auto-generated if omitted). */
    layerId?: string;
    /** Human-readable layer name. */
    layerName?: string;
    /** Initial visibility. Default: true. */
    visible?: boolean;
    /** Enable point clustering. Default: false. */
    cluster?: boolean;
    /** Geometry hint (`point` / `line` / `polygon`) forwarded to the adapter for sub-layer creation. */
    geometry?: string;
    /** Stacking order forwarded to the adapter (`getInsertBeforeId`). */
    zIndex?: number;
}

/** Result returned by load / loadBbox. */
export interface FgbLoadResult {
    /** The GeoJSON FeatureCollection. */
    data: FeatureCollection;
    /** Number of features loaded. */
    featureCount: number;
    /** FlatGeobuf header metadata (columns, geometry type, envelope, CRS…). */
    headerMeta?: Record<string, unknown>;
}
