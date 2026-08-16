/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter capability — taxonomy expansion + panel options.
 *
 * Geometry-agnostic and **decoupled by construction**: reads taxonomy through the
 * runtime seam, with no static import of POI or Route.
 *
 * Historically this module also held a pure-native filtering path (translate the filter
 * into a MapLibre expression, let the GPU evaluate it). It was complete and tested, but
 * never called — and it was retired in S5/N-4 rather than wired: `text` is JS-only and
 * present in 9 profiles out of 9, 6 of the 9 had no natively expressible field at all
 * (zero gain), and the one profile that would have gained is clustered — a native
 * `setFilter` there leaves cluster counts stale, a guard `apply.ts` has and this path
 * never did. The filter is applied by `apply.ts` through the `GeoJSONCore.filterFeatures`
 * seam, which is the single writer of the layer filter.
 */

import { expandCategorySelection, getCategoryTree } from "./engine/options.js";
import type { ActiveField } from "./engine/types.js";
import type { FilterConfig } from "./types.js";
import type { FieldOptions, OptionsByField } from "./panel/render.js";

/**
 * Expands taxonomy selections (a selected parent category also selects its
 * sub-categories) before predicate/expression evaluation. Other kinds pass through
 * unchanged.
 */
export function expandActiveFilter(active: ActiveField[]): ActiveField[] {
    return active.map((af) => {
        if (af.descriptor.kind === "taxonomy" && af.values?.length) {
            // `taxonomyRef` selects the named taxonomy read from the taxonomy
            // capability (`GeoLeaf.Taxonomy.getCategories`).
            return {
                ...af,
                values: expandCategorySelection(af.descriptor.taxonomyRef ?? "", af.values),
            };
        }
        return af;
    });
}

/**
 * Resolves the panel option lists the renderer needs, from the config:
 * `taxonomy` → the category tree via `getCategoryTree` (the taxonomy capability);
 * `tag` with a declared list → those values. `tag: "auto"` is resolved live from
 * the data (F4) and is left empty here. Fields with no options
 * (text/range/boolean/proximity) are omitted.
 */
export function resolveFieldOptions(config: FilterConfig): OptionsByField {
    const out: OptionsByField = {};
    for (const field of config.fields ?? []) {
        if (field.kind === "taxonomy") {
            out[field.id] = { categories: getCategoryTree(field.taxonomyRef) };
        } else if (field.kind === "tag" && Array.isArray(field.options)) {
            const values: FieldOptions["values"] = field.options.map((v) => ({ value: v }));
            out[field.id] = { values };
        }
    }
    return out;
}
