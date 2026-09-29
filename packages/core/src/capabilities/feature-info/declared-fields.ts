/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The fields feature-info reads on a layer — its side of the kernel's declared-fields slot.
 *
 * A layer's `attributes.fields[]` names what its tooltip, popup and side panel show. A name the
 * data does not carry resolves `undefined`, and the row is skipped as empty: the surface simply
 * shows less, with nothing to say why. The kernel's diagnostic now says so; this file tells it
 * which names, and how feature-info resolves them.
 *
 * PURE — the installer's closure calls it on the layer the loader holds; the guard over the
 * repository's profiles calls it on a profile's own layer configuration.
 */

import type { DeclaredField, DeclaredFieldFeature } from "../../kernel/shared/index.js";
import { asLayerAttributes } from "./attributes-binding.js";
import { buildNormalizedModel, resolvePath } from "./resolve.js";

/**
 * The attribute fields a layer SHOWS, under feature-info's reading rule (`resolvePath` over the
 * normalized `{ properties, attributes }` model).
 *
 * Only a field that declares `display.surfaces` is judged: a capture-only field (an `edit` block
 * and no `display`) is filled when a feature is created, and its absence from the loaded data is
 * normal, not a fault. `titleField` is not a data read — it names one of `fields[]` —, so it is
 * not judged here either.
 *
 * @param def - A layer definition.
 * @returns One declared field per displayed attribute; none when the layer declares no
 *          `attributes` block.
 * @example
 * attributeDeclaredFields({ attributes: { fields: [
 *     { field: "properties.NAME", label: "Nom", display: { surfaces: ["popup"] } },
 * ] } });
 * // → [{ key: "attributes.fields[0].field", field: "properties.NAME", present: … }]
 */
export function attributeDeclaredFields(def: Readonly<Record<string, unknown>>): DeclaredField[] {
    const attributes = asLayerAttributes(def["attributes"]);
    if (!attributes) return [];
    const out: DeclaredField[] = [];
    attributes.fields.forEach((entry, i) => {
        const field = entry?.field;
        const surfaces = entry?.display?.surfaces;
        if (typeof field !== "string" || field.length === 0) return;
        if (!Array.isArray(surfaces) || surfaces.length === 0) return;
        out.push({
            key: `attributes.fields[${i}].field`,
            field,
            present: (feature: DeclaredFieldFeature) =>
                resolvePath(buildNormalizedModel(feature.properties), field) !== undefined,
        });
    });
    return out;
}
