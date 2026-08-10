/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * MapLibre GL JS adapter — implements `IMapAdapter`.
 * Coordinates: GeoLeaf `{lat,lng}` ↔ MapLibre `[lng,lat]`.
 */
import type {
    IMapAdapter,
    MapInitOptions,
    MapEvent,
    GeoLeafLatLng,
    GeoLeafBounds,
    GeoLeafPoint,
    GeoLeafLayerOptions,
    GeoLeafStyleOptions,
    GeoLeafMarkerOptions,
    GeoLeafPopupOptions,
    GeoLeafControlPosition,
    GeoLeafControl,
    GeoLeafMarkerHandle,
    VectorTileLayerSpec,
    VectorTileStyleInput,
} from "../../contracts/map-adapter.contract.ts";

import { dispatchGeoLeafEvent } from "../../kernel/events/event-bus.js";
import { MaplibreLayerRegistry, SENTINEL_POI } from "./maplibre-layer-registry.js";
import { applyLayerStyle } from "./maplibre-style-applier.js";
import { applyPoiFilter, type ClusterLayerIds } from "./maplibre-poi-builders.js";
import {
    registerSpriteIcons,
    hasProfileSprite,
    ensureLayerSpriteIcons,
} from "./maplibre-poi-icons.js";
import { buildGeoLeafStyleTransform, type StyleTransform } from "./maplibre-style-transform.js";
import { flushMapCleanups } from "./maplibre-event-subscriptions.js";
import {
    attachWrappedHandler,
    createEventWrapperMap,
    detachWrappedHandler,
    type EventWrapperMap,
} from "./maplibre-event-wrappers.js";
import {
    toMapLibreLngLat,
    fromMapLibreLngLat,
    toMapLibreBounds,
    fromMapLibreBounds,
    POSITION_MAP,
    applyLayerZoomRange,
} from "./maplibre-primitives.js";
import { buildGeoJSONLayer, buildClusterGroup } from "./maplibre-layer-builders.js";
import { buildMarker, dropMarker, moveMarker } from "./maplibre-markers.js";
import {
    buildVectorTileLayer,
    updateVectorTileLayerStyle as applyVectorTileLayerStyle,
} from "./maplibre-vector-tiles.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { Log } from "../../utils/log/index.js";
import type {
    MaplibreMap,
    MaplibreControl,
    MaplibrePopup,
    MaplibreMarker,
    GeoJSONSourceLike,
    MaplibreFilter,
    ControlPosition,
    FlyToOptions,
    FitBoundsOptions,
    MaplibreEventListener,
} from "./maplibre-adapter-types.ts";
// MapLibre GL global — loaded via <script> tag at runtime. Typed canonically in
// `src/global.d.ts` as a type-only `typeof import("maplibre-gl")` (zero bundle emit).

/** Minimal view of the `GeoLeaf.plugins` registry queried before map init. */
interface PluginsRegistryLike {
    isLoaded?: (name: string) => boolean;
}

/** MapLibre GL JS adapter — implements `IMapAdapter`. One instance per map. */
export class MaplibreAdapter implements IMapAdapter {
    private _map: MaplibreMap | null = null;
    private _ready = false;
    private _prevZoom = 0;
    private _controlIdCounter = 0;
    private readonly _controls: Map<string, MaplibreControl> = new Map();
    private readonly _layerRegistry = new MaplibreLayerRegistry();
    private readonly _openPopups: Set<MaplibrePopup> = new Set();
    private readonly _markers: Map<string, MaplibreMarker> = new Map();
    private readonly _clusterIds: Map<string, ClusterLayerIds> = new Map();

    // Named handler refs — stored so destroy() can deregister them explicitly.
    private readonly _handleLoad = (): void => {
        dispatchGeoLeafEvent("geoleaf:map:ready", undefined);
    };
    private readonly _handleZoomStart = (): void => {
        if (this._map) this._prevZoom = this._map.getZoom();
    };
    private readonly _handleZoomEnd = (): void => {
        if (!this._map) return;
        const c = this._map.getCenter();
        dispatchGeoLeafEvent("geoleaf:map:zoom", {
            zoom: this._map.getZoom(),
            oldZoom: this._prevZoom,
            center: { lat: c.lat, lng: c.lng },
        });
    };
    private readonly _handleMoveEnd = (): void => {
        if (!this._map) return;
        const c = this._map.getCenter();
        dispatchGeoLeafEvent("geoleaf:map:move", {
            center: { lat: c.lat, lng: c.lng },
            zoom: this._map.getZoom(),
        });
    };

    // ── Initialisation ────────────────────────────────────────────────────────

    init(options: MapInitOptions): void {
        if (this._ready) throw new Error("MaplibreAdapter: init() has already been called.");
        const maxBoundsRaw = options["maxBounds"] as GeoLeafBounds | undefined;
        // Auto-activate preserveDrawingBuffer when the print plugin is registered before map init.
        // Also honoured via explicit opt-in `mapOptions.preserveDrawingBuffer`.
        const _plugins = getGeoLeaf()?.plugins as PluginsRegistryLike | undefined;
        const _printRegistered = _plugins?.isLoaded?.("print") === true;
        this._map = new maplibregl.Map({
            container: options.container,
            style: { version: 8 as const, sources: {}, layers: [] },
            center: options.center ? toMapLibreLngLat(options.center) : [0, 0],
            zoom: options.zoom ?? 5,
            // `MapOptions` est déclaré hors du dépôt : on ne peut pas l'élargir, donc on
            // construit par insertion conditionnelle — l'idiome que ce littéral emploie déjà
            // trois lignes plus bas pour `preserveDrawingBuffer`.
            ...(options.minZoom !== undefined && { minZoom: options.minZoom }),
            ...(options.maxZoom !== undefined && { maxZoom: options.maxZoom }),
            maxPitch: options.maxPitch ?? 80,
            ...(maxBoundsRaw && { maxBounds: toMapLibreBounds(maxBoundsRaw) }),
            attributionControl: false,
            ...((options.preserveDrawingBuffer || _printRegistered) && {
                preserveDrawingBuffer: true,
            }),
        });
        if (options.bounds)
            this._map.fitBounds(toMapLibreBounds(options.bounds), { animate: false });
        this._ready = true;
        this._bindEvents();
    }

    isReady(): boolean {
        return this._ready;
    }

    /** Destroys the map instance and releases all resources. After destroy(), no other method may be called. */
    destroy(): void {
        this._ready = false;
        if (this._map) {
            // Detach delegated layer listeners (feature/POI/cluster binders) before
            // removing named handlers, so nothing survives into a re-init.
            flushMapCleanups(this._map);
            // Deregister named handlers before remove() to prevent listener leaks
            // when the same adapter instance is destroyed and re-initialised.
            this._map.off("load", this._handleLoad);
            this._map.off("zoomstart", this._handleZoomStart);
            this._map.off("zoomend", this._handleZoomEnd);
            this._map.off("moveend", this._handleMoveEnd);
            this._map.remove();
            this._map = null;
        }
        // Cleanup DOM markers
        for (const marker of this._markers.values()) {
            marker.remove();
        }
        this._markers.clear();
        this._clusterIds.clear();
        this._controls.clear();
        this._layerRegistry.clear();
        this._openPopups.clear();
        this._wrapperMap.clear();
        this._sentinelCreated = false;
    }

    // ── View / Navigation ─────────────────────────────────────────────────────

    setView(center: GeoLeafLatLng, zoom: number): void {
        this._requireMap().jumpTo({ center: toMapLibreLngLat(center), zoom });
    }

    getCenter(): GeoLeafLatLng {
        return fromMapLibreLngLat(this._requireMap().getCenter());
    }

    getZoom(): number {
        return this._requireMap().getZoom();
    }

    setZoom(zoom: number): void {
        this._requireMap().jumpTo({ zoom });
    }

    panTo(center: GeoLeafLatLng): void {
        this._requireMap().easeTo({ center: toMapLibreLngLat(center) });
    }

    flyTo(center: GeoLeafLatLng, zoom?: number): void {
        const opts: FlyToOptions = { center: toMapLibreLngLat(center) };
        if (zoom !== undefined) opts.zoom = zoom;
        this._requireMap().flyTo(opts);
    }

    fitBounds(
        bounds: GeoLeafBounds,
        options?: { padding?: GeoLeafPoint | Record<string, number>; animate?: boolean }
    ): void {
        const mlOpts: FitBoundsOptions = {};
        if (options?.padding) {
            const p = options.padding as Record<string, number>;
            if (typeof p.top === "number" || typeof p.bottom === "number") {
                // MapLibre {top, bottom, left, right} format — pass through
                mlOpts.padding = {
                    top: p.top ?? 0,
                    bottom: p.bottom ?? 0,
                    left: p.left ?? 0,
                    right: p.right ?? 0,
                };
            } else {
                // GeoLeafPoint {x, y} → symmetric conversion
                mlOpts.padding = {
                    top: p.y ?? 0,
                    bottom: p.y ?? 0,
                    left: p.x ?? 0,
                    right: p.x ?? 0,
                };
            }
        }
        if (options?.animate === false) mlOpts.animate = false;
        this._requireMap().fitBounds(toMapLibreBounds(bounds), mlOpts);
    }

    getBounds(): GeoLeafBounds {
        return fromMapLibreBounds(this._requireMap().getBounds());
    }

    // ── Events ────────────────────────────────────────────────────────────────

    /** Handler → event → attached wrapper. See `maplibre-event-wrappers.ts`. */
    private readonly _wrapperMap: EventWrapperMap = createEventWrapperMap();

    on(event: MapEvent, handler: (e: unknown) => void): void {
        attachWrappedHandler(this._requireMap(), this._wrapperMap, event, handler);
    }

    off(event: MapEvent, handler: (e: unknown) => void): void {
        detachWrappedHandler(this._requireMap(), this._wrapperMap, event, handler);
    }

    once(event: MapEvent, handler: (e: unknown) => void): void {
        const map = this._requireMap();
        // MapLibre types `once` as a SINGLE signature returning `this | Promise<any>`
        // (maplibre-gl.d.ts:12010), not as overloads. The promise branch only exists
        // when `listener` is omitted; passing one returns `this` at runtime. `void` is
        // therefore accurate here — there is no promise to await, only an imprecise
        // upstream type.
        void map.once(event, handler as MaplibreEventListener);
    }

    // ── Layers ────────────────────────────────────────────────────────────────

    /** Creates a GeoJSON source + fill/line/circle sub-layers for the given data. */
    addGeoJSONLayer(id: string, data: unknown, options?: GeoLeafLayerOptions): void {
        buildGeoJSONLayer(
            this._requireMap(),
            this._layerRegistry,
            () => this._ensureSentinel(),
            id,
            data,
            options
        );
        // Taxonomy POI icons: the symbol sub-layer's `icon-image` reads `symbolId`
        // (injected by the GeoJSON loader). Ensure the profile sprite + its MapLibre
        // images are registered — idempotent, no-op without symbolId features.
        ensureLayerSpriteIcons(this._map, data);
    }

    /**
     * Adds a native vector-tile source + its styled sub-layers (socle B.1). The
     * `vector-tiles` capability resolves config/style and delegates rendering here,
     * mirroring `addGeoJSONLayer`. Returns the created sub-layer ids for the caller
     * to bind interactions and record in shared state.
     */
    addVectorTileLayer(layerId: string, spec: VectorTileLayerSpec): string[] {
        return buildVectorTileLayer(
            this._requireMap(),
            this._layerRegistry,
            () => this._ensureSentinel(),
            layerId,
            spec
        );
    }

    /** Updates the paint of an existing vector-tile layer's sub-layers. */
    updateVectorTileLayerStyle(
        layerId: string,
        subLayerIds: string[],
        style: VectorTileStyleInput
    ): void {
        applyVectorTileLayerStyle(this._requireMap(), layerId, subLayerIds, style);
    }

    /**
     * Removes all MapLibre layers and the source for the given GeoLeaf layer.
     */
    removeLayer(id: string): void {
        const map = this._requireMap();
        const entry = this._layerRegistry.get(id);
        if (!entry) return;

        for (const subId of entry.subLayerIds) {
            if (map.getLayer(subId)) map.removeLayer(subId);
        }
        if (map.getSource(entry.sourceId)) {
            map.removeSource(entry.sourceId);
        }
        // Cleanup hatch pattern images (prefix-based: gl-hatch-{layerId}-*).
        // `listImages()` is the PUBLIC enumeration API. This used to read
        // `map.style._images`, an engine-private field: it worked, but nothing
        // contractual guaranteed it across engine versions.
        const hatchPrefix = `gl-hatch-${id}-`;
        if (typeof map.listImages === "function") {
            for (const imgId of map.listImages()) {
                if (imgId.startsWith(hatchPrefix)) map.removeImage(imgId);
            }
        }
        this._layerRegistry.unregister(id);
    }

    /** Returns `true` if the layer is registered in the adapter. */
    hasLayer(id: string): boolean {
        return this._layerRegistry.has(id);
    }

    /** Shows all sub-layers for the given GeoLeaf layer. */
    showLayer(id: string): void {
        const map = this._requireMap();
        const subIds = this._layerRegistry.getSubLayerIds(id);
        for (const subId of subIds) {
            if (map.getLayer(subId)) {
                map.setLayoutProperty(subId, "visibility", "visible");
            }
        }
        this._layerRegistry.setVisible(id, true);
    }

    /** Hides all sub-layers for the given GeoLeaf layer. */
    hideLayer(id: string): void {
        const map = this._requireMap();
        const subIds = this._layerRegistry.getSubLayerIds(id);
        for (const subId of subIds) {
            if (map.getLayer(subId)) {
                map.setLayoutProperty(subId, "visibility", "none");
            }
        }
        this._layerRegistry.setVisible(id, false);
    }

    /** Replaces the GeoJSON data of an existing source. */
    updateLayerData(id: string, data: unknown): void {
        const map = this._requireMap();
        const entry = this._layerRegistry.get(id);
        if (!entry) return;
        const source = map.getSource(entry.sourceId) as GeoJSONSourceLike | undefined;
        if (source && typeof source.setData === "function") {
            source.setData(data);
        }
    }

    /**
     * Sets feature-state on a registered source's feature, targeted by its
     * promoted id. Used for reactive paint (POI sync badge, hover/selection halo)
     * without rebuilding the source data. No-op if the source is gone. The source
     * must declare `promoteId` for a string id to resolve.
     */
    setFeatureState(id: string, featureId: string | number, state: Record<string, unknown>): void {
        const map = this._requireMap();
        const sourceId = this._layerRegistry.get(id)?.sourceId ?? id;
        if (!map.getSource(sourceId)) return;
        map.setFeatureState({ source: sourceId, id: featureId }, state);
    }

    /** Applies a style to an existing layer by updating paint properties on each sub-layer. */
    setLayerStyle(id: string, style: GeoLeafStyleOptions): void {
        applyLayerStyle(this._requireMap(), this._layerRegistry, id, style);
    }

    // ── Layer filtering ──────────────────────────────────────────────────────

    /**
     * Applies a filter expression to a registered layer's sub-layers.
     * For cluster groups, filters the unclustered-point layer specifically.
     * Pass `null` to clear the filter.
     */
    setLayerFilter(id: string, filter: unknown): void {
        const map = this._requireMap();

        // Check if this is a cluster group first
        if (this._clusterIds.has(id)) {
            applyPoiFilter(map, id, filter);
            return;
        }

        // Regular GeoJSON layer — apply filter to all sub-layers
        const subLayerIds = this._layerRegistry.getSubLayerIds(id);
        for (const subId of subLayerIds) {
            if (map.getLayer(subId)) {
                map.setFilter(subId, (filter ?? null) as MaplibreFilter);
            }
        }
    }

    /**
     * Sets the zoom range on every sub-layer of a registered layer.
     *
     * Iterates `getSubLayerIds` rather than `subLayerTypes`: only the former carries the
     * cluster sub-layers (they are registered via `customSubLayerIds`), and a cluster
     * left out of the range would keep rendering outside it.
     */
    setLayerZoomRange(id: string, minZoom: number | null, maxZoom: number | null): void {
        const subLayerIds = this._layerRegistry.getSubLayerIds(id);
        applyLayerZoomRange(this._requireMap(), subLayerIds, minZoom, maxZoom);
    }

    // ── Markers ──────────────────────────────────────────────────────────────

    /** Creates a DOM marker at the given position and adds it to the map. */
    createMarker(id: string, position: GeoLeafLatLng, options?: GeoLeafMarkerOptions): void {
        buildMarker(this._requireMap(), this._markers, id, position, options);
    }

    removeMarker(id: string): void {
        dropMarker(this._markers, id);
    }

    updateMarkerPosition(id: string, position: GeoLeafLatLng): void {
        moveMarker(this._markers, id, position);
    }

    /**
     * Returns the native marker registered under `id`, or `null`.
     *
     * `maplibregl.Marker` structurally satisfies `GeoLeafMarkerHandle` (it exposes both
     * `getLngLat()` and `on()`), so the handle needs no wrapper — but the narrow return
     * type keeps the rest of the engine surface out of callers' reach.
     */
    getMarkerHandle(id: string): GeoLeafMarkerHandle | null {
        return this._markers.get(id) ?? null;
    }

    /** Creates a clustered GeoJSON source with cluster circle/symbol layers. */
    async createClusterGroup(id: string, options?: Record<string, unknown>): Promise<void> {
        await buildClusterGroup(
            this._requireMap(),
            this._layerRegistry,
            this._clusterIds,
            id,
            options
        );
    }

    // ── Popups ───────────────────────────────────────────────────────────────

    /** Creates a popup (not opened — call `openPopup()` after). Content must be pre-sanitised. */
    createPopup(content: string | HTMLElement, options?: GeoLeafPopupOptions): unknown {
        const mlOpts: Record<string, unknown> = {};
        if (options?.maxWidth) mlOpts.maxWidth = `${options.maxWidth}px`;
        if (options?.minWidth) mlOpts.minWidth = `${options.minWidth}px`;
        if (options?.maxHeight) mlOpts.maxHeight = `${options.maxHeight}px`;
        if (typeof options?.closeOnClick === "boolean") mlOpts.closeOnClick = options.closeOnClick;
        if (options?.className) mlOpts.className = options.className;

        const popup = new maplibregl.Popup(mlOpts);
        if (typeof content === "string") {
            popup.setHTML(content);
        } else {
            popup.setDOMContent(content);
        }
        return popup;
    }

    openPopup(popup: unknown, position?: GeoLeafLatLng): void {
        const map = this._requireMap();
        const p = popup as MaplibrePopup;
        if (position) {
            p.setLngLat(toMapLibreLngLat(position));
        }
        p.addTo(map);
        this._openPopups.add(p);

        // Auto-remove from tracking when the popup is closed by the user.
        // See the `once()` note above: listener supplied ⇒ returns `this`, not a promise.
        void p.once("close", () => {
            this._openPopups.delete(p);
        });
    }

    closePopup(popup?: unknown): void {
        if (popup) {
            const p = popup as MaplibrePopup;
            p.remove();
            this._openPopups.delete(p);
        } else {
            for (const p of this._openPopups) {
                p.remove();
            }
            this._openPopups.clear();
        }
    }

    // ── Controls ──────────────────────────────────────────────────────────────

    /** Adds a control (HTMLElement or native IControl) at the given position. */
    addControl(control: unknown, position: GeoLeafControlPosition): GeoLeafControl {
        const map = this._requireMap();

        const mlControl = this._resolveControl(control, position);
        const mlPosition = (POSITION_MAP[position] || "top-right") as ControlPosition;
        map.addControl(mlControl, mlPosition);

        const controlId = `ctrl_${++this._controlIdCounter}`;
        this._controls.set(controlId, mlControl);

        return {
            position,
            remove: () => {
                this._map?.removeControl(mlControl);
                this._controls.delete(controlId);
            },
        };
    }

    removeControl(control: GeoLeafControl): void {
        this._assertReady();
        control.remove();
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    latLngToPoint(latlng: GeoLeafLatLng): GeoLeafPoint {
        const pt = this._requireMap().project(toMapLibreLngLat(latlng));
        return { x: pt.x, y: pt.y };
    }

    pointToLatLng(point: GeoLeafPoint): GeoLeafLatLng {
        const ll = this._requireMap().unproject([point.x, point.y]);
        return fromMapLibreLngLat(ll);
    }

    getContainer(): HTMLElement {
        return this._requireMap().getContainer();
    }

    /** Escape hatch — returns the underlying `maplibregl.Map` instance. */
    getNativeMap(): MaplibreMap | null {
        return this._map;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _assertReady(): void {
        if (!this._ready || !this._map) {
            throw new Error("MaplibreAdapter: map is not ready. Call init() first.");
        }
    }

    /**
     * Returns the live MapLibre map after asserting readiness.
     * Centralises the non-null narrowing so callers avoid scattered `!` operators;
     * `_assertReady()` throws before this returns when the map is absent.
     */
    private _requireMap(): MaplibreMap {
        this._assertReady();
        // Safe: `_assertReady()` throws above when `_map` is null.
        return this._map as MaplibreMap;
    }

    private _bindEvents(): void {
        const map = this._requireMap();
        map.on("load", this._handleLoad);
        map.on("zoomstart", this._handleZoomStart);
        map.on("zoomend", this._handleZoomEnd);
        map.on("moveend", this._handleMoveEnd);
    }

    private _resolveControl(control: unknown, _position: GeoLeafControlPosition): MaplibreControl {
        if (control instanceof HTMLElement) {
            return { onAdd: () => control, onRemove: () => {} };
        }
        return control as MaplibreControl;
    }

    // ── Sentinel ─────────────────────────────────────────────────────────────

    private _sentinelCreated = false;
    private _ensureSentinel(): void {
        if (this._sentinelCreated) return;
        const map = this._requireMap();
        if (map.getLayer(SENTINEL_POI)) {
            this._sentinelCreated = true;
            return;
        }
        map.addLayer({
            id: SENTINEL_POI,
            type: "background",
            paint: { "background-opacity": 0 },
        });
        this._sentinelCreated = true;
    }

    /**
     * Builds a `transformStyle` callback that preserves the GeoLeaf-owned sources
     * and layers across a `map.setStyle()` basemap swap, so they survive natively
     * instead of being torn down and re-injected from JS (the former
     * `geoleaf:style:rebuild` dance — audit redundancy #1).
     *
     * Snapshots ownership from the layer registry (GeoJSON sub-layers + sources),
     * the POI cluster ids, and the sentinel z-anchor. Returns `null` when nothing
     * is owned yet (e.g. a switch before any data layer exists), letting the caller
     * fall back to a plain `setStyle()`.
     *
     * Called by the basemap registry immediately before `setStyle()`.
     */
    buildStyleChangeTransform(): StyleTransform | null {
        const layerIds = new Set<string>();
        const sourceIds = new Set<string>();
        for (const layerId of this._layerRegistry.getAllLayerIds()) {
            const entry = this._layerRegistry.get(layerId);
            if (!entry) continue;
            for (const subId of entry.subLayerIds) layerIds.add(subId);
            sourceIds.add(entry.sourceId);
        }
        for (const ids of this._clusterIds.values()) {
            for (const lid of ids.allLayerIds) layerIds.add(lid);
            sourceIds.add(ids.sourceId);
        }
        // The sentinel is added directly (not via the registry) but must be carried
        // over so its z-order boundary between GeoJSON and POI layers is preserved.
        if (this._sentinelCreated) layerIds.add(SENTINEL_POI);
        if (layerIds.size === 0) return null;
        return buildGeoLeafStyleTransform({ layerIds, sourceIds });
    }

    /**
     * Re-registers runtime images wiped by `map.setStyle()`. The `transformStyle`
     * merge (see {@link buildStyleChangeTransform}) preserves sources and layers,
     * but images added via `map.addImage()` (POI sprite icons) are not part of the
     * style spec and are always cleared. Skipped when no profile sprite is present,
     * so sprite-less profiles pay nothing and log no warning.
     *
     * Called by the basemap registry inside the post-swap `style.load` handler.
     */
    reregisterStyleImages(): void {
        if (!this._map || !hasProfileSprite()) return;
        void registerSpriteIcons(this._map).catch((err) =>
            Log.warn("[POI] sprite re-registration failed:", err)
        );
    }

    /** Returns the layer registry (read-only, for popup-tooltip event binding). */
    getLayerRegistry(): MaplibreLayerRegistry {
        return this._layerRegistry;
    }
}
