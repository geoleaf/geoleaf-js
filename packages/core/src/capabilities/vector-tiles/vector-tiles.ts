/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Vector-tiles capability — orchestrator.
 *
 * Resolves vector-tile config / URL / style for a layer, then delegates all MapLibre
 * rendering to the adapter via `IMapAdapter.addVectorTileLayer` /
 * `updateVectorTileLayerStyle`. Socle B.1: this capability no longer imports anything
 * from `adapters/maplibre/` — the engine-side builder lives in
 * `adapters/maplibre/maplibre-vector-tiles.ts`. Interaction binding mirrors the GeoJSON
 * loader (via `IMapAdapter.getNativeMap()` + the shared geojson binder), which are not
 * engine imports.
 */

"use strict";

import { bindFeatureInteractionEvents, GeoJSONShared } from "../../kernel/geojson/index.js";
import { getLog } from "../../utils/general/di-accessors.js";
import { buildVtLayerData } from "./vector-tiles-layer-data.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import type { VectorTileLayerSpec } from "../../contracts/map-adapter.contract.ts";
import type {
    GeoJSONAdapter,
    GeoJSONCurrentStyle,
    GeoJSONNativeMap,
    GeoJSONSharedState,
} from "../../kernel/geojson/core-types.js";
import type { GeoJSONLoaderLog } from "../../kernel/geojson/loader/loader-types.js";
import { layerGeometry } from "../../kernel/config/index.js";
import type {
    LayerConfigModuleLike,
    LayerManagerModuleLike,
    VtConfig,
    VtLayerDef,
} from "./types.js";

const getState = (): GeoJSONSharedState => GeoJSONShared.state;

// ─── Config helpers ──────────────────────────────────────────────────────────

function _resolveProfileBasePath(def: VtLayerDef): {
    basePath: string;
    profileId: string | undefined;
    layerDir: string | undefined;
} {
    const Config = getGeoLeaf()?.Config;
    const dataCfg = Config && Config.get ? (Config.get("data") as Record<string, unknown>) : null;
    const basePath = (dataCfg?.profilesBasePath as string | undefined) || "profiles";
    return { basePath, profileId: def._profileId, layerDir: def._layerDirectory };
}

async function _loadVtStyle(
    layerId: string,
    def: VtLayerDef,
    Log: GeoJSONLoaderLog
): Promise<GeoJSONCurrentStyle | null> {
    if (!def.styles || !def.styles.default) return null;
    try {
        const LayerConfig = getGeoLeaf()?._GeoJSONLayerConfig as LayerConfigModuleLike | undefined;
        return (await LayerConfig?.loadDefaultStyle?.(layerId, def)) ?? null;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Log.warn(`[VectorTiles] Could not load default style for ${layerId}:`, message);
        return null;
    }
}

/** Resolves the map adapter and asserts it exposes vector-tile rendering. */
function _resolveVtAdapter(): GeoJSONAdapter {
    const Core = getGeoLeaf()?.Core as { getMap?: () => GeoJSONAdapter | undefined } | undefined;
    const adapter = Core?.getMap?.() ?? null;
    if (!adapter || typeof adapter.addVectorTileLayer !== "function") {
        throw new Error("[VectorTiles] Map adapter with vector-tile support not available");
    }
    return adapter;
}

/** Builds the engine-agnostic layer spec passed to the adapter. */
function _buildVtSpec(
    def: VtLayerDef,
    vtConfig: VtConfig,
    tileUrl: string,
    vtLayerName: string,
    styleData: GeoJSONCurrentStyle | null,
    state: GeoJSONSharedState
): VectorTileLayerSpec {
    return {
        tileUrl,
        sourceLayer: vtLayerName,
        // B-161 — voir `vector-tiles-layer-data.ts` : même consolidation, même repli.
        geometryType: layerGeometry(def, "polygon"),
        zIndex: typeof def.zIndex === "number" ? def.zIndex : 0,
        source: {
            ...(vtConfig.minZoom !== undefined && { minZoom: vtConfig.minZoom }),
            ...(vtConfig.maxNativeZoom !== undefined && {
                maxNativeZoom: vtConfig.maxNativeZoom,
            }),
            ...(vtConfig.scheme !== undefined && { scheme: vtConfig.scheme }),
            ...(vtConfig.bounds !== undefined && { bounds: vtConfig.bounds }),
        },
        subLayerZoom: {
            ...(vtConfig.minZoom !== undefined && { minZoom: vtConfig.minZoom }),
            ...(vtConfig.maxZoom !== undefined && { maxZoom: vtConfig.maxZoom }),
        },
        style: {
            ...(state.options.defaultStyle !== undefined && {
                defaultStyle: state.options.defaultStyle,
            }),
            ...((styleData?.defaultStyle ?? styleData?.style) !== undefined && {
                resolvedStyle: styleData?.defaultStyle ?? styleData?.style,
            }),
            ...(styleData?.styleRules !== undefined && { styleRules: styleData.styleRules }),
        },
    };
}

// ─── VectorTiles module ──────────────────────────────────────────────────────

const VectorTiles = {
    /**
     * Determines if a layer definition should use vector tiles.
     * Returns true only when the VT config provides an **absolute** tile URL.
     * Relative paths (auto-generated from profile structure) are not used
     * because PBF files may not exist — the layer falls back to GeoJSON.
     */
    shouldUseVectorTiles(def: VtLayerDef): boolean {
        const vtConfig = this._getVTConfig(def);
        if (!vtConfig || vtConfig.enabled === false) return false;
        // Only use VT when an explicit absolute URL is configured.
        // Relative tile paths (auto-generated) may point to non-existent PBF files.
        const url = vtConfig.tilesUrl;
        if (!url) return false;
        if (url.startsWith("http") || url.startsWith("//") || url.startsWith("/")) {
            return true;
        }
        return false;
    },

    /**
     * Extracts the vectorTiles config block from a layer definition.
     * Supports both `def.vectorTiles` and `def.data.vectorTiles`.
     */
    _getVTConfig(def: VtLayerDef | null): VtConfig | null {
        if (!def) return null;
        if (def.vectorTiles && typeof def.vectorTiles === "object") return def.vectorTiles;
        if (def.data?.vectorTiles && typeof def.data.vectorTiles === "object") {
            return def.data.vectorTiles;
        }
        return null;
    },

    /**
     * Resolves the full tile URL template from the layer definition.
     *
     * ⚠️ The `tilesDirectory` fallback below is UNREACHABLE from the production flow,
     * and deliberately so. `_createVectorTileLayer` only calls this after
     * `shouldUseVectorTiles()` has returned true, and that guard requires an ABSOLUTE
     * `tilesUrl` — so by the time we get here, the first branch always wins. The
     * derived `…/{z}/{x}/{y}.pbf` path is therefore dead code *in practice*.
     *
     * It is kept, not purged (R.33, backlog résiduel S5). Two reasons: it is covered by
     * 13 assertions across `__tests__/geojson/vector-tiles.test.js` and
     * `__tests__/config/s13-layer-data.test.js`, several of them asserting the derived
     * path specifically; and it becomes live again the moment the absolute-URL guard is
     * relaxed, which is what "arming" a profile's vector tiles would mean. Removing it
     * would delete tested behaviour to fix a promise that was really a data problem —
     * the six `tourism` layers that declared `enabled:true` without a `tilesUrl` have
     * been disarmed in the profiles instead.
     */
    _resolveTileUrl(def: VtLayerDef, vtConfig: VtConfig): string | null {
        const directUrl = vtConfig.tilesUrl;
        if (directUrl) {
            if (
                directUrl.startsWith("http") ||
                directUrl.startsWith("//") ||
                directUrl.startsWith("/")
            ) {
                return directUrl;
            }
        }

        const { basePath: profilesBasePath, profileId, layerDir } = _resolveProfileBasePath(def);
        if (!profileId || !layerDir) return vtConfig.tilesUrl || null;

        const tilesDir = vtConfig.tilesDirectory || "tiles";
        return `${profilesBasePath}/${profileId}/${layerDir}/${tilesDir}/{z}/{x}/{y}.pbf`;
    },

    /**
     * Creates a vector tile layer by delegating to the adapter, then binds
     * interactions and records shared state. The adapter builds one `vector` source
     * and up to 3 render layers (fill/line/circle) from the resolved spec.
     *
     * @param layerId - Unique layer ID.
     * @param layerLabel - Display label.
     * @param def - Normalised layer definition (must include vectorTiles block).
     * @param _baseOptions - Base options (unused in MapLibre mode).
     * @returns Layer metadata.
     */
    async loadVectorTileLayer(
        layerId: string,
        layerLabel: string,
        def: VtLayerDef,
        _baseOptions: Record<string, unknown>
    ): Promise<{ id: string; label: string; featureCount: number; isVectorTile: boolean }> {
        const Log = getLog();
        const state = getState();
        const vtConfig = this._getVTConfig(def);
        if (!vtConfig) throw new Error(`[VectorTiles] No vectorTiles config for ${layerId}`);

        const tileUrl = this._resolveTileUrl(def, vtConfig);
        if (!tileUrl) throw new Error(`[VectorTiles] Cannot resolve tile URL for ${layerId}`);

        const styleData = await _loadVtStyle(layerId, def, Log);
        // `def.id` is always present on a normalised layer definition by this point.
        const vtLayerName = (vtConfig.layerName || def.id) as string;

        const adapter = _resolveVtAdapter();

        Log.info(
            `[GeoLeaf.VectorTiles] Creating VT layer: ${layerId} (source-layer: ${vtLayerName})`
        );
        Log.debug(`[GeoLeaf.VectorTiles] URL template: ${tileUrl}`);

        // Delegate all MapLibre building to the adapter (source + sub-layers + registry).
        const spec = _buildVtSpec(def, vtConfig, tileUrl, vtLayerName, styleData, state);
        const createdSubIds = adapter.addVectorTileLayer?.(layerId, spec) ?? [];

        // Bind interactions — same explicit pattern as the GeoJSON loader, via the
        // interface (`getNativeMap`) + the shared geojson binder. Neither is an engine import.
        if (vtConfig.interactive !== false) {
            const nativeMap = adapter.getNativeMap?.() as GeoJSONNativeMap | null;
            if (nativeMap) bindFeatureInteractionEvents(layerId, def, nativeMap, createdSubIds);
        }

        // Store layer data in shared state.
        const { basePath: profilesBasePath } = _resolveProfileBasePath(def);
        const layerBasePath = `${profilesBasePath}/${def._profileId}/${def._layerDirectory}`;
        const layerData = buildVtLayerData({
            layerId,
            layerLabel,
            def,
            vtLayerName,
            tileUrl,
            styleData,
            createdSubIds,
            layerBasePath,
        });
        state.layers.set(layerId, layerData);

        // Trigger visibility check.
        const LayerManager = getGeoLeaf()?._GeoJSONLayerManager as
            | LayerManagerModuleLike
            | undefined;
        if (LayerManager) {
            LayerManager.updateLayerVisibilityByZoom?.();
        }

        Log.info(`[GeoLeaf.VectorTiles] VT layer loaded: ${layerId}`);
        return { id: layerId, label: layerLabel, featureCount: 0, isVectorTile: true };
    },

    /**
     * Updates the style of an existing VT layer via the adapter.
     */
    updateLayerStyle(layerId: string, styleData: GeoJSONCurrentStyle | null): void {
        const Log = getLog();
        const state = getState();
        const layerData = state.layers.get(layerId);
        if (!layerData || !layerData.isVectorTile) return;

        const Core = getGeoLeaf()?.Core as
            | { getMap?: () => GeoJSONAdapter | undefined }
            | undefined;
        const adapter = Core?.getMap?.();
        if (!adapter?.updateVectorTileLayerStyle) return;

        const subLayerIds: string[] = layerData._maplibreSubLayerIds || [];
        adapter.updateVectorTileLayerStyle(layerId, subLayerIds, {
            ...(state.options.defaultStyle !== undefined && {
                defaultStyle: state.options.defaultStyle,
            }),
            ...((styleData?.defaultStyle ?? styleData?.style) !== undefined && {
                resolvedStyle: styleData?.defaultStyle ?? styleData?.style,
            }),
            ...(styleData?.styleRules !== undefined && { styleRules: styleData.styleRules }),
        });

        layerData.currentStyle = styleData;
        Log.debug(`[GeoLeaf.VectorTiles] Style updated for ${layerId}`);
    },
};

export { VectorTiles };
