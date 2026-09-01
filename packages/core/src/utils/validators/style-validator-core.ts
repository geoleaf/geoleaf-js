/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Base types, error class and validation of the style's structural fields
 */

import type { ValidationErrorItem, ValidationWarningItem } from "./style-validator-rules.js";

/**
 * The outcome of a full style validation: the verdict plus everything that was found.
 *
 * `valid` reflects `errors` alone — a style with warnings is still valid. Errors may carry a
 * `stack` when the finding came from a thrown `StyleValidationError` rather than from an
 * accumulator push.
 */
export interface StyleValidationResult {
    /** `true` when no blocking error was collected. Warnings do not affect it. */
    valid: boolean;
    /** Blocking failures, optionally carrying the stack of the throw that produced them. */
    errors: (ValidationErrorItem & { stack?: string })[];
    /** Non-blocking remarks. */
    warnings: ValidationWarningItem[];
}

/**
 * Classe d'error for thes validations de style
 */
export class StyleValidationError extends Error {
    context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown> = {}) {
        super(message);
        this.name = "StyleValidationError";
        this.context = context;
    }
}

/**
 * Validates the only structural field that is genuinely required: `style` or `defaultStyle`.
 *
 * `id` is NOT required — the schema stopped demanding it in S1/PRF-SCHEMA ("filename acts
 * as id for ~20% of style files"), and the loader derives it from the file name
 * (`_ensureStyleId`). This validator still required it: id-less styles were thus
 * rejected, and since the loader throws on a validation error, their layers were
 * never loaded. The `id` format stays validated when present (`validateId`).
 *
 * ⚠️ This line quantified the defect per profile ("guyane 9,
 * france-risques-inondation 5, france-rail 1") until 29/07/2026 — **all three
 * profiles have since been deleted**. The tally is removed rather than corrected:
 * it dated a repaired defect, on a corpus that no longer exists, and keeping it
 * would have required re-measuring at every profile added or removed. What stays
 * here is the motive, which does not expire.
 *
 * `scaleConfig` is not required either: absent means no scale constraint (S5/N-1).
 * Its shape is validated by `validateScales`.
 */
export function validateRequiredFields(
    styleData: Record<string, unknown>,
    errors: (ValidationErrorItem & { stack?: string })[],
    context: Record<string, unknown>
): void {
    const hasStyle = "style" in styleData && styleData.style != null;
    const hasDefaultStyle = "defaultStyle" in styleData && styleData.defaultStyle != null;

    if (!hasStyle && !hasDefaultStyle) {
        errors.push({
            field: "style",
            message: `Le field required 'style' ou 'defaultStyle' est manquant`,
            context: { availableFields: Object.keys(styleData), ...context },
        });
    }
}

/**
 * Validates the id format (Unicode letters, digits, hyphens, underscores)
 */
export function validateId(
    styleData: Record<string, unknown>,
    errors: ValidationErrorItem[],
    context: Record<string, unknown>
): void {
    if (!styleData.id) return;

    // \p{L} = all Unicode letters (including accented, CJK, etc.)
    const idPattern = /^[\p{L}0-9_-]+$/u;
    if (typeof styleData.id !== "string") {
        errors.push({
            field: "id",
            message: `L'ID must be une string de characters`,
            context: { received: typeof styleData.id, value: styleData.id, ...context },
        });
    } else if (!idPattern.test(styleData.id)) {
        errors.push({
            field: "id",
            message: `L'ID doit contenir only des lettres, chiffres, tirets et underscores`,
            context: { received: styleData.id, pattern: idPattern.toString(), ...context },
        });
    }
}
