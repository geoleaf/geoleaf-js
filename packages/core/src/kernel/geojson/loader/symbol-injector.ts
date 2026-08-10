/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Loader — Symbol ID injection for point layers
 *
 * Resolves a MapLibre symbol image ID for each Point/MultiPoint feature from the
 * taxonomy capability (`GeoLeaf.Taxonomy.resolvePoiIcon`, via the layer's
 * `modules.taxonomy` binding), so `showIconsOnMap` layers render the configured
 * SVG icons. Pure module: the resolver is passed in — no service-locator
 * coupling — so it is unit-testable in isolation.
 */

import type { TaxonomySymbolResolver } from "./loader-types.js";

/**
 * Adds a `symbolId` property to Point/MultiPoint features whose layer is bound to
 * a taxonomy that resolves an icon for them. No-op when no resolver is supplied
 * (e.g. the Lite bundle, where the taxonomy capability is tree-shaken out), no
 * `layerId` is given, or the feature resolves no icon.
 */
export function injectSymbolIds(
    geojsonData: { features?: unknown[] },
    layerId?: string,
    taxonomyResolve?: TaxonomySymbolResolver
): void {
    if (!Array.isArray(geojsonData.features)) return;
    if (!taxonomyResolve || !layerId) return;
    for (const rawFeature of geojsonData.features) {
        const feature = rawFeature as {
            geometry?: { type?: string };
            properties?: Record<string, unknown> | null;
        };
        const geomType = feature?.geometry?.type;
        if (geomType !== "Point" && geomType !== "MultiPoint") continue;
        const resolved = taxonomyResolve({ layerId, properties: feature.properties ?? null });
        if (resolved?.useIcon && resolved.symbolId) {
            if (!feature.properties) feature.properties = {};
            feature.properties.symbolId = resolved.symbolId;
        }
    }
}
