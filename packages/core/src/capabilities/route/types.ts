/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Route capability — public types.
 *
 * The capability decorates a bound polyline layer with start / via / end markers; it owns no
 * data (the line itself is rendered by the GeoJSON engine).
 *
 * ## Two sources for the markers, and never both at once
 *
 * A layer carrying only LINES has its start / end DERIVED from the first and last positions of
 * each line — the behaviour since V1, unchanged.
 *
 * A layer that already carries `Point` features tagged with `properties.role` has those used
 * VERBATIM, and nothing is derived. That is what a routing plugin publishes, and it is the only
 * way an intermediate stop can exist at all.
 *
 * 🛑 **Doing both would render two superposed markers at each end** — indistinguishable by eye,
 * doubled on click, and impossible to explain from the data.
 */

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
    /**
     * Intermediate-stop style override.
     *
     * ⚠️ A `via` is NOT derived, and cannot be: nothing in a `LineString` says which of its
     * vertices are stops. Via points are read from the bound layer's own `Point` features when
     * they carry `properties.role` — which is what a routing plugin publishes through
     * `Layers.setData`. Deriving them would mean inventing them.
     */
    via?: RouteEndpointStyle;
    /** Show the start marker (default `true`). */
    showStart?: boolean;
    /** Show the end marker (default `true`). */
    showEnd?: boolean;
    /** Show the intermediate-stop markers (default `true`). */
    showVia?: boolean;
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
    /** Whether the intermediate-stop markers are shown. */
    showVia: boolean;
    /** Effective start-marker style. */
    startStyle: RouteEndpointStyle;
    /** Effective end-marker style. */
    endStyle: RouteEndpointStyle;
    /** Effective intermediate-stop style. */
    viaStyle: RouteEndpointStyle;
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
