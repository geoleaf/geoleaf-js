/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Style rule validation (styleRules, conditions, scales)
 */

import { STYLE_OPERATORS } from "../../kernel/geojson/style-operators.js";

/**
 * Upper bound of a MapLibre zoom level. A scale denominator at or below this is
 * unreachable (1:24 sits past zoom 25, and MapLibre caps at 24), so such a value is
 * always a zoom level entered by mistake. Guards `scaleConfig`/`labelScale`.
 */
const MAX_ZOOM_LIKE = 24;

/**
 * Operators a `styleRules[].when` condition may use — **derived from the engine's own table**,
 * never listed by hand.
 *
 * 🛑 This was a hard-coded array of **8** operators while `STYLE_OPERATORS` implements **16**.
 * The eight it omitted (`===`, `!==`, `eq`, `neq`, `startsWith`, `endsWith`, `notIn`, `between`)
 * work perfectly at runtime, so the validator rejected styles the engine renders correctly —
 * `profiles/_reference/layers/reference-points/styles/alt.json` is one, and it has been failing
 * validation unnoticed because it is not any layer's `styles.default`.
 *
 * ⚠️ Found while making the boot path validate, which is what turned this from latent
 * into load-bearing: before, an unlisted operator in a DEFAULT style still rendered (the
 * preload path applied the file without validating and the theme path failed silently); after,
 * it would degrade the layer to neutral styling. Deriving the list removes that regression.
 *
 * ⚠️ The `STYLE_OPERATORS` header already records that this table "used to exist twice" and was
 * unified for exactly this reason. This allowlist was a **third** copy, and the only partial
 * one — which is why nobody saw it drift.
 */
const VALID_RULE_OPERATORS = Object.keys(STYLE_OPERATORS);

/**
 * A blocking style-validation failure, located by the profile path that produced it.
 *
 * `field` is a dotted/indexed path such as `styleRules[2].when`, so a message can point at
 * the offending entry of a profile rather than at the rule set as a whole.
 */
export interface ValidationErrorItem {
    /** Profile path of the offending value, e.g. `styleRules[2].style`. */
    field: string;
    /** Human-readable description of what is wrong. */
    message: string;
    /** Surrounding data (rule index, received type…) carried for diagnostics. */
    context?: Record<string, unknown>;
}

/**
 * A non-blocking style-validation remark. Same shape as {@link ValidationErrorItem}, but
 * collected separately: warnings never make a profile invalid.
 */
export interface ValidationWarningItem {
    /** Profile path of the value the remark concerns. */
    field: string;
    /** Human-readable description of the remark. */
    message: string;
    /** Surrounding data carried for diagnostics. */
    context?: Record<string, unknown>;
}

/**
 * The predicate of a style rule — either one condition, or a conjunction under `all`.
 *
 * ⚠️ The two forms are exclusive in practice: when `all` is an array it is validated and the
 * sibling `field`/`operator`/`value` are **ignored**. There is no `any`/`or` counterpart.
 */
export interface StyleRuleWhen {
    /** Feature property the condition reads. */
    field?: string;
    /** Comparison operator applied to `field`. */
    operator?: string;
    /** Value compared against. */
    value?: unknown;
    /** Conditions that must ALL hold. When present, the sibling fields are ignored. */
    all?: Array<{ field?: string; operator?: string; value?: unknown }>;
}

/**
 * One entry of a layer's `styleRules`: a predicate and the paint it applies when matched.
 *
 * `when` and `style` are both required by the validator despite being optional here — the
 * type describes what may be parsed, the validator what must be present.
 */
export interface StyleRule {
    /** Predicate selecting the features this rule paints. */
    when?: StyleRuleWhen;
    /** Paint properties applied to matching features. */
    style?: Record<string, unknown>;
    /** Legend entry derived from this rule. */
    legend?: Record<string, unknown>;
}

function _validateSingleRule(
    rule: unknown,
    index: number,
    errors: ValidationErrorItem[],
    warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    const ruleContext = { ...context, ruleIndex: index };
    if (typeof rule !== "object" || rule === null) {
        errors.push({
            field: `styleRules[${index}]`,
            message: `La r\u00e8gle doit \u00eatre un object`,
            context: ruleContext,
        });
        return;
    }
    const r = rule as StyleRule;
    if (!r.when)
        errors.push({
            field: `styleRules[${index}].when`,
            message: `Le field 'when' est required`,
            context: ruleContext,
        });
    else validateWhenCondition(r.when, index, errors, warnings, ruleContext);
    if (!r.style)
        errors.push({
            field: `styleRules[${index}].style`,
            message: `Le field 'style' est required`,
            context: ruleContext,
        });
    else if (typeof r.style !== "object" || r.style === null)
        errors.push({
            field: `styleRules[${index}].style`,
            message: `Le style doit \u00eatre un object`,
            context: { received: typeof r.style, ...ruleContext },
        });
    if (r.legend && typeof r.legend !== "object")
        errors.push({
            field: `styleRules[${index}].legend`,
            message: `legend doit \u00eatre un object`,
            context: { received: typeof r.legend, ...ruleContext },
        });
}

/**
 * Validates a layer's whole `styleRules` array.
 *
 * Accumulator contract, shared by every function in this module: nothing is returned and
 * nothing throws — findings are **pushed into** `errors` and `warnings`, so one traversal can
 * collect every defect of a profile instead of stopping at the first. A caller decides the
 * profile is invalid by testing `errors.length`, not by catching.
 *
 * A non-array `rules` is itself an error; each entry is then checked for a `when` and a
 * `style`.
 *
 * @param rules - The candidate `styleRules` value, of unverified shape.
 * @param errors - Accumulator for blocking failures. Mutated in place.
 * @param warnings - Accumulator for non-blocking remarks. Mutated in place.
 * @param context - Diagnostic data merged into every finding (layer id, profile…).
 */
export function validateStyleRules(
    rules: unknown,
    errors: ValidationErrorItem[],
    warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (!Array.isArray(rules)) {
        errors.push({
            field: "styleRules",
            message: `styleRules doit \u00eatre un table`,
            context: { received: typeof rules, ...context },
        });
        return;
    }
    rules.forEach((rule: unknown, index: number) =>
        _validateSingleRule(rule, index, errors, warnings, context)
    );
}

/**
 * Validates the `when` predicate of one style rule.
 *
 * Dispatches on shape: an `all` array is validated condition by condition, otherwise the
 * object is treated as a single condition. Accumulator contract — see
 * {@link validateStyleRules}.
 *
 * @param when - The candidate predicate, of unverified shape.
 * @param ruleIndex - Index of the owning rule, used to build the `field` path.
 * @param errors - Accumulator for blocking failures. Mutated in place.
 * @param _warnings - Accepted for signature symmetry with the other validators; unused.
 * @param context - Diagnostic data merged into every finding.
 */
export function validateWhenCondition(
    when: unknown,
    ruleIndex: number,
    errors: ValidationErrorItem[],
    _warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (typeof when !== "object" || when === null) {
        errors.push({
            field: `styleRules[${ruleIndex}].when`,
            message: `when must be un object`,
            context: { received: typeof when, ...context },
        });
        return;
    }

    const w = when as StyleRuleWhen;

    if (w.all && Array.isArray(w.all)) {
        w.all.forEach((condition: unknown, condIndex: number) => {
            validateSimpleCondition(condition, ruleIndex, condIndex, errors, context);
        });
        return;
    }

    validateSimpleCondition(w, ruleIndex, null, errors, context);
}

/**
 * Validates one leaf condition — the `field`/`operator`/`value` triple.
 *
 * Accumulator contract — see {@link validateStyleRules}.
 *
 * @param condition - The candidate condition, of unverified shape.
 * @param ruleIndex - Index of the owning rule, used to build the `field` path.
 * @param condIndex - Index within an `all` array, or `null` when the condition is the whole
 *   `when` — the two produce different `field` paths.
 * @param errors - Accumulator for blocking failures. Mutated in place.
 * @param context - Diagnostic data merged into every finding.
 */
export function validateSimpleCondition(
    condition: unknown,
    ruleIndex: number,
    condIndex: number | null,
    errors: ValidationErrorItem[],
    context: Record<string, unknown>
): void {
    const c = condition as Record<string, unknown>;
    const required = ["field", "operator", "value"];
    for (const field of required) {
        if (!(field in c)) {
            const prefix =
                condIndex !== null
                    ? `styleRules[${ruleIndex}].when.all[${condIndex}]`
                    : `styleRules[${ruleIndex}].when`;
            errors.push({
                field: `${prefix}.${field}`,
                message: `Le field '${field}' est required dans la condition`,
                context,
            });
        }
    }

    const validOperators = VALID_RULE_OPERATORS;
    if (c.operator && !validOperators.includes(c.operator as string)) {
        const prefix =
            condIndex !== null
                ? `styleRules[${ruleIndex}].when.all[${condIndex}]`
                : `styleRules[${ruleIndex}].when`;
        errors.push({
            field: `${prefix}.operator`,
            message: `Invalid operator`,
            context: { received: c.operator, allowed: validOperators, ...context },
        });
    }

    if (c.field && typeof c.field !== "string") {
        const prefix =
            condIndex !== null
                ? `styleRules[${ruleIndex}].when.all[${condIndex}]`
                : `styleRules[${ruleIndex}].when`;
        errors.push({
            field: `${prefix}.field`,
            message: `field must be une string de characters`,
            context: { received: typeof c.field, ...context },
        });
    }
}

/**
 * Validates the scale constraints of a style — `scaleConfig` (the layer) and `labelScale`
 * (its labels).
 *
 * ⚠️ Both are expressed in **scale denominators** (the X of 1:X), never in MapLibre zoom
 * levels. This is the point the retired `zoomConfig` got wrong: its name said zoom while the
 * engine read denominators, so `{ minZoom: 6 }` hid layers at every zoom. `zoomConfig` is
 * therefore rejected outright rather than ignored, and unknown keys inside a scale object are
 * errors too — silently dropping them would leave the layer unconstrained, the same failure
 * one level quieter.
 *
 * Both fields are optional; absent means no constraint. Accumulator contract — see
 * {@link validateStyleRules}.
 *
 * @param styleData - The style object to inspect.
 * @param errors - Accumulator for blocking failures. Mutated in place.
 * @param _warnings - Accepted for signature symmetry with the other validators; unused.
 * @param context - Diagnostic data merged into every finding.
 */
export function validateScales(
    styleData: Record<string, unknown>,
    errors: ValidationErrorItem[],
    _warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    // Reject the retired `zoomConfig` outright rather than silently ignoring it: its
    // name claimed "zoom levels" while the engine read SCALE DENOMINATORS, so authors
    // wrote `{minZoom: 6}` and their layers were hidden at every zoom. A style still
    // carrying it would now lose its constraint without a word — fail loudly instead.
    if ("zoomConfig" in styleData) {
        errors.push({
            field: "zoomConfig",
            message:
                `'zoomConfig' a été retiré — utiliser 'scaleConfig' avec 'minScale'/'maxScale', ` +
                `exprimés en DÉNOMINATEURS D'ÉCHELLE (1:X), pas en niveaux de zoom MapLibre ` +
                `(ex. { "minScale": 9222148, "maxScale": 2252 })`,
            context: { availableFields: Object.keys(styleData), ...context },
        });
    }

    // Both are optional; absent = no constraint. `scaleConfig` gates the layer,
    // `labelScale` gates its labels. Both are scale denominators.
    const scaleFieldsToValidate: string[] = ["scaleConfig", "labelScale"];
    scaleFieldsToValidate.forEach((scaleField) => {
        if (!styleData[scaleField]) {
            return;
        }

        const scale = styleData[scaleField] as Record<string, unknown> | null;
        if (typeof scale !== "object" || scale === null) {
            errors.push({
                field: scaleField,
                message: `${scaleField} must be un object`,
                context: { received: typeof scale, ...context },
            });
            return;
        }

        // Unknown keys are rejected, not ignored. Without this, `{ minZoom: 6 }` would
        // pass silently and leave the layer unconstrained — the same failure mode as the
        // old alias, just quieter.
        Object.keys(scale).forEach((key) => {
            if (key.startsWith("_comment") || key === "minScale" || key === "maxScale") return;
            errors.push({
                field: `${scaleField}.${key}`,
                message:
                    `clé inconnue '${key}' dans ${scaleField} — attendu 'minScale'/'maxScale', ` +
                    `en dénominateurs d'échelle (1:X)`,
                context: { received: scale[key], ...context },
            });
        });

        // `minScale`/`maxScale` only — no `minZoom`/`maxZoom` alias. That alias is what
        // let a zoom level pass validation and be read as a scale denominator.
        (["minScale", "maxScale"] as const).forEach((prop) => {
            if (!(prop in scale) || scale[prop] === null) return;

            const value = scale[prop];
            if (typeof value !== "number" || value < 0) {
                errors.push({
                    field: `${scaleField}.${prop}`,
                    message: `${prop} must be un nombre >= 0 ou null`,
                    context: { received: value, ...context },
                });
                return;
            }

            // A denominator in (0 ; MAX_ZOOM_LIKE] is unreachable at any zoom MapLibre
            // supports (1:24 ≈ zoom 25+), so it is always a zoom level written by mistake
            // — the exact confusion that kept 18 layers hidden for ~3 months. `0` stays
            // legal: it is the "constraint disabled" convention (_normalizeScaleValue).
            if (value > 0 && value <= MAX_ZOOM_LIKE) {
                errors.push({
                    field: `${scaleField}.${prop}`,
                    message:
                        `${prop} = ${value} ressemble à un niveau de zoom MapLibre, or ce champ ` +
                        `attend un DÉNOMINATEUR D'ÉCHELLE (1:X). Un dénominateur <= ${MAX_ZOOM_LIKE} ` +
                        `est inatteignable et masquerait la couche à tous les zooms`,
                    context: { received: value, ...context },
                });
            }
        });
    });
}

/**
 * Validates the `legend` block of a style.
 *
 * Only two things are enforced: the value is an object, and `order` — when present — is an
 * integer. Everything else is left open, legend entries being extended by capabilities.
 * Accumulator contract — see {@link validateStyleRules}.
 *
 * @param legend - The candidate legend value, of unverified shape.
 * @param errors - Accumulator for blocking failures. Mutated in place.
 * @param _warnings - Accepted for signature symmetry with the other validators; unused.
 * @param context - Diagnostic data merged into every finding.
 */
export function validateLegend(
    legend: unknown,
    errors: ValidationErrorItem[],
    _warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (typeof legend !== "object" || legend === null) {
        errors.push({
            field: "legend",
            message: `legend must be un object`,
            context: { received: typeof legend, ...context },
        });
        return;
    }

    const leg = legend as Record<string, unknown>;
    if ("order" in leg && !Number.isInteger(leg.order)) {
        errors.push({
            field: "legend.order",
            message: `order must be un entier`,
            context: { received: leg.order, type: typeof leg.order, ...context },
        });
    }
}

/**
 * The rule-level style validators, grouped for the style-validator entry point.
 *
 * Every member follows the accumulator contract described on {@link validateStyleRules}.
 */
export const StyleValidatorRules = {
    validateStyleRules,
    validateWhenCondition,
    validateSimpleCondition,
    validateScales,
    validateLegend,
};
