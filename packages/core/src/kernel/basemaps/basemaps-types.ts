/*!
 * GeoLeaf Core — Basemaps runtime types
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */

/**
 * Structural + config type hub shared by every file under `kernel/basemaps/`.
 *
 * Two kinds of types live here:
 *
 * 1. **Config shapes** — re-exported from the canonical config contract
 *    (`config-types.ts`). Basemap definitions arrive from arbitrary user
 *    profiles, so the registry treats them as `BasemapConfig` and narrows at the
 *    call site. Re-exporting them here gives the module a single import point.
 *
 * 2. **Native-map structural view** (`NativeMap`) — the raw MapLibre GL `Map`
 *    instance manipulated by `registry.ts` and the apply helpers. MapLibre is a
 *    peer dependency loaded at runtime via a `<script>` tag; its spec types
 *    (`SourceSpecification`, `AddLayerObject`, `StyleSpecification`, …) are far
 *    stricter than the loosely-shaped `Record<string, unknown>` specs the
 *    registry builds. Rather than fight the engine's overloads, we expose a
 *    precise structural interface covering exactly the methods the module calls,
 *    with permissive argument types — the same approach already used by
 *    `adapters/maplibre/maplibre-adapter-types.ts` (`GeoJSONSourceLike`,
 *    `ClusterSourceLike`). The genuine `MaplibreMap` type is re-exported
 *    type-only for documentation and accurate provenance.
 *
 * Every `import` from "maplibre-gl" here MUST be `import type` — a value import
 * would pull the engine into the CDN bundle.
 */

import type { Map as MaplibreMap } from "maplibre-gl";

import type {
    BasemapConfig,
    TerrainConfig,
    ImageSourceConfig,
    HillshadeConfig,
    WmtsConfig,
    WmsConfig,
} from "../config/geoleaf-config/config-types.js";
import type { StyleTransform } from "../../adapters/maplibre/maplibre-style-transform.js";

// ─── Config shapes (re-exported) ───────────────────────────────────────────────

export type {
    BasemapConfig,
    TerrainConfig,
    ImageSourceConfig,
    HillshadeConfig,
    WmtsConfig,
    WmsConfig,
    MaplibreMap,
};

/**
 * A basemap definition as handled at runtime by the basemaps module.
 *
 * Extends the canonical {@link BasemapConfig} contract with fields the module
 * reads but which are not part of the public config surface (they originate from
 * provider presets and profile overrides):
 * - `apiKey` / `apiKeyRequired`: tile API-key injection (see `normalizeTilesArray`).
 * - `options`: legacy provider option bag (`attribution`, `maxZoom`).
 * - top-level `demUrl` / `demEncoding` / `demMaxZoom`: hillshade DEM shortcuts
 *   accepted alongside the nested `hillshade.*` form.
 *
 * All extra fields are optional, so every `BasemapConfig` is assignable here.
 */
export interface BasemapDefinition extends BasemapConfig {
    /** Tile-service API key substituted into any `{apikey}` placeholder. */
    apiKey?: string;
    /** When true, the basemap is disabled if `apiKey` is missing (avoids silent 403). */
    apiKeyRequired?: boolean;
    /** Legacy provider option bag carrying `attribution` / `maxZoom`. */
    options?: { attribution?: string; maxZoom?: number; [key: string]: unknown };
    /** Top-level DEM tile URL (hillshade shortcut for `hillshade.demUrl`). */
    demUrl?: string;
    /** Top-level DEM encoding (hillshade shortcut for `hillshade.demEncoding`). */
    demEncoding?: "terrarium" | "mapbox";
    /** Top-level DEM max zoom (hillshade shortcut for `hillshade.demMaxZoom`). */
    demMaxZoom?: number;
}

// ─── Native MapLibre map — structural view ──────────────────────────────────────

/**
 * A minimal MapLibre GL `Style`-like object as returned by `map.getStyle()`.
 * The registry only reads `layers` to find the first existing layer id (so the
 * basemap can be inserted below the data layers).
 */
export interface NativeStyleView {
    layers?: Array<{ id?: string }>;
}

/**
 * A MapLibre source handle as returned by `map.getSource()`. The hillshade
 * builder reads the optional `tiles` array to decide whether the existing
 * `terrain-dem` source can be reused for the hillshade layer.
 */
export interface NativeSourceView {
    tiles?: string[];
    [key: string]: unknown;
}

/**
 * Event object passed to the terrain module DEM error listener. MapLibre emits
 * `error` events carrying an optional `sourceId` and `error` payload; the
 * manager filters on the terrain source id.
 */
export interface NativeMapErrorEvent {
    sourceId?: string;
    error?: { message?: string } | null;
}

/**
 * Structural view of the raw MapLibre GL `Map` as consumed by the basemaps
 * module. Argument types are intentionally permissive (`Record<string, unknown>`
 * specs, generic listeners) because the registry assembles specs dynamically and
 * patches filter expressions in place — the same loose-spec style the module has
 * always used. Backed at runtime by a genuine `maplibregl.Map` (see `MaplibreMap`).
 */
export interface NativeMap {
    addSource(id: string, source: Record<string, unknown>): void;
    addLayer(layer: Record<string, unknown>, before?: string): void;
    removeSource(id: string): void;
    removeLayer(id: string): void;
    getSource(id: string): NativeSourceView | undefined;
    getLayer(id: string): unknown;
    getStyle(): NativeStyleView | undefined;
    setStyle(style: unknown, options?: { diff?: boolean; transformStyle?: StyleTransform }): void;
    setTerrain(options: { source: string; exaggeration?: number } | null): void;
    getFilter(layerId: string): unknown;
    setFilter(layerId: string, filter: unknown): void;
    easeTo(options: { pitch?: number; bearing?: number }): void;
    loaded(): boolean;
    isStyleLoaded(): boolean;
    on(type: string, listener: (e: NativeMapErrorEvent) => void): unknown;
    off(type: string, listener: (e: NativeMapErrorEvent) => void): unknown;
    once(type: string, listener: () => void): unknown;
}

/**
 * An object that wraps a native map and can unwrap it via `getNativeMap()`.
 * Used by `setMap()`/`_acquireNativeMap()` to accept either a raw map or an adapter.
 */
export interface NativeMapHolder {
    getNativeMap(): unknown;
}

/**
 * The subset of `GeoLeaf.Core` the registry reads to resolve the live map and
 * the adapter (for the style transform + image re-registration on vector-style
 * transitions).
 */
export interface BasemapsCoreSurface {
    getMap?: () => NativeMapHolder | null | undefined;
    getAdapter?: () =>
        | {
              buildStyleChangeTransform?: () => StyleTransform | null;
              reregisterStyleImages?: () => void;
          }
        | null
        | undefined;
}

// ─── Registry runtime types ─────────────────────────────────────────────────────

/** Resolved render path for a basemap definition. */
export type BasemapRenderType = "raster" | "vector";

/**
 * A single entry in the in-memory basemap registry (`_baseLayers`).
 *
 * `layer` is a permanent backward-compat tombstone — no MapLibre layer instance
 * is stored (rewrite to the native API). It is always `null`.
 */
export interface BaseLayerEntry {
    key: string;
    label: string;
    definition: BasemapDefinition;
    /** Always `null` — backward-compat tombstone, never a layer instance. */
    layer: null;
}

/**
 * Options accepted by `Baselayers.init()`.
 *
 * Lives in the hub (rather than `index.ts`) so `ui.ts` can reference it without
 * importing `index.ts` — that would create an `index → ui → index` cycle.
 */
export interface BaselayersInitOptions {
    map?: unknown;
    baselayers?: Record<string, unknown>;
    activeKey?: string;
}

/** Options accepted by `setBaseLayer()`. */
export interface SetBaseLayerOptions {
    /** When true, the basemap change does not dispatch `geoleaf:basemap:change`. */
    silent?: boolean;
    [key: string]: unknown;
}

/**
 * `detail` payload of the `geoleaf:basemap:change` `CustomEvent`.
 * `layer` is always `null` (tombstone, see {@link BaseLayerEntry}).
 */
export interface BasemapChangeDetail {
    key: string;
    previousKey: string | null;
    map: NativeMap | null;
    definition: BasemapDefinition;
    layer: null;
    source: "geoleaf.baselayers";
}
