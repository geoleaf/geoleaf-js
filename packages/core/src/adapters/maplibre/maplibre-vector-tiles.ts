/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * MapLibre vector-tile layer builder — the engine-side of the `vector-tiles`
 * capability. Adds a native `type:"vector"` source and its fill / fill-extrusion /
 * line / casing / circle sub-layers, mirroring `maplibre-layer-builders.ts` for
 * GeoJSON. Moved here from `capabilities/vector-tiles/` (socle B.1) so the capability
 * orchestrates config/style resolution and delegates all MapLibre rendering to the
 * adapter — `capabilities/**` no longer imports `adapters/maplibre/**`.
 *
 * The adapter exposes this through `IMapAdapter.addVectorTileLayer` /
 * `updateVectorTileLayerStyle`; capabilities pass raw GeoLeaf style and never see a
 * MapLibre paint object.
 */
import {
    toSourceId,
    toSubLayerId,
    SENTINEL_POI,
    MaplibreLayerRegistry,
} from "./maplibre-layer-registry.js";
import type { SubLayerType } from "./maplibre-layer-registry.js";
import {
    normalizeToFlat,
    toFillPaint,
    toFillExtrusionPaint,
    toLinePaint,
    toCirclePaint,
    toCasingPaint,
    styleRulesToPaint,
    collectHatchPatterns,
    type CasingConfig,
} from "./maplibre-style-converter.js";
import { setPaintAt } from "./maplibre-primitives.js";
import { registerHatchPattern } from "./maplibre-hatch-patterns.js";
import { validateFillExtrusionStyle } from "./maplibre-extrusion-validator.js";
import { Log } from "../../utils/log/index.js";
import type {
    MaplibreMap,
    MaplibreLayerSpec,
    MaplibreSourceSpec,
} from "./maplibre-adapter-types.js";
import type { GeoJSONStyleRule } from "../../kernel/geojson/geojson-types.js";
import type {
    VectorTileLayerSpec,
    VectorTileStyleInput,
} from "../../contracts/map-adapter.contract.ts";

// Geometry kinds (config vocabulary) → which sub-layers to build.
const _VT_FILL_GEOM = ["polygon", "multipolygon", "mixed"];
const _VT_LINE_GEOM = ["polygon", "multipolygon", "linestring", "multilinestring", "line", "mixed"];
const _VT_CIRCLE_GEOM = ["point", "multipoint", "mixed"];

/** Rendering context threaded through the per-geometry VT sub-layer builders. */
interface VtBuildCtx {
    map: MaplibreMap;
    layerId: string;
    sourceId: string;
    sourceLayer: string;
    mergedFlat: Record<string, unknown>;
    styleRules: GeoJSONStyleRule[] | undefined;
    vtZoom: Record<string, number>;
    beforeId: string | undefined;
    createdSubIds: string[];
    createdTypes: SubLayerType[];
}

/**
 * Every sub-layer type a vector-tile layer can create — the `_addVt*Layer` builders
 * below pass exactly these to {@link _addVtSubLayer}.
 *
 * ⚠️ This is the cleanup's single source of truth, and it must stay that way (B.44).
 * The purge list used to be written out by hand and had drifted from the builders in
 * both directions: it named `gl-<id>-line-casing` where `toSubLayerId` emits
 * `gl-<id>-casing` (the id carries the REGISTRY type, `"casing"`, not the MapLibre
 * type, `"line"`), so the casing sub-layer survived every rebuild and `removeSource`
 * ran with a layer still referencing the source; and it named `gl-<id>-symbol`, which
 * no vector-tile builder has ever produced.
 */
const _VT_SUB_LAYER_TYPES: readonly SubLayerType[] = [
    "fill-extrusion",
    "fill",
    "line",
    "casing",
    "circle",
];

/** Removes any stale source/sub-layers left from a previous load cycle. */
function _removeStaleVtSource(map: MaplibreMap, layerId: string, sourceId: string): void {
    if (!map.getSource(sourceId)) return;
    for (const type of _VT_SUB_LAYER_TYPES) {
        const sid = toSubLayerId(layerId, type);
        if (map.getLayer(sid)) map.removeLayer(sid);
    }
    map.removeSource(sourceId);
    if (Log) Log.debug(`[GeoLeaf.VectorTiles] Removed stale source/layers for "${layerId}".`);
}

/** Builds the MapLibre vector source config (scheme/bounds applied from the spec). */
function _buildVtSourceConfig(spec: VectorTileLayerSpec): MaplibreSourceSpec {
    const src = spec.source ?? {};
    const sourceConfig: Record<string, unknown> = {
        type: "vector",
        tiles: [spec.tileUrl],
        minzoom: src.minZoom ?? 0,
        maxzoom: src.maxNativeZoom ?? 14,
    };
    // Tile grid scheme — explicit config only ("xyz" is MapLibre's default).
    if (src.scheme === "tms") sourceConfig.scheme = "tms";
    if (src.bounds) sourceConfig.bounds = src.bounds;
    return sourceConfig as MaplibreSourceSpec;
}

/** Per-sub-layer zoom constraints from the spec. */
function _buildVtZoom(zoom?: { minZoom?: number; maxZoom?: number }): Record<string, number> {
    const vtZoom: Record<string, number> = {};
    if (typeof zoom?.minZoom === "number") vtZoom.minzoom = zoom.minZoom;
    if (typeof zoom?.maxZoom === "number") vtZoom.maxzoom = zoom.maxZoom;
    return vtZoom;
}

/** Merges the profile default style with the layer-resolved style into a flat style. */
function _resolveMergedFlat(style?: VectorTileStyleInput): Record<string, unknown> {
    const defaultFlat = normalizeToFlat(style?.defaultStyle as Record<string, unknown>);
    const resolvedFlat =
        style?.resolvedStyle != null
            ? normalizeToFlat(style.resolvedStyle as Record<string, unknown>)
            : defaultFlat;
    return { ...defaultFlat, ...resolvedFlat };
}

/**
 * Resolves the MapLibre paint object for a VT sub-layer from its id suffix, or null
 * when the sub-layer should be skipped (disabled casing / unknown suffix).
 *
 * Single source of truth for VT paint resolution: the build path
 * ({@link _addVtSubLayer}) and the re-style path ({@link updateVectorTileLayerStyle})
 * both go through it, so a sub-layer can never be created with one paint and updated
 * with another.
 *
 * ⚠️ The suffix match must stay ANCHORED (`endsWith`). `gl-x-fill-extrusion` CONTAINS
 * `-fill`, so a substring match would route the extrusion sub-layer to the fill branch
 * and paint it with `fill-*` properties that MapLibre silently ignores on a
 * fill-extrusion layer — no throw, just a flat polygon. Anchoring makes the five
 * suffixes mutually exclusive, which is also why their order here does not matter.
 */
function resolveVtSubLayerPaint(
    subId: string,
    styleRules: GeoJSONStyleRule[] | undefined,
    mergedFlat: Record<string, unknown>,
    layerId: string
): Record<string, unknown> | null {
    if (subId.endsWith("-fill")) {
        return styleRules?.length
            ? styleRulesToPaint(styleRules, mergedFlat, "fill", layerId)
            : toFillPaint(mergedFlat, layerId);
    }
    if (subId.endsWith("-casing")) {
        const vtCas = mergedFlat.casing as CasingConfig | undefined;
        if (!vtCas?.enabled) return null;
        const mw = typeof mergedFlat.weight === "number" ? (mergedFlat.weight as number) : 1;
        return toCasingPaint(vtCas, mw) as Record<string, unknown>;
    }
    if (subId.endsWith("-line")) {
        return styleRules?.length
            ? styleRulesToPaint(styleRules, mergedFlat, "line")
            : toLinePaint(mergedFlat);
    }
    if (subId.endsWith("-fill-extrusion")) {
        return toFillExtrusionPaint(mergedFlat);
    }
    if (subId.endsWith("-circle")) {
        return styleRules?.length
            ? styleRulesToPaint(styleRules, mergedFlat, "circle")
            : toCirclePaint(mergedFlat);
    }
    return null;
}

/**
 * Creates one VT sub-layer: resolves its paint through {@link resolveVtSubLayerPaint},
 * adds it to the map and records it in the build context.
 *
 * A null paint means "skip" — the only case today is a casing sub-layer whose casing
 * is disabled, which is exactly the condition under which it must not be created.
 *
 * @param ctx Build context carrying the map, the ids, the merged style and the insertion
 *   point — everything the sub-layer needs, gathered once by the caller.
 * @param subType Registry sub-layer type, and the id suffix the paint is resolved from.
 * @param mlType MapLibre layer type — differs from `subType` for casing, which is a `line`.
 */
function _addVtSubLayer(ctx: VtBuildCtx, subType: SubLayerType, mlType: string): void {
    const { map, layerId, sourceId, sourceLayer, mergedFlat, styleRules, vtZoom, beforeId } = ctx;
    const subId = toSubLayerId(layerId, subType);
    const paint = resolveVtSubLayerPaint(subId, styleRules, mergedFlat, layerId);
    if (!paint) return;
    map.addLayer(
        {
            id: subId,
            type: mlType,
            source: sourceId,
            "source-layer": sourceLayer,
            paint,
            ...vtZoom,
        } as MaplibreLayerSpec,
        beforeId
    );
    ctx.createdSubIds.push(subId);
    ctx.createdTypes.push(subType);
}

/** Polygon/mixed → fill sub-layer (registers hatch patterns first). */
function _addVtFillLayer(ctx: VtBuildCtx, geomType: string): void {
    if (!_VT_FILL_GEOM.includes(geomType)) return;
    // Register hatch patterns before creating the fill layer: `toFillPaint` emits a
    // `fill-pattern` referencing them by id.
    const hatchPatterns = collectHatchPatterns(ctx.mergedFlat, ctx.styleRules, ctx.layerId);
    for (const { patternId, hatchConfig } of hatchPatterns) {
        registerHatchPattern(ctx.map, patternId, hatchConfig);
    }
    _addVtSubLayer(ctx, "fill", "fill");
}

/** fill-extrusion → extrusion sub-layer. */
function _addVtFillExtrusionLayer(ctx: VtBuildCtx, geomType: string): void {
    if (geomType !== "fill-extrusion") return;
    _addVtSubLayer(ctx, "fill-extrusion", "fill-extrusion");
}

/** Polygon/line/mixed → optional casing + line sub-layer. */
function _addVtLineLayers(ctx: VtBuildCtx, geomType: string): void {
    if (!_VT_LINE_GEOM.includes(geomType)) return;
    // Casing first: a thicker line behind the main stroke, so it must be added below it.
    // Self-skipping when casing is disabled (null paint).
    _addVtSubLayer(ctx, "casing", "line");
    _addVtSubLayer(ctx, "line", "line");
}

/** Point/mixed → circle sub-layer. */
function _addVtCircleLayer(ctx: VtBuildCtx, geomType: string): void {
    if (!_VT_CIRCLE_GEOM.includes(geomType)) return;
    _addVtSubLayer(ctx, "circle", "circle");
}

/**
 * Adds a native vector-tile source + its styled sub-layers, registering them in the
 * layer registry. Mirrors `buildGeoJSONLayer`: the adapter passes its live map, its
 * registry, and a bound `ensureSentinel` callback.
 *
 * @returns The created sub-layer ids (for interaction binding + bookkeeping).
 */
export function buildVectorTileLayer(
    map: MaplibreMap,
    registry: MaplibreLayerRegistry,
    ensureSentinel: () => void,
    layerId: string,
    spec: VectorTileLayerSpec
): string[] {
    const sourceId = toSourceId(layerId);
    // Remove any stale source left from a previous load cycle (e.g. rapid basemap
    // switching where two rebuilds overlap).
    _removeStaleVtSource(map, layerId, sourceId);
    map.addSource(sourceId, _buildVtSourceConfig(spec));

    const geomType = spec.geometryType.toLowerCase();
    const mergedFlat = _resolveMergedFlat(spec.style);
    // Validate fill-extrusion required fields (throws on missing).
    validateFillExtrusionStyle(layerId, geomType, mergedFlat, null, "vector");

    ensureSentinel();
    const beforeId = map.getLayer(SENTINEL_POI) ? SENTINEL_POI : undefined;
    const vtZoom = _buildVtZoom(spec.subLayerZoom);

    const createdSubIds: string[] = [];
    const createdTypes: SubLayerType[] = [];
    const ctx: VtBuildCtx = {
        map,
        layerId,
        sourceId,
        sourceLayer: spec.sourceLayer,
        mergedFlat,
        styleRules: spec.style?.styleRules as GeoJSONStyleRule[] | undefined,
        vtZoom,
        beforeId,
        createdSubIds,
        createdTypes,
    };
    // Each helper self-guards on geomType.
    _addVtFillLayer(ctx, geomType);
    _addVtFillExtrusionLayer(ctx, geomType);
    _addVtLineLayers(ctx, geomType);
    _addVtCircleLayer(ctx, geomType);

    // Register in the adapter's layer registry (mirrors buildGeoJSONLayer).
    registry.register(layerId, createdTypes, spec.zIndex ?? 0, {
        isVectorTile: true,
        sourceLayer: spec.sourceLayer,
    });

    return createdSubIds;
}

/** Updates the paint of an existing VT layer's sub-layers from raw GeoLeaf style. */
export function updateVectorTileLayerStyle(
    map: MaplibreMap,
    layerId: string,
    subLayerIds: string[],
    style: VectorTileStyleInput
): void {
    const mergedFlat = _resolveMergedFlat(style);
    const styleRules = style?.styleRules as GeoJSONStyleRule[] | undefined;

    // Register hatch patterns for style updates.
    const hatchPatterns = collectHatchPatterns(mergedFlat, styleRules, layerId);
    for (const { patternId, hatchConfig } of hatchPatterns) {
        registerHatchPattern(map, patternId, hatchConfig);
    }

    for (const subId of subLayerIds) {
        if (!map.getLayer(subId)) continue;
        const paint = resolveVtSubLayerPaint(subId, styleRules, mergedFlat, layerId);
        if (!paint) continue;
        for (const [prop, value] of Object.entries(paint)) {
            setPaintAt(map, subId, prop, value);
        }
    }
}
