/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The fields the taxonomy reads on a layer — its side of the kernel's declared-fields slot.
 *
 * A layer bound to a taxonomy is read by two names: `categoryField` and, optionally,
 * `subCategoryField`, each declared by the taxonomy and overridable per layer. A name the data
 * does not carry resolves no category: the icon falls back to the category's, or to the default,
 * and the marker disc to its plain colour — silently. The kernel's diagnostic now says so; this
 * file tells it which names, and how the taxonomy looks for them.
 *
 * PURE — the installer's closure reads the running config and calls it; the guard over the
 * repository's profiles calls it on a profile's own config.
 */

import type { DeclaredField, DeclaredFieldFeature } from "../../kernel/shared/index.js";
import { hasField, resolveLayerBinding } from "./resolver.js";
import type { TaxonomyConfig } from "./types.js";

type BindingField = "categoryField" | "subCategoryField";

/**
 * The taxonomy's declared fields for one layer, under its reader's rule.
 *
 * The rule is applied to the shape the symbol injector hands the resolver at load time —
 * `{ layerId, properties }` —, so a name that only a nested `properties.attributes` holds is not
 * called carried: no reader of the icon would see it there.
 *
 * @param config - The `modules.taxonomy` block — the running config, or a profile's own.
 * @param layerId - The layer judged.
 * @returns The category field and, when declared, the sub-category field — each keyed by where
 *          it is declared (the layer's override, or the taxonomy) —; none when the layer is not
 *          bound or the taxonomy is disabled.
 * @example
 * taxonomyDeclaredFields(getTaxonomyConfig(), "candelabres");
 * // → [{ key: "modules.taxonomy.taxonomies.poi-cat.categoryField", field: "categoryId", … }, …]
 */
export function taxonomyDeclaredFields(config: TaxonomyConfig, layerId: string): DeclaredField[] {
    if (config.enabled === false) return [];
    const binding = config.layers?.[layerId];
    const resolved = binding ? resolveLayerBinding(config, layerId) : null;
    if (!binding || !resolved) return [];

    const declare = (name: BindingField, field: string): DeclaredField => ({
        key:
            binding[name] !== undefined
                ? `modules.taxonomy.layers.${layerId}.${name}`
                : `modules.taxonomy.taxonomies.${binding.use}.${name}`,
        field,
        present: (feature: DeclaredFieldFeature) =>
            hasField({ layerId, properties: feature.properties ?? null }, field),
    });

    const out = [declare("categoryField", resolved.categoryField)];
    if (resolved.subCategoryField) out.push(declare("subCategoryField", resolved.subCategoryField));
    return out;
}
