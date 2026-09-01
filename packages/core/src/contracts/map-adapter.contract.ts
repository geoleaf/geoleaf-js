/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Map Adapter (public type boundary)
 *
 * The `IMapAdapter` interface abstracting all map-engine operations (MapLibre GL JS).
 * The value types it is expressed in live in `./map-adapter.types.ts` and are re-exported
 * below, so this module stays the single import surface for adapter consumers.
 *
 * No `maplibregl.*` type must ever appear in this file.
 */

import type {
    GeoLeafLatLng,
    GeoLeafBounds,
    GeoLeafPoint,
    MapInitOptions,
    MapEvent,
    GeoLeafLayerOptions,
    GeoLeafStyleOptions,
    GeoLeafMarkerOptions,
    GeoLeafPopupOptions,
    GeoLeafControlPosition,
    GeoLeafControl,
    GeoLeafMarkerHandle,
} from "./map-adapter.types.js";
import type { VectorTileLayerSpec, VectorTileStyleInput } from "./vector-tiles.contract.js";

// The value types keep being reachable from this module: splitting the file must not
// ripple into the call sites that import them from `map-adapter.contract.js`.
// `export type *`, never a bare `export *` — the latter emits a runtime re-export, which
// the contracts-purity gate rejects: a contract must erase completely at compile time.
export type * from "./map-adapter.types.js";

// ─── IMapAdapter ──────────────────────────────────────────────────────────────

/**
 * Engine-agnostic map adapter interface.
 *
 * `MaplibreAdapter` implements this interface. All GeoLeaf modules interact
 * with the map exclusively through this interface — no `maplibregl.*`
 * references outside of the adapter implementation.
 *
 * **Id-based management:** Layers, markers, and cluster groups are managed by
 * string identifiers. The adapter stores native engine objects internally —
 * callers never interact with MapLibre overlays directly.
 *
 * **Opaque handles:** `createPopup()` returns `unknown` because the underlying
 * type differs between engines. Callers must treat popup handles as opaque and
 * pass them back to `openPopup()` / `closePopup()`.
 *
 * @example
 * ```typescript
 * // In a module's init():
 * adapter.init({ container: 'map', center: { lat: 45.76, lng: 4.83 }, zoom: 13 });
 * adapter.on('zoomend', () => console.log('zoom:', adapter.getZoom()));
 * ```
 */
export interface IMapAdapter {
    // ── Initialisation ────────────────────────────────────────────────────────

    /**
     * Creates and mounts the map inside the given container.
     * Must be called exactly once before any other method.
     *
     * @param options - Map creation options.
     */
    init(options: MapInitOptions): void;

    /**
     * Returns `true` after `init()` has completed successfully.
     * Methods that depend on a live map instance should guard on this flag.
     */
    isReady(): boolean;

    /**
     * Destroys the map instance and releases all associated resources.
     * After `destroy()`, no other methods may be called.
     */
    destroy(): void;

    // ── View / Navigation ─────────────────────────────────────────────────────

    /**
     * Sets the map center and zoom level without animation.
     *
     * @param center - New geographic center.
     * @param zoom - New zoom level.
     */
    setView(center: GeoLeafLatLng, zoom: number): void;

    /**
     * Returns the current geographic center of the map viewport.
     */
    getCenter(): GeoLeafLatLng;

    /**
     * Returns the current zoom level.
     */
    getZoom(): number;

    /**
     * Sets the zoom level without changing the center.
     *
     * @param zoom - New zoom level.
     */
    setZoom(zoom: number): void;

    /**
     * Pans the map to the given center without changing the zoom level.
     *
     * MapLibre uses `easeTo()` without zoom change.
     *
     * @param center - Target geographic center.
     */
    panTo(center: GeoLeafLatLng): void;

    /**
     * Smoothly animates the viewport to the target center and zoom level.
     *
     * @param center - Target geographic center.
     * @param zoom - Target zoom level (optional — keeps current zoom when omitted).
     */
    flyTo(center: GeoLeafLatLng, zoom?: number): void;

    /**
     * Adjusts the viewport to fit the given bounding box.
     *
     * @param bounds - Geographic area to fit.
     * @param options - Optional padding in screen pixels around the bounds.
     */
    fitBounds(bounds: GeoLeafBounds, options?: { padding?: GeoLeafPoint; animate?: boolean }): void;

    /**
     * Returns the current viewport as a geographic bounding box.
     */
    getBounds(): GeoLeafBounds;

    // ── Events ────────────────────────────────────────────────────────────────

    /**
     * Subscribes to a map event.
     *
     * The handler receives an engine-specific event object (`unknown`).
     * Adapters normalise geographic coordinates to `GeoLeafLatLng` within
     * the event object where applicable.
     *
     * @param event - Event type token.
     * @param handler - Callback invoked on each occurrence.
     */
    on(event: MapEvent, handler: (e: unknown) => void): void;

    /**
     * Unsubscribes a previously registered event handler.
     * Silently does nothing if the handler was not registered.
     *
     * @param event - Event type token.
     * @param handler - The exact function reference passed to `on()`.
     */
    off(event: MapEvent, handler: (e: unknown) => void): void;

    /**
     * Subscribes to a map event for a single occurrence, then auto-unsubscribes.
     *
     * @param event - Event type token.
     * @param handler - Callback invoked on the first occurrence.
     */
    once(event: MapEvent, handler: (e: unknown) => void): void;

    // ── Layers ────────────────────────────────────────────────────────────────

    /**
     * Creates a GeoJSON layer from raw GeoJSON data and adds it to the map.
     *
     * The adapter stores the layer internally keyed by `id`. Use `removeLayer()`,
     * `setLayerVisibility()`, `updateLayerData()`, and `setLayerStyle()` to
     * manage it afterwards.
     *
     * @param id - Unique layer identifier.
     * @param data - GeoJSON data (`FeatureCollection`, `Feature`, or `Geometry`).
     *   Validated by the adapter at runtime.
     * @param options - Optional layer display options.
     */
    addGeoJSONLayer(id: string, data: unknown, options?: GeoLeafLayerOptions): void;

    /**
     * Removes the layer identified by `id` from the map and disposes it.
     *
     * @param id - The layer identifier used in `addGeoJSONLayer()`.
     */
    removeLayer(id: string): void;

    /**
     * Returns `true` if a layer with the given id is currently managed by the adapter.
     *
     * @param id - Layer identifier to check.
     */
    hasLayer(id: string): boolean;

    /**
     * Shows a previously hidden layer.
     *
     * @param id - Layer identifier.
     */
    showLayer(id: string): void;

    /**
     * Hides a layer without removing it from the adapter's internal registry.
     *
     * @param id - Layer identifier.
     */
    hideLayer(id: string): void;

    /**
     * Replaces the GeoJSON data of an existing layer.
     *
     * Internally clears the current features and adds the new data.
     * The layer keeps its id, options, and style.
     *
     * @param id - Layer identifier.
     * @param data - New GeoJSON data (`FeatureCollection`, `Feature`, or `Geometry`).
     */
    updateLayerData(id: string, data: unknown): void;

    /**
     * Sets feature-state on a layer's source feature, targeted by its promoted
     * id — reactive paint (e.g. POI sync badge, hover/selection halo) without a
     * source data rebuild. Maps to `map.setFeatureState()`. The source must
     * declare `promoteId` for a string id to resolve.
     *
     * @param id - Layer identifier (resolves to the backing source).
     * @param featureId - Promoted feature id to target.
     * @param state - Feature-state key/values to set.
     */
    setFeatureState?(id: string, featureId: string | number, state: Record<string, unknown>): void;

    /**
     * Applies a style to an existing GeoJSON layer.
     *
     * @param id - Layer identifier.
     * @param style - Vector fill and stroke style options.
     */
    setLayerStyle(id: string, style: GeoLeafStyleOptions): void;

    /**
     * Applies a filter expression to an existing layer.
     *
     * Maps to `map.setFilter()` with a MapLibre expression
     * array (e.g. `["==", ["get", "type"], "park"]`).
     *
     * @param id - Layer identifier.
     * @param filter - Engine-specific filter expression (`unknown`).
     *   Pass `null` to clear the filter.
     */
    setLayerFilter(id: string, filter: unknown): void;

    /**
     * Updates the zoom range of an existing layer, on every one of its sub-layers.
     *
     * Maps to `map.setLayerZoomRange()`. Needed because a scale bound converts to a zoom
     * level THROUGH THE LATITUDE: the same 1:X sits at different zooms in Cayenne and in
     * Tromsø. A range posted at load time therefore drifts as the user pans north or
     * south, and has to be re-pushed — but never on zoom, which does not affect the
     * conversion.
     *
     * @param id - Layer identifier.
     * @param minZoom - Lowest zoom at which the layer renders, or `null` to clear.
     * @param maxZoom - Highest zoom at which the layer renders, or `null` to clear.
     */
    setLayerZoomRange(id: string, minZoom: number | null, maxZoom: number | null): void;

    // ── Markers ───────────────────────────────────────────────────────────────

    /**
     * Creates a marker at the given position and adds it to the map.
     *
     * The adapter stores the marker internally keyed by `id`.
     *
     * @param id - Unique marker identifier.
     * @param position - Geographic position of the marker anchor.
     * @param options - Marker display options.
     *
     * @security The `options.icon` field, if provided, must be a static
     * hardcoded SVG string. Never pass user-provided or network-fetched content
     * as `icon` — SVG can carry executable payloads (XSS).
     */
    createMarker(id: string, position: GeoLeafLatLng, options?: GeoLeafMarkerOptions): void;

    /**
     * Removes a marker from the map and releases its resources.
     *
     * @param id - The marker identifier used in `createMarker()`.
     */
    removeMarker(id: string): void;

    /**
     * Updates the geographic position of an existing marker.
     *
     * @param id - The marker identifier used in `createMarker()`.
     * @param position - New geographic position.
     */
    updateMarkerPosition(id: string, position: GeoLeafLatLng): void;

    /**
     * Rotates an existing marker's icon.
     *
     * Pair it with `rotationAlignment: "map"` at creation: the engine then re-derives the
     * on-screen angle from the map bearing on every frame, so a caller updating this once per
     * position fix still gets a continuously correct icon during an animated camera move.
     *
     * Optional: an adapter whose engine has no marker-rotation model may omit it, and callers
     * must handle `undefined` as they do for the other optional members.
     *
     * @param id - The marker identifier used in `createMarker()`.
     * @param degrees - Rotation clockwise, in degrees.
     */
    setMarkerRotation?(id: string, degrees: number): void;

    /**
     * Returns a handle on an existing marker, or `null` when no marker carries that id.
     *
     * The id-based surface above covers the common cases; this exists for the two things
     * it cannot express — reading a marker's position *after the user dragged it*, and
     * subscribing to its own events. Prefer `updateMarkerPosition()` and the map-level
     * `on()` whenever they suffice.
     *
     * Optional: an adapter whose engine has no per-marker event model may omit it, and
     * callers must handle `undefined` as they do for the other optional members.
     *
     * @param id - The marker identifier used in `createMarker()`.
     */
    getMarkerHandle?(id: string): GeoLeafMarkerHandle | null;

    /**
     * Creates a cluster group for grouping markers at low zoom levels.
     *
     * The adapter stores the cluster group internally keyed by `id`.
     *
     * @param id - Unique cluster group identifier.
     * @param options - Clustering options (engine-specific, typed `unknown`).
     *   Each adapter validates the concrete options internally.
     */
    createClusterGroup(id: string, options?: Record<string, unknown>): Promise<void>;

    // ── Popups ────────────────────────────────────────────────────────────────

    /**
     * Creates a popup with the given content.
     *
     * Returns an opaque handle (`unknown`) to pass to `openPopup()` /
     * `closePopup()`. The popup is not opened automatically — call `openPopup()`
     * after creation.
     *
     * @param content - HTML string or DOM element to display inside the popup.
     * @precondition When `content` is a string, it **must** be sanitised by the
     * caller before being passed here. The adapter does not sanitise content.
     * Use `GeoLeaf.Security.sanitizeHTML()` (allowlist) or `stripHtml()`, or pass an
     * already-built `HTMLElement` — the internal renderers use `setDOMContent`, never a
     * raw string.
     */
    createPopup(content: string | HTMLElement, options?: GeoLeafPopupOptions): unknown;

    /**
     * Opens (displays) a popup on the map.
     *
     * @param popup - The opaque handle returned by `createPopup()`.
     * @param position - Geographic position at which to anchor the popup.
     * When omitted, the popup opens at its previously stored position.
     */
    openPopup(popup: unknown, position?: GeoLeafLatLng): void;

    /**
     * Closes a popup without destroying it.
     * When `popup` is omitted, all open popups are closed.
     *
     * @param popup - The opaque handle returned by `createPopup()`. Optional.
     */
    closePopup(popup?: unknown): void;

    // ── Controls ──────────────────────────────────────────────────────────────

    /**
     * Adds a native control object to the map at the specified corner.
     *
     * Returns a `GeoLeafControl` handle that can be passed to `removeControl()`.
     *
     * @param control - Native control object (engine-specific, typed `unknown`).
     * @param position - Map corner where the control is rendered.
     */
    addControl(control: unknown, position: GeoLeafControlPosition): GeoLeafControl;

    /**
     * Removes a control from the map.
     *
     * @param control - The `GeoLeafControl` handle returned by `addControl()`.
     */
    removeControl(control: GeoLeafControl): void;

    // ── Utilities ─────────────────────────────────────────────────────────────

    /**
     * Projects a geographic coordinate to a pixel point relative to the
     * map container's top-left corner.
     *
     * @param latlng - Geographic coordinate to project.
     */
    latLngToPoint(latlng: GeoLeafLatLng): GeoLeafPoint;

    /**
     * Unprojects a pixel point (relative to the map container) back to a
     * geographic coordinate.
     *
     * @param point - Pixel coordinate to unproject.
     */
    pointToLatLng(point: GeoLeafPoint): GeoLeafLatLng;

    /**
     * Returns the map's root DOM container element.
     * Useful for positioning custom overlays or reading container dimensions.
     */
    getContainer(): HTMLElement;

    /**
     * Returns the engine's drawing canvas — the element that actually paints the pointer.
     *
     * ⚠️ **Not interchangeable with {@link IMapAdapter.getContainer}.** MapLibre styles the
     * cursor through CSS classes on `.maplibregl-canvas-container`, an element BETWEEN the
     * root container and the canvas (`cursor: grab` on `.maplibregl-interactive`). A rule
     * set on that descendant beats anything inherited from the root, so writing
     * `getContainer().style.cursor` is silently overridden and never shows. Any code
     * changing the map cursor must target the canvas.
     *
     * Optional, like {@link IMapAdapter.resize}: test doubles implement the contract
     * without it, and making it required would turn every mock red for a capability none
     * of them exercise. Call it as `adapter.getCanvas?.() ?? adapter.getContainer()` — the
     * same fallback the editor plugin already uses.
     */
    getCanvas?(): HTMLCanvasElement;

    /**
     * Asks the engine to re-read its container size and resize its drawing buffer.
     *
     * Needed after the container is moved into a parent of different dimensions —
     * `Core.reattach()` calls it — because the WebGL canvas keeps the size it was
     * built with and would otherwise render at the old dimensions in the new slot.
     *
     * Optional, like {@link IMapAdapter.getNativeMap}: test doubles implement the
     * contract without it, and making it required would turn every mock red for a
     * capability none of them exercise. ⚠️ Optional means a caller can invoke it on
     * `undefined` and never notice — call it as `adapter.resize?.()` and treat its
     * absence as "the engine does not need telling", never as success.
     */
    resize?(): void;

    /**
     * Returns the underlying native map instance (MapLibre GL `Map` object).
     *
     * Intended for low-level integrations that cannot be expressed through the
     * standard adapter interface. Use sparingly — direct access bypasses the
     * adapter contract and may break on engine upgrades.
     *
     * Returns `unknown` to avoid importing engine-specific types in this file.
     */
    getNativeMap?(): unknown;

    /**
     * Builds a `transformStyle` callback (`setStyle` option, depuis MapLibre v5) that
     * preserves the adapter-owned sources and layers across a basemap style swap,
     * so they survive natively rather than being torn down and re-injected.
     * Returns `null` when nothing is owned yet.
     *
     * Called by the basemap registry immediately before `setStyle()`. The return
     * type is intentionally opaque here to keep the contract engine-agnostic.
     */
    buildStyleChangeTransform?(): unknown;

    /**
     * Re-registers runtime images (e.g. POI sprite icons) wiped by
     * `map.setStyle()`. Sources and layers are preserved by the style transform;
     * images are not part of the style spec and must be re-added after the swap.
     *
     * Called by the basemap registry inside the post-swap `style.load` handler.
     */
    reregisterStyleImages?(): void;

    /**
     * Adds a native vector-tile source and its styled sub-layers (fill / line /
     * circle / fill-extrusion / casing), registering them in the adapter's layer
     * registry. Returns the created sub-layer ids (for interaction binding and layer
     * bookkeeping). Engine-specific (vector tiles are a MapLibre-native concept) — a
     * non-MapLibre adapter may omit it. Socle B.1: the `vector-tiles` capability
     * resolves config/style and delegates all rendering here.
     */
    addVectorTileLayer?(layerId: string, spec: VectorTileLayerSpec): string[];

    /**
     * Updates the paint of an existing vector-tile layer's sub-layers from raw
     * GeoLeaf style objects (normalised by the adapter). Companion to
     * {@link addVectorTileLayer}.
     */
    updateVectorTileLayerStyle?(
        layerId: string,
        subLayerIds: string[],
        style: VectorTileStyleInput
    ): void;
}
