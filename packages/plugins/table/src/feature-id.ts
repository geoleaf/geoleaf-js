/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table — Feature identity
 * Resolves a stable, deterministic id for a feature.
 *
 * ⚠️ **The stateful counter that used to live here is gone.** It was a module
 * variable reset only by `render()`, while `updateVirtualRows` minted rows without that
 * reset: after a scroll a row displaying one feature carried the id of another. Identity
 * is now resolved once per load by `view-model.buildRows`, which passes the synthetic
 * index explicitly — so there is nothing left to get out of step.
 *
 * Split out of `table-renderer-utils.ts` (STRUCT S8, N3): that file cumulated four
 * unrelated responsibilities behind a `utils` name — identity, formatting, an event
 * registry and virtual-scroll constants.
 */

/**
 * Minimal feature shape needed to resolve an identity — satisfied by both
 * `TableFeature` (renderer/selection) and `GeoJSONFeature` (export), neither of
 * which carries an incompatible index signature here. Internal to this module.
 */
interface FeatureIdentity {
    id?: string | number;
    properties?: Record<string, unknown>;
}

/** Prefix of the ids minted for features that carry no natural identifier. */
const SYNTHETIC_PREFIX = "__gl_row_";

/** Candidate id-bearing property names, tried in order after the GeoJSON `id`. */
const _FEATURE_ID_PROPS = ["id", "fid", "osm_id", "OBJECTID", "SITE_ID", "code", "IN1"];

/**
 * Serializes a value to a stable string key without the lossy `[object Object]`
 * (JSON for objects/arrays, `String` otherwise). Shared with the exporter so
 * that DOM ids and `_featureIdMap` keys live in the same space.
 */
export function _str(v: unknown): string {
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
}

/**
 * Resolves a feature's id — pure and deterministic. Tries the GeoJSON `id`,
 * then the known id-bearing properties, then a synthetic `__gl_row_<n>` from the
 * caller-supplied index. Single source of truth shared by the renderer (DOM
 * `data-feature-id`) and the exporter / `table-api` (`_featureIdMap` keys): they
 * must never resolve the same feature to different ids, or a selected row can no
 * longer be found (highlight / zoom / export-of-selection silently no-op).
 */
export function resolveFeatureId(feature: FeatureIdentity, syntheticIndex: number): string {
    if (feature.id != null && feature.id !== "") return String(feature.id);
    const p = feature.properties;
    if (!p) return SYNTHETIC_PREFIX + syntheticIndex;
    for (const key of _FEATURE_ID_PROPS) {
        const v = p[key];
        if (v != null && v !== "") return _str(v);
    }
    return SYNTHETIC_PREFIX + syntheticIndex;
}

/**
 * Mints the identity of every feature of a layer, in LOAD order — the ONE numbering.
 *
 * ⚠️ The synthetic index is the **count of synthetic ids handed out so far**, not the array
 * index: a layer mixing identified and unidentified features would otherwise skip numbers. The
 * table's model and the exports both call this function, so a feature cannot be named one way
 * in the table and another in an exported file — the exports used to pass the array index.
 *
 * 🛑 It numbers a LAYER, from its first feature. Called on a subset — a selection — it would
 * start again at zero and hand out names that belong to other features: a subset is exported
 * with the identifiers its features already have.
 *
 * @param features - The layer's features, in load order.
 * @returns One id per feature, positionally aligned with `features`.
 */
export function mintFeatureIds(features: readonly FeatureIdentity[]): string[] {
    const ids: string[] = [];
    let synthetic = 0;
    for (const feature of features) {
        const id = resolveFeatureId(feature, synthetic);
        if (id.startsWith(SYNTHETIC_PREFIX)) synthetic++;
        ids.push(id);
    }
    return ids;
}
