/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Validateur de files de style GeoLeaf — orchestrateur
 * Validates style.json files against the declared JSON schema
 * and generates detailed errors with context to facilitate debugging
 */

import {
    validateStyleRules as _validateStyleRules,
    validateScales as _validateScales,
    validateLegend as _validateLegend,
    type ValidationErrorItem,
    type ValidationWarningItem,
} from "./style-validator-rules.js";
import {
    StyleValidationError,
    validateRequiredFields,
    validateId,
} from "./style-validator-core.js";
import type { StyleValidationResult } from "./style-validator-core.js";
import { validateLabel, validateBaseStyle } from "./style-validator-properties.js";
import { formatValidationErrors } from "./style-validator-formatter.js";

export type { StyleValidationResult } from "./style-validator-core.js";
export { StyleValidationError } from "./style-validator-core.js";
export { formatValidationErrors } from "./style-validator-formatter.js";

/**
 * Validates a style object against the JSON schema
 */
export function validateStyle(
    styleData: Record<string, unknown> | null | undefined,
    context: Record<string, unknown> = {}
): StyleValidationResult {
    const errors: (ValidationErrorItem & { stack?: string })[] = [];
    const warnings: ValidationWarningItem[] = [];

    try {
        if (!styleData || typeof styleData !== "object") {
            errors.push({
                field: "root",
                message: "Le style must be un object JSON valide",
                context: { received: typeof styleData, ...context },
            });
            return { valid: false, errors, warnings };
        }

        validateRequiredFields(styleData, errors, context);
        validateId(styleData, errors, context);
        validateLabel(styleData, errors, warnings, context);
        validateBaseStyle(styleData, errors, warnings, context);

        if (styleData.styleRules) {
            _validateStyleRules(styleData.styleRules, errors, warnings, context);
        }

        _validateScales(styleData, errors, warnings, context);

        if (styleData.legend) {
            _validateLegend(styleData.legend, errors, warnings, context);
        }
    } catch (error) {
        errors.push({
            field: "validation",
            message: `Erreur inexpectede lors de la validation: ${(error as Error).message}`,
            ...((error as Error).stack !== undefined && { stack: (error as Error).stack }),
            context,
        });
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Style Validator module — exposes the public functions
 */
export const StyleValidator = {
    validateStyle,
    formatValidationErrors,
    StyleValidationError,
};
