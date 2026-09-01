/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Per-type validation of the style properties
 * (font, label, stroke, caseing, fillPattern, baseStyle)
 */

import type { ValidationErrorItem, ValidationWarningItem } from "./style-validator-rules.js";

import { pushColorError, pushOpacityError, pushSizeError } from "./style-validator-helpers.js";

/**
 * Validates a label's font configuration
 */

export function validateFont(
    font: unknown,
    errors: ValidationErrorItem[],
    _warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (typeof font !== "object" || font === null) {
        errors.push({
            field: "label.font",
            message: `La configuration font must be un object`,
            context: { received: typeof font, ...context },
        });
        return;
    }
    const f = font as Record<string, unknown>;
    if (f.sizePt !== undefined) {
        if (typeof f.sizePt !== "number" || f.sizePt < 1) {
            errors.push({
                field: "label.font.sizePt",
                message: `sizePt must be un nombre >= 1`,
                context: { received: f.sizePt, ...context },
            });
        }
    }
    if (f.weight !== undefined) {
        if (!Number.isInteger(f.weight) || (f.weight as number) < 0 || (f.weight as number) > 100) {
            errors.push({
                field: "label.font.weight",
                message: `weight must be un entier entre 0 et 100`,
                context: { received: f.weight, ...context },
            });
        }
    }
}

/**
 * Validates a label component (buffer, background)
 */

export function validateLabelComponent(
    component: unknown,
    fieldPath: string,
    errors: ValidationErrorItem[],
    _warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (typeof component !== "object" || component === null) {
        errors.push({
            field: fieldPath,
            message: `${fieldPath} must be un object`,
            context: { received: typeof component, ...context },
        });
        return;
    }
    const comp = component as Record<string, unknown>;
    pushColorError(comp, "color", `${fieldPath}.color`, errors, context);
    pushOpacityError(comp, "opacity", `${fieldPath}.opacity`, errors, context);
    pushSizeError(comp, "sizePx", `${fieldPath}.sizePx`, errors, context);
}

/**
 * Validates the label field (either a string or a label config object)
 */

function _validateLabelOffset(
    labelObj: Record<string, unknown>,
    errors: ValidationErrorItem[],
    context: Record<string, unknown>
): void {
    if (!labelObj.offset) return;
    const offset = labelObj.offset as Record<string, unknown>;
    if (typeof offset.distancePx === "undefined") return;
    if (typeof offset.distancePx !== "number") {
        errors.push({
            field: "label.offset.distancePx",
            message: `distancePx must be un nombre`,
            context: { received: typeof offset.distancePx, ...context },
        });
    }
}

function _validateLabelObject(
    labelObj: Record<string, unknown>,
    label: Record<string, unknown>,
    errors: ValidationErrorItem[],
    warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (!("enabled" in labelObj)) {
        errors.push({
            field: "label.enabled",
            message: `Le field 'enabled' est required dans la configuration de labels`,
            context: { labelConfig: label, ...context },
        });
    } else if (typeof labelObj.enabled !== "boolean") {
        errors.push({
            field: "label.enabled",
            message: `Le field 'enabled' must be un boolean`,
            context: { received: typeof labelObj.enabled, value: labelObj.enabled, ...context },
        });
    }
    if (labelObj.enabled && !labelObj.field) {
        warnings.push({
            field: "label.field",
            message: `Labels are enabled but no field is specified`,
            context: { labelConfig: label, ...context },
        });
    }
    if (labelObj.font) validateFont(labelObj.font, errors, warnings, context);
    pushColorError(labelObj, "color", "label.color", errors, context);
    pushOpacityError(labelObj, "opacity", "label.opacity", errors, context);
    if (labelObj.buffer)
        validateLabelComponent(labelObj.buffer, "label.buffer", errors, warnings, context);
    if (labelObj.background)
        validateLabelComponent(labelObj.background, "label.background", errors, warnings, context);
    _validateLabelOffset(labelObj, errors, context);
}

/**
 * Validates the `label` block of a style, in either of its two accepted forms.
 *
 * `label` may be a **string** — the feature property to display, which needs no further
 * checking — or a **configuration object**, whose colour, opacity, buffer, background and
 * offset are then validated. An absent `label` is not a defect. Anything else (a number, an
 * array) is an error.
 *
 * Accumulator contract: findings are pushed into `errors` and `warnings`, nothing is returned.
 *
 * @param styleData - The style object to inspect; a missing `label` returns immediately.
 * @param errors - Accumulator for blocking failures. Mutated in place.
 * @param warnings - Accumulator for non-blocking remarks. Mutated in place.
 * @param context - Diagnostic data merged into every finding.
 */
export function validateLabel(
    styleData: Record<string, unknown>,
    errors: ValidationErrorItem[],
    warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (!("label" in styleData)) return;
    const label = styleData.label as string | Record<string, unknown> | undefined;
    if (typeof label === "string") return;
    if (typeof label === "object" && label !== null) {
        _validateLabelObject(label, label, errors, warnings, context);
        return;
    }
    errors.push({
        field: "label",
        message: `Le field 'label' must be une string de characters ou un object de configuration`,
        context: { received: typeof label, value: label, ...context },
    });
}

/**
 * Validates the stroke (lines)
 */

export function validateStroke(
    stroke: unknown,
    errors: ValidationErrorItem[],
    _warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (typeof stroke !== "object" || stroke === null) {
        errors.push({
            field: "style.stroke",
            message: `stroke must be un object`,
            context: { received: typeof stroke, ...context },
        });
        return;
    }
    const s = stroke as Record<string, unknown>;
    pushColorError(s, "color", "style.stroke.color", errors, context);
    pushOpacityError(s, "opacity", "style.stroke.opacity", errors, context);
    pushSizeError(s, "weight", "style.stroke.weight", errors, context);
    if (s.dashArray !== null && s.dashArray !== undefined && typeof s.dashArray !== "string") {
        errors.push({
            field: "style.stroke.dashArray",
            message: `dashArray must be une string de characters ou null`,
            context: { received: typeof s.dashArray, value: s.dashArray, ...context },
        });
    }
}

/**
 * Validates the casing (lines)
 */

export function validateCasing(
    casing: unknown,
    errors: ValidationErrorItem[],
    _warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (typeof casing !== "object" || casing === null) {
        errors.push({
            field: "style.casing",
            message: `casing must be un object`,
            context: { received: typeof casing, ...context },
        });
        return;
    }
    const c = casing as Record<string, unknown>;
    if ("enabled" in c && typeof c.enabled !== "boolean") {
        errors.push({
            field: "style.casing.enabled",
            message: `enabled must be un boolean`,
            context: { received: typeof c.enabled, ...context },
        });
    }
    pushColorError(c, "color", "style.casing.color", errors, context);
}

/**
 * Validates the fillPattern (polygons)
 */

export function validateFillPattern(
    pattern: unknown,
    errors: ValidationErrorItem[],
    _warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    if (typeof pattern !== "object" || pattern === null) {
        errors.push({
            field: "style.fillPattern",
            message: `fillPattern must be un object`,
            context: { received: typeof pattern, ...context },
        });
        return;
    }
    const p = pattern as Record<string, unknown>;
    if ("enabled" in p && typeof p.enabled !== "boolean") {
        errors.push({
            field: "style.fillPattern.enabled",
            message: `enabled must be un boolean`,
            context: { received: typeof p.enabled, ...context },
        });
    }
    if (
        p.type &&
        !["diagonal", "horizontal", "vertical", "cross", "x"].includes(p.type as string)
    ) {
        errors.push({
            field: "style.fillPattern.type",
            message: `type must be parmi: diagonal, horizontal, vertical, cross, x`,
            context: {
                received: p.type,
                allowed: ["diagonal", "horizontal", "vertical", "cross", "x"],
                ...context,
            },
        });
    }
    pushColorError(p, "color", "style.fillPattern.color", errors, context);
    pushSizeError(p, "weight", "style.fillPattern.weight", errors, context);
    pushSizeError(p, "density", "style.fillPattern.density", errors, context);
}

/**
 * Validates the base style (style or defaultStyle)
 */

export function validateBaseStyle(
    styleData: Record<string, unknown>,
    errors: ValidationErrorItem[],
    warnings: ValidationWarningItem[],
    context: Record<string, unknown>
): void {
    const style = styleData.style || styleData.defaultStyle;
    if (!style) return;
    const styleObj = style as Record<string, unknown>;
    if (typeof styleObj !== "object" || styleObj === null) {
        errors.push({
            field: "style",
            message: `Le style must be un object`,
            context: { received: typeof styleObj, ...context },
        });
        return;
    }
    pushColorError(styleObj, "fillColor", "style.fillColor", errors, context);
    pushColorError(styleObj, "color", "style.color", errors, context);
    pushOpacityError(styleObj, "fillOpacity", "style.fillOpacity", errors, context);
    pushOpacityError(styleObj, "opacity", "style.opacity", errors, context);
    pushSizeError(styleObj, "weight", "style.weight", errors, context);
    pushSizeError(styleObj, "radius", "style.radius", errors, context);
    if (styleObj.shape && !["circle", "square"].includes(styleObj.shape as string)) {
        errors.push({
            field: "style.shape",
            message: `shape must be 'circle' ou 'square'`,
            context: { received: styleObj.shape, allowed: ["circle", "square"], ...context },
        });
    }
    if (styleObj.stroke) {
        validateStroke(styleObj.stroke, errors, warnings, context);
    }
    if (styleObj.casing) {
        validateCasing(styleObj.casing, errors, warnings, context);
    }
    if (styleObj.fillPattern) {
        validateFillPattern(styleObj.fillPattern, errors, warnings, context);
    }
}
