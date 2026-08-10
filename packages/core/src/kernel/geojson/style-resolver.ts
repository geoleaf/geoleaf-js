/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Module - Style Resolver
 *
 * Engine-agnostic evaluation of conditional style rules (`styleRules[].when`).
 * Exposed to the Themes module through the `GeoLeaf._StyleRules` global.
 *
 * Scope note (S6): this module used to also build Leaflet-era layer options
 * (`buildLayerOptions`) and MapLibre paint specs (`buildMapLibreStyleSpec`).
 * Both were purged — they had no production caller, and the real paint pipeline
 * runs through `adapters/maplibre/maplibre-style-converter.ts`, which the
 * adapter imports directly.
 */

import { GeoJSONShared } from "./shared.js";
import { STYLE_OPERATORS } from "./style-operators.js";
import { getLog } from "../../utils/general/di-accessors.js";
import type { GeoJSONFeature, GeoJSONStyleRule } from "./geojson-types.js";

interface StyleRuleWhen {
    field?: string;
    operator?: string;
    value?: unknown;
    all?: { field?: string; operator?: string; value?: unknown }[];
}

function _checkStyleRule(
    feature: GeoJSONFeature,
    rule: GeoJSONStyleRule,
    STYLE_OPERATORS: Record<string, (a: unknown, b: unknown) => boolean>,
    Log: { warn?: (a: string, b?: unknown) => void }
): Record<string, unknown> | null {
    const when = rule.when as StyleRuleWhen;
    if (when.all && Array.isArray(when.all)) {
        const allMet = when.all.every((condition) =>
            GeoJSONStyleResolver.evaluateCondition(feature, condition, STYLE_OPERATORS, Log)
        );
        if (allMet) return rule.style as Record<string, unknown>;
    } else if (when.field && when.operator) {
        const conditionMet = GeoJSONStyleResolver.evaluateCondition(
            feature,
            when,
            STYLE_OPERATORS,
            Log
        );
        if (conditionMet) return rule.style as Record<string, unknown>;
    }
    return null;
}

const GeoJSONStyleResolver = {
    getNestedValue(obj: Record<string, unknown> | null, path: string): unknown {
        if (!obj || !path) return null;
        return path
            .split(".")
            .reduce(
                (current: unknown, prop: string) =>
                    current != null &&
                    typeof current === "object" &&
                    (current as Record<string, unknown>)[prop] !== undefined
                        ? (current as Record<string, unknown>)[prop]
                        : null,
                obj as unknown
            );
    },

    evaluateCondition(
        feature: GeoJSONFeature,
        condition: StyleRuleWhen,
        STYLE_OPERATORS: Record<string, (a: unknown, b: unknown) => boolean>,
        Log: { warn?: (a: string, b?: unknown) => void }
    ): boolean {
        const { field, operator, value } = condition;
        if (!field || !operator) return false;
        const fieldValue = GeoJSONStyleResolver.getNestedValue(
            feature.properties ?? {},
            field
        ) as unknown;
        if (fieldValue === null || fieldValue === undefined) return false;
        const compareFn = STYLE_OPERATORS[operator];
        if (!compareFn) {
            Log.warn?.("[GeoJSON] Unknown styleRules operator:", operator);
            return false;
        }
        try {
            return compareFn(fieldValue, value);
        } catch (e) {
            Log.warn?.("[GeoJSON] Condition evaluation error:", e instanceof Error ? e.message : e);
            return false;
        }
    },

    evaluateStyleRules(
        feature: GeoJSONFeature,
        styleRules: GeoJSONStyleRule[] | null | undefined
    ): Record<string, unknown> | null {
        if (!Array.isArray(styleRules) || styleRules.length === 0) return null;
        const Log = getLog();
        // The optional chain guards against a test mocking `GeoJSONShared` with a partial
        // object — both branches now resolve to the same table (style-operators.ts).
        const operators = GeoJSONShared?.STYLE_OPERATORS ?? STYLE_OPERATORS;

        for (const rule of styleRules) {
            if (!rule?.when || !rule?.style) continue;
            const matched = _checkStyleRule(feature, rule, operators, Log);
            if (matched) return matched;
        }
        return null;
    },
};

// API publique S4.3 — le SECOND écrivain de `GeoLeaf._StyleRules` vivait ici, et il était le
// plus discutable des deux : exécuté AU NIVEAU RACINE du module, donc au simple import, avant
// la séquence de boot B1→B11 — et il posait `globalThis.GeoLeaf = {}` s'il ne trouvait rien.
// Un module feuille du kernel CRÉAIT donc le namespace public, en course avec la chaîne
// `globals/` qui en est la propriétaire déclarée. La clé n'avait aucun lecteur de production
// (seuls des tests et un spec e2e la lisaient) ; les deux écritures sont parties ensemble.
//
// `GeoJSONStyleResolver.evaluateStyleRules` et `.getNestedValue` restent atteignables en ESM,
// et c'est par là que le core les consomme déjà.

export { GeoJSONStyleResolver };
