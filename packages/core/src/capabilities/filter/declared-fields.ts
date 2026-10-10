/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The fields the filter reads on a layer — its side of the kernel's declared-fields slot.
 *
 * A filter descriptor that LISTS its layers promises each of them the field it tests. A listed
 * layer that does not carry it rejects every one of its features as soon as a value is chosen —
 * the layer empties, and nothing says why. The kernel's diagnostic now says so.
 *
 * ⚠️ **Only descriptors with an explicit `layers` list, and never `text` nor `proximity`.** A
 * descriptor without `layers` applies to every layer, and a field that lives on some of them only
 * is normal; `text` ORs its `searchFields`, so one of them missing from a layer is normal too;
 * `proximity` names no field. Judging them one layer at a time would accuse the healthy — and the
 * verdict "missing from EVERY layer in scope" is out of reach at load time, when the layers of an
 * inactive theme are not loaded yet.
 *
 * PURE — the installer's closure reads the running config and calls it; the guard over the
 * repository's profiles calls it on a profile's own config.
 *
 * ## The other half: a verdict over the whole scope
 *
 * What is set aside above is not unjudgeable, it is unjudgeable ONE LAYER AT A TIME. A field no
 * layer in scope carries is dead — a search that never matches, a slider that filters everything
 * out. {@link filterScopedFields} names those fields with their scope; the verdict needs every
 * layer of that scope at once, which the repository guard has
 * (`__tests__/guards/profile-field-reconciliation.guard.test.ts`) and a running page has not.
 */

import type { DeclaredField, DeclaredFieldFeature } from "../../kernel/shared/index.js";
import { hasNestedPath } from "../../utils/general/object-utils.js";
import type { FilterConfig } from "./types.js";

/**
 * Whether a feature carries a field where `getFieldValue` looks for it — the feature root, then
 * `properties`. A key, not a value: a property present with `null` is carried.
 */
function _carries(feature: DeclaredFieldFeature, field: string): boolean {
    if (hasNestedPath(feature, field)) return true;
    const props = feature.properties;
    return props !== null && typeof props === "object" && hasNestedPath(props, field);
}

/**
 * The filter's declared fields for one layer: `field` — and `subField` for a `taxonomy`
 * descriptor — of every descriptor that lists the layer, `text` and `proximity` excepted.
 *
 * @param config - The `modules.filter` block — the running config, or a profile's own.
 * @param layerId - The layer judged.
 * @returns The fields the listed descriptors test on that layer; none when the filter is disabled
 *          or no descriptor lists the layer.
 * @example
 * filterDeclaredFields({ enabled: true, fields: [{ id: "c", kind: "taxonomy",
 *     field: "categoryId", subField: "subCategoryId", layers: ["candelabres"] }] }, "candelabres");
 * // → the category field and the sub-category field
 */
export function filterDeclaredFields(config: FilterConfig, layerId: string): DeclaredField[] {
    if (config.enabled === false || !Array.isArray(config.fields)) return [];
    const out: DeclaredField[] = [];
    config.fields.forEach((descriptor, i) => {
        if (!Array.isArray(descriptor?.layers) || !descriptor.layers.includes(layerId)) return;
        if (descriptor.kind === "text" || descriptor.kind === "proximity") return;
        const names: Array<["field" | "subField", string | undefined]> = [
            ["field", descriptor.field],
            ["subField", descriptor.kind === "taxonomy" ? descriptor.subField : undefined],
        ];
        for (const [name, field] of names) {
            if (typeof field !== "string" || field.length === 0) continue;
            out.push({
                key: `modules.filter.fields[${i}].${name}`,
                field,
                present: (feature: DeclaredFieldFeature) => _carries(feature, field),
            });
        }
    });
    return out;
}

/**
 * A field the filter reads over a SET of layers — carried by one of them is enough. A declared
 * field, plus its scope: `layers` lists the layers, `null` means every layer of the profile.
 *
 * Not exported: the one caller reads the fields, it never names the type.
 */
type ScopedFilterField = DeclaredField & { layers: readonly string[] | null };

/**
 * The fields {@link filterDeclaredFields} sets aside, each with the scope its verdict is over:
 * every `searchFields` entry of a `text` descriptor — it ORs them, so one is dead only when no
 * layer in scope carries it —, and the `field` (and `subField`) of a descriptor that lists no
 * layer. `proximity` names no field.
 *
 * ⚠️ Not a runtime diagnostic: a page holds the layers of its active theme only, and « carried by
 * none » is a verdict over ALL of them. A caller that cannot read every layer in scope must say
 * the verdict is undecided, never that the field is missing.
 *
 * @param config - The `modules.filter` block — a profile's own.
 * @returns The scoped fields, in declaration order; none when the filter is disabled.
 * @example
 * filterScopedFields({ enabled: true, fields: [{ id: "q", kind: "text",
 *     searchFields: ["properties.name", "properties.adresse"] }] });
 * // → two fields, each over every layer of the profile (`layers: null`)
 */
export function filterScopedFields(config: FilterConfig): ScopedFilterField[] {
    if (config.enabled === false || !Array.isArray(config.fields)) return [];
    const out: ScopedFilterField[] = [];
    config.fields.forEach((descriptor, i) => {
        if (!descriptor || descriptor.kind === "proximity") return;
        const layers = Array.isArray(descriptor.layers) ? descriptor.layers : null;
        const push = (name: string, field: unknown): void => {
            if (typeof field !== "string" || field.length === 0) return;
            out.push({
                key: `modules.filter.fields[${i}].${name}`,
                field,
                layers,
                present: (feature: DeclaredFieldFeature) => _carries(feature, field),
            });
        };
        if (descriptor.kind === "text") {
            (descriptor.searchFields ?? []).forEach((field, j) =>
                push(`searchFields[${j}]`, field)
            );
            return;
        }
        // Listing its layers, it is judged on each of them — `filterDeclaredFields`.
        if (layers) return;
        push("field", descriptor.field);
        if (descriptor.kind === "taxonomy") push("subField", descriptor.subField);
    });
    return out;
}
