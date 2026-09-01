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
 *
 * ⚠️ **This module is OUTSIDE every shipped graph, and that is a measured execution
 * verdict, not a guess.** The granular build emits no `dist/esm/kernel/geojson/
 * style-resolver.js` (no importer survives tree-shaking), the instrumented CDN bundle's
 * real-boot coverage carries 25 kernel/geojson files and this one is not among them, and
 * the `_StyleRules` / `_GeoJSONStyleResolver` namespace keys this header used to cite were
 * removed with zero readers. What keeps the SOURCE alive is its test suites and its
 * published type surface: `GeoJSONStyleResolver` is in the API golden master, shipped in
 * `dist/types/`, and a published symbol does not get removed outside a MAJOR version —
 * removal is recorded as due at the next one, module and tests in a single gesture.
 * Until then: no new caller should reach for this — the real paint pipeline runs through
 * `adapters/maplibre/maplibre-style-converter.ts`, which the adapter imports directly.
 *
 * Scope note (S6): this module used to also build Leaflet-era layer options
 * (`buildLayerOptions`) and MapLibre paint specs (`buildMapLibreStyleSpec`).
 * Both were purged — they had no production caller.
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
    const when = rule.when;
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
        const fieldValue = GeoJSONStyleResolver.getNestedValue(feature.properties ?? {}, field);
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

// Public-API review — the SECOND writer of `GeoLeaf._StyleRules` lived here, and it
// was the more questionable of the two: executed at module ROOT LEVEL, hence at mere
// import, before the B1→B11 boot sequence — and it set `globalThis.GeoLeaf = {}`
// when it found nothing. A kernel leaf module thus CREATED the public namespace,
// racing the `globals/` chain that is its declared owner. The key had no production
// reader (only tests and an e2e spec read it); both writes left together.
//
// `GeoJSONStyleResolver.evaluateStyleRules` and `.getNestedValue` stay reachable in
// ESM, and that is how the core already consumes them.

export { GeoJSONStyleResolver };
