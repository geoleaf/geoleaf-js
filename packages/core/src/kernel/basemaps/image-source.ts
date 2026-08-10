/*!
 * GeoLeaf Core – Basemaps / Image Source
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Implements static image overlays using MapLibre GL JS `type:"image"` sources.
 * Used as a basemap type when a georeferenced image (plan, scan, ortho, etc.)
 * must be overlaid at fixed geographic coordinates.
 *
 * Security: image URLs are validated before use. No innerHTML or eval.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { validateUrl } from "../../utils/general/utils-base.js";
import { BASEMAP_SOURCE_ID, BASEMAP_LAYER_ID, insertBelow } from "./basemaps-apply.js";
import type { BasemapDefinition, NativeMap } from "./basemaps-types.js";

/**
 * Default image corner coordinates covering the Web Mercator world extent.
 * [topLeft, topRight, bottomRight, bottomLeft] as [lng, lat].
 * @internal
 */
const WORLD_COORDS: [[number, number], [number, number], [number, number], [number, number]] = [
    [-180, 85.051129],
    [180, 85.051129],
    [180, -85.051129],
    [-180, -85.051129],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validates that image corner coordinates form a valid 4-element array of [lng, lat] pairs.
 * Order: [topLeft, topRight, bottomRight, bottomLeft].
 * @internal
 */
function _validateCoordinates(
    coords: unknown
): coords is [[number, number], [number, number], [number, number], [number, number]] {
    if (!Array.isArray(coords) || coords.length !== 4) return false;
    return coords.every(
        (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            typeof pair[0] === "number" &&
            typeof pair[1] === "number" &&
            pair[0] >= -180 &&
            pair[0] <= 180 &&
            pair[1] >= -90 &&
            pair[1] <= 90
    );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a MapLibre image source spec and raster layer spec from a basemap definition.
 * Pure factory — does not call any map API.
 *
 * @param definition - Basemap config with `imageSource.url` and `imageSource.coordinates`.
 * @param sourceId - Source ID to use.
 * @param layerId - Layer ID to use.
 * @returns Source and layer specs, or null if the definition is invalid.
 */
export function buildImageSourceSpec(
    definition: BasemapDefinition,
    sourceId: string,
    layerId: string
): { sourceSpec: Record<string, unknown>; layerSpec: Record<string, unknown> } | null {
    const config = definition?.imageSource;

    if (!config?.url) {
        Log.warn("[GeoLeaf.ImageSource] imageSource.url is required.");
        return null;
    }

    // Security: validate URL before use
    const safeUrl = validateUrl(config.url, ["http:", "https:", "data:"]);
    if (!safeUrl) {
        Log.error("[GeoLeaf.ImageSource] Invalid or unsafe imageSource.url:", config.url);
        return null;
    }

    // Validate and default coordinates
    const coordsValid = _validateCoordinates(config.coordinates);
    if (!coordsValid) {
        Log.warn(
            "[GeoLeaf.ImageSource] imageSource.coordinates invalid — using world bounds. " +
                "Expected 4 [lng, lat] pairs: [topLeft, topRight, bottomRight, bottomLeft]."
        );
    }
    const coords = coordsValid ? config.coordinates : WORLD_COORDS;

    const opacity =
        typeof config.opacity === "number" ? Math.max(0, Math.min(1, config.opacity)) : 1;

    const sourceSpec: Record<string, unknown> = {
        type: "image",
        url: safeUrl,
        coordinates: coords,
    };

    const layerSpec: Record<string, unknown> = {
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: { "raster-opacity": opacity },
    };

    return { sourceSpec, layerSpec };
}

/**
 * Applies an image basemap to the map.
 * Adds a MapLibre `type:"image"` source and a raster layer below all existing layers.
 *
 * @param map - Native `maplibregl.Map` instance.
 * @param definition - Basemap config with `imageSource` settings.
 * @param sourceId - Source ID. Defaults to `"__geoleaf_basemap__"`.
 * @param layerId - Layer ID. Defaults to `"__geoleaf_basemap_layer__"`.
 */
export function applyImageBasemap(
    map: NativeMap,
    definition: BasemapDefinition,
    sourceId = BASEMAP_SOURCE_ID,
    layerId = BASEMAP_LAYER_ID
): void {
    const specs = buildImageSourceSpec(definition, sourceId, layerId);
    if (!specs) {
        Log.error("[GeoLeaf.ImageSource] Cannot apply: invalid definition.");
        return;
    }

    map.addSource(sourceId, specs.sourceSpec);
    insertBelow(map, specs.layerSpec);

    Log.info("[GeoLeaf.ImageSource] Image basemap applied:", _imageUrlForLog(definition));
}

/** @internal Extracts the image URL for logging without re-validating. */
function _imageUrlForLog(definition: BasemapDefinition): string {
    return definition?.imageSource?.url ?? "(unknown)";
}
