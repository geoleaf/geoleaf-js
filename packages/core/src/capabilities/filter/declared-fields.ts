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
