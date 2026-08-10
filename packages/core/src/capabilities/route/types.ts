/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Route capability — public types.
 *
 * The capability decorates a bound polyline layer with start / end endpoint
 * markers; it owns no data (the line itself is rendered by the GeoJSON engine).
 */
"use strict";

/** Circle-marker style for an endpoint (start or end). */
export interface RouteEndpointStyle {
    /** Marker radius (px). */
    radius?: number;
    /** Stroke colour. */
    color?: string;
    /** Fill colour. */
    fillColor?: string;
    /** Fill opacity (0–1). */
    fillOpacity?: number;
    /** Stroke width (px). */
    weight?: number;
}

/** Per-layer binding: how a polyline layer's endpoints are shown. */
export interface RouteLayerBinding {
    /** Start-marker style override. */
    start?: RouteEndpointStyle;
    /** End-marker style override. */
    end?: RouteEndpointStyle;
    /** Show the start marker (default `true`). */
    showStart?: boolean;
    /** Show the end marker (default `true`). */
    showEnd?: boolean;
}

/** The full `modules.route` config block. */
export interface RouteConfig {
    /** Master gate — the capability is inert unless `true`. */
    enabled: boolean;
    /** Per-layer bindings (which polyline layers get endpoint markers). */
    layers?: Record<string, RouteLayerBinding>;
}

/** A layer's resolved endpoint configuration (defaults applied). */
export interface ResolvedEndpointConfig {
    /** Whether the start marker is shown. */
    showStart: boolean;
    /** Whether the end marker is shown. */
    showEnd: boolean;
    /** Effective start-marker style. */
    startStyle: RouteEndpointStyle;
    /** Effective end-marker style. */
    endStyle: RouteEndpointStyle;
}

/** Structural view of the core layer registry the capability reads on sweep. */
interface RouteLayerRegistry {
    /** All currently-registered GeoLeaf layer ids. */
    getAllLayerIds(): string[];
    /** GeoJSON geometry-type vocabulary present on a layer. */
    getGeometryTypes(layerId: string): Set<string> | undefined;
}

/**
 * Minimal structural view of the MapLibre adapter the capability calls
 * (`Core.getMap()`). Permissive on purpose — narrowed at the boundary.
 */
export interface RouteMapAdapter {
    /** Adds a GeoJSON source + sub-layers (used for the endpoint points). */
    addGeoJSONLayer: (id: string, data: unknown, style?: Record<string, unknown>) => void;
    /** Removes a previously added layer (idempotent endpoint refresh). */
    removeLayer?: (id: string) => void;
    /** The core per-layer registry (used by the ready-sweep). */
    getLayerRegistry?: () => RouteLayerRegistry | null;
}
