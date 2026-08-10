/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Loader — MapLibre adapter options assembly
 *
 * Builds the option bag passed to `adapter.addGeoJSONLayer` for a single layer
 * (style merge, geometry type, on-map icons, styleRules, clustering). Pure module.
 */

import type { DefLike, GeoJSONLoaderLog } from "./loader-types.js";
import type { ClusterLayerDef } from "../../../capabilities/cluster/types.js";
import { scaleToZoom } from "../../../utils/general/scale-utils.js";

/** The style's scale window, as declared by the profile (denominators, 1:X). */
interface ScaleConfigLike {
    minScale?: number | null;
    maxScale?: number | null;
}

/**
 * Converts the style's `scaleConfig` (scale denominators) into the adapter's
 * `minZoom`/`maxZoom` (MapLibre zoom levels), so the ENGINE carries the constraint.
 *
 * Reads `scaleConfig` off `preloadedStyleData` explicitly: it is a SIBLING of
 * `defaultStyle`, so the `Object.assign` merges below never picked it up — which is why
 * the native bridge (`maplibre-primitives` `zoomProps`) sat unfed while the whole constraint
 * ran in JS.
 *
 * The mapping is order-preserving — a denominator grows as you zoom out, so `minScale`
 * (widest view) is the LOWEST zoom: `minScale → minZoom`, `maxScale → maxZoom`.
 *
 * @param preloadedStyleData - Style already fetched by the caller; when given, the bounds
 *   are read from it instead of re-fetching.
 * @param refLat - Latitude the bounds are converted at. The conversion depends on it, so
 *   the range must be re-pushed when the map moves far in latitude — never on zoom.
 */
function _resolveZoomBounds(
    preloadedStyleData: Record<string, unknown> | null,
    refLat: number
): { minZoom?: number; maxZoom?: number } {
    const scaleConfig = preloadedStyleData?.scaleConfig as ScaleConfigLike | undefined;
    if (!scaleConfig) return {};
    const bounds: { minZoom?: number; maxZoom?: number } = {};
    const minZoom = scaleToZoom(scaleConfig.minScale, refLat);
    const maxZoom = scaleToZoom(scaleConfig.maxScale, refLat);
    if (minZoom !== null) bounds.minZoom = minZoom;
    if (maxZoom !== null) bounds.maxZoom = maxZoom;
    return bounds;
}

/** Builds the adapter options (style merge, geometry, icons, styleRules, clustering) for a layer. */
export function buildSingleLayerAdapterOptions(
    def: DefLike,
    preloadedStyleData: Record<string, unknown> | null,
    clusterResult: { shouldCluster: boolean; useSharedCluster?: boolean },
    layerId: string,
    Log: GeoJSONLoaderLog,
    // S7 — resolved through the service locator (capabilities/cluster/install.ts), not
    // imported statically. `clusterResult.shouldCluster` can only be `true` when this
    // resolver was present to compute it, so it is always defined on that branch.
    applyCluster?: (
        adapterOptions: Record<string, unknown>,
        def: unknown,
        layerId: string,
        Log: GeoJSONLoaderLog
    ) => void,
    /** Latitude the scale bounds are converted at — the map's current centre. */
    refLat?: number
): Record<string, unknown> {
    const zIndex = typeof def.zIndex === "number" ? def.zIndex : 0;
    const adapterOptions: Record<string, unknown> = { visible: true, zIndex };

    // Merge style into adapter options (flat format).
    // Preserve visible/zIndex — style properties must not override layer options.
    if (def.style) Object.assign(adapterOptions, def.style);
    if (preloadedStyleData?.defaultStyle)
        Object.assign(adapterOptions, preloadedStyleData.defaultStyle);
    adapterOptions.visible = true;
    adapterOptions.zIndex = zIndex;
    // Pass geometry type so the adapter creates the correct MapLibre layer type
    // (e.g. "fill-extrusion" instead of the default "fill" for polygon GeoJSON sources).
    if (def.geometry) adapterOptions.geometry = def.geometry;
    // Forward a config-declared GeoJSON geometry type so the adapter can skip the
    // per-feature scan (dormant unless the profile declares "Point"/"Polygon"/…).
    if (def.geometryType) adapterOptions.geometryType = def.geometryType;
    if (def.showIconsOnMap) adapterOptions.showIconsOnMap = true;
    if (Array.isArray(def.styleRules) && def.styleRules.length) {
        adapterOptions.styleRules = def.styleRules;
    }

    // Scale window → native zoom range. Set AFTER the style merges so an explicit
    // `minZoom`/`maxZoom` in the style cannot silently outrank the profile's scaleConfig.
    if (typeof refLat === "number") {
        Object.assign(adapterOptions, _resolveZoomBounds(preloadedStyleData, refLat));
    }

    if (clusterResult.shouldCluster) {
        applyCluster?.(adapterOptions, def as unknown as ClusterLayerDef, layerId, Log);
    }
    return adapterOptions;
}
