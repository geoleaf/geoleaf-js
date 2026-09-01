/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf App – Feature Module Initializers
 * Extracted from app/init.js (Phase 8.2.3)
 * Each function initializes one feature domain after secondary modules are loaded.
 */

import type {
    DesktopPanelBuilderContext,
    FeatureInitContext,
    GeoJSONInitContext,
    MobileToolbarBuilderContext,
} from "./app-types.js";
import { asFn, member } from "./app-types.js";
import type { IMapAdapter } from "../contracts/map-adapter.contract.js";
import { asObject } from "../utils/general/type-guards.js";
import type { BasemapConfig, GeoLeafConfig } from "../kernel/config/geoleaf-config/config-types.js";

/**
 * Resolves the native maplibregl.Map from the IMapAdapter, falling
 * back to `GeoLeaf.Core.getMap().getNativeMap()` and finally the raw map value.
 * Extracted from `initBasemaps` to keep it within the function-length budget.
 */
function _resolveNativeMap(GeoLeaf: GeoLeafGlobal, map: IMapAdapter | null): unknown {
    if (map && typeof map.getNativeMap === "function") {
        return map.getNativeMap();
    }
    // Fallback: GeoLeaf.Core.getMap().getNativeMap() — both must be called as BOUND
    // methods (a detached `getMap()` loses `this` and throws while reading the current
    // instance's `_map`), and only lazily when the adapter path above is unavailable.
    const core = GeoLeaf.Core as { getMap?(): unknown } | undefined;
    const coreMap = (typeof core?.getMap === "function" ? core.getMap() : null) as {
        getNativeMap?(): unknown;
    } | null;
    if (coreMap && typeof coreMap.getNativeMap === "function") {
        return coreMap.getNativeMap() ?? map;
    }
    return map;
}

/**
 * Initialize base tile layers from profile cfg.basemaps.
 * @param deps Shared boot dependencies passed by `initApp`.
 */

export function initBasemaps({ GeoLeaf, cfg, map, AppLog }: FeatureInitContext) {
    const baseLayersModule = asObject(GeoLeaf.BaseLayers || GeoLeaf.Baselayers);
    const baseLayersInit = asFn(baseLayersModule?.init);
    if (!baseLayersInit) {
        AppLog.warn("BaseLayers module not found.");
        return;
    }

    // Resolve native maplibregl.Map from the IMapAdapter.
    // Fallback to the raw map value for legacy paths.
    const nativeMap = _resolveNativeMap(GeoLeaf, map);

    let activeKey = "street";
    const basemapsCfg = cfg.basemaps;
    const basemapsFromConfig: Record<string, Record<string, unknown>> = {};
    if (basemapsCfg && typeof basemapsCfg === "object") {
        // entries() rather than keys() + lookup: the value arrives typed, with no indexed read
        // to widen. This callback sits exactly at the complexity ceiling (20), so the fix had
        // to cost zero branches (qualite Q5).
        Object.entries(basemapsCfg).forEach(function ([key, def]: [string, BasemapConfig]) {
            if (def.defaultBasemap === true) activeKey = def.id || key;
            const entry: Record<string, unknown> = {
                id: def.id || key,
                label: def.label || key,
                url: def.url || def.fallbackUrl,
                options: {
                    minZoom: def.minZoom || 0,
                    maxZoom: def.maxZoom || 19,
                    attribution: def.attribution || "",
                },
            };
            // MapLibre vector basemap support
            if (def.type) entry.type = def.type;
            if (def.style) entry.style = def.style;
            if (def.attribution) entry.attribution = def.attribution;
            // Propagate minZoom/maxZoom at top level for MapLibre path
            if (typeof def.minZoom === "number") entry.minZoom = def.minZoom;
            if (typeof def.maxZoom === "number") entry.maxZoom = def.maxZoom;
            // Native tiles array and subdomain config for MapLibre raster sources
            if (Array.isArray(def.tiles) && def.tiles.length > 0) entry.tiles = def.tiles;
            if (def.subdomains) entry.subdomains = def.subdomains;
            if (typeof def.tileSize === "number") entry.tileSize = def.tileSize;
            // 3D terrain configuration
            if (def.terrain) entry.terrain = def.terrain;
            // WMTS configuration (IGN and other WMTS providers)
            if (def.wmts) entry.wmts = def.wmts;

            basemapsFromConfig[key] = entry;
        });
    }

    try {
        baseLayersInit.call(baseLayersModule, {
            map: nativeMap,
            baselayers: basemapsFromConfig,
            activeKey: activeKey,
            ui: cfg.ui,
            basemaps: cfg.basemaps,
        });
    } catch (e) {
        AppLog.warn("BaseLayers.init threw an exception:", e);
    }
}

/**
 * Wires the boot toast + the LayerManager population pipeline. F2/S8: the theme-selector
 * UI moved to the `theme-selector` capability (mounted on `geoleaf:app:ready`) and the
 * default theme is applied by `ThemeEngineModule` — neither runs here anymore.
 * @param deps Shared boot dependencies passed by `initApp`.
 */
export function initGeoJSON({ GeoLeaf, map, AppLog, _app }: GeoJSONInitContext) {
    // F0 (S8): GeoLeaf.GeoJSON.init() + profile layer loading were moved to
    // GeoJSONModule.init() (registry, phase B5) so the layer registry is HOT before the
    // theme applier below runs (it now takes the TOGGLE branch, never ADD). This function
    // keeps only the boot toast wiring + the ThemeSelector / LayerManager pipeline.

    // `geoleaf:geojson:layers-loaded` is a custom adapter event (not a standard
    // MapEvent), so `map.on` is accessed generically to bypass the narrow token type.
    const mapOn = asFn(member(map, "on"));
    if (mapOn) {
        mapOn.call(map, "geoleaf:geojson:layers-loaded", function (event: unknown) {
            // Read `count` at the TOP LEVEL, not under `.detail`.
            //
            // `loader/profile.ts` emits via `map.fire(type, { count, layers })`, and
            // MapLibre merges that payload into the event object itself. The adapter does
            // not re-wrap it either: `on()` delegates to `attachWrappedHandler`
            // (adapters/maplibre/maplibre-event-wrappers.ts), whose only job is to
            // normalise `lngLat → latlng`. No `detail` envelope is ever created.
            //
            // Reading `event.detail.count` — the DOM CustomEvent shape — therefore never
            // matched, and the `typeof count === "number"` guard below turned the miss into
            // a silent non-event: the boot toast never fired, and nothing said so.
            const count = asObject(event)?.count;
            if (typeof count === "number") {
                const message =
                    count === 1 ? "1 GeoJSON layer loaded" : count + " GeoJSON layers loaded";
                const showNotification = asFn(member(_app, "showNotification"));
                if (showNotification) {
                    showNotification.call(_app, message, 3000);
                }
            }
        });
    }

    // Theme system initialization
    // B5 [ESM-02]: IIFE replaced by named function — scoping unnecessary in ESM
    function buildLoadAllConfigsPromise(): Promise<unknown> {
        const loader = asObject(GeoLeaf._GeoJSONLoader);
        const loadAllLayersConfigs = asFn(loader?.loadAllLayersConfigsForLayerManager);
        if (loadAllLayersConfigs) {
            const config = asObject(GeoLeaf.Config);
            const getActiveProfile = asFn(config?.getActiveProfile);
            const activeProfile = getActiveProfile ? getActiveProfile.call(config) : null;
            if (activeProfile) {
                // Bind via .call and call .catch as a BOUND method — extracting it via
                // asFn(...) would detach `this` (a Promise's .catch needs its receiver).
                const result = loadAllLayersConfigs.call(loader, activeProfile) as
                    { catch?(onRejected: (err: unknown) => unknown): Promise<unknown> } | undefined;
                if (result?.catch) {
                    return result.catch((err: unknown) => {
                        AppLog.warn("Error loading layer configs:", err);
                        return [];
                    });
                }
                return Promise.resolve(result);
            }
        }
        return Promise.resolve();
    }
    const loadAllConfigsPromise = buildLoadAllConfigsPromise();

    // D4/F2: LayerManager population is a KERNEL concern — it runs regardless of the
    // (gated) theme-selector capability. `activeThemeConfig` is `null` (the historical
    // `getActiveTheme()` was always undefined → always null), so no selector dependency.
    // The theme-selector UI moved to `capabilities/theme-selector/lifecycle.ts` (mounted
    // on `geoleaf:app:ready`); the default theme is applied by ThemeEngineModule.
    function populateLayerManager(): void {
        const layerManager = asObject(GeoLeaf._GeoJSONLayerManager);
        const populate = asFn(layerManager?.populateLayerManagerWithAllConfigs);
        if (populate) {
            populate.call(layerManager, null);
        }
    }

    loadAllConfigsPromise
        .then(function () {
            // Initial populate once the layer configs are loaded (every profile, themed or
            // not), then re-sync on each theme switch. `populateLayerManagerWithAllConfigs`
            // registers by id (idempotent), so a boot apply that also lands on the listener
            // is a harmless no-op-equivalent — end state unchanged.
            populateLayerManager();
            document.addEventListener("geoleaf:theme:applied", populateLayerManager);
        })
        .catch(function (e: unknown) {
            AppLog.error("Error initializing GeoJSON LayerManager pipeline:", e);
        });
}

/**
 * Builds the mobile-toolbar sheet-title map (only present titles). Helper for
 * initUIPanels — keeps the conditional spreads out of the orchestrator (S6 B.6).
 */
function _buildSheetTitles(cfg: GeoLeafConfig) {
    const searchTitle = member(cfg.modules?.filter, "title");
    const layersTitle = member(cfg.layerManagerConfig, "title");
    const legendTitle = member(cfg.modules?.legend, "title");
    return {
        ...(searchTitle ? { filters: searchTitle } : {}),
        ...(layersTitle ? { layers: layersTitle } : {}),
        ...(legendTitle ? { legend: legendTitle } : {}),
    };
}

/**
 * Builds the option bag for GeoLeaf.UI.initMobileToolbar. Helper for initUIPanels
 * (S6 B.6) — the `ui` defaults are read once to keep complexity low.
 */
function _buildMobileToolbarOptions({ GeoLeaf, cfg, map, glMain }: MobileToolbarBuilderContext) {
    const ui = cfg?.ui ?? {};
    return {
        glMain,
        map,
        // `showAddPoi` and `poiAddDefaultPosition` left with the button. The
        // second was a PLUGIN config key (`modules.addpoi.defaultPosition`) read
        // by the kernel; both now live under `modules.editor`, with their reader.
        // Toolbar geoloc button follows the in-core `geolocation` capability gate (opt-out),
        // migrated from `ui.showGeolocation`.
        showGeolocation: cfg.modules?.geolocation?.enabled !== false,
        showThemeSelector: cfg.modules?.["theme-selector"]?.enabled !== false,
        showFilterPanel: cfg.modules?.filter?.enabled !== false,
        showLayerManager: ui.showLayerManager !== false,
        showLegend: cfg.modules?.legend?.enabled !== false,
        sheetTitles: _buildSheetTitles(cfg),
        getFilterActiveState: () => GeoLeaf.Filter?.hasActiveFilters?.() ?? false,
        onResetFilters: () => GeoLeaf.Filter?.reset?.(),
    };
}

/**
 * Builds the option bag for GeoLeaf.UI.initDesktopPanel. Helper for initUIPanels (S6 B.6).
 */
function _buildDesktopPanelOptions({ GeoLeaf, cfg, glMain }: DesktopPanelBuilderContext) {
    const ui = cfg?.ui ?? {};
    return {
        glMain,
        titleFilters: member(cfg.modules?.filter, "title"),
        titleLayers: member(cfg.layerManagerConfig, "title"),
        titleLegend: member(cfg.modules?.legend, "title"),
        showFilters: cfg.modules?.filter?.enabled !== false,
        showLayers: ui.showLayerManager !== false,
        showLegend: cfg.modules?.legend?.enabled !== false,
        getFilterActiveState: () => GeoLeaf.Filter?.hasActiveFilters?.() ?? false,
    };
}

/**
 * Initialize mobile toolbar pill bar and desktop right panel.
 * @param deps Shared boot dependencies passed by `initApp`.
 */
export function initUIPanels({ GeoLeaf, cfg, map, AppLog }: FeatureInitContext) {
    // Mobile utilities pill bar + sheet (Phase 2 Mobile Friendly)
    const initMobileToolbar = asFn(member(GeoLeaf.UI, "initMobileToolbar"));
    if (initMobileToolbar) {
        try {
            const glMain = document.querySelector(".gl-main") as HTMLElement | null;
            if (glMain) {
                initMobileToolbar.call(
                    GeoLeaf.UI,
                    _buildMobileToolbarOptions({ GeoLeaf, cfg, map, glMain })
                );
                AppLog.log("Mobile pill bar and sheet initialized.");
            }
        } catch (e) {
            AppLog.warn("Error initializing mobile pill bar:", e);
        }
    }

    // Persistent right sidebar for desktop (>= 1440px) (Phase 9 Mobile Friendly)
    const initDesktopPanel = asFn(member(GeoLeaf.UI, "initDesktopPanel"));
    if (initDesktopPanel) {
        try {
            const glMainDesktop = document.querySelector(".gl-main") as HTMLElement | null;
            if (glMainDesktop) {
                initDesktopPanel.call(
                    GeoLeaf.UI,
                    _buildDesktopPanelOptions({ GeoLeaf, cfg, glMain: glMainDesktop })
                );
                AppLog.log("Right desktop sidebar initialized.");
            }
        } catch (e) {
            AppLog.warn("Error initializing right desktop panel:", e);
        }
    }
}
