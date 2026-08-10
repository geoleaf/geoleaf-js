/*!
 * GeoLeaf Core – Basemaps / Hillshade
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Implements hillshade (terrain shadow / ambient occlusion) as a basemap type.
 * Uses a MapLibre `raster-dem` source with a `hillshade` render layer.
 *
 * Terrain-dem reuse: when the terrain module has already added a `raster-dem`
 * source with a matching DEM URL, the hillshade layer reuses that source to avoid
 * redundant tile loading.
 *
 * Security: DEM URLs are validated before use. No innerHTML or eval.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { validateUrl } from "../../utils/general/utils-base.js";
import { BASEMAP_SOURCE_ID, BASEMAP_LAYER_ID, insertBelow } from "./basemaps-apply.js";
import type { BasemapDefinition, HillshadeConfig, NativeMap } from "./basemaps-types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Source ID managed by terrain.ts for 3D terrain. */
const TERRAIN_DEM_SOURCE_ID = "terrain-dem";

/**
 * When `terrain-dem` cannot be reused, hillshade takes over the **basemap slot**
 * rather than opening a source of its own — hence the shared id. Aliased locally
 * so the call sites keep reading as hillshade intent.
 */
const HILLSHADE_SOURCE_ID = BASEMAP_SOURCE_ID;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the hillshade render layer spec, referencing the given source.
 * @internal
 */
function _buildHillshadeLayerSpec(
    sourceId: string,
    layerId: string,
    config: Partial<HillshadeConfig>
): Record<string, unknown> {
    const paint: Record<string, unknown> = {};

    if (config.shadowColor) paint["hillshade-shadow-color"] = config.shadowColor;
    if (config.highlightColor) paint["hillshade-highlight-color"] = config.highlightColor;
    if (config.accentColor) paint["hillshade-accent-color"] = config.accentColor;

    if (typeof config.exaggeration === "number") {
        paint["hillshade-exaggeration"] = Math.max(0, Math.min(1, config.exaggeration));
    }
    if (typeof config.illuminationDirection === "number") {
        paint["hillshade-illumination-direction"] = config.illuminationDirection;
    }
    if (config.illuminationAnchor) {
        paint["hillshade-illumination-anchor"] = config.illuminationAnchor;
    }

    return { id: layerId, type: "hillshade", source: sourceId, paint };
}

/**
 * Returns the tiles array from an existing `raster-dem` map source, or null.
 * MapLibre exposes `.tiles` on the source spec; this may be absent in some versions.
 * @internal
 */
function _getExistingDemTiles(map: NativeMap, sourceId: string): string[] | null {
    if (!map?.getSource) return null;
    const src = map.getSource(sourceId);
    if (!src) return null;
    return Array.isArray(src.tiles) ? src.tiles : null;
}

/**
 * Returns `true` when the `terrain-dem` source exists and contains `demUrl`.
 * @internal
 */
function _canReuseTerrainSource(map: NativeMap, demUrl: string): boolean {
    const tiles = _getExistingDemTiles(map, TERRAIN_DEM_SOURCE_ID);
    return tiles !== null && tiles.includes(demUrl);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a MapLibre `raster-dem` source spec for a hillshade basemap.
 * Pure factory — does not call any map API.
 *
 * @param definition - Basemap config with `hillshade.demUrl` (or top-level `demUrl`).
 * @returns The raster-dem source spec.
 */
export function buildHillshadeSourceSpec(definition: BasemapDefinition): Record<string, unknown> {
    const config: Partial<HillshadeConfig> = definition?.hillshade ?? {};
    const demUrl = config.demUrl ?? definition.demUrl ?? "";
    const encoding = config.demEncoding ?? definition.demEncoding ?? "terrarium";
    const maxzoom =
        typeof config.demMaxZoom === "number"
            ? config.demMaxZoom
            : typeof definition.demMaxZoom === "number"
              ? definition.demMaxZoom
              : 15;

    return {
        type: "raster-dem",
        tiles: [demUrl],
        encoding,
        tileSize: 256,
        maxzoom,
    };
}

/**
 * Applies a hillshade basemap to the map.
 *
 * - Reuses `terrain-dem` source if it already covers the same DEM URL.
 * - Otherwise adds a new `raster-dem` source using `HILLSHADE_SOURCE_ID`.
 * - Inserts the hillshade layer below all existing layers.
 *
 * @param map - Native `maplibregl.Map` instance.
 * @param definition - Basemap config with `hillshade` settings.
 * @param layerId - Layer ID. Defaults to `"__geoleaf_basemap_layer__"`.
 * @returns The source ID actually used (`"terrain-dem"` or `"__geoleaf_basemap__"`).
 */
export function applyHillshadeBasemap(
    map: NativeMap,
    definition: BasemapDefinition,
    layerId = BASEMAP_LAYER_ID
): string {
    const config: Partial<HillshadeConfig> = definition?.hillshade ?? {};
    const demUrl: string = config.demUrl ?? definition.demUrl ?? "";

    if (!demUrl) {
        Log.error("[GeoLeaf.Hillshade] hillshade.demUrl is required.");
        return HILLSHADE_SOURCE_ID;
    }

    // Security: validate DEM URL before use
    const safeDemUrl = validateUrl(demUrl, ["http:", "https:"]);
    if (!safeDemUrl) {
        Log.error("[GeoLeaf.Hillshade] Invalid hillshade demUrl:", demUrl);
        return HILLSHADE_SOURCE_ID;
    }

    // Determine source to use
    let sourceId = HILLSHADE_SOURCE_ID;
    if (_canReuseTerrainSource(map, demUrl)) {
        sourceId = TERRAIN_DEM_SOURCE_ID;
        Log.debug("[GeoLeaf.Hillshade] Reusing terrain-dem source for hillshade.");
    } else if (!map.getSource?.(HILLSHADE_SOURCE_ID)) {
        map.addSource(HILLSHADE_SOURCE_ID, buildHillshadeSourceSpec(definition));
    }

    const layerSpec = _buildHillshadeLayerSpec(sourceId, layerId, config);
    insertBelow(map, layerSpec);

    Log.info("[GeoLeaf.Hillshade] Hillshade basemap applied (source:", sourceId, ")");
    return sourceId;
}
