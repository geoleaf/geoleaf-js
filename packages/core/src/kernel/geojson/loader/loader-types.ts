/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Loader — Shared type definitions
 * Strict interfaces replacing `any` annotations in profile.ts, data.ts, single-layer.ts.
 */

import type { GeoJSONLayerEntry } from "../core-types.js";

// ─── Logger ───────────────────────────────────────────────────────────────────

/**
 * Minimal logger interface used by the GeoJSON loaders.
 * Structurally compatible with {@link LogImplInterface} from the log module.
 */
export interface GeoJSONLoaderLog {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

// ─── Config module ────────────────────────────────────────────────────────────

/** Minimal interface for the Config module accessed by profile loaders. */
export interface ConfigModule {
    getActiveProfile: () => unknown;
    get: (key: string) => unknown;
    /** Active profile's mapping.json config (named per-source blocks), or null. */
    getActiveProfileMapping?: () => Record<string, unknown> | null;
    Profile?: {
        getActiveProfileLayersConfig: () => unknown[] | null;
    };
}

// ─── Taxonomy icon resolver (D2 seam) ─────────────────────────────────────────

/**
 * Minimal structural view of a feature passed to the taxonomy icon resolver:
 * the GeoLeaf layer id (required by the resolver's per-layer binding) and the
 * raw GeoJSON `properties` bag (holding the category / sub-category values).
 */
export interface TaxonomyResolverFeature {
    layerId?: string;
    properties?: Record<string, unknown> | null;
}

/**
 * Structural signature of `GeoLeaf.Taxonomy.resolvePoiIcon`, injected into the
 * loader as an optional dependency. Declared locally — with no import from the
 * `capabilities/taxonomy` module — so the GeoJSON loader stays decoupled and the
 * Lite bundle (where the taxonomy capability is tree-shaken out) never pulls it
 * in. Returns `{ useIcon:false, … }` when no taxonomy applies (the feature's
 * layer is unbound, or its category resolves no icon) — the symbol injector then
 * injects nothing.
 */
export type TaxonomySymbolResolver = (feature: TaxonomyResolverFeature) => {
    useIcon: boolean;
    symbolId: string | null;
};

// ─── GeoJSON shared state ─────────────────────────────────────────────────────

/**
 * Shape of GeoJSONShared.state used in loader functions.
 * `map` and `adapter` are typed `unknown`; callers use `as any` for MapLibre API access.
 */
export interface GeoJSONState {
    map: unknown;
    layerGroup: unknown;
    geoJsonLayer: unknown;
    layers: Map<string, unknown>;
    layerIdCounter: number;
    options: Record<string, unknown>;
    adapter: unknown;
}

// ─── Layer sub-config shapes ──────────────────────────────────────────────────

/** Point clustering configuration block in a layer config. */
export interface ClusteringConfig {
    enabled?: boolean;
    maxClusterRadius?: number;
    disableClusteringAtZoom?: number;
}

/**
 * OGC API Features source configuration.
 * Set on a layer's `data.ogcApi` property to load features from an OGC API
 * Features endpoint instead of a static file or URL.
 */
export interface OgcApiConfig {
    /**
     * Dot-path to the next-page cursor in the response envelope
     * (e.g. `"pagination.next_cursor"`).
     *
     * Consulted BEFORE the standard `links[rel="next"]` relation; when absent, that relation
     * drives pagination alone and nothing changes. It exists because an envelope that paginates
     * by cursor rather than by link relation is otherwise unreachable from a profile — and a
     * profile is the only channel an integrator has.
     *
     * 🛑 **The resolved value is treated as a URL, not as a token.** If it is not an absolute
     * http(s) URL, pagination STOPS and says so. `validateUrl()` is the only anti-SSRF guard on
     * this path; a bare token to re-inject into a query parameter would need a tenth key AND a
     * page bound, neither of which is decided.
     */
    cursorPath?: string;
    /**
     * Base endpoint URL of the OGC API Features service.
     * The collection path may be included here (e.g. `https://api.example.com/collections/roads/items`)
     * or separated via `collectionId`.
     */
    url: string;
    /**
     * OGC API Features collection identifier.
     * When provided, appended to `url` as `/collections/{collectionId}/items`.
     * Ignored when `url` already contains the full items path.
     */
    collectionId?: string;
    /**
     * Bounding box filter applied to each request.
     * Format: `[minLon, minLat, maxLon, maxLat]` (WGS-84).
     * When `autoRefresh` is enabled the current map viewport bbox is used instead.
     */
    bbox?: [number, number, number, number];
    /**
     * Maximum total number of features to accumulate across all pages.
     * Acts as a memory anti-DoS safeguard.
     * @default 10000
     */
    maxFeatures?: number;
    /**
     * Number of features requested per page (`limit` query parameter).
     * @default 1000
     */
    limit?: number;
    /**
     * When `true`, re-fetches features on every `moveend` map event so that
     * the displayed data tracks the current viewport.
     * Requires `bbox` support from the server.
     * @default false
     */
    autoRefresh?: boolean;
    /**
     * Debounce delay in milliseconds applied to `moveend` refreshes.
     * @default 300
     */
    autoRefreshDebounce?: number;
    /**
     * Additional HTTP request headers (e.g. `Authorization: Bearer …`).
     */
    headers?: Record<string, string>;
}

/** Data source configuration block in a layer config (data.vectorTiles / data.ogcApi). */
export interface LayerDataConfig {
    directory?: string;
    file?: string;
    vectorTiles?: Record<string, unknown>;
    /** OGC API Features source — when present, the layer is loaded from an OGC API endpoint. */
    ogcApi?: OgcApiConfig;
    /**
     * Name of a per-source block in mapping.json (e.g. "gbif"). When set, the raw fetched
     * data is normalized to the GeoLeaf POI shape via that block before conversion. (ANO-083)
     * (A legacy inline object form is tolerated by the schema but not consumed here.)
     */
    mapping?: string | Record<string, unknown>;
    /**
     * Dot-path to the items array inside a non-array response (e.g. "results" for the
     * GBIF Occurrence API `{ results: [...] }`). Used with `mapping` to locate the array
     * to normalize. When absent, the response must already be an array.
     */
    itemsPath?: string;
    /**
     * Custom HTTP request headers for a remote `dataUrl` GeoJSON source.
     * Use for content negotiation (e.g. `{ "Accept": "application/geo+json" }` on a
     * server that serves several representations) or other static request headers. When present, the
     * layer is fetched on the main thread (the worker fetch path does not forward
     * per-layer headers); auth headers stay centralized in the Connector plugin.
     */
    headers?: Record<string, string>;
}

/**
 * Loosely-typed layer definition consumed by the single-layer loader pipeline.
 * Extends `Record<string, unknown>` (profile defs carry many optional keys); the
 * fields below are the ones the loader reads directly.
 */
export interface DefLike extends Record<string, unknown> {
    url?: string;
    type?: string;
    zIndex?: number;
    clusterRadius?: number;
    disableClusteringAtZoom?: number;
    clustering?: Record<string, unknown>;
    _profileId?: string;
    _layerDirectory?: string;
    _cachedData?: unknown;
    styles?: { default?: unknown };
    style?: Record<string, unknown>;
    styleRules?: unknown[];
    interactiveShape?: boolean;
    geometry?: string;
    geometryType?: string;
    legends?: unknown;
    fitBoundsOnLoad?: boolean;
    maxZoomOnFit?: number;
    labels?: { enabled?: boolean };
    contentLength?: number;
    showIconsOnMap?: boolean;
}

/** Minimal layer entry shape expected by `_resolveStyleLabels` in profile.ts. */
export interface LayerStyleEntry {
    config?: {
        styles?: unknown;
        labels?: unknown;
    };
    styles?: unknown;
    labels?: unknown;
}

/** Loaded layer result returned by `_loadSingleLayer` / `_processLayerDef`. */
export interface LoadedLayerResult {
    id: string;
    label: string;
    featureCount?: number;
}

// ─── Feature validation module ────────────────────────────────────────────────

/** Minimal interface for the _GeoJSONFeatureValidator runtime module. */
export interface ValidatorModule {
    validateFeatureCollection: (data: unknown) => {
        errors: unknown[];
        validFeatures: unknown[];
    };
}

// ─── Module dependency interfaces (Phase 10-F) ────────────────────────────────

/** GeoJSON layer manager (registerWithLayerManager, updateLayerVisibilityByZoom). */
export interface GeoJSONLayerManagerLike {
    registerWithLayerManager(): void;
    updateLayerVisibilityByZoom(): void;
}

/**
 * Layer manager surface accessed by `core.ts` through the lazy `getLayerManager()`
 * getter — the full CRUD/visibility/style API the aggregator delegates to.
 */
export interface CoreLayerManagerLike extends GeoJSONLayerManagerLike {
    getLayerById(layerId: string): GeoJSONLayerEntry | null;
    getLayerData(layerId: string): unknown;
    getAllLayers(): unknown[];
    showLayer(layerId: string): void;
    hideLayer(layerId: string): void;
    toggleLayer(layerId: string): void;
    removeLayer(layerId: string): void;
    setLayerStyle(layerId: string, styleConfig: unknown): boolean;
    detectLayerType(layer: unknown): string;
}

/** Loader surface accessed by `core.ts` through the lazy `getLoader()` getter. */
export interface CoreLoaderLike {
    loadUrl(url: string, options?: Record<string, unknown>): Promise<unknown>;
    addData(geojsonData: unknown, options?: Record<string, unknown>): void;
    loadFromActiveProfile(options?: Record<string, unknown>): Promise<unknown[]>;
}

/** GeoJSON loader sub-module (single-layer pipeline entry point). */
export interface GeoJSONLoaderLike {
    _loadSingleLayer(
        layerId: string,
        layerLabel: string,
        def: unknown,
        baseOptions: Record<string, unknown>
    ): Promise<{ id: string; label: string; featureCount: number }>;
}

/** GeoJSON layer config manager (style loading, geometry type inference). */
export interface GeoJSONLayerConfigLike {
    loadDefaultStyle(layerId: string, def: unknown): Promise<Record<string, unknown> | null>;
    inferGeometryType?(def: unknown, geojsonData?: unknown): string | null;
}

/** Vector tiles module (early-exit check + load). */
export interface VectorTilesLike {
    shouldUseVectorTiles(def: unknown): boolean;
    loadVectorTileLayer(
        layerId: string,
        layerLabel: string,
        def: unknown,
        baseOptions: Record<string, unknown>
    ): Promise<{ id: string; label: string; featureCount: number }>;
}

/**
 * Minimal interface for the MapLibre map adapter (IMapAdapter).
 * Used to type the `adapter` variable in `_doLoadSingleLayerMapLibre`.
 */
export interface MapAdapterLike {
    addGeoJSONLayer(layerId: string, data: unknown, options: Record<string, unknown>): void;
    getNativeMap(): unknown;
    getLayerRegistry?(): { getSubLayerIds(layerId: string): string[] } | null;
}

/** Core map module — provides map adapter. */
export interface CoreModuleLike {
    getMap?(): MapAdapterLike | unknown;
}

/** Labels module (layer label initialization). */
export interface LabelsLike {
    initializeLayerLabels(layerId: string): void;
}

/** Cluster capability's pure per-layer clustering resolvers (policy, no lifecycle). */
export interface ClusterResolversLike {
    getClusteringStrategy(
        def: unknown,
        geojsonData: unknown
    ): { shouldCluster: boolean; useSharedCluster: boolean };
    applyGeoJSONClusterOptions(
        adapterOptions: Record<string, unknown>,
        def: unknown,
        layerId: string,
        Log: GeoJSONLoaderLog
    ): void;
}

/** Web worker manager for background fetch/parse. */
export interface WorkerManagerLike {
    isAvailable(): boolean;
    fetchText(url: string, layerId: string): Promise<unknown>;
    fetchGeoJSON(url: string, layerId: string, options?: unknown): Promise<unknown>;
}

/** Data converter (format detection, auto-conversion). */
export interface DataConverterLike {
    autoConvert(data: unknown): { type?: string; features?: unknown[] };
}

/** Utilities module (mergeOptions, FetchHelper). */
export interface UtilsModuleLike {
    mergeOptions?<T extends object>(base: T, overrides: Partial<T>): T;
    FetchHelper?: {
        get(url: string, options?: { timeout?: number; retries?: number }): Promise<unknown>;
    };
}

// ─── Service locator for GeoJSON loaders (Phase 10-F) ─────────────────────────

/**
 * Typed service locator for GeoJSON loader modules.
 *
 * Injected once at boot via `setupXxxDeps()` functions exported by each loader.
 * Every getter uses lazy evaluation — the value is resolved at call-time, not
 * at setup-time — so the boot order constraint (B1→B11) is fully respected.
 *
 * Phase 10-F — replaces all `(_g as any).GeoLeaf.*` accesses in loaders.
 */
export interface LoaderDependencies {
    getLayerManager(): GeoJSONLayerManagerLike | undefined;
    getLoader(): GeoJSONLoaderLike | undefined;
    getConfig(): ConfigModule | undefined;
    getFeatureValidator(): ValidatorModule | undefined;
    getLayerConfig(): GeoJSONLayerConfigLike | undefined;
    getVectorTiles(): VectorTilesLike | undefined;
    /** Cluster capability's pure resolvers — same pull-based policy pattern as vector-tiles (S7). */
    getCluster(): ClusterResolversLike | undefined;
    getUtils(): UtilsModuleLike | undefined;
    getCore(): CoreModuleLike | undefined;
    getLabels(): LabelsLike | undefined;
    getWorkerManager(): WorkerManagerLike | undefined;
    getDataConverter(): DataConverterLike | undefined;
    getAllLayerConfigs(): unknown;
    setAllLayerConfigs(configs: unknown): void;
    /**
     * Resolves the layer loader a plugin registered for declarative `plugin:` layers
     * (e.g. flatgeobuf). Returns `undefined` when no plugin handles the given id.
     * Optional — absent on reduced builds that don't wire the plugin registry.
     */
    getPluginLayerLoader?(
        pluginId: string
    ): ((def: Record<string, unknown>) => Promise<string>) | undefined;
    /**
     * Loads the plugin backing `pluginId` when it is registered lazily and not yet loaded;
     * resolves immediately otherwise. Never throws for an unknown id — a layer declaring a
     * plugin nobody provides is a profile error, reported by the caller's own warning, not
     * a boot failure.
     *
     * Exists because `getPluginLayerLoader()` resolves SYNCHRONOUSLY: a lazily registered
     * plugin has not run its `registerLayerLoader()` yet, so the lookup returns `undefined`
     * and the layer is skipped with 0 features. Without this seam, no layer-backing plugin
     * could ever be made lazy — which is precisely what the lazy plugin registrations rely on.
     *
     * Optional — absent on reduced builds that don't wire the plugin registry.
     */
    ensurePluginLoaded?(pluginId: string): Promise<void>;
    /**
     * point feature, or `undefined` when the taxonomy capability is absent (the
     * Lite bundle, or any build without it). Optional — the symbol injector
     * injects no icons when this getter or its value is absent.
     */
    getTaxonomyResolvePoiIcon?(): TaxonomySymbolResolver | undefined;
}
