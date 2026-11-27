/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * Label configuration extractor for GeoLeaf style data.
 *
 * Reads the `label` sub-block of a style file (integrated labels) for the renderers.
 * Extracted from style-loader.ts.
 *
 * `visibleByDefault` is passed through as the file says it, absence included: an absent key
 * lets the caller decide whether the labels show (the labels module), and the loader's own
 * path keeps them hidden until the user asks. Writing `false` in its place would turn that
 * absence into a declaration, which wins over the caller.
 */

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
