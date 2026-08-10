/*!
 * GeoLeaf Core (feature-info capability) — Resolving what a surface paints
 * © 2026 Mattieu Pottier — MIT License
 *
 * ONE entry point answering one question: what does this surface paint for this
 * layer? It reads the new root `attributes` block first and falls back to the
 * legacy `capabilities.feature-info` binding while the migration is in flight.
 *
 * ⚠️ Two things disappeared here, and both were the same defect wearing two hats.
 *
 * `"all"` was documented as a rendering mode. It was not: `resolveFields` treated
 * `"all"`, `undefined` AND `null` through one branch, so a layer that merely OMITTED
 * a surface got every property of its features rendered as raw text — technical ids
 * and working columns included — with nobody having asked. It was a complete bypass
 * of the attribute contract, reachable by saying nothing.
 *
 * And the three surfaces each carried their OWN fallback for the no-binding case,
 * outside this file and different from each other: the popup listed every property,
 * the tooltip took the first key only, the side panel listed every property and then
 * dropped all of them further down (a field with no widget was skipped before
 * dispatch) — which is why the one profile in the repo that wrote `"all"` explicitly,
 * on the side panel, rendered an EMPTY panel. Four implementations of one idea, no
 * two agreeing.
 *
 * Both are replaced by a single rule: a surface paints what a declaration names, and
 * nothing when there is no declaration. `null` and `[]` are kept distinct — the first
 * says "this layer declares no reading", the second says "it declares one, and this
 * surface is empty".
 * https://geoleaf.dev
 */

import { asLayerAttributes, fieldsForSurface } from "./attributes-binding.js";
import { coreLayerConfigGet } from "./layer-config-seam.js";
import type { RenderField, RenderSurface } from "./render/dom.js";
import type { FeatureInfoFieldConfig, FeatureInfoLayerBinding } from "./types.js";

/**
 * Why a layer has no reading declaration.
 *
 * ⚠️ These four cases used to be ONE `null`, indistinguishable from each other. A
 * profile with a typo'd layer id and a layer deliberately opting out of the popup
 * produced the same silence, so neither was diagnosable. They are named so the
 * runtime log can say which one happened (decision Q9).
 */
type BindingAbsence =
    /** The GeoJSON seam is not mounted — the capability booted before its provider. */
    | "no-seam"
    /** The seam is mounted but knows no layer under this id. */
    | "unknown-layer"
    /** The layer exists and declares neither `attributes` nor the legacy block. */
    | "no-declaration"
    /** The layer declares a reading, and this surface is deliberately switched off. */
    | "surface-off";

/**
 * Reads a layer's legacy `capabilities.feature-info` binding.
 *
 * ⚠️ Kept only until the three profiles are migrated (task 2.10). It is the
 * `getConfig` façade member's return type, so it also outlives the migration as a
 * public API shape — that removal is a separate, breaking decision.
 *
 * @param layerId - The layer to read.
 * @returns The legacy binding, or `null`.
 */
export function getLayerBinding(layerId: string): FeatureInfoLayerBinding | null {
    const layerConfig = coreLayerConfigGet(layerId);
    const capabilities = layerConfig?.["capabilities"] as Record<string, unknown> | undefined;
    const raw = capabilities?.["feature-info"];
    return raw && typeof raw === "object" ? (raw as FeatureInfoLayerBinding) : null;
}

/**
 * Resolves the legacy surface list, minus `"all"`.
 *
 * A legacy surface that is absent, `null` or `"all"` now yields `null` — "this
 * surface is not declared" — instead of silently rendering the whole property bag.
 *
 * @param binding - The legacy binding.
 * @param surface - The surface being painted.
 * @returns The declared descriptors, or `null` when the surface is not declared.
 */
function legacyFieldsForSurface(
    binding: FeatureInfoLayerBinding,
    surface: RenderSurface
): readonly FeatureInfoFieldConfig[] | null {
    // ⚠️ ONE check rather than four. `"all"` is retired (decision U2) and `SurfaceConfig`
    // no longer admits it, so comparing against it would need a widening cast — an
    // assertion born to guard a value the type says cannot exist. Asking "is this a
    // list?" answers the same question and covers more: `false`, `null`, `undefined`,
    // a leftover `"all"`, and anything else a HOST hands through the runtime seam,
    // which has no schema behind it. A surface that is not a list declares nothing.
    const spec: unknown = binding[surface];
    if (!Array.isArray(spec)) return null;
    return (spec as readonly FeatureInfoFieldConfig[]).filter((f) => !f.hidden);
}

/**
 * Resolves what a surface paints for a layer.
 *
 * The root `attributes` block wins when present; the legacy block serves underneath
 * it until the migration is complete. Neither is guessed at: a layer with no reading
 * declaration paints nothing, which is what makes the block the single source of
 * "which property, shown how".
 *
 * @param layerId - The layer whose feature was clicked or hovered.
 * @param surface - The surface being painted.
 * @returns Render descriptors — possibly empty — or a {@link BindingAbsence} saying
 *   why there is nothing to paint.
 */
export function resolveSurfaceFields(
    layerId: string,
    surface: RenderSurface
): readonly RenderField[] | BindingAbsence {
    const layerConfig = coreLayerConfigGet(layerId);
    if (layerConfig === null || layerConfig === undefined) {
        // The seam answers `undefined` both when it is absent and when it does not
        // know the id; only the presence of the global tells the two apart.
        const seam = (globalThis as { GeoLeaf?: { GeoJSON?: unknown } }).GeoLeaf?.GeoJSON;
        return seam ? "unknown-layer" : "no-seam";
    }

    const attributes = asLayerAttributes(layerConfig["attributes"]);
    if (attributes) return fieldsForSurface(attributes, surface);

    const legacy = getLayerBinding(layerId);
    if (!legacy) return "no-declaration";

    const fields = legacyFieldsForSurface(legacy, surface);
    if (fields === null) return "surface-off";

    return toRenderFields(fields);
}

/**
 * Widens authored descriptors into render descriptors.
 *
 * ⚠️ A spread rather than an assertion. `RenderField` carries an index signature and
 * `FeatureInfoFieldConfig` does not, so TypeScript refuses the direct assignment
 * even though every property is compatible — the copy is what makes the widening
 * legal instead of merely asserted. Also the single place the two shapes meet, so a
 * divergence between them surfaces here rather than at each call site.
 *
 * @param fields - Authored descriptors from the legacy binding or a layout override.
 * @returns The same descriptors, typed for the render layer.
 */
export function toRenderFields(fields: readonly FeatureInfoFieldConfig[]): readonly RenderField[] {
    return fields.map((f) => ({ ...f }));
}

/**
 * Reports whether a resolution yielded descriptors rather than an absence.
 *
 * @param resolved - The value returned by {@link resolveSurfaceFields}.
 * @returns `true` when the surface has a list — possibly empty — to paint.
 */
export function hasFields(
    resolved: readonly RenderField[] | BindingAbsence
): resolved is readonly RenderField[] {
    return Array.isArray(resolved);
}
