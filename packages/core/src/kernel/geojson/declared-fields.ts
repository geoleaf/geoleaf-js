/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The declared fields the kernel reads itself, and the confrontation with a sample of features.
 *
 * PURE: no log, no state, no map. The load-time diagnostic (`field-reconciliation.ts`) calls it
 * on a layer the loader just converted; the guard over the repository's profiles calls the SAME
 * functions on the data files — so the rule that says "missing" at build time is the rule that
 * says it at load time.
 *
 * Two families of keys are the kernel's own:
 * - a style's `styleRules[].when.field` (and its `all[]` branches), read by the MapLibre converter
 *   as `["get", key]` after stripping ONE leading `properties.` (`utils/general/style-rule-field.ts`);
 * - a definition's `searchable.fields`, read by the layer search at the root, then under
 *   `properties` (`layer-search.ts`).
 * Every other key is judged by the capability that reads it, through the declared-fields slot.
 *
 * ⚠️ **A key, not a value.** A declared field is missing when NO sampled feature carries its key —
 * a property present with `null` counts as carried. Measured on 28/09/2026 over the repository's
 * profile data (17 layers, 219 layer × property pairs): the key rule gave no false positive even
 * on a one-feature sample; a non-null rule gave two on a fifty-feature sample. Sparse data is not
 * a naming fault.
 */

import { styleRuleFieldKey } from "../../utils/general/style-rule-field.js";
import { declaredSearchFields, hasSearchField } from "./layer-search.js";
import type {
    DeclaredField,
    DeclaredFieldFeature,
    DeclaredFieldsContext,
} from "../shared/declared-fields-slot.js";

/**
 * The most features a layer is judged on. Bounds the worst case — a field carried by none — to
 * this many key lookups per field; a carried field usually stops at the first feature.
 */
const FIELD_SAMPLE_SIZE = 1000;

/** A declared field no sampled feature carries. */
export interface MissingField {
    /** Where the profile declares it. */
    readonly key: string;
    /** The name as the profile writes it. */
    readonly field: string;
    /**
     * The same name with the casing the data uses, when a sampled key differs only by case —
     * written in the declaration's own notation. `null` when no key comes that close.
     */
    readonly suggestion: string | null;
}

/**
 * Takes up to `size` features, evenly spread over the collection — one every ⌈n / size⌉. Evenly
 * rather than the first ones: the cost is the same, and a collection sorted by some column would
 * otherwise show only one end of itself.
 *
 * @param features - The layer's features, as converted.
 * @param size - The most features to keep — 1 000 by default.
 * @returns The sample — the whole collection (a copy) when it holds no more than `size`.
 * @example
 * sampleFeatures(Array.from({ length: 5 }, (_, i) => i), 2); // [0, 3]
 */
export function sampleFeatures<T>(features: readonly T[], size: number = FIELD_SAMPLE_SIZE): T[] {
    if (size <= 0) return [];
    if (features.length <= size) return features.slice();
    const step = Math.ceil(features.length / size);
    const out: T[] = [];
    for (let i = 0; i < features.length && out.length < size; i += step) {
        out.push(features[i] as T);
    }
    return out;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function _hasOwn(obj: unknown, key: string): boolean {
    return _isRecord(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

/** Every property key the sample shows — under `properties` and a nested `attributes` object. */
function _sampleKeys(sample: readonly DeclaredFieldFeature[]): Map<string, string> {
    const keys = new Map<string, string>();
    const add = (bag: unknown): void => {
        if (!_isRecord(bag)) return;
        for (const k of Object.keys(bag))
            if (!keys.has(k.toLowerCase())) keys.set(k.toLowerCase(), k);
    };
    for (const feature of sample) {
        add(feature.properties);
        if (_isRecord(feature.properties)) add(feature.properties["attributes"]);
    }
    return keys;
}

/** The declaration rewritten with the data's casing of its last segment, or `null`. */
function _suggest(field: string, keys: Map<string, string>): string | null {
    const last = field.slice(field.lastIndexOf(".") + 1);
    const hit = keys.get(last.toLowerCase());
    return hit !== undefined && hit !== last
        ? field.slice(0, field.length - last.length) + hit
        : null;
}

/** A reader's rule that throws proves nothing: the field is not accused on its word. */
function _carried(declared: DeclaredField, feature: DeclaredFieldFeature): boolean {
    try {
        return declared.present(feature);
    } catch {
        return true;
    }
}

/**
 * The declared fields no feature of the sample carries, each under its own reader's rule.
 *
 * @param declared - The fields the readers of the layer declare.
 * @param sample - The features judged — see {@link sampleFeatures}. An empty sample proves
 *                 nothing, and yields nothing.
 * @returns The missing fields, in declaration order, with a casing hint when one applies.
 */
export function findMissingFields(
    declared: readonly DeclaredField[],
    sample: readonly DeclaredFieldFeature[]
): MissingField[] {
    if (sample.length === 0) return [];
    const missing: MissingField[] = [];
    let keys: Map<string, string> | null = null;
    for (const d of declared) {
        if (sample.some((feature) => _carried(d, feature))) continue;
        keys ??= _sampleKeys(sample);
        missing.push({ key: d.key, field: d.field, suggestion: _suggest(d.field, keys) });
    }
    return missing;
}

/** One style condition, walked exactly as the converter walks it (`conditionToExpression`). */
function _collectCondition(condition: unknown, path: string, out: DeclaredField[]): void {
    if (!_isRecord(condition)) return;
    const all = condition["all"];
    if (Array.isArray(all)) {
        all.forEach((sub, j) => _collectCondition(sub, `${path}.all[${j}]`, out));
        return;
    }
    const field = condition["field"];
    if (typeof field !== "string" || field.length === 0 || !condition["operator"]) return;
    const key = styleRuleFieldKey(field);
    out.push({
        key: `${path}.field`,
        field,
        present: (feature) => _hasOwn(feature.properties, key),
    });
}

/**
 * The fields a style's rules test, under the renderer's rule: `["get", key]` on the feature's
 * properties, after one leading `properties.` is stripped.
 *
 * @param style - A style document — `{ id, styleRules: [{ when }] }` —, or `null`.
 * @returns One declared field per condition that names a field; none without rules.
 */
function styleRuleDeclaredFields(style: Readonly<Record<string, unknown>> | null): DeclaredField[] {
    const rules = style?.["styleRules"];
    if (!Array.isArray(rules)) return [];
    const name = typeof style?.["id"] === "string" ? style["id"] : "?";
    const out: DeclaredField[] = [];
    rules.forEach((rule, i) => {
        if (_isRecord(rule))
            _collectCondition(rule["when"], `style[${name}].styleRules[${i}].when`, out);
    });
    return out;
}

/**
 * The fields a definition declares searchable, under the layer search's rule.
 *
 * @param def - A layer definition.
 * @returns One declared field per `searchable.fields` entry; none when the layer is not searchable.
 */
function searchableDeclaredFields(def: Readonly<Record<string, unknown>>): DeclaredField[] {
    return (declaredSearchFields(def) ?? []).map((field) => ({
        key: "searchable.fields",
        field,
        present: (feature: DeclaredFieldFeature) => hasSearchField(feature, field),
    }));
}

/**
 * Every field the kernel itself reads on a layer — its style's rules and its searchable fields.
 *
 * @param ctx - The layer, its definition and the style it wears.
 * @returns The kernel's declared fields for that layer.
 */
export function kernelDeclaredFields(ctx: DeclaredFieldsContext): DeclaredField[] {
    return [...styleRuleDeclaredFields(ctx.style), ...searchableDeclaredFields(ctx.def)];
}
