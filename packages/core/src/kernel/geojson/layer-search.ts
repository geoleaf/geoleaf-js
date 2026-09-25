/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Layer search — finds features by reference in the layers the map holds, with no network.
 *
 * Body of `GeoLeaf.Layers.search`. It reads the in-memory layer store and nothing else — the
 * collection each layer's source was last fed. That store already holds what matters offline:
 * a layer that declares an offline read is loaded from the device store before the network is
 * tried (`loader/single-layer.ts`), so searching memory IS searching what was pulled — plus
 * the static layers the service worker serves, which the device store never holds. Two cases
 * are out of reach, by construction rather than by omission: a layer never loaded
 * (`active: false`, not yet switched on) holds nothing in memory, and a vector-tile layer
 * keeps no feature at all.
 *
 * Only layers declaring `searchable: { fields }` are searched, on those fields and on the
 * feature's id. The matching rule is the filter's (`utils/general/normalize-text.ts`): the
 * same words find the same features whether the user filters the map or searches it.
 *
 * 🛑 **The index is a second copy of the store, and it is invalidated at the store's writers,
 * not guessed at here.** Normalizing every value on every keystroke costs ~19 ms over 30 000
 * features × 2 fields on a desktop, several times that on a phone; an index built once costs
 * about the same, then well under a millisecond per query. It lives on the layer entry
 * (`_searchIndex`), like `_diffable`, and the three writers that can change what it holds
 * clear it: `GeoJSONShared.setLayerCollection` (every whole-collection write),
 * `applyLayerDiff` (every unit mutation) and the silent branch of `patchFeature`, which
 * rewrites properties in place and passes through neither. The index also checks it still
 * describes the same array of the same length — a writer added later that forgets to clear it
 * then costs a rebuild, not a stale answer.
 */

import { GeoJSONShared } from "./shared.js";
import { readFeaturePropId } from "./geojson-filter.js";
import { getNestedValue } from "../../utils/general/object-utils.js";
import {
    matchesNormalized,
    normalizeText,
    searchTerms,
} from "../../utils/general/normalize-text.js";
import { geometryBounds, representativePoint } from "../../utils/geo/geometry-bounds.js";
import type { GeoJSONLayerEntry } from "./core-types.js";
import type { GeoJSONFeature } from "./geojson-types.js";
import type { FeatureMatch, LayerSearchOptions } from "../../contracts/layer-data.contract.js";

/** Results returned when the caller names no `limit`. */
const DEFAULT_LIMIT = 10;

/** One feature, as the index keeps it. */
interface IndexRow {
    feature: GeoJSONFeature;
    /** The feature's id as text, or `null` when it carries none. */
    id: string | null;
    /** Normalized id, or `null`. */
    idNorm: string | null;
    /** Normalized values of the declared fields, arrays flattened. */
    fieldNorms: string[];
    /** First non-empty declared field value, verbatim — what a result displays. */
    display: string | null;
}

/** A layer's index, and what it was built from. */
interface LayerIndex {
    features: GeoJSONFeature[];
    length: number;
    fields: string;
    rows: IndexRow[];
}

/** The declared fields of a searchable layer, or `null` when the layer is not searchable. */
function searchableFields(entry: GeoJSONLayerEntry): string[] | null {
    const decl = (entry.config as { searchable?: { fields?: unknown } } | undefined)?.searchable;
    const fields = Array.isArray(decl?.fields)
        ? decl.fields.filter((f): f is string => typeof f === "string" && f.length > 0)
        : [];
    return fields.length > 0 ? fields : null;
}

/** Reads a field at the feature root first, then under `properties` — the filter's order. */
function readField(feature: GeoJSONFeature, path: string): unknown {
    const direct = getNestedValue(feature, path);
    if (direct !== null) return direct;
    return getNestedValue(feature.properties as object | null | undefined, path);
}

/** The feature's id as text — `properties.id` (what the source is keyed on), then `id`. */
function featureId(feature: GeoJSONFeature): string | null {
    const raw = readFeaturePropId(feature) ?? (feature as { id?: unknown }).id;
    return typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
}

/** Builds one row: the id and every declared value, normalized once. */
function buildRow(feature: GeoJSONFeature, fields: readonly string[]): IndexRow {
    const id = featureId(feature);
    const fieldNorms: string[] = [];
    let display: string | null = null;
    for (const path of fields) {
        const value = readField(feature, path);
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
            if (v === null || v === undefined || v === "") continue;
            if (display === null) display = String(v);
            fieldNorms.push(normalizeText(String(v)));
        }
    }
    return { feature, id, idNorm: id === null ? null : normalizeText(id), fieldNorms, display };
}

/** The layer's index, rebuilt only when the store changed under it. */
function indexFor(entry: GeoJSONLayerEntry, fields: string[]): IndexRow[] {
    const features = entry.features ?? [];
    const key = fields.join("\u0000");
    const cached = entry._searchIndex as LayerIndex | undefined;
    if (
        cached &&
        cached.features === features &&
        cached.length === features.length &&
        cached.fields === key
    ) {
        return cached.rows;
    }
    const rows = features.map((f) => buildRow(f, fields));
    entry._searchIndex = { features, length: features.length, fields: key, rows };
    return rows;
}

/**
 * Ranks a row against a query: 0 exact id, 1 exact field value, 2 id or value starting with
 * the query, 3 every term somewhere in the id or one value — or `-1`, no match.
 */
function rank(row: IndexRow, query: string, terms: readonly string[]): number {
    if (row.idNorm === query) return 0;
    if (row.fieldNorms.includes(query)) return 1;
    if (row.idNorm?.startsWith(query) || row.fieldNorms.some((v) => v.startsWith(query))) {
        return 2;
    }
    if (row.idNorm !== null && matchesNormalized(row.idNorm, terms)) return 3;
    return row.fieldNorms.some((v) => matchesNormalized(v, terms)) ? 3 : -1;
}

/** Turns a row into the result a caller receives. */
function toMatch(row: IndexRow, layerId: string, layerLabel: string): FeatureMatch | null {
    const at = representativePoint(row.feature.geometry);
    if (!at) return null;
    const match: FeatureMatch = {
        label: row.display ?? row.id ?? layerLabel,
        lat: at.lat,
        lng: at.lng,
        layerId,
        layerLabel,
        featureId: row.id,
    };
    if (row.feature.geometry?.type !== "Point") {
        const box = geometryBounds(row.feature.geometry);
        if (box && (box.north !== box.south || box.east !== box.west)) match.bounds = box;
    }
    return match;
}

/**
 * Searches the searchable layers the map holds — the body of `GeoLeaf.Layers.search`, whose
 * contract (`layer-data.contract.ts`) says what a caller may rely on.
 *
 * @param query - What the user typed.
 * @param opts - `limit` (default 10) and `layerIds` (default: every searchable layer).
 * @returns Matches, best first.
 */
export function searchLayers(query: string, opts: LayerSearchOptions = {}): FeatureMatch[] {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const normalizedQuery = terms.join(" ");
    const limit = opts.limit ?? DEFAULT_LIMIT;
    if (limit <= 0) return [];
    const only = opts.layerIds ? new Set(opts.layerIds) : null;

    // Buckets by rank: the order within a bucket is the store's (layer, then feature), which
    // keeps the result stable without sorting what will be thrown away.
    const buckets: Array<Array<{ row: IndexRow; layerId: string; label: string }>> = [
        [],
        [],
        [],
        [],
    ];
    for (const [layerId, entry] of GeoJSONShared.state.layers) {
        if (only && !only.has(layerId)) continue;
        const fields = searchableFields(entry);
        if (!fields) continue;
        const label = entry.label ?? layerId;
        for (const row of indexFor(entry, fields)) {
            const r = rank(row, normalizedQuery, terms);
            if (r >= 0) buckets[r]?.push({ row, layerId, label });
        }
    }

    const out: FeatureMatch[] = [];
    for (const bucket of buckets) {
        for (const hit of bucket) {
            const match = toMatch(hit.row, hit.layerId, hit.label);
            if (match) out.push(match);
            if (out.length >= limit) return out;
        }
    }
    return out;
}
