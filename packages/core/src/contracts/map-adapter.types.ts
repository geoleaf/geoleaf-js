/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Map Adapter value types (public type boundary)
 *
 * The geographic, layer, marker, popup and control value types that `IMapAdapter`
 * (`./map-adapter.contract.ts`) is expressed in. Split out of the contract module when it
 * crossed the 700-line ceiling; the contract re-exports everything here, so
 * `map-adapter.contract.js` remains the single import surface and no call site changed.
 *
 * All geographic coordinates flow through `GeoLeafLatLng` — never raw tuples.
 * Adapters normalise engine-specific coordinates to/from these types at their
 * boundary; no `maplibregl.*` types must ever appear in this file.
 */
"use strict";

import type { VectorTileLayerSpec, VectorTileStyleInput } from "./vector-tiles.contract.js";
// Re-exported so `map-adapter.contract` stays the single import surface for adapter types.
export type { VectorTileLayerSpec, VectorTileStyleInput };

// ─── Geographic value types ───────────────────────────────────────────────────

/**
 * Immutable geographic coordinate pair.
 *
 * **Order convention — read carefully:**
 * GeoLeaf uses `{ lat, lng }` (latitude first).
 * MapLibre GL uses `[lng, lat]` (longitude first, GeoJSON order).
 * Always convert explicitly when passing coordinates to/from the adapter.
 *
 * @example
 * ```typescript
 * // GeoLeaf
 * const center: GeoLeafLatLng = { lat: 45.764, lng: 4.835 };
 * // MapLibre interop (in the adapter only)
 * const mlCenter: [number, number] = [center.lng, center.lat];
 * ```
 */
export interface GeoLeafLatLng {
    /** Latitude in decimal degrees (WGS 84). Range: −90 … +90. */
    readonly lat: number;
    /** Longitude in decimal degrees (WGS 84). Range: −180 … +180. */
    readonly lng: number;
}

/**
 * Immutable axis-aligned geographic bounding box.
 *
 * All four edges are required; partial bounds are not supported to avoid
 * ambiguity between "not set" and "zero-sized box".
 */
export interface GeoLeafBounds {
    /** Northern edge latitude (decimal degrees). */
    readonly north: number;
    /** Southern edge latitude (decimal degrees). */
    readonly south: number;
    /** Eastern edge longitude (decimal degrees). */
    readonly east: number;
    /** Western edge longitude (decimal degrees). */
    readonly west: number;
}

/**
 * Immutable 2-D screen-space point (pixels, top-left origin).
 *
 * Returned by `IMapAdapter.latLngToPoint()` and consumed by
 * `IMapAdapter.pointToLatLng()`.
 */
export interface GeoLeafPoint {
    /** Horizontal pixel offset from the map container's left edge. */
    readonly x: number;
    /** Vertical pixel offset from the map container's top edge. */
    readonly y: number;
}

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Options passed to `IMapAdapter.init()` to configure the map instance.
 *
 * The index signature allows adapters to forward engine-specific options
 * (e.g. MapLibre `style`) without breaking the contract.
 */
export interface MapInitOptions {
    /** DOM element or CSS selector of the map container. */
    container: string | HTMLElement;
    /** Initial map center. Defaults to the adapter's built-in default. */
    center?: GeoLeafLatLng;
    /** Initial zoom level. */
    zoom?: number;
    /** Minimum allowed zoom level. */
    minZoom?: number;
    /** Maximum allowed zoom level. */
    maxZoom?: number;
    /** Maximum pitch in degrees (0–85). MapLibre default: 60. */
    maxPitch?: number;
    /** Initial bounds — `fitBounds()` is called after map creation when provided. */
    bounds?: GeoLeafBounds;
    /**
     * Keeps the WebGL framebuffer readable after rendering (`canvas.toDataURL` / `toBlob`).
     * Required by the print plugin for off-screen capture and live canvas preview.
     * Incurs a small memory/perf overhead — enable only when needed.
     * Set automatically when the print plugin is registered (Sprint 2); opt-in here for manual activation.
     */
    preserveDrawingBuffer?: boolean;
    /** Forward-compatibility escape hatch for engine-specific options. */
    [key: string]: unknown;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Normalised set of map events exposed by `IMapAdapter`.
 *
 * Adapters translate engine-specific event names to these tokens.
 * Additional engine-specific events are not exposed through this interface —
 * use the adapter's native instance via a downcast if necessary.
 */
export type MapEvent =
    | "click"
    | "dblclick"
    | "contextmenu"
    | "moveend"
    | "movestart"
    | "zoomend"
    | "zoomstart"
    | "load"
    | "resize";
// ⚠️ `"unload"` a été retiré ici : il figurait dans ce contrat depuis l'origine SANS EXISTER
// dans le moteur — ni en MapLibre 5, ni en 6 (`grep` sur les deux `.d.ts` : aucun événement de
// `Map` de ce nom). Il ne compilait que par la surcharge fourre-tout `on(type: string, …)` de
// la v5, que la v6 retire en typant les événements. Zéro appelant dans tout le dépôt. Ce n'est
// donc pas une concession à la v6 mais la purge d'un jeton mort du contrat public : l'exposer
// promettait un abonnement que l'adaptateur n'aurait jamais pu honorer.

// ─── Layer & style options ────────────────────────────────────────────────────

/**
 * Common options for GeoJSON and vector layers.
 *
 * The index signature allows adapters to accept engine-specific style
 * overrides from advanced callers without losing type safety on the
 * known properties.
 */
export interface GeoLeafLayerOptions {
    /** Whether the layer is rendered on the map. @default true */
    visible?: boolean;
    /** Layer opacity. Range: 0 (transparent) … 1 (opaque). @default 1 */
    opacity?: number;
    /** Stacking order relative to other layers. Higher = on top. */
    zIndex?: number;
    /** Whether the layer responds to pointer events. @default true */
    interactive?: boolean;
    /** HTML string shown in the attribution control. */
    attribution?: string;
    /** Enable MapLibre native Supercluster on this GeoJSON source (Point layers only). */
    cluster?: boolean;
    /** Cluster radius in pixels. @default 50 */
    clusterRadius?: number;
    /** Max zoom at which clusters are generated. @default 14 */
    clusterMaxZoom?: number;
    /**
     * Lowest zoom at which the layer renders — a MapLibre ZOOM LEVEL (0-24), not a scale
     * denominator. Profiles express the constraint as `scaleConfig.minScale` (1:X); the
     * loader converts it with `scaleToZoom(scale, lat)` before it reaches the adapter.
     *
     * Distinct from {@link clusterMaxZoom}, which is a Supercluster threshold on the
     * SOURCE, not a rendering bound on the layer.
     */
    minZoom?: number;
    /** Highest zoom at which the layer renders — a zoom level, see {@link minZoom}. */
    maxZoom?: number;
    /** Forward-compatibility escape hatch for engine-specific options. */
    [key: string]: unknown;
}

/**
 * Vector fill and stroke style options, engine-agnostic.
 *
 * The index signature allows adapters to accept engine-specific style
 * extensions without breaking the contract.
 */
export interface GeoLeafStyleOptions {
    /** Fill colour (CSS colour string). */
    fillColor?: string;
    /** Fill opacity. Range: 0 … 1. */
    fillOpacity?: number;
    /** Stroke colour (CSS colour string). */
    color?: string;
    /** Stroke width in pixels. */
    weight?: number;
    /** Stroke opacity. Range: 0 … 1. */
    opacity?: number;
    /** Stroke dash pattern (SVG `stroke-dasharray` format, e.g. `"5, 10"`). */
    dashArray?: string;
    /** SVG `stroke-linecap` value (`"butt"`, `"round"`, `"square"`). */
    lineCap?: string;
    /** SVG `stroke-linejoin` value (`"miter"`, `"round"`, `"bevel"`). */
    lineJoin?: string;
    /** Forward-compatibility escape hatch for engine-specific options. */
    [key: string]: unknown;
}

// ─── Marker & popup options ───────────────────────────────────────────────────

/**
 * Options for creating a map marker.
 *
 * **Security note on `icon`:** The `icon` field must be a static, hardcoded
 * SVG string authored by the module developer. Never assign content that
 * originates from user input, network responses, or profile data — doing so
 * creates an XSS vector via SVG injection.
 */
export interface GeoLeafMarkerOptions {
    /** Accessible title for the marker (tooltip / screen reader). */
    title?: string;
    /** Alt text for the marker icon image. */
    alt?: string;
    /** Marker opacity. Range: 0 … 1. @default 1 */
    opacity?: number;
    /** Whether the marker can be repositioned by the user. @default false */
    draggable?: boolean;
    /**
     * SVG icon string.
     * @security Must be a static hardcoded string — never from external or user input.
     */
    icon?: string;
    /** Icon size in pixels as `[width, height]`. */
    iconSize?: readonly [number, number];
    /** Pixel offset from the icon top-left corner to the geographic anchor point. */
    iconAnchor?: readonly [number, number];
    /**
     * CSS class(es) applied to the marker element (space-separated). Use this
     * instead of inline styles so the marker can be themed via a stylesheet
     * under a strict CSP (`style-src` without `'unsafe-inline'`, roadmap B.5).
     */
    className?: string;
    /** Forward-compatibility escape hatch for engine-specific options. */
    [key: string]: unknown;
}

/**
 * Options controlling popup behaviour and dimensions.
 */
export interface GeoLeafPopupOptions {
    /** Maximum popup width in pixels. */
    maxWidth?: number;
    /** Minimum popup width in pixels. */
    minWidth?: number;
    /** Maximum popup height in pixels (enables internal scrolling). */
    maxHeight?: number;
    /** Close the popup when the map is clicked. @default true */
    closeOnClick?: boolean;
    /** Pan the map to keep the popup fully visible. @default true */
    autoPan?: boolean;
    /** Additional CSS class name(s) applied to the popup element. */
    className?: string;
}

// ─── Controls ─────────────────────────────────────────────────────────────────

/**
 * Cardinal corner position for map controls.
 */
export type GeoLeafControlPosition = "topleft" | "topright" | "bottomleft" | "bottomright";

/**
 * Handle returned by `IMapAdapter.addControl()`.
 * Callers use it to later remove the control via `IMapAdapter.removeControl()`.
 */
export interface GeoLeafControl {
    /** Corner where the control is anchored. */
    readonly position: GeoLeafControlPosition;
    /**
     * Removes the control from the map.
     * Equivalent to calling `IMapAdapter.removeControl(this)`.
     */
    remove(): void;
}

/**
 * Handle on a marker previously created through `IMapAdapter.createMarker()`,
 * returned by `IMapAdapter.getMarkerHandle()`.
 *
 * Deliberately narrow: id-based management stays the rule, and this handle exists
 * only for the interactions the id-based surface cannot express — reading a marker's
 * live position after the user has dragged it, and subscribing to its own events.
 * It is typed rather than opaque so callers need no cast; keep it minimal, and add a
 * member only when a real consumer needs one.
 */
export interface GeoLeafMarkerHandle {
    /** Current position of the marker, which drag interactions move away from its initial one. */
    getLngLat(): GeoLeafLatLng;
    /** Subscribes to a native marker event (e.g. `"dragend"`). */
    on(event: string, callback: () => void): void;
}
