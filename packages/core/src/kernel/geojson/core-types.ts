/*!
 * GeoLeaf Core — GeoJSON runtime types
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */
/**
 * Runtime structural types for the GeoJSON module (state, adapter, native map).
 *
 * These complement the config-time shapes in {@link ./geojson-types} and the
 * loader DI interfaces in {@link ./loader/loader-types}. They are extracted here
 * so `core.ts` (the aggregator facade) and its sub-modules can share one typed
 * view of the shared state without re-declaring `any` locally.
 *
 * All map/adapter surfaces are intentionally minimal & permissive (structural,
 * not the strict `maplibre-gl` types) so the custom GeoLeaf events fired on the
 * map type-check, and so they erase to nothing at build (zero bundle impact).
 */

import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";
import type { SubLayerType } from "../../adapters/maplibre/maplibre-layer-registry.js";
import type {
    GeoJSONFeature,
    GeoJSONLayerOptions,
    GeoJSONStyle,
    GeoJSONStyleRule,
} from "./geojson-types.js";

// ─── Native map (structural MapLibre surface used by the GeoJSON module) ──────

/** Pixel point payload carried by MapLibre pointer events. */
export interface MapPointLike {
    x: number;
    y: number;
}

/** Geographic coordinate payload carried by MapLibre pointer events. */
export interface MapLngLatLike {
    lng: number;
    lat: number;
}

/**
 * Event object passed to map/layer event handlers.
 * Only the fields the GeoJSON module reads are typed; everything else is `unknown`.
 */
export interface MapInteractionEvent {
    features?: GeoJSONFeature[];
    point?: MapPointLike;
    lngLat?: MapLngLatLike;
    originalEvent?: unknown;
    target?: unknown;
    [key: string]: unknown;
}

/** Handler signature for map/layer events. */
export type MapEventHandler = (ev: MapInteractionEvent) => void;

/**
 * Minimal structural view of the native MapLibre `Map` as consumed by the
 * GeoJSON module. Permissive on purpose — custom GeoLeaf events (`geoleaf:*`)
 * are fired through `fire()`, and handler payloads use {@link MapInteractionEvent}.
 */
export interface GeoJSONNativeMap {
    getZoom(): number;
    /** Map centre. Its latitude anchors the scale→zoom conversion (`scaleToZoom`). */
    getCenter(): { lat: number; lng: number };
    getCanvas(): HTMLCanvasElement;
    // Event subscription — 2-arg (map events) and 3-arg (layer events) forms.
    on(type: string, handler: MapEventHandler): void;
    on(type: string, layerId: string, handler: MapEventHandler): void;
    off(type: string, handler: MapEventHandler): void;
    off(type: string, layerId: string, handler: MapEventHandler): void;
    once(type: string, handler: MapEventHandler): void;
    once(type: string, layerId: string, handler: MapEventHandler): void;
    fire(type: string, data?: unknown): unknown;
    fitBounds(bounds: unknown, options?: unknown): void;
    // Sources & layers (MapLibre style API).
    getSource(id: string): unknown;
    addSource(id: string, source: unknown): void;
    removeSource(id: string): void;
    getLayer(id: string): unknown;
    addLayer(layer: unknown, beforeId?: string): void;
    removeLayer(id: string): void;
    setPaintProperty(layerId: string, name: string, value: unknown): void;
    [key: string]: unknown;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

/** Sub-layer id registry exposed by the MapLibre adapter. */
export interface LayerRegistryLike {
    getSubLayerIds(layerId: string): string[];
    /**
     * Registers a layer's sub-layers (z-index ordering / VT bookkeeping).
     * Optional — reduced registries may only expose `getSubLayerIds`.
     */
    register?(
        layerId: string,
        subLayerTypes: SubLayerType[],
        zIndex: number,
        options?: {
            isVectorTile?: boolean;
            sourceLayer?: string;
            customSubLayerIds?: string[];
            customSourceId?: string;
        }
    ): unknown;
}

/**
 * The GeoJSON module's view of the map adapter: the engine-agnostic
 * {@link IMapAdapter} plus the optional MapLibre layer registry accessor.
 */
export type GeoJSONAdapter = IMapAdapter & {
    getLayerRegistry?(): LayerRegistryLike | null;
};

// ─── Layer runtime entry (state.layers value) ─────────────────────────────────

/**
 * Label-rendering config a style file may carry under its `label` key
 * (map-label visibility), as opposed to a plain display-name string.
 * The `label` field of a style file is polymorphic by design (config-contract).
 */
export interface GeoJSONStyleLabelConfig {
    enabled?: boolean;
    visibleByDefault?: boolean;
    [key: string]: unknown;
}

/**
 * A layer's currently-applied style. May be a full style-file object
 * (`{ id, label, style, styleRules }`) or a flat paint object.
 */
export interface GeoJSONCurrentStyle {
    id?: string;
    /**
     * Either the style's display name (string) or a map-label config object —
     * the style-file `label` field is polymorphic. Narrow with `typeof` / a
     * structural cast before reading `enabled` / `visibleByDefault`.
     */
    label?: string | GeoJSONStyleLabelConfig;
    style?: GeoJSONStyle | Record<string, unknown>;
    styleRules?: GeoJSONStyleRule[];
    /**
     * Zoom-visibility window expressed as SCALE DENOMINATORS (1:X), not MapLibre zoom
     * levels — `minScale` is the widest view allowed (the larger number). Absent, or
     * bounds `<= 0`/null, means no constraint. Consumed by `updateLayerVisibilityByZoom`.
     */
    scaleConfig?: { minScale?: number | null; maxScale?: number | null };
    [key: string]: unknown;
}

/** Layer definition / config as stored on a runtime entry (superset of the config-time options). */
export type GeoJSONLayerDef = GeoJSONLayerOptions & {
    zIndex?: number;
    geometry?: string;
    showIconsOnMap?: boolean;
    styleRules?: GeoJSONStyleRule[];
    clusterRadius?: number;
    disableClusteringAtZoom?: number;
};

/**
 * Runtime layer entry stored in `GeoJSONShared.state.layers`.
 *
 * Richer than the config-time {@link ./geojson-types#GeoJSONLayerStateEntry}:
 * it also holds the loaded features, the user-selected style and MapLibre
 * bookkeeping. The index signature keeps ad-hoc bookkeeping fields typed as
 * `unknown` (narrow at the call site) rather than `any`.
 */
export interface GeoJSONLayerEntry {
    id?: string;
    label?: string;
    /** Opaque native layer handle, read by `getAllLayers()`'s featureCount fallback (`layer.getLayers()`). */
    layer?: unknown;
    visible?: boolean;
    config: GeoJSONLayerDef;
    /** Dominant geometry type, cached at load (`"point"`/`"line"`/`"polygon"`/…). */
    geometryType?: string;
    /** Loaded features (a FeatureCollection's `features`). */
    features?: GeoJSONFeature[];
    /** Raw GeoJSON last set via `updateLayerData`. */
    geojson?: unknown;
    /** User-selected / currently-applied style. */
    currentStyle?: GeoJSONCurrentStyle | null;
    clusterGroup?: unknown;
    isVectorTile?: boolean;
    _visibility?: { logicalState?: boolean; current?: boolean; [key: string]: unknown };
    _maplibreSubLayerIds?: string[];
    [key: string]: unknown;
}

/**
 * Shape of `GeoJSONShared.state` — the module's shared mutable state.
 * Use to type `state` parameters across the GeoJSON sub-modules.
 */
export interface GeoJSONSharedState {
    map: GeoJSONNativeMap | null;
    layerGroup: unknown;
    geoJsonLayer: unknown;
    layers: Map<string, GeoJSONLayerEntry>;
    layerIdCounter: number;
    options: Record<string, unknown>;
    adapter: GeoJSONAdapter | null;
}

// ─── init() options ────────────────────────────────────────────────────────────

/** Options accepted by `GeoJSONCore.init()`. */
export interface GeoJSONInitOptions {
    /** Map instance or adapter. Falls back to `GeoLeaf.Core.getMap()` when absent. */
    map?: unknown;
    defaultStyle?: GeoJSONStyle | Record<string, unknown>;
    defaultPointStyle?: Record<string, unknown>;
    onEachFeature?: (feature: GeoJSONFeature, layer: unknown) => void;
    pointToLayer?: (feature: GeoJSONFeature, latlng: unknown) => unknown;
    fitBoundsOnLoad?: boolean;
    maxZoomOnFit?: number;
    [key: string]: unknown;
}
