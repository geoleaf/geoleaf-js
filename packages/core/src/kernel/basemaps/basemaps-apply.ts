/*!
 * GeoLeaf Core – Basemaps / Apply helpers (pure builders)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stateless helpers extracted from `registry.ts` to keep that file under the
 * 700-line module budget. The invariant of this module is the absence of *module
 * state*: every input comes from the arguments. Most are pure factories; a few
 * (`_trySwitchByTiles`, `insertBelow`) do touch the map, because their effect is
 * mechanical and carries no business branching. The registry keeps all mutable
 * state and all switching decisions.
 * https://geoleaf.dev
 */

import { normalizeTilesArray } from "./providers.js";
import type { BasemapDefinition, BasemapRenderType, NativeMap } from "./basemaps-types.js";

// ─── Fixed IDs ───────────────────────────────────────────────────────────────

/** MapLibre source id used for raster basemaps. */
export const BASEMAP_SOURCE_ID = "__geoleaf_basemap__";

/** MapLibre layer id used for raster basemaps. */
export const BASEMAP_LAYER_ID = "__geoleaf_basemap_layer__";

// ─── Basemap type resolution ─────────────────────────────────────────────────

/**
 * Determines whether a basemap definition should be applied as a
 * raster source (`addSource`/`addLayer`) or a vector style (`setStyle`).
 * Image, hillshade, WMTS, and WMS types all return `"raster"` — they use
 * the same sync removal path as XYZ raster tiles.
 */
export function _resolveBasemapType(definition: BasemapDefinition): BasemapRenderType {
    if (definition.type === "maplibre") return "vector";
    if (
        definition.type === "image" ||
        definition.type === "hillshade" ||
        definition.type === "wmts" ||
        definition.type === "wms"
    ) {
        return "raster";
    }

    // A style URL without a raster url/tiles → vector
    if (definition.style && !definition.url && !definition.tiles) return "vector";

    // PMTiles: if a style URL is also provided treat as vector; otherwise raster
    const firstTile: string | undefined =
        definition.url || (Array.isArray(definition.tiles) ? definition.tiles[0] : undefined);
    if (firstTile?.startsWith("pmtiles://")) {
        return definition.style ? "vector" : "raster";
    }

    return "raster";
}

// ─── Raster basemap builders ─────────────────────────────────────────────────

/**
 * Builds a MapLibre raster source spec and layer spec from a basemap definition.
 * Pure factory — does not call any map API.
 */
export function _buildRasterSourceSpec(definition: BasemapDefinition): {
    sourceSpec: Record<string, unknown>;
    layerSpec: Record<string, unknown>;
} {
    const tiles = normalizeTilesArray(definition);
    const tileSize = typeof definition.tileSize === "number" ? definition.tileSize : 256;
    const attribution = definition.attribution ?? definition.options?.attribution ?? "";

    const sourceSpec: Record<string, unknown> = {
        type: "raster",
        tiles,
        tileSize,
    };
    if (attribution) sourceSpec.attribution = attribution;
    if (typeof definition.minZoom === "number") sourceSpec.minzoom = definition.minZoom;
    if (typeof definition.maxZoom === "number") {
        sourceSpec.maxzoom = definition.maxZoom;
    } else if (typeof definition.options?.maxZoom === "number") {
        sourceSpec.maxzoom = definition.options.maxZoom;
    }

    const layerSpec: Record<string, unknown> = {
        id: BASEMAP_LAYER_ID,
        type: "raster",
        source: BASEMAP_SOURCE_ID,
    };

    return { sourceSpec, layerSpec };
}

/**
 * Basemap types that do NOT produce a MapLibre `RasterTileSource`, and therefore have no
 * `setTiles()`: `image` is an `ImageSource` (mutated via `setCoordinates`), `hillshade` a
 * `raster-dem`, and `wms`/`wmts` build their tile URLs through their own templates.
 */
const _NON_TILE_RASTER_TYPES = new Set(["image", "hillshade", "wms", "wmts"]);

/** True when the definition renders as a plain XYZ raster tile source. */
function _isPlainRasterTiles(definition: BasemapDefinition | null | undefined): boolean {
    if (!definition) return false;
    if (definition.type && _NON_TILE_RASTER_TYPES.has(definition.type)) return false;
    if (_resolveBasemapType(definition) !== "raster") return false;
    return normalizeTilesArray(definition).length > 0;
}

/**
 * True when switching from `prev` to `next` changes **nothing but the tile URLs**.
 *
 * `RasterTileSource.setTiles()` mutates the tiles and nothing else — `tileSize`,
 * `attribution`, `minzoom` and `maxzoom` are baked into the source at creation. When any
 * of those differ, the source really must be destroyed and rebuilt; mutating would
 * silently keep the previous values.
 */
function _canSwitchByTiles(
    prev: BasemapDefinition | null | undefined,
    next: BasemapDefinition
): boolean {
    if (!_isPlainRasterTiles(prev) || !_isPlainRasterTiles(next)) return false;

    const a = _buildRasterSourceSpec(prev as BasemapDefinition).sourceSpec;
    const b = _buildRasterSourceSpec(next).sourceSpec;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if (key === "tiles") continue;
        if (a[key] !== b[key]) return false;
    }
    // Same tiles = nothing to do; let the caller no-op rather than push a pointless update.
    return JSON.stringify(a.tiles) !== JSON.stringify(b.tiles);
}

/** The live source surface this module needs — only the tile mutation. */
interface RasterTileSourceLike {
    setTiles?: (tiles: string[]) => void;
}

/** Minimal map surface: reading the active basemap source. */
interface SourceReaderLike {
    getSource?: (id: string) => unknown;
}

/**
 * Mutates the live raster source's tile URLs instead of destroying and rebuilding it.
 *
 * Only when the two basemaps differ by their tiles alone ({@link _canSwitchByTiles}): any
 * other change is baked into the source at creation and would be silently kept. Returns
 * `false` whenever the mutation cannot be trusted, so the caller falls back to the
 * remove + re-add path — which stays the general case, not a degraded one.
 *
 * @param map - Anything exposing `getSource`; the live raster source is read off it.
 * @param previous - The basemap currently applied, or null/undefined at boot — in which case
 *   there is nothing to mutate and the call returns `false`.
 * @param next - The basemap being switched to; its tiles are the ones written.
 * @param onWarn - Reports a failed mutation; the caller then rebuilds.
 * @returns `true` when the tiles were mutated in place.
 */
export function _trySwitchByTiles(
    map: SourceReaderLike,
    previous: BasemapDefinition | null | undefined,
    next: BasemapDefinition,
    onWarn: (message: string, error: unknown) => void
): boolean {
    if (!_canSwitchByTiles(previous, next)) return false;

    const source = map.getSource?.(BASEMAP_SOURCE_ID) as RasterTileSourceLike | undefined;
    if (!source || typeof source.setTiles !== "function") return false;

    try {
        source.setTiles(normalizeTilesArray(next));
    } catch (e) {
        // A failed mutation leaves the previous tiles in place — the rebuild path can
        // still take over, so this is a fallback, not an error.
        onWarn("[GeoLeaf.Baselayers] setTiles failed, rebuilding the source:", e);
        return false;
    }
    return true;
}

// ─── Layer insertion ─────────────────────────────────────────────────────────

/**
 * Adds a basemap layer at the very bottom of the render stack.
 *
 * A basemap must never cover the data layers, so it is inserted before the first
 * existing layer. When the style carries no layer yet, `addLayer` without a
 * `beforeId` already appends at the bottom — hence the single-argument branch,
 * which callers can observe through the call arity.
 *
 * Touches the map (style read + `addLayer`) but keeps no module state.
 *
 * @param map - Native `maplibregl.Map` instance.
 * @param layerSpec - Layer spec to add.
 */
export function insertBelow(map: NativeMap, layerSpec: Record<string, unknown>): void {
    const existingLayers = map.getStyle()?.layers ?? [];
    const firstLayerId: string | undefined = existingLayers[0]?.id;
    if (firstLayerId) {
        map.addLayer(layerSpec, firstLayerId);
    } else {
        map.addLayer(layerSpec);
    }
}
