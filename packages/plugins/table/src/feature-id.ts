/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table — Feature identity
 * Resolves a stable, deterministic id for a feature, and the stateful synthetic-id
 * counter the renderer uses when a feature carries no id of its own.
 *
 * Split out of `table-renderer-utils.ts` (STRUCT S8, N3): that file cumulated four
 * unrelated responsibilities behind a `utils` name — identity, formatting, an event
 * registry and virtual-scroll constants.
 */

import type { TableFeature } from "./types.js";

/**
 * Counter for generating synthetic row IDs.
 * Must be reset via {@link resetSyntheticIdCounter} before each full render.
 */
let _syntheticIdCounter = 0;

/**
 * Resets the counter behind synthetic feature ids.
 *
 * ⚠️ **Test seam.** Synthetic ids are handed to features that arrive without one; resetting
 * the counter at runtime would let a new feature reuse an id still held by a rendered row.
 */
export function resetSyntheticIdCounter(): void {
    _syntheticIdCounter = 0;
}

/**
 * Minimal feature shape needed to resolve an identity — satisfied by both
 * `TableFeature` (renderer/selection) and `GeoJSONFeature` (export), neither of
 * which carries an incompatible index signature here. Internal to this module.
 */
interface FeatureIdentity {
    id?: string | number;
    properties?: Record<string, unknown>;
}

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
    if (!p) return "__gl_row_" + syntheticIndex;
    for (const key of _FEATURE_ID_PROPS) {
        const v = p[key];
        if (v != null && v !== "") return _str(v);
    }
    return "__gl_row_" + syntheticIndex;
}

/**
 * Stateful wrapper over {@link resolveFeatureId} for the renderer: advances the
 * module synthetic-id counter only when a synthetic id is actually produced
 * (same convention as `table-api.refresh`). Reset via {@link resetSyntheticIdCounter}.
 */
export function getFeatureId(feature: TableFeature): string {
    const id = resolveFeatureId(feature, _syntheticIdCounter);
    if (id.startsWith("__gl_row_")) _syntheticIdCounter++;
    return id;
}
