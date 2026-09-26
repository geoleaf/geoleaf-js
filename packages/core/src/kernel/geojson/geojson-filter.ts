/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON — Feature Filter Helpers
 * Extracted from geojson/core.ts.
 * Handles geometry-type filtering and per-feature visibility for filterFeatures().
 *
 * The filter is geometry-agnostic: a line layer is filtered exactly like a point or polygon
 * layer. It used to skip every line layer unless it declared `search.enabled: true` — a key the
 * profile schema dropped, so no profile could opt a line layer back in and the documented
 * behaviour was unreachable. A vector-tile layer keeps no feature in memory: the JS predicate has
 * nothing to run on, so it is left unfiltered.
 */

import { GeoJSONShared } from "./shared.ts";
import { geometryKindToGeoJSONTypes } from "../config/layer-geometry.js";
import type { GeoJSONFeature } from "./geojson-types.js";
import type { GeoJSONLayerEntry, GeoJSONSharedState } from "./core-types.js";

/** Predicate deciding whether a feature stays visible. */
type FeatureFilterFn = (feature: GeoJSONFeature, layerId: string) => boolean;

/** Running tally accumulated while filtering. */
interface FilterStats {
    filtered: number;
    total: number;
    visible: number;
}

/** Options narrowing which layers / geometry types are filtered. */
interface FilterOptions {
    layerIds?: string | string[];
    geometryType?: string;
}

/** Options for {@link getFeatures}. */
interface GetFeaturesOptions {
    geometryTypes?: string[];
    layerIds?: string[];
}

/** A returned feature, shallow-tagged with its owning layer id (`_layerId`). */
type TaggedFeature = GeoJSONFeature & { _layerId?: string; [key: string]: unknown };

/**
 * Resolves the list of layer IDs to process, optionally filtered by geometry type.
 * @internal
 */
export function _resolveGeometryFilteredIds(
    state: GeoJSONSharedState,
    options: FilterOptions
): string[] {
    const layerIds: string[] = options.layerIds
        ? Array.isArray(options.layerIds)
            ? options.layerIds
            : [options.layerIds]
        : Array.from(state.layers.keys());

    if (!options.geometryType) return layerIds;

    const requested = _geometryBucket(options.geometryType);

    return layerIds.filter((id) => {
        const data = state.layers.get(id);
        if (!data) return false;
        return _geometryBucket(data.geometryType || "") === requested;
    });
}

/** Legacy bucket names accepted by `filterFeatures({ geometryType })`, kept for its callers. */
const _BUCKET_ALIASES: Readonly<Record<string, string>> = {
    poi: "point",
    route: "line",
    area: "polygon",
};

/**
 * The bucket (`point`, `line` or `polygon`) a declared geometry kind belongs to.
 *
 * Every spelling the profile schema accepts folds into its family — `polyline`, `multiline`,
 * `multipoint`, `multipolygon`, `fill-extrusion` — and so do the GeoJSON names; the family table
 * is the one `layer-geometry.ts` holds for the whole core. A kind that names no family (`mixed`,
 * `unknown`) stays itself, lowercased, so it only ever matches itself.
 */
function _geometryBucket(kind: string): string {
    const lower = kind.toLowerCase();
    const alias = _BUCKET_ALIASES[lower];
    if (alias) return alias;
    const types = geometryKindToGeoJSONTypes(kind);
    if (types.has("Point") || types.has("MultiPoint")) return "point";
    if (types.has("LineString") || types.has("MultiLineString")) return "line";
    if (types.has("Polygon") || types.has("MultiPolygon")) return "polygon";
    return lower;
}

/** Opaque MapLibre filter expression at this module boundary. */
type FilterExpr = unknown;

/** Sentinel id no real feature carries — yields a "match nothing" filter. */
const _NONE_ID = "__geoleaf_filter_none__";

/**
 * True when the layer is (or may be) clustered. A clustered source derives its
 * cluster counts from the **full** source, so filtering must re-feed the data
 * (`setData`) rather than a GPU `setFilter` that would leave stale counts.
 * Over-approximates: any clustering signal falls back to the safe re-feed path.
 * @internal
 */
function _isClusteredLayer(layerData: GeoJSONLayerEntry): boolean {
    const cfg = layerData.config as Record<string, unknown> | undefined;
    return (
        layerData.clusterGroup != null ||
        cfg?.cluster === true ||
        cfg?.clustering === true ||
        typeof cfg?.clusterRadius === "number" ||
        typeof cfg?.disableClusteringAtZoom === "number"
    );
}

/**
 * Reads a feature's `properties.id` (the field `["get","id"]` resolves), else null.
 *
 * Exported under a public name below as `readFeaturePropId` — the diff path addresses
 * features in this same id space, and reading it a second way would let the two drift.
 */
function _readPropId(feature: GeoJSONFeature): string | number | null {
    const pid = feature.properties?.id;
    return typeof pid === "string" || typeof pid === "number" ? pid : null;
}

/**
 * True when every feature carries a **unique** `properties.id`.
 *
 * The precondition for GPU id-filtering — missing or duplicate ids would filter the
 * wrong features, so those layers use the `setData` re-feed path instead — and, since
 * R6, the precondition for partial source updates as well: MapLibre addresses a
 * feature by id and by nothing else.
 *
 * 🛑 **ONE definition, deliberately shared** (exported below as
 * `canIdentifyFeatures`). Two subsystems now decide "can this layer be addressed by
 * id?", and a second, separately-written predicate would eventually disagree with this
 * one on some layer — at which point the GPU filter and the diff would hold different
 * beliefs about the same features, and the symptom would be features that vanish.
 * @internal
 */
function _canFilterById(features: GeoJSONFeature[]): boolean {
    const seen = new Set<string>();
    for (const feature of features) {
        const id = _readPropId(feature);
        if (id == null) return false;
        const key = String(id);
        if (seen.has(key)) return false;
        seen.add(key);
    }
    return true;
}

/**
 * Builds a GPU filter selecting exactly the visible features by id, or `null`
 * when all are visible (clears any active filter). Uses `match`, which MapLibre
 * compiles to an O(1)/feature hash lookup, so a large id list stays cheap.
 * @internal
 */
function _buildIdFilter(total: number, visible: GeoJSONFeature[]): FilterExpr {
    if (visible.length === total) return null;
    const ids = visible.length > 0 ? visible.map((f) => String(_readPropId(f))) : [_NONE_ID];
    return ["match", ["to-string", ["get", "id"]], ids, true, false];
}

/**
 * Applies a filter predicate to all features in a single layer,
 * showing or hiding each feature via the visibility helpers.
 *
 * Every geometry goes through the same path. A layer with no feature in memory — empty, or a
 * vector-tile layer — is left as it is and counts for nothing.
 * @internal
 */
export function _applyFeatureVisibilityForLayer(
    layerData: GeoJSONLayerEntry,
    filterFn: FeatureFilterFn,
    layerId: string,
    stats: FilterStats
): void {
    const features: GeoJSONFeature[] = layerData.features || [];
    if (!features.length) return;

    const visibleFeatures = features.filter((feature) => filterFn(feature, layerId));

    stats.total += features.length;
    stats.visible += visibleFeatures.length;
    stats.filtered += features.length - visibleFeatures.length;

    const adapter = GeoJSONShared.state?.adapter;
    if (!adapter) return;

    // GPU-native path (RM-P1): apply the JS-computed visible set through
    // `map.setFilter` on feature ids — zero source re-tiling. Restricted to
    // non-clustered layers whose features all carry a unique `properties.id`.
    // Everything else re-feeds the data so cluster counts stay correct and
    // id-less features remain filterable. The predicate above is unchanged, so
    // *what* is filtered is identical to the legacy path — only *how* differs.
    if (
        typeof adapter.setLayerFilter === "function" &&
        !_isClusteredLayer(layerData) &&
        _canFilterById(features)
    ) {
        adapter.setLayerFilter(layerId, _buildIdFilter(features.length, visibleFeatures));
        return;
    }

    if (typeof adapter.updateLayerData === "function") {
        adapter.updateLayerData(layerId, {
            type: "FeatureCollection",
            features: visibleFeatures,
        });
    }
}

/**
 * Returns all loaded features, each shallow-tagged with its owning layer id.
 * Reads directly from state.layers (featureCache removed).
 *
 * @param options - Optional narrowing by geometry type and/or layer id.
 * @returns GeoJSON features enriched with `{ _layerId }`.
 */
export function getFeatures(options: GetFeaturesOptions = {}): TaggedFeature[] {
    const state = GeoJSONShared.state;
    if (!state) return [];

    const geometrySet = Array.isArray(options.geometryTypes)
        ? new Set(options.geometryTypes.map((t) => t.toLowerCase()))
        : null;
    const layerSet = Array.isArray(options.layerIds) ? new Set(options.layerIds) : null;

    const result: TaggedFeature[] = [];
    state.layers.forEach((layerData, layerId) => {
        if (layerSet && !layerSet.has(layerId)) return;
        const geoType = (layerData.geometryType || "").toLowerCase();
        if (geometrySet && !geometrySet.has(geoType)) return;

        (layerData.features || []).forEach((f) => {
            if (f && typeof f === "object") {
                // Shallow tag with _layerId instead of full Object.assign clone
                const tagged = f as TaggedFeature;
                tagged._layerId = layerId;
                result.push(tagged);
            }
        });
    });
    return result;
}

/**
 * Public name for the layer-identifiability predicate — see `_canFilterById`.
 *
 * The kernel calls it once per whole-collection write, caches the answer on the layer
 * entry, and reads that cache on every unit mutation. That placement is the whole
 * economy of the diff path: the predicate is O(N), so paying it per mutation would
 * cost exactly what the diff was introduced to save.
 */
export function canIdentifyFeatures(features: GeoJSONFeature[]): boolean {
    return _canFilterById(features);
}

/** Public name for `_readPropId` — the id space a diff addresses features in. */
export function readFeaturePropId(feature: GeoJSONFeature): string | number | null {
    return _readPropId(feature);
}
