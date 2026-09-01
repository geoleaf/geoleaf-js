/*!
 * GeoLeaf Core – Config / Types
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Map configuration section
 */
export interface MapConfig {
    /** HTML element ID for the map container. */
    target?: string;
    /** Alias for target (legacy). */
    id?: string;
    /** Geographic bounds: [[south, west], [north, east]]. Required. */
    bounds?: [[number, number], [number, number]];
    /** Initial map center [lat, lng]. */
    center?: [number, number];
    /** Initial zoom level. */
    zoom?: number;
    /** Maximum zoom level. */
    maxZoom?: number;
    /** Minimum zoom level. */
    minZoom?: number;
    /** Alias for maxZoom (legacy). Used by CoreMapModule. */
    initialMaxZoom?: number;
    /** Padding in pixels applied to fitBounds ([top/bottom, left/right]). */
    padding?: [number, number];
    /** When true, restricts panning/zooming to bounds. */
    positionFixed?: boolean;
    /** Degree by which bounds are padded when positionFixed is true. Default 0.3. */
    boundsMargin?: number;
    /** Raw MapLibre GL map options forwarded to the MapLibre Map constructor. */
    mapOptions?: Record<string, unknown>;
}

/**
 * Data configuration section (profiles, mapping, etc.)
 */
export interface DataConfig {
    /** Name of the active profile to load. */
    activeProfile?: string;
    /** Base path to the profiles directory. Default "profiles". */
    profilesBasePath?: string;
    /** Enable POI mapping from active profile. */
    enableProfilePoiMapping?: boolean;
    /**
     * The active profile, handed over in memory instead of being fetched.
     *
     * Carries BOTH on-disk artefacts, mirrored one to one — `profile.json` under `profile`,
     * `profile-bundle.json` under `bundle`. They are two payloads because the bundle does not
     * contain the profile: the compiler writes `_bundleVersion` plus the sections, and the
     * assembly takes the profile as a separate argument. Handing over the bundle alone would
     * leave the `profile.json` request in place.
     *
     * Present ⟹ no HTTP request is issued for the profile's configuration. Absent ⟹ nothing
     * changes: the cascade stays the default path. Data paths are still resolved from
     * `profilesBasePath`; this removes configuration requests, not data ones.
     *
     * ⚠️ The bundle format is confronted but NOT enforced: a `_bundleVersion` other than the
     * expected one produces a warning and the assembly continues. Sections the loader does not
     * know are ignored, and sections it expects may be absent — so an injected bundle built by
     * another version passes, quietly degraded rather than rejected.
     */
    profileBundle?: {
        /** The `profile.json` payload. */
        profile: Record<string, unknown>;
        /** The `profile-bundle.json` payload. */
        bundle: Record<string, unknown>;
    };
    /**
     * Profiles offered by the `profile-switcher` capability.
     *
     * **Generated at deploy time** by `scripts/build-deploy.cjs`, which harvests
     * `{id, displayLabel, icon}` from every `profiles/<id>/profile.json` — never
     * written by hand. A browser cannot enumerate a server directory, so the list
     * has to be baked in; harvesting it from the same loop that copies the profiles
     * is what keeps it from drifting.
     *
     * Absent when the app runs straight from sources (no deploy step): the switcher
     * then renders nothing, which is the intended degradation.
     */
    availableProfiles?: AvailableProfileEntry[];
}

/** One entry of {@link DataConfig.availableProfiles}. */
export interface AvailableProfileEntry {
    /** Profile id — matches the directory name under `profiles/`. */
    id: string;
    /** Short label for the selector (`displayLabel` ?? `label` ?? `id` at harvest time). */
    displayLabel: string;
    /** Optional emoji rendered before the label. */
    icon?: string;
}

/**
 * UI configuration section
 * All flags come from profile.json → ui (or the root geoleaf.config.json → ui).
 */
export interface UIConfig {
    /**
     * Active colour theme.
     * - "light" / "dark": explicit, persisted in localStorage.
     * - "auto": follows prefers-color-scheme; user toggle overrides until localStorage is cleared.
     * Default "auto".
     */
    theme?: "light" | "dark" | "auto" | string;
    /** UI language code (e.g. "fr", "en"). */
    language?: string;
    /** Show the basemap switcher control. Default true. */
    showBaseLayerControls?: boolean;
    /** Show the layer manager panel. Default true. */
    showLayerManager?: boolean;
    /** Show the credential/login button (injected by @geoleaf-plugins/connector plugin). Default false. */
    showCredentialButton?: boolean;
    /** Show the print/export button (requires @geoleaf-plugins/print). Default true. */
    showPrint?: boolean;
    /** Show the measure & annotation button (requires @geoleaf-plugins/measure). Default true. */
    showMeasure?: boolean;
    /** Show the geometry editor button (requires @geoleaf-plugins/editor). Default false. */
    showEditor?: boolean;
    // `showAddPoi`, `showPoiExport` and `showPoiSubmit` are removed. The last two
    // were declared in NO schema while `ui.schema.json` is
    // `additionalProperties: false`: they were unreachable, so their buttons could
    // be neither hidden nor shown. Their equivalents live under
    // `modules.editor.*`, declared — `showAddPoi` and `showExport`.
    [key: string]: unknown;
}

/**
 * `modules.permalink` — URL Permalink / Deep Linking configuration (S13).
 *
 * Serializes the current map state (centre, zoom, visible layers, active filter,
 * theme) into the browser URL so the exact view can be restored on reload or shared.
 * In-core capability, **opt-out** (active unless `enabled: false`). Migrated from the
 * former `ui.permalink` block.
 *
 * @example
 * // config/plugins/permalink.json (or omit entirely to keep the defaults):
 * { "enabled": true, "mode": "hash" }
 */
export interface PermalinkConfig {
    /** Enable URL permalink synchronisation. Opt-out — default `true`. */
    enabled?: boolean;
    /**
     * URL encoding strategy.
     * - `"hash"` (default): state in `window.location.hash` — no server request.
     * - `"query"`: state in `window.location.search` — requires server-side pass-through.
     * - `"compact"`: base64-encoded state in hash — shorter URL, not human-readable.
     */
    mode?: "hash" | "query" | "compact";
    /**
     * Optional facets to include in the serialized state. Default: all of them
     * (layers, taxonomy/tag/rating facets, text filter, theme).
     *
     * ⚠️ The **view state is mandatory** and is not listable here: `lat` / `lng` / `zoom`
     * are always written by `buildUrl` and always required by the parser (a permalink
     * without a view carries nothing to restore). They were part of this union until
     * v2.x but were inert — removing them from the list changed nothing. The whitelist
     * now only holds what it actually gates, and it is enforced on **both** the verbose
     * and the compact (`gl=<base64>`) encodings.
     */
    fields?: Array<
        "layers" | "shownLayers" | "categories" | "tags" | "rating" | "filter" | "theme"
    >;
    /**
     * Share-view sub-feature (copy-link modal + QR code). Opt-out — the share button is
     * shown unless `enabled: false` (S13 F7 — share is a sub-feature of permalink).
     */
    share?: {
        /** Enable the share button + modal. Opt-out — default `true`. */
        enabled?: boolean;
    };
}

/**
 * 3D terrain configuration for a basemap that supports raster-dem elevation rendering.
 * Only applicable to basemaps of type "maplibre" or basemaps with explicit tiles (raster-dem source).
 */
export interface TerrainConfig {
    /** Enables 3D terrain rendering for this basemap. Default: false. */
    enabled: boolean;
    /**
     * URL template for the raster-dem tile source (MNT/DTM tiles).
     * Required when enabled is true.
     * Examples:
     *   - "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"
     *   - "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
     */
    demUrl?: string;
    /** Tile encoding format. Default: "terrarium". */
    demEncoding?: "terrarium" | "mapbox";
    /** Maximum zoom level available for DEM tiles. Default: 15. */
    demMaxZoom?: number;
    /** Vertical exaggeration factor. Default: 1.5. Recommended range: 1.0–3.0. */
    exaggeration?: number;
    /**
     * When true, 3D terrain activates automatically when this basemap is selected.
     * The user can disable it manually. Default: false.
     */
    default3D?: boolean;
    /** Initial camera pitch in degrees applied when 3D terrain is activated. Default: 45. */
    pitch?: number;
    /** Initial camera bearing in degrees applied when 3D terrain is activated. Default: 0. */
    bearing?: number;
}

/**
 * Static image overlay configuration for basemaps with `type: "image"`.
 * The image is rendered at fixed geographic coordinates (georeferenced).
 */
export interface ImageSourceConfig {
    /** URL of the image (raster, not tiled). Supports http/https/data URIs. */
    url: string;
    /**
     * Corner coordinates of the image in geographic [lng, lat] order:
     * `[topLeft, topRight, bottomRight, bottomLeft]`.
     * Defaults to world bounds if omitted or invalid.
     */
    coordinates?: [[number, number], [number, number], [number, number], [number, number]];
    /** Raster opacity (0–1). Default: 1. */
    opacity?: number;
}

/**
 * Hillshade (terrain shadow) configuration for basemaps with `type: "hillshade"`.
 * Uses a `raster-dem` source and a MapLibre `hillshade` render layer.
 */
export interface HillshadeConfig {
    /** DEM tile URL template. Required. E.g. `"https://tiles.example.com/{z}/{x}/{y}.png"`. */
    demUrl: string;
    /** Tile encoding format for the DEM source. Default: `"terrarium"`. */
    demEncoding?: "terrarium" | "mapbox";
    /** Maximum zoom level available for DEM tiles. Default: 15. */
    demMaxZoom?: number;
    /** Hillshade shadow color (CSS color string). Default: MapLibre default. */
    shadowColor?: string;
    /** Hillshade highlight color (CSS color string). Default: MapLibre default. */
    highlightColor?: string;
    /** Hillshade accent color (CSS color string). Default: MapLibre default. */
    accentColor?: string;
    /** Vertical exaggeration intensity (0–1). Default: MapLibre default (0.5). */
    exaggeration?: number;
    /** Sun illumination direction in degrees clockwise from north. Default: 335. */
    illuminationDirection?: number;
    /** Whether illumination is relative to the viewport or fixed to the map. Default: `"viewport"`. */
    illuminationAnchor?: "viewport" | "map";
}

/**
 * WMTS (Web Map Tile Service) configuration for basemaps with `type: "wmts"`.
 * GeoLeaf fetches the GetCapabilities XML, parses it, and builds an XYZ tile URL.
 * The resolved URL is cached in memory for subsequent basemap activations.
 */
export interface WmtsConfig {
    /** Full URL to the WMTS GetCapabilities XML document. Required. */
    getCapabilitiesUrl: string;
    /**
     * Target WMTS layer identifier (value of `<ows:Identifier>`).
     * Uses the first available layer when omitted.
     */
    layer?: string;
    /**
     * Target TileMatrixSet identifier (e.g. `"PM"`, `"GoogleMapsCompatible"`).
     * Uses the first available TileMatrixSet when omitted.
     */
    tileMatrixSet?: string;
    /** Tile image MIME type (e.g. `"image/png"`, `"image/jpeg"`). Default: `"image/png"`. */
    format?: string;
}

/**
 * WMS (Web Map Service) configuration for basemaps with `type: "wms"`.
 * GeoLeaf builds a MapLibre raster source URL using `{bbox-epsg-3857}` templating.
 * No network request is made at registration time.
 */
export interface WmsConfig {
    /** WMS service base URL (without query string). Required. */
    url: string;
    /** Comma-separated WMS layer names. Required. */
    layers: string;
    /** WMS version string. Default: `"1.3.0"`. */
    version?: string;
    /** Coordinate reference system. Default: `"EPSG:3857"`. */
    crs?: string;
    /** Tile image MIME type. Default: `"image/png"`. */
    format?: string;
    /** Tile size in pixels. Default: 256. */
    tileSize?: number;
    /** Request transparent background. Default: `true`. */
    transparent?: boolean;
    /** Comma-separated style names. Default: `""`. */
    styles?: string;
}

/**
 * Basemap (tile or vector) configuration entry.
 * Used as values in GeoLeafConfig.basemaps record.
 */
export interface BasemapConfig {
    /** Unique basemap key (mirrors the record key). */
    id?: string;
    /** Display label shown in the basemap switcher. */
    label?: string;
    /**
     * Basemap rendering type.
     * - `"tile"` / `"raster"`: XYZ raster tiles (default when `url` or `tiles` are set).
     * - `"maplibre"`: MapLibre GL vector style (requires `style`).
     * - `"image"`: Static georeferenced image overlay (requires `imageSource`).
     * - `"hillshade"`: Hillshade terrain shading (requires `hillshade.demUrl`).
     * - `"wmts"`: WMTS tile service via GetCapabilities (requires `wmts.getCapabilitiesUrl`).
     * - `"wms"`: WMS tile service (requires `wms.url` and `wms.layers`).
     */
    type?: "tile" | "maplibre" | "image" | "hillshade" | "wmts" | "wms" | string;
    /** Tile URL template, e.g. "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png". */
    url?: string;
    /** Fallback tile URL when MapLibre GL is unavailable. */
    fallbackUrl?: string;
    /** Map attribution string (HTML allowed). */
    attribution?: string;
    /** Minimum zoom level. */
    minZoom?: number;
    /** Maximum zoom level. */
    maxZoom?: number;
    /** MapLibre GL style URL (only for type: 'maplibre'). */
    style?: string;
    /** Tile subdomains, e.g. "abc" or ["a", "b", "c"]. */
    subdomains?: string | string[];
    /** Explicit tiles array for MapLibre raster sources (overrides {s} subdomain template). */
    tiles?: string[];
    /** Tile size in pixels. Default 256. */
    tileSize?: number;
    /** When true, this basemap is active on startup. */
    defaultBasemap?: boolean;
    /** When true, this basemap supports offline tile caching. */
    offline?: boolean;
    /** Geographic bounds for offline caching. */
    offlineBounds?: { north: number; south: number; east: number; west: number };
    /** Minimum zoom level to cache offline. */
    cacheMinZoom?: number;
    /** Maximum zoom level to cache offline. */
    cacheMaxZoom?: number;
    /** 3D terrain / raster-dem configuration for this basemap. */
    terrain?: TerrainConfig;
    /** Static image overlay configuration. Required when `type: "image"`. */
    imageSource?: ImageSourceConfig;
    /** Hillshade terrain-shading configuration. Required when `type: "hillshade"`. */
    hillshade?: HillshadeConfig;
    /** WMTS service configuration. Required when `type: "wmts"`. */
    wmts?: WmtsConfig;
    /** WMS service configuration. Required when `type: "wms"`. */
    wms?: WmsConfig;
}

/**
 * Layer reference entry in the profile layers array.
 * Points to a per-layer JSON config file loaded at runtime.
 */
export interface LayerConfig {
    /** Unique layer ID used throughout the app. */
    id?: string;
    /** Direct GeoJSON / tile URL (alternative to configFile). */
    url?: string;
    /** Internal name (legacy). Prefer label. */
    name?: string;
    /** Display label shown in the layer manager. */
    label?: string;
    /** Relative path to the layer's JSON config file. */
    configFile?: string;
    /** Layer manager group/panel ID this layer belongs to. */
    layerManagerId?: string;
    /** Whether the layer is visible on startup. Default true. */
    visible?: boolean;
    /** Active style ID applied to this layer. */
    style?: string;
    [key: string]: unknown;
}

/**
 * Profile.json structure (metadata for a business profile)
 */
export interface ProfileConfig {
    id: string;
    name?: string;
    layers?: LayerConfig[] | string[];
    /** Path to a pre-bundled JSON file containing all profile resources (layers, styles, taxonomy, etc.). */
    bundleFile?: string;
    [key: string]: unknown;
}

/** Security options. */
export interface SecurityConfig {
    /** When true, validateUrl() rejects http: and allows only https: and data: (images). Default false. */
    httpsOnly?: boolean;
}

/** Logging / verbosity configuration. */
export interface LoggingConfig {
    /** Minimum log level. Default "info". */
    level?: "debug" | "info" | "warn" | "error" | "production";
}

// `PwaConfig` removed in S5 (optimisation KERNEL). It described a root-level `pwa` block
// that `GeoLeafConfig` stopped declaring when the config moved to `modules.pwa` (commit
// 56a6e260, S14 Phase A) — the interface outlived its only field and was referenced by
// nothing. The PWA config FORM is very much alive (`profiles/geoleaf.config.json` →
// `modules.pwa`); its authoritative schema is now the capability's own declaration in
// `capabilities/pwa/pwa-capability.ts`.

/**
 * Root GeoLeaf configuration object (JSON shape)
 */
export interface GeoLeafConfig {
    map?: MapConfig;
    data?: DataConfig;
    ui?: UIConfig;
    /** Security options (e.g. httpsOnly for production). */
    security?: SecurityConfig;
    /** Logging verbosity. */
    logging?: LoggingConfig;
    /** Named basemap definitions, keyed by basemap ID. */
    basemaps?: Record<string, BasemapConfig>;
    /** GeoJSON / vector layer references loaded from configFile paths. */
    layers?: LayerConfig[];
    /**
     * Per-plugin configuration blocks, keyed by module id (Plugin Contract
     * v1, INV-CONFIG) — e.g. `modules.offline`, `modules.editor`,
     * `modules.print`. The keys inside each block belong to the owning
     * plugin/capability; the core treats them as opaque.
     *
     * ⚠️ This example cited `modules.addpoi` until 17/08/2026: that plugin MERGED
     * into `editor`, and the key it named can no longer be read by anyone. A
     * canonical example designating a vanished module gets copied around.
     */
    modules?: Record<string, Record<string, unknown>>;
    /** Layer manager panel configuration (e.g. title). */
    layerManagerConfig?: Record<string, unknown>;
    /** Performance tuning options. */
    performance?: Record<string, unknown>;
    /** Enable verbose debug logging. */
    debug?: boolean;
    /** Runtime cache of loaded profile payloads, keyed by profileId. Populated by ProfileModule. */
    profiles?: Record<string, unknown>;
    // `routes?: unknown[]` removed in S5 (optimisation KERNEL): nothing read or wrote
    // `config.routes`, and its TSDoc ("Populated at runtime by ProfileModule") pointed at a
    // homonym on a DIFFERENT type — `ProfileDataPayload.routes` in profile.ts. The top-level
    // `routes[]` array was already announced as removed to integrators (guide de configuration,
    // §BREAKING); only the declaration had survived.
}

/**
 * Options for Config.init()
 */
export interface ConfigInitOptions {
    config?: GeoLeafConfig;
    url?: string;
    headers?: Record<string, string>;
    strictContentType?: boolean;
    autoEvent?: boolean;
    onLoaded?: (config: GeoLeafConfig) => void;
    onError?: (err: Error) => void;
    profileId?: string;
}

/**
 * Options for loadUrl / fetch
 */
export interface LoadUrlOptions {
    headers?: Record<string, string>;
    strictContentType?: boolean;
}

/**
 * The COMPLETE `GeoLeaf.Config` façade — single source of truth for its shape.
 *
 * ⚠️ The singleton is assembled in two stages, which is why this type exists.
 * `config-core.ts` builds an object literal carrying only the lifecycle core; three sibling
 * modules then graft the rest onto it at import time, as side effects
 * (`globals.config.ts` imports them for that purpose alone):
 *
 * | Module                 | Grafts                                                    |
 * | ---------------------- | --------------------------------------------------------- |
 * | `config-accessors.ts`  | `getAll` `get` `getModuleConfig` `set` `getSection` `getActiveProfile*` `isProfilePoiMappingEnabled` |
 * | `config-loaders.ts`    | `loadUrl` `loadActiveProfileResources`                    |
 * | `config-validation.ts` | `_validateConfig`                                         |
 *
 * Before S5 each grafting module redeclared its own partial interface and reached the
 * singleton through an `as unknown as` cast — four declarations that ignored one another,
 * two of them redeclaring `_config`, and no type anywhere describing a complete `Config`.
 * They now all target this one. The single remaining widening cast lives in
 * `config-core.ts`, where the two-stage assembly actually happens.
 */
export interface ConfigFacade {
    // ─── Lifecycle core — implemented by the config-core.ts literal ───
    _config: GeoLeafConfig;
    _isLoaded: boolean;
    _subModulesInitialized: boolean;
    _source: string | null;
    _options: { autoEvent: boolean };
    /**
     * Loads the configuration and brings the sub-modules up.
     *
     * Three paths, in this order of precedence: an inline `config` is applied synchronously; a
     * `url` is fetched; neither yields an empty configuration rather than an error — a map can
     * boot with defaults. `onLoaded` fires on all three, and the DOM event only when
     * `autoEvent` is left on.
     *
     * @example
     * ```ts
     * await GeoLeaf.Config.init({
     *     url: "../data/geoleaf.config.json",
     *     autoEvent: true,
     *     onLoaded: (config) => {
     *         console.log("Config loaded:", config);
     *     },
     * });
     * ```
     */
    init(options?: ConfigInitOptions): Promise<GeoLeafConfig>;
    isLoaded(): boolean;
    getSource(): string | null;
    _initSubModules(): void;
    _applyConfig(cfg: Record<string, unknown> | null, source: string): void;
    _maybeFireLoadedEvent(): void;

    // ─── Grafted by config-accessors.ts ───
    /**
     * The complete configuration currently loaded.
     *
     * ⚠️ Through the ambient global, this returns a loose record: `GeoLeafGlobal.Config` is
     * hand-typed and declares `getAll(): Record<string, unknown>`, not {@link GeoLeafConfig}.
     * To read a field with its real type, use {@link ConfigFacade.get} — which is generic — or
     * import `Config` from `@geoleaf/core/kernel`. Typing the ambient member from this
     * interface only ever shrinks — never widened back.
     *
     * @example
     * ```ts
     * const config = GeoLeaf.Config.getAll();
     * console.log(Object.keys(config));
     * ```
     */
    getAll(): GeoLeafConfig;
    /**
     * Reads one field by dotted path, with a fallback when it is absent.
     *
     * @example
     * ```ts
     * const theme = GeoLeaf.Config.get("ui.theme", "light");
     * const zoom = GeoLeaf.Config.get("map.zoom", 10);
     * ```
     */
    get<T = unknown>(path: string, defaultValue?: T): T;
    getModuleConfig<T = unknown>(moduleId: string, key?: string, defaultValue?: T): T;
    set(path: string, value: unknown): void;
    getSection(sectionName: string, defaultValue?: unknown): unknown;
    getActiveProfileId(): string | null;
    /**
     * The active profile object, as resolved by `ProfileManager`, or `null` when none is active.
     *
     * @example
     * ```ts
     * const profile = GeoLeaf.Config.getActiveProfile();
     * if (profile) {
     *     console.log("active profile loaded");
     * }
     * ```
     */
    getActiveProfile(): Record<string, unknown> | null;
    getActiveProfileMapping(): Record<string, unknown> | null;
    isProfilePoiMappingEnabled(): boolean;

    // ─── Grafted by config-loaders.ts ───
    /**
     * Fetches a JSON configuration and applies it.
     *
     * 🔻 **Failure REJECTS, since 20/08/2026 — and this sentence said the exact opposite.**
     * It read « Failure is contained, not thrown: […] a bad fetch degrades the map rather than
     * breaking its boot ». That was true until the loader's `catch` was changed to re-throw, and
     * the sentence was not updated with it: for a few hours a published `.d.ts` promised an
     * integrator the inverse of what the runtime did. No gate can catch that — nothing checks
     * whether a sentence is still true.
     *
     * An unreachable URL, invalid JSON, or a response that is not `application/json` when
     * `strictContentType` is set: the cause is logged, then the promise REJECTS. The boot stops
     * instead of continuing on an empty configuration and rendering a blank map under a
     * "Configuration loaded successfully" message.
     *
     * ⚠️ **Breaking for a caller that relied on the degradation** — even without knowing it.
     * If the configuration is already in memory, `GeoLeaf.boot({ config })` removes the request
     * entirely and the question does not arise.
     *
     * @throws When the fetch fails, the payload is not valid JSON, or `strictContentType`
     *   rejects the response's content type.
     * @example
     * ```ts
     * await GeoLeaf.Config.loadUrl("../data/config.json", {
     *     headers: { Authorization: "Bearer token" },
     * });
     * ```
     */
    loadUrl(url: string, options?: LoadUrlOptions): Promise<GeoLeafConfig>;
    loadActiveProfileResources(options?: {
        headers?: Record<string, string>;
        strictContentType?: boolean;
    }): Promise<GeoLeafConfig>;

    // ─── Grafted by config-validation.ts (optional: absent until that module is imported) ───
    _validateConfig?: (cfg: GeoLeafConfig | null | undefined) => void;
}

/** What the `config-core.ts` literal implements on its own — the rest is grafted. */
export type ConfigCoreShape = Omit<
    ConfigFacade,
    | "getAll"
    | "get"
    | "getModuleConfig"
    | "set"
    | "getSection"
    | "getActiveProfileId"
    | "getActiveProfile"
    | "getActiveProfileMapping"
    | "isProfilePoiMappingEnabled"
    | "loadUrl"
    | "loadActiveProfileResources"
>;
