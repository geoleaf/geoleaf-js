/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * @fileoverview Label configuration extractor for GeoLeaf style data.
 * Extracted from style-loader.ts as part of Sprint 1 refactoring.
 */

"use strict";

import { Log } from "../log/index.js";

/** Label sub-block of a style file (integrated labels). */
interface StyleLabelConfig {
    enabled?: boolean;
    visibleByDefault?: boolean;
    [key: string]: unknown;
}

/** Minimal structural view of a style file used by the label extractor. */
interface StyleDataWithLabel {
    label?: StyleLabelConfig;
    [key: string]: unknown;
}

/**
 * Ensures visibleByDefault is set when label.enabled is true.
 * Mutates styleData in place; emits a console warning if the field was missing.
 * @param {Object} styleData - Style data object.
 * @param {string} stylePath - Path of the style file (used in warning message).
 * @internal
 */
export function _ensureLabelVisibleByDefault(
    styleData: StyleDataWithLabel,
    stylePath: string
): void {
    if (styleData.label && styleData.label.enabled === true) {
        if (styleData.label.visibleByDefault === undefined) {
            styleData.label.visibleByDefault = false;
            Log.warn(
                `[StyleLoader] "visibleByDefault" manquant: ${stylePath}\nFallback applied: visibleByDefault = false`
            );
        }
    }
}

/**
 * Extracts label configuration from a loaded style data object.
 * Automatically detects if labels are integrated in the style.
 * @param {Object} styleData - The style data object.
 * @returns {Object|null} Label configuration or null if absent/disabled.
 */
export function extractLabelConfig(styleData: unknown): Record<string, unknown> | null {
    if (!styleData || typeof styleData !== "object") {
        return null;
    }

    const { label } = styleData as StyleDataWithLabel;
    if (label && typeof label === "object" && label !== null) {
        if (label.enabled === true) {
            return {
                ...label,
                isIntegrated: true,
            };
        }
    }

    return null;
}
