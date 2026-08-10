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
 * (`_ensureStyleId`). Ce validateur l'exigeait encore : les styles sans `id` étaient donc
 * rejetés, et comme le chargeur jette sur une erreur de validation, leurs couches n'étaient
 * jamais chargées. Le format de `id` reste validé quand il est présent (`validateId`).
 *
 * ⚠️ Cette ligne a chiffré le défaut par profil (« guyane 9, france-risques-inondation 5,
 * france-rail 1 ») jusqu'au 29/07/2026 — **les trois profils ont été supprimés depuis** (B-43).
 * Le décompte est retiré plutôt que corrigé : il datait un défaut réparé, sur un corpus qui
 * n'existe plus, et le maintenir aurait demandé de le re-mesurer à chaque profil ajouté ou
 * retiré. Ce qui reste ici est le motif, qui ne se périme pas.
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
