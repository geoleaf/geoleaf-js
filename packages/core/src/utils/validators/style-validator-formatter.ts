/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Formatting validation results into readable debug messages
 */

import type { ValidationErrorItem } from "./style-validator-rules.js";
import type { StyleValidationResult } from "./style-validator-core.js";

function _formatErrorItems(
    items: ValidationErrorItem[],
    label: string,
    icon: string,
    lines: string[]
): void {
    lines.push(`${icon}  ${items.length} ${label}:`);
    lines.push("");
    items.forEach((item, index) => {
        lines.push(`  ${index + 1}. Champ: ${item.field}`);
        lines.push(`     Message: ${item.message}`);
        if (item.context)
            lines.push(
                `     Contexte: ${JSON.stringify(item.context, null, 2).split("\n").join("\n     ")}`
            );
        const withStack = item as ValidationErrorItem & { stack?: string };
        if (withStack.stack)
            lines.push(`     Stack: ${withStack.stack.split("\n").slice(0, 3).join("\n     ")}`);
        lines.push("");
    });
}

/**
 * Formats a result de validation en message d'error lisible.
 * Returns null when the style is valid.
 */
export function formatValidationErrors(
    validationResult: StyleValidationResult,
    styleFilePath: string = ""
): string | null {
    if (validationResult.valid) return null;
    const lines: string[] = [];
    lines.push(
        "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"
    );
    lines.push("\u274c ERREUR DE VALIDATION DE STYLE GEOLEAF");
    lines.push(
        "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"
    );
    if (styleFilePath) {
        lines.push(`Fichier: ${styleFilePath}`);
        lines.push("");
    }
    if (validationResult.errors.length > 0)
        _formatErrorItems(
            validationResult.errors,
            "error(s) d\u00e9tect\u00e9e(s):",
            "\u274c",
            lines
        );
    if (validationResult.warnings.length > 0)
        _formatErrorItems(validationResult.warnings, "warning(s):", "\u26a0\ufe0f", lines);
    lines.push(
        "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"
    );
    lines.push(
        "\ud83d\udca1 Conseil: V\u00e9rifiez la documentation dans docs/STYLE_FORMAT_SPEC.md"
    );
    lines.push(
        "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"
    );
    return lines.join("\n");
}
