/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The field the labels read on a layer — their side of the kernel's declared-fields slot.
 *
 * A layer's label names ONE property, and the renderer draws `["get", field]`: a name the data
 * does not carry draws an empty text, and nothing says why the labels never appear. The kernel's
 * diagnostic now says so; this file tells it which name, and how the renderer reads it.
 *
 * ⚠️ **A bare name, strictly.** `["get"]` reads under `feature.properties` and strips nothing: a
 * label declared `"properties.name"` looks for a key literally named `properties.name`, and draws
 * nothing. The style rules strip one prefix; the label does not.
 *
 * PURE — the installer's closure calls it; the guard over the repository's profiles calls it on a
 * profile's own configuration.
 */

import type {
    DeclaredField,
    DeclaredFieldFeature,
    DeclaredFieldsContext,
} from "../../kernel/shared/index.js";
import { resolveLayerLabelConfig } from "../../kernel/geojson/index.js";

/**
 * The label field a layer wears, when its label is enabled — the style's `label` object first,
 * else the definition's `labels` block (`resolveLayerLabelConfig`, the one answer every reader
 * asks).
 *
 * @param ctx - The layer, its definition and the style it wears.
 * @returns The label's field, keyed by where it is declared; none when no enabled label names one.
 * @example
 * labelDeclaredFields({ layerId: "sites", def: {}, style: { id: "defaut",
 *     label: { enabled: true, field: "name" } } });
 * // → [{ key: "style[defaut].label.field", field: "name", present: … }]
 */
export function labelDeclaredFields(ctx: DeclaredFieldsContext): DeclaredField[] {
    const label = resolveLayerLabelConfig({ currentStyle: ctx.style, config: ctx.def });
    const field = label?.["field"];
    if (label?.enabled !== true || typeof field !== "string" || field.length === 0) return [];

    const styleLabel = ctx.style?.["label"];
    const fromStyle = styleLabel !== null && typeof styleLabel === "object";
    const styleName = typeof ctx.style?.["id"] === "string" ? ctx.style["id"] : "?";
    return [
        {
            key: fromStyle ? `style[${styleName}].label.field` : "labels.field",
            field,
            present: (feature: DeclaredFieldFeature) => {
                const props = feature.properties;
                return (
                    props !== null &&
                    typeof props === "object" &&
                    Object.prototype.hasOwnProperty.call(props, field)
                );
            },
        },
    ];
}
