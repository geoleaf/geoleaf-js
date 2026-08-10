/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter engine — JS predicate (S5, F1).
 *
 * Geometry-agnostic, always-correct fallback path: given the active field
 * selections and a feature, decide visibility. `taxonomy` and `tag` share one
 * value-membership engine (a tag is a flat taxonomy). Per-layer scoping is
 * opt-in: a field with no `layers` applies everywhere; a field with `layers`
 * applies only to those layers.
 */
"use strict";

import { featureCentroid, getFieldTags, getFieldValue, haversine } from "./field-access.js";
import type { ActiveField, FeatureLike } from "./types.js";
import type { FilterFieldDescriptor } from "../types.js";

/** Truthiness for `boolean` fields — accepts `true`/`1`/`"true"`/`"1"`/`"yes"`. */
function _isTruthy(v: unknown): boolean {
    if (v === true || v === 1) return true;
    if (typeof v === "string") return ["true", "1", "yes", "y"].includes(v.trim().toLowerCase());
    return false;
}

/**
 * `taxonomy` — feature's category value ∈ selected values. Two-level: matches on
 * `field` (category) OR, when declared, `subField` (sub-category) — so selecting a
 * parent category (expanded to its children) and selecting a leaf sub-category both
 * work, mirroring the former `_resolveCatId` / `_resolveSubId`.
 */
function _matchesValueSet(active: ActiveField, feature: FeatureLike): boolean {
    const values = active.values ?? [];
    if (values.length === 0) return true;
    const v = String(getFieldValue(feature, active.descriptor.field ?? "") ?? "");
    if (values.includes(v)) return true;
    const subField = active.descriptor.subField;
    if (subField) {
        const sub = String(getFieldValue(feature, subField) ?? "");
        if (values.includes(sub)) return true;
    }
    return false;
}

/** `tag` — feature's field tags ∩ selected values ≠ ∅. */
function _matchesTags(active: ActiveField, feature: FeatureLike): boolean {
    const values = active.values ?? [];
    if (values.length === 0) return true;
    const tags = getFieldTags(feature, active.descriptor.field ?? "");
    return values.some((t) => tags.includes(t));
}

/** `range` — min ≤ Number(field) ≤ max (either bound optional). */
function _matchesRange(active: ActiveField, feature: FeatureLike): boolean {
    const { min, max } = active.range ?? {};
    if (min === undefined && max === undefined) return true;
    const n = Number(getFieldValue(feature, active.descriptor.field ?? ""));
    if (Number.isNaN(n)) return false;
    if (min !== undefined && n < min) return false;
    if (max !== undefined && n > max) return false;
    return true;
}

/**
 * Diacritic- and case-insensitive text normalization: decomposes accents
 * (NFD) and drops the combining marks, then lowercases — so `recif` matches
 * `Récif`. Kept local (no dependency) and cheap enough for per-feature use.
 */
function _normalizeText(s: string): string {
    return s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
}

/**
 * `text` — accent-insensitive, word-order-independent match against the
 * descriptor's `searchFields`. The query is split into whitespace-separated
 * terms; a field matches when it contains every term (in any order). A field
 * holding the terms contiguously still matches, so this is a strict superset of
 * the former single-substring behaviour (`recif` → `Récif`, `gilles récif` →
 * `Le Récif — Saint-Gilles`).
 */
function _matchesText(active: ActiveField, feature: FeatureLike): boolean {
    const terms = _normalizeText(active.text ?? "")
        .split(/\s+/)
        .filter(Boolean);
    if (terms.length === 0) return true;
    const fields = active.descriptor.searchFields ?? [];
    const fieldMatches = (val: unknown): boolean => {
        const hay = _normalizeText(String(val));
        return terms.every((t) => hay.includes(t));
    };
    return fields.some((f) => {
        const val = getFieldValue(feature, f);
        if (Array.isArray(val)) return val.some((x) => fieldMatches(x));
        return val !== null && val !== undefined && fieldMatches(val);
    });
}

/** `proximity` — haversine(center, feature centroid) ≤ radius. */
function _matchesProximity(active: ActiveField, feature: FeatureLike): boolean {
    const p = active.proximity;
    if (!p || !p.center) return true;
    const c = featureCentroid(feature);
    if (!c) return false;
    return haversine(p.center.lat, p.center.lng, c.lat, c.lng) <= p.radius;
}

/**
 * Whether a single active field passes for a feature. An inactive/empty selection
 * always passes (the field simply does not constrain).
 */
export function fieldPredicate(active: ActiveField, feature: FeatureLike): boolean {
    switch (active.descriptor.kind) {
        case "taxonomy":
            return _matchesValueSet(active, feature);
        case "tag":
            return _matchesTags(active, feature);
        case "boolean":
            return active.bool !== true
                ? true
                : _isTruthy(getFieldValue(feature, active.descriptor.field ?? ""));
        case "range":
            return _matchesRange(active, feature);
        case "text":
            return _matchesText(active, feature);
        case "proximity":
            return _matchesProximity(active, feature);
        default:
            return true;
    }
}

/**
 * Whether a field applies to a layer. Opt-in scope: `layers` absent (or empty) ⟹
 * all layers; `layers` present ⟹ only those layers (a layer not listed is not
 * filtered by this field).
 */
export function fieldAppliesToLayer(descriptor: FilterFieldDescriptor, layerId: string): boolean {
    if (!descriptor.layers || descriptor.layers.length === 0) return true;
    return descriptor.layers.includes(layerId);
}

/**
 * Whether a feature on `layerId` passes the whole active filter — the conjunction
 * of every active field that applies to that layer.
 */
export function featurePasses(
    active: ActiveField[],
    feature: FeatureLike,
    layerId: string
): boolean {
    for (const af of active) {
        if (!fieldAppliesToLayer(af.descriptor, layerId)) continue;
        if (!fieldPredicate(af, feature)) return false;
    }
    return true;
}
