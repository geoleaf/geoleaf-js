/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Helpers color et opacity reusable for style validation.
 * Deduplicates repeated patterns (color hex, plage opacity, size >= 0).
 */

import type { ValidationErrorItem } from "./style-validator-rules.js";
import { isHexColor } from "./general-validators.js";

/**
 * Checks whether a colour is a valid full-form hex value (`#RRGGBB`).
 * Shorthand `#RGB` is rejected here on purpose — style JSON requires the long form, and the
 * error message pushed below promises exactly that. See `isHexColor` for the rationale.
 */
function isValidHexColor(color: unknown): boolean {
    return isHexColor(color, { shorthand: false });
}

/**
 * Pushes an error when the colour field is present but invalid (`#RRGGBB`).
 */
export function pushColorError(
    obj: Record<string, unknown>,
    key: string,
    fieldPath: string,
    errors: ValidationErrorItem[],
    context: Record<string, unknown>
): void {
    if (obj[key] && !isValidHexColor(obj[key])) {
        errors.push({
            field: fieldPath,
            message: `Couleur invalide, format expected: #RRGGBB`,
            context: { received: obj[key], ...context },
        });
    }
}

/**
 * Pushes an error when the opacity field is present but outside the [0, 1] range
 */
export function pushOpacityError(
    obj: Record<string, unknown>,
    key: string,
    fieldPath: string,
    errors: ValidationErrorItem[],
    context: Record<string, unknown>
): void {
    if (key in obj) {
        const val = obj[key];
        if (typeof val !== "number" || val < 0 || val > 1) {
            errors.push({
                field: fieldPath,
                message: `Opacity must be a number between 0 and 1`,
                context: { received: val, ...context },
            });
        }
    }
}

/**
 * Pushes an error when the numeric field is present but strictly negative
 */
export function pushSizeError(
    obj: Record<string, unknown>,
    key: string,
    fieldPath: string,
    errors: ValidationErrorItem[],
    context: Record<string, unknown>
): void {
    if (key in obj) {
        const val = obj[key];
        if (typeof val !== "number" || val < 0) {
            errors.push({
                field: fieldPath,
                message: `${key} must be un nombre >= 0`,
                context: { received: val, ...context },
            });
        }
    }
}
