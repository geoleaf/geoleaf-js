/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Taxonomy capability — the marker disc.
 *
 * Builds the MapLibre paint that draws a coloured disc under a point's icon.
 *
 * **The cardinal rule: taxonomy replaces the DEFAULT, it does not outrank the
 * layer.** `styleRulesToPaint` emits `["case", cond₁, val₁, …, DEFAULT]` for every
 * paint key that varies across a layer's style rules. Taxonomy rewrites only the
 * DEFAULT — the last element — into a `match` on the category column, which in
 * turn falls back to that same old default. So the effective cascade is:
 *
 *     styleRules  >  sub-category  >  category  >  the layer's own default
 *
 * A layer that colours its points by `mag` or `fclass` therefore keeps doing so;
 * taxonomy only colours what the layer left unsaid.
 *
 * Taxonomy owns `circle-color`, `circle-stroke-color` and `circle-stroke-width`
 * — plus `circle-opacity` in the single `marker: false` case (a bare icon). It
 * deliberately never touches `circle-radius`: size belongs to the layer.
 */
"use strict";

import type { TaxonomyCategory, TaxonomyConfig } from "./types.js";
import { resolveLayerBinding } from "./resolver.js";

/** A MapLibre style expression (JSON array form). */
type StyleExpression = unknown[];

/** Extracts one paint value from a category entry, or `undefined` to leave it alone. */
type MarkerPick = (cat: TaxonomyCategory) => unknown;

/** One MapLibre paint key taxonomy can drive, with its picker and its spec default. */
interface MarkerRole {
    /** The MapLibre paint property. */
    key: string;
    /** Reads the value this category wants for that property. */
    pick: MarkerPick;
    /**
     * MapLibre's OWN spec default, used when the layer declares nothing for this
     * key. Deliberately not `_getPaintDefault()` from the style converter, which
     * returns `DEFAULT_FEATURE_COLOR` (`#cccccc`) — that would paint a colour where
     * the layer had asked for none.
     */
    specDefault: unknown;
}

/**
 * The four paint keys taxonomy drives.
 *
 * `marker: false` means "bare icon": the disc is hidden with `circle-opacity: 0`
 * and `circle-stroke-width: 0`, rather than by inventing a transparent colour.
 * Note the pickers return `undefined` for a category that declares no marker —
 * such a category simply falls through to the layer's default.
 */
const MARKER_ROLES: readonly MarkerRole[] = [
    {
        key: "circle-color",
        pick: (cat) => (cat.marker ? cat.marker.fill : undefined),
        specDefault: "#000000",
    },
    {
        key: "circle-stroke-color",
        pick: (cat) => (cat.marker ? cat.marker.stroke : undefined),
        specDefault: "#000000",
    },
    {
        key: "circle-stroke-width",
        // `0` is meaningful here (a disc with no border), so test for `false` first
        // and let a declared `strokeWidth: 0` through untouched.
        pick: (cat) => (cat.marker === false ? 0 : cat.marker?.strokeWidth),
        specDefault: 0,
    },
    {
        key: "circle-opacity",
        pick: (cat) => (cat.marker === false ? 0 : undefined),
        specDefault: 1,
    },
];

/** Case-folded MapLibre getter for a feature field — mirrors `resolveCategoryKey`. */
function fieldGetter(field: string): StyleExpression {
    return ["downcase", ["to-string", ["get", field]]];
}

/**
 * Builds the `match` branches for one role, nested BY CATEGORY.
 *
 * The nesting is not cosmetic. Sub-category labels are only unique *within* a
 * category: `tourism` declares both `nature.parc` and `Environnement.PARC`, which
 * case-fold to the same `"parc"`. A flat `match` on the sub-category column would
 * collide and silently give one of them the other's colour. Matching the category
 * first, then the sub-category inside that branch, keeps them apart.
 *
 * @returns The branch pairs, or `null` when no category declares anything for
 *   this role (the key is then left entirely alone).
 */
function buildRoleMatch(
    categories: Record<string, TaxonomyCategory>,
    role: MarkerRole,
    categoryField: string,
    subCategoryField: string | undefined,
    fallback: unknown
): StyleExpression | null {
    const seen = new Set<string>();
    const branches: Array<[string, unknown]> = [];

    for (const [value, cat] of Object.entries(categories)) {
        const label = value.toLowerCase();
        if (seen.has(label)) continue; // first wins — MapLibre match labels must be unique
        seen.add(label);

        const own = role.pick(cat);
        const subExpr = subCategoryField
            ? buildSubMatch(cat, role, subCategoryField, own ?? fallback)
            : null;

        // A category with nothing of its own AND no sub-category branch contributes
        // nothing — dropping it lets it fall through to the global fallback.
        if (subExpr) branches.push([label, subExpr]);
        else if (own !== undefined) branches.push([label, own]);
    }

    if (branches.length === 0) return null;

    const expr: StyleExpression = ["match", fieldGetter(categoryField)];
    for (const [label, value] of branches) expr.push(label, value);
    expr.push(fallback);
    return expr;
}

/**
 * Builds the inner `match` over one category's sub-categories, or `null` when none
 * of them declares a value for this role.
 *
 * @param cat - The category whose sub-categories are matched over.
 * @param role - Which visual role is being resolved (icon, colour…).
 * @param subCategoryField - Feature property holding the sub-category key.
 * @param inherited - What the feature gets when no sub-category matches: the
 *   category's own value, or the layer default when it has none.
 */
function buildSubMatch(
    cat: TaxonomyCategory,
    role: MarkerRole,
    subCategoryField: string,
    inherited: unknown
): StyleExpression | null {
    const subs = cat.subcategories;
    if (!subs) return null;

    const seen = new Set<string>();
    const branches: Array<[string, unknown]> = [];

    for (const [value, sub] of Object.entries(subs)) {
        const label = value.toLowerCase();
        if (seen.has(label)) continue;
        seen.add(label);
        const own = role.pick(sub);
        if (own !== undefined) branches.push([label, own]);
    }

    if (branches.length === 0) return null;

    const expr: StyleExpression = ["match", fieldGetter(subCategoryField)];
    for (const [label, value] of branches) expr.push(label, value);
    expr.push(inherited);
    return expr;
}

/**
 * Derives the fallback for a paint key from what the layer already declares, and
 * says whether the key may be rewritten at all.
 *
 * Four shapes, one of them off-limits:
 * - **absent** → the MapLibre spec default;
 * - **scalar** → itself (it *is* the layer's default);
 * - `["case", …]` → its last element (the default branch of the style rules);
 * - **any other expression** → hands off. `defaultStyle.expressionPaint` injects
 *   raw MapLibre paint that we did not build and cannot safely take apart.
 */
function deriveFallback(
    existing: unknown,
    specDefault: unknown
): { fallback: unknown; rewritable: true } | { rewritable: false } {
    if (existing === undefined) return { fallback: specDefault, rewritable: true };
    if (!Array.isArray(existing)) return { fallback: existing, rewritable: true };
    if (existing[0] === "case" && existing.length >= 2) {
        return { fallback: existing[existing.length - 1], rewritable: true };
    }
    return { rewritable: false };
}

/**
 * Splices a taxonomy `match` into the layer's existing paint value for one key.
 * A `["case", …]` keeps every one of its style-rule branches and only swaps its
 * default; anything else is replaced outright (the match already carries the old
 * value as its own fallback).
 */
function rewrite(existing: unknown, matchExpr: StyleExpression): unknown {
    if (Array.isArray(existing) && existing[0] === "case") {
        const next = existing.slice();
        next[next.length - 1] = matchExpr;
        return next;
    }
    return matchExpr;
}

/**
 * Builds the taxonomy paint overrides for a point layer.
 *
 * @param config - The `modules.taxonomy` config.
 * @param layerId - GeoLeaf layer id.
 * @param existingPaint - The circle paint as built by `styleRulesToPaint` /
 *   `toCirclePaint`. Read only — never mutated here.
 * @returns The paint keys to override, or `null` when taxonomy has nothing to say
 *   about this layer (disabled, unbound, or no category declares a `marker`).
 */
export function buildMarkerPaint(
    config: TaxonomyConfig,
    layerId: string,
    existingPaint: Record<string, unknown>
): Record<string, unknown> | null {
    if (config.enabled === false) return null;

    const binding = resolveLayerBinding(config, layerId);
    if (!binding) return null;

    const result: Record<string, unknown> = {};

    for (const role of MARKER_ROLES) {
        const derived = deriveFallback(existingPaint[role.key], role.specDefault);
        if (!derived.rewritable) continue;

        const matchExpr = buildRoleMatch(
            binding.def.categories,
            role,
            binding.categoryField,
            binding.subCategoryField,
            derived.fallback
        );
        if (!matchExpr) continue;

        result[role.key] = rewrite(existingPaint[role.key], matchExpr);
    }

    return Object.keys(result).length > 0 ? result : null;
}
