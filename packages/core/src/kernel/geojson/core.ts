/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Module - Aggregator — main module delegating to sub-modules.
 *
 * Architecture Phase 3.5:
 * - geojson/shared.js        : Shared state, constants, STYLE_OPERATORS
 * - geojson/style-resolver.js: styleRules evaluation
 * - geojson/layers/   : Layer management (show/hide/toggle/remove)
 * - geojson/loader/          : Loading (loadUrl, loadFromActiveProfile)
 * - geojson/popup-tooltip.js : Unified popups and tooltips
 */

"use strict";

import { Log } from "../../utils/log/index.js";
import { GeoJSONShared as SharedModule } from "./shared.ts";
import {
    _resolveGeometryFilteredIds,
    _applyFeatureVisibilityForLayer,
    getFeatures as _getFeatures,
} from "./geojson-filter.js";
import { dispatchGeoLeafEvent } from "../events/event-bus.js";
import {
    evaluateStyleCondition,
    getFeatureProperty,
    getGeometryType,
    isPointGeometry,
    isLineGeometry,
    isPolygonGeometry,
    validateFeature,
    validateFeatureCollection,
    extractCoordinates,
    calculateBounds,
} from "./geojson-utils.ts";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { bindZoomRangeSync } from "./layers/zoom-range-sync.js";
import type {
    GeoJSONAdapter,
    GeoJSONInitOptions,
    GeoJSONLayerDef,
    GeoJSONLayerEntry,
    GeoJSONNativeMap,
    GeoJSONSharedState,
} from "./core-types.js";
import type { GeoJSONFeature } from "./geojson-types.js";
import type { CoreLayerManagerLike, CoreLoaderLike } from "./loader/loader-types.js";

/** Minimal Utils surface read during init() for map resolution / option merging. */
interface InitUtils {
    ensureMap?: (map: unknown) => GeoJSONAdapter | null;
    mergeOptions?: (
        current: Record<string, unknown>,
        incoming: Record<string, unknown>
    ) => Record<string, unknown>;
    [key: string]: unknown;
}

// ──────────────────────────────────────────
//   GETTERS LAZY POUR SOUS-MODULES
// ──────────────────────────────────────────

const getState = (): GeoJSONSharedState => SharedModule.state;

const getLayerManager = (): CoreLayerManagerLike | undefined =>
    getGeoLeaf()?._GeoJSONLayerManager as CoreLayerManagerLike | undefined;

const getLoader = (): CoreLoaderLike | undefined =>
    getGeoLeaf()?._GeoJSONLoader as CoreLoaderLike | undefined;

function _validateZoomOnFit(options: GeoJSONInitOptions, g: GeoLeafGlobal | undefined): void {
    if (
        typeof options.maxZoomOnFit !== "number" ||
        options.maxZoomOnFit < 1 ||
        options.maxZoomOnFit > 20
    ) {
        Log.warn("[GeoLeaf.GeoJSON] options.maxZoomOnFit must be a number between 1 and 20.");
        const constants = g?.CONSTANTS as { GEOJSON_MAX_ZOOM_ON_FIT?: number } | undefined;
        options.maxZoomOnFit = constants ? (constants.GEOJSON_MAX_ZOOM_ON_FIT ?? 18) : 18;
    }
}

function _mergeInitOptions(
    current: Record<string, unknown>,
    incoming: Record<string, unknown>,
    g: GeoLeafGlobal | undefined
): Record<string, unknown> {
    const utils = g?.Utils as InitUtils | undefined;
    return utils?.mergeOptions
        ? utils.mergeOptions(current, incoming)
        : Object.assign({}, current, incoming);
}

const GeoJSONModule = {
    /** Getters for direct state access (compatibility) */
    get _map() {
        return getState() ? getState().map : null;
    },
    get _layers() {
        return getState() ? getState().layers : new Map<string, GeoJSONLayerEntry>();
    },
    get _options() {
        return getState() ? getState().options : {};
    },
    get DEFAULT_STYLES() {
        return SharedModule.DEFAULT_STYLES;
    },

    STYLE_OPERATORS: SharedModule.STYLE_OPERATORS,
    evaluateStyleCondition,
    getFeatureProperty,
    getGeometryType,
    isPointGeometry,
    isLineGeometry,
    isPolygonGeometry,
    validateFeature,
    validateFeatureCollection,
    extractCoordinates,
    calculateBounds,

    /**
     * Validates options passed to init()
     * @param {Object} options
     * @private
     */
    _validateOptions(options: GeoJSONInitOptions): GeoJSONInitOptions {
        const map = options.map as
            | { getNativeMap?: unknown; addLayer?: unknown }
            | null
            | undefined;
        if (map && typeof map.getNativeMap !== "function" && typeof map.addLayer !== "function") {
            Log.warn(
                "[GeoLeaf.GeoJSON] options.map does not appear to be a valid map or adapter instance."
            );
        }
        if (options.defaultStyle && typeof options.defaultStyle !== "object") {
            Log.warn("[GeoLeaf.GeoJSON] options.defaultStyle must be an object.");
            delete options.defaultStyle;
        }
        if (options.onEachFeature && typeof options.onEachFeature !== "function") {
            Log.warn("[GeoLeaf.GeoJSON] options.onEachFeature must be a function.");
            delete options.onEachFeature;
        }
        if (options.pointToLayer && typeof options.pointToLayer !== "function") {
            Log.warn("[GeoLeaf.GeoJSON] options.pointToLayer must be a function.");
            delete options.pointToLayer;
        }
        if (options.maxZoomOnFit !== undefined) _validateZoomOnFit(options, getGeoLeaf());
        return options;
    },

    /**
     * Initialise the module GeoJSON.
     *
     * @param {Object} options
     * @param {unknown} [options.map] - Map instance. Si absent, tentative via GeoLeaf.Core.getMap().
     * @param {Object} [options.defaultStyle]
     * @param {Object} [options.defaultPointStyle]
     * @param {Function} [options.onEachFeature]
     * @param {Function} [options.pointToLayer]
     * @param {boolean} [options.fitBoundsOnLoad]
     * @param {number} [options.maxZoomOnFit]
     * @returns {unknown} - The GeoJSON layer or null on failure.
     */
    init(options: GeoJSONInitOptions = {}): unknown {
        const state = getState();
        if (!state) {
            Log.error("[GeoLeaf.GeoJSON] shared.js module not loaded.");
            return null;
        }
        // Validation
        options = this._validateOptions(options);
        // ── MapLibre mode ─────────────────────────────────────────────────
        // Detect MapLibre adapter: options.map may be the adapter itself,
        // or fall back to GeoLeaf.Core.getMap() which returns the adapter.
        const core = getGeoLeaf()?.Core as { getMap?: () => unknown } | undefined;
        const mapOrAdapter =
            (options.map as { getNativeMap?: unknown } | null | undefined) ||
            (core?.getMap?.() as { getNativeMap?: unknown } | null | undefined) ||
            null;
        const adapter =
            mapOrAdapter && typeof mapOrAdapter.getNativeMap === "function"
                ? (mapOrAdapter as unknown as GeoJSONAdapter)
                : null;
        const nativeMap = adapter?.getNativeMap?.() as GeoJSONNativeMap | null | undefined;
        const isMapLibre = nativeMap && typeof nativeMap.addSource === "function";
        if (isMapLibre) {
            state.adapter = adapter;
            state.map = nativeMap as GeoJSONNativeMap;
            state.options = _mergeInitOptions(
                state.options,
                options as Record<string, unknown>,
                getGeoLeaf()
            );
            // No panes, no layer groups in MapLibre — layer ordering via registry
            state.layerGroup = null;
            state.geoJsonLayer = null;
            state.layers = new Map<string, GeoJSONLayerEntry>();
            Log.info("[GeoLeaf.GeoJSON] Module initialized (MapLibre mode)");
            // No basemap-switch rebuild listener: the adapter's transformStyle
            // preserves the GeoLeaf sources/layers across map.setStyle() natively —
            // `minzoom`/`maxzoom` travel with the serialized specs, so the native scale
            // window survives a basemap swap on its own.
            // Latitude watcher: a scale bound converts to a zoom THROUGH the latitude, so
            // the ranges posted at load time drift as the map travels north/south (S5/N-1b).
            bindZoomRangeSync(state.map);
            return null;
        }
        Log.error(
            "[GeoLeaf.GeoJSON] MapLibre adapter not found. Pass a valid map adapter in init({ map })."
        );
        return null;
    },

    // ──────────────────────────────────────────
    //   DELEGATION TO LAYER MANAGER
    // ──────────────────────────────────────────

    getLayerById(layerId: string): GeoJSONLayerEntry | null {
        const LayerManager = getLayerManager();
        return LayerManager ? LayerManager.getLayerById(layerId) : null;
    },

    /**
     * Returns a loaded layer's authored config object (the layer definition
     * stored on its runtime entry), or `null` when the layer is unknown.
     *
     * Runtime read seam for capability plugins (e.g. `@geoleaf-plugins/feature-info`)
     * that need per-layer config at click/hover time. This is config passthrough
     * (plumbing), not rendering: the kernel exposes the already-loaded config,
     * the plugin interprets it. Reads the shared state directly (same source as
     * the POI config resolution) so it works regardless of layer-manager wiring.
     *
     * @param layerId - GeoLeaf layer id.
     */
    getLayerConfig(layerId: string): GeoJSONLayerDef | null {
        return SharedModule.getLayerById(layerId)?.config ?? null;
    },

    getLayerData(layerId: string): unknown {
        const LayerManager = getLayerManager();
        return LayerManager ? LayerManager.getLayerData(layerId) : null;
    },

    /**
     * Replaces the GeoJSON data of an existing layer in real time.
     *
     * Updates both the MapLibre source (`source.setData()`) and the in-memory
     * state so that subsequent `getLayerData()` calls return the fresh data.
     *
     * @param {string} layerId - ID of the layer to update.
     * @param {unknown} data - GeoJSON FeatureCollection (or any valid GeoJSON) to set.
     */
    updateLayerData(layerId: string, data: unknown): void {
        const state = getState();
        if (!state) return;
        // Update MapLibre source via adapter
        const adapter = state.adapter;
        if (adapter && typeof adapter.updateLayerData === "function") {
            adapter.updateLayerData(layerId, data);
        }
        // Keep in-memory state consistent so getLayerData() returns fresh data
        const layerEntry = state.layers?.get(layerId);
        if (layerEntry) {
            layerEntry.geojson = data;
            const fc = data as { features?: GeoJSONFeature[] } | null | undefined;
            if (fc && Array.isArray(fc.features)) {
                layerEntry.features = fc.features;
            }
        }
    },

    getAllLayers(): unknown[] {
        const LayerManager = getLayerManager();
        return LayerManager ? LayerManager.getAllLayers() : [];
    },

    showLayer(layerId: string): void {
        const LayerManager = getLayerManager();
        if (LayerManager) LayerManager.showLayer(layerId);
    },

    hideLayer(layerId: string): void {
        const LayerManager = getLayerManager();
        if (LayerManager) LayerManager.hideLayer(layerId);
    },

    toggleLayer(layerId: string): void {
        const LayerManager = getLayerManager();
        if (LayerManager) LayerManager.toggleLayer(layerId);
    },

    removeLayer(layerId: string): void {
        const LayerManager = getLayerManager();
        if (LayerManager) LayerManager.removeLayer(layerId);
    },

    setLayerStyle(layerId: string, styleConfig: unknown): boolean {
        const LayerManager = getLayerManager();
        return LayerManager ? LayerManager.setLayerStyle(layerId, styleConfig) : false;
    },

    // ──────────────────────────────────────────
    //   DELEGATION TO LOADER
    // ──────────────────────────────────────────

    loadFromActiveProfile(options: Record<string, unknown> = {}): Promise<unknown[]> {
        const Loader = getLoader();
        return Loader ? Loader.loadFromActiveProfile(options) : Promise.resolve([]);
    },

    // ──────────────────────────────────────────
    //   FILTRAGE DES FEATURES
    // ──────────────────────────────────────────

    /**
     * Filters the features of every GeoJSON layer.
     * Shows only features that pass the predicate.
     *
     * The predicate runs in JS (so arbitrary logic — substring search, distance,
     * nested fields — is supported), but the resulting visible set is applied on
     * the GPU via `map.setFilter` on feature ids (no source re-tiling) for
     * non-clustered layers with unique `properties.id`; clustered / id-less
     * layers fall back to re-feeding the filtered data (RM-P1).
     *
     * @param {Function} filterFn - Fonction (feature, layerId) => boolean
     * @param {Object} [options] - Additional options
     * @returns {Object} - { filtered: number, total: number, visible: number }
     */
    filterFeatures(
        filterFn: (feature: GeoJSONFeature, layerId: string) => boolean,
        options: { layerIds?: string | string[]; geometryType?: string } = {}
    ): { filtered: number; total: number; visible: number } {
        const state = getState();
        if (typeof filterFn !== "function") {
            Log.warn("[GeoLeaf.GeoJSON] filterFeatures: filterFn must be a function");
            return { filtered: 0, total: 0, visible: 0 };
        }
        const stats = { filtered: 0, total: 0, visible: 0 };
        const layerIds = _resolveGeometryFilteredIds(state, options);
        layerIds.forEach((layerId) => {
            const layerData = state.layers.get(layerId);
            if (!layerData) return;
            _applyFeatureVisibilityForLayer(layerData, filterFn, layerId, stats);
        });
        Log.debug(
            `[GeoLeaf.GeoJSON] filterFeatures: ${stats.visible}/${stats.total} visible features`
        );
        dispatchGeoLeafEvent("geoleaf:filter:apply", {
            layerIds: layerIds.map(String),
            // Detail d'un CustomEvent lu par des handlers tiers, qui peuvent sonder la présence
            // de la clé — insertion conditionnelle plutôt qu'un `undefined` explicite.
            ...(options.geometryType !== undefined && { geometryType: options.geometryType }),
            activeCount: stats.filtered,
        });
        return stats;
    },

    /**
     * Resets the feature filter (shows all).
     *
     * @param {Object} [options] - Same options as filterFeatures
     */
    clearFeatureFilter(options: { layerIds?: string | string[]; geometryType?: string } = {}) {
        const result = this.filterFeatures(() => true, options);
        const layerIds = Array.isArray(options.layerIds)
            ? options.layerIds.map(String)
            : [...getState().layers.keys()].map(String);
        dispatchGeoLeafEvent("geoleaf:filter:reset", { layerIds });
        return result;
    },

    /**
     * Returns all loaded features.
     * Reads directly from state.layers (featureCache removed in Sprint 1).
     * @param {Object} [options]
     * @returns {Array<Object>} features GeoJSON enrichies de { _layerId }
     */
    getFeatures(options: { geometryTypes?: string[]; layerIds?: string[] } = {}) {
        return _getFeatures(options);
    },

    // ──────────────────────────────────────────
    //   EXPOSED INTERNAL METHODS
    // ──────────────────────────────────────────

    _updateLayerVisibilityByZoom(): void {
        const LayerManager = getLayerManager();
        if (LayerManager) LayerManager.updateLayerVisibilityByZoom();
    },

    _registerWithLayerManager(): void {
        const LayerManager = getLayerManager();
        if (LayerManager) LayerManager.registerWithLayerManager();
    },

    _detectLayerType(layer: unknown): string {
        const LayerManager = getLayerManager();
        return LayerManager ? LayerManager.detectLayerType(layer) : "mixed";
    },
};

const GeoJSONCore = GeoJSONModule;

export { GeoJSONCore };
