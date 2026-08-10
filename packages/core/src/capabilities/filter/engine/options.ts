/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter engine — option resolution (S5, F1).
 *
 * `taxonomy` and `tag` share the value-membership predicate; they differ only in
 * where their options come from. Taxonomy options are read from the taxonomy
 * capability via the runtime seam (`GeoLeaf.Taxonomy.getCategories`), so the filter
 * stays decoupled and works whether taxonomy is enabled or not. Tag options are
 * derived from the data (`"auto"`).
 */
"use strict";

import { getFieldValue, normalizeTags } from "./field-access.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import type { FeatureLike } from "./types.js";
import type { TaxonomyCategory } from "../../taxonomy/types.js";

/**
 * The category tree for a named taxonomy, read from the in-core taxonomy
 * capability (`GeoLeaf.Taxonomy.getCategories`). Empty `{}` when taxonomy is
 * disabled or the ref is unknown — the filter then degrades to no options.
 *
 * @param ref - Named taxonomy under `modules.taxonomy.taxonomies` (e.g. `poi-cat`).
 */
export function getCategoryTree(ref?: string): Record<string, TaxonomyCategory> {
    return getGeoLeaf()?.Taxonomy?.getCategories?.(ref ?? "") ?? {};
}

/**
 * Expands a set of selected category ids to include the sub-category ids of any
 * selected parent (hierarchical select: choosing a category selects its children).
 * Falls back to the input unchanged when the category tree is unavailable.
 *
 * @param taxonomyRef - Named taxonomy read from the taxonomy capability.
 * @param selected - Selected category / sub-category ids.
 */
export function expandCategorySelection(taxonomyRef: string, selected: string[]): string[] {
    if (selected.length === 0) return [...selected];
    const cats = getCategoryTree(taxonomyRef);
    const out = new Set<string>(selected);
    for (const id of selected) {
        const sub = cats[id]?.subcategories;
        if (sub) for (const subId of Object.keys(sub)) out.add(subId);
    }
    return Array.from(out);
}

/**
 * Distinct values of a field across a feature set — the `"auto"` option source for
 * `tag` (and, when needed, `enum`). Tag values are tag-normalised (array / CSV /
 * scalar); non-tag values are stringified. Sorted for stable UI order.
 *
 * @param field - Attribute field (dotted path).
 * @param features - Features to scan.
 * @param asTags - Treat the value as a tag list (normalise array / CSV).
 */
export function distinctFieldValues(
    field: string,
    features: FeatureLike[],
    asTags = false
): string[] {
    const out = new Set<string>();
    for (const f of features) {
        const v = getFieldValue(f, field);
        if (asTags) {
            normalizeTags(v).forEach((t) => out.add(t));
        } else if (Array.isArray(v)) {
            v.forEach((x) => out.add(String(x)));
        } else if (v !== null && v !== undefined && v !== "") {
            out.add(String(v));
        }
    }
    return Array.from(out).sort();
}
