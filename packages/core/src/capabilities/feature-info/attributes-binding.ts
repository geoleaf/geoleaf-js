/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Core (feature-info capability) — Reading the `attributes` block
 *
 * Projects a layer's root `attributes` block onto the render model, one surface at
 * a time.
 *
 * The block is the successor of `capabilities.feature-info`, and the two differ in
 * ways that matter more than their shape:
 *
 *  - it is STRICT. It lives at the layer root rather than under `capabilities`,
 *    which was `additionalProperties: true`, so a typo used to pass in silence;
 *  - a field declares the surfaces it appears on, ONE list instead of three that
 *    had to be kept parallel by hand — and which had three different shapes;
 *  - there is no `"all"`. See {@link ./convert.js} for why that mattered.
 *
 * This module is a pure projection: it reads the authored declaration and returns
 * render descriptors. It resolves no value and touches no DOM.
 */

import type {
    AttributeField,
    AttributeSurface,
    LayerAttributes,
} from "../../contracts/attributes.contract.js";
import type { RenderField } from "./render/dom.js";

/**
 * Narrows an unknown layer-config value to the `attributes` block.
 *
 * The check is structural rather than a cast: the block is validated at build time
 * by `validate:profiles`, but a layer config can also be handed in at runtime by a
 * host, and that path has no schema behind it.
 *
 * @param raw - Candidate value read from the layer configuration.
 * @returns The block, or `null` when it is absent or malformed.
 */
export function asLayerAttributes(raw: unknown): LayerAttributes | null {
    if (!raw || typeof raw !== "object") return null;
    const fields = (raw as { fields?: unknown }).fields;
    return Array.isArray(fields) ? (raw as LayerAttributes) : null;
}

/**
 * Maps the presentation modifiers onto the render model's legacy spelling.
 *
 * ⚠️ `emphasis` and `hero` land on `style` and `variant` because that is what the
 * renderers already read, and this sprint changes the DECLARATION, not the render
 * primitives. The pair is the reason `isTitleField` tests both spellings.
 *
 * @param out - Render descriptor being built, mutated in place.
 * @param presentation - The declared presentation block, when there is one.
 */
function applyPresentation(
    out: RenderField,
    presentation: NonNullable<AttributeField["display"]>["presentation"]
): void {
    if (!presentation) return;
    if (presentation.accordion !== undefined) out["accordion"] = presentation.accordion;
    if (presentation.defaultOpen !== undefined) out["defaultOpen"] = presentation.defaultOpen;
    if (presentation.emphasis !== undefined) out["style"] = presentation.emphasis;
    if (presentation.hero) out["variant"] = "hero";
}

/**
 * Projects one declared field onto a render descriptor.
 *
 * The widget becomes `type`, the options are spread flat, and the presentation
 * modifiers are translated. Spreading the options is what lets a renderer keep
 * reading `columns`, `maxCount` or `closedLabel` unchanged — the descriptor shape
 * the render layer consumes is deliberately untouched by this sprint.
 *
 * @param field - One entry of `attributes.fields`.
 * @param isTitle - Whether the layer's `titleField` names this field.
 * @returns The render descriptor.
 */
function toRenderField(field: AttributeField, isTitle: boolean): RenderField {
    // Typed as the target from the start, not cast into it at the end: the
    // descriptor carries an index signature, so the per-widget options land on it
    // without any assertion having to vouch for the shape.
    const out: RenderField = {
        field: field.field,
        label: field.label,
        type: field.widget,
    };

    if (field.options) Object.assign(out, field.options);
    if (field.display?.mode) out["mode"] = field.display.mode;
    applyPresentation(out, field.display?.presentation);

    // The layer-level pointer and the per-field modifier converge on ONE mechanism
    // rather than becoming a second way to say the same thing.
    if (isTitle) out["style"] = "title";

    return out;
}

/**
 * Resolves the render descriptors a surface should paint, from the `attributes`
 * block.
 *
 * A field appears on a surface when — and only when — it declares that surface. A
 * field with no `display` is capture-only or a pure binding, and never appears.
 *
 * ⚠️ An empty list is a legitimate answer and is NOT the same as "no declaration":
 * a layer may declare its attributes and put none of them in the tooltip. The
 * caller distinguishes the two, which is what replaces the implicit fallback.
 *
 * @param attributes - The layer's validated `attributes` block.
 * @param surface - The surface being painted.
 * @returns Render descriptors, in declaration order.
 */
export function fieldsForSurface(
    attributes: LayerAttributes,
    surface: AttributeSurface
): readonly RenderField[] {
    const titleField = attributes.titleField;
    const out: RenderField[] = [];

    for (const field of attributes.fields) {
        if (!field?.display?.surfaces?.includes(surface)) continue;
        out.push(toRenderField(field, titleField !== undefined && field.field === titleField));
    }

    return out;
}
