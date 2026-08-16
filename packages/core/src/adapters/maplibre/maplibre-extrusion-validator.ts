/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Boot-time validation for fill-extrusion layers.
 * Called during layer loading to fail fast on invalid configuration.
 */

import type { FlatStyle } from "./maplibre-style-converter.js";
import { Log } from "../../utils/log/index.js";

/**
 * Validates that required fill-extrusion style properties are present.
 * Throws on missing required fields; logs warnings for suspicious config.
 *
 * @param layerId - Layer identifier (for error messages)
 * @param geometry - Layer geometry type from config
 * @param style - Normalized flat style
 * @param firstFeature - Optional first GeoJSON feature (for field heuristic)
 * @param sourceType - "geojson" | "vector" (heuristic only runs on geojson)
 */
export function validateFillExtrusionStyle(
    layerId: string,
    geometry: string | undefined,
    style: FlatStyle,
    firstFeature?: { properties?: Record<string, unknown> } | null,
    sourceType?: "geojson" | "vector"
): void {
    if (!geometry || geometry.toLowerCase() !== "fill-extrusion") return;

    if (!style.fillExtrusionHeight && style.fillExtrusionHeight !== 0) {
        throw new Error(
            `[GeoLeaf] Layer "${layerId}": fillExtrusionHeight is required for fill-extrusion geometry.`
        );
    }

    if (!style.fillExtrusionColor) {
        throw new Error(
            `[GeoLeaf] Layer "${layerId}": fillExtrusionColor is required for fill-extrusion geometry.`
        );
    }

    // Heuristic warning: check if the height field exists in the first feature (GeoJSON only)
    if (
        sourceType === "geojson" &&
        typeof style.fillExtrusionHeight === "string" &&
        firstFeature?.properties &&
        !(style.fillExtrusionHeight in firstFeature.properties)
    ) {
        Log.warn(
            `[GeoLeaf] Layer "${layerId}": field "${style.fillExtrusionHeight}" not found in feature properties. ` +
                `Extrusion height will be 0. Check the fillExtrusionHeight field name.`
        );
    }
}
