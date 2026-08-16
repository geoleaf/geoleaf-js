/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Route capability — applies endpoint markers to a bound layer.
 *
 * Reads the layer's line features (via the generic `GeoLeaf.Layers` seam),
 * derives start / end points and renders them as dedicated point sub-layers
 * (`addGeoJSONLayer`). Idempotent: existing endpoint layers are removed first.
 * No-op when the layer has no binding or carries no line geometry.
 */

import type { RouteConfig, RouteMapAdapter, RouteEndpointStyle } from "./types.js";
import { resolveLayerBinding, resolveEndpointConfig } from "./resolver.js";
import { deriveEndpoints } from "./endpoint-deriver.js";
import { Layers } from "../../api/geoleaf.layers.js";

/** GeoJSON geometry types the capability decorates. */
const LINE_TYPES = new Set(["LineString", "MultiLineString"]);

/**
 * GeoLeaf layer id of the derived endpoint sub-layer.
 *
 * Start and end markers share ONE layer — and therefore one MapLibre source. They
 * used to be two (`gl-route-<id>-start` / `-end`), which meant two sources and two
 * sub-layers per itinerary where one of each suffices (R.38, backlog résiduel S5).
 * The merge is possible because `deriveEndpoints()` already tags every derived
 * feature with `properties.role`, so the two visual styles are expressible as
 * data-driven `styleRules` on a single layer rather than as two layers.
 */
export function endpointsLayerId(layerId: string): string {
    return `gl-route-${layerId}-endpoints`;
}

/** Maps an endpoint style to the adapter's circle-layer style bag. */
function toLayerStyle(style: RouteEndpointStyle): Record<string, unknown> {
    return {
        fillColor: style.fillColor,
        color: style.color,
        weight: style.weight,
        radius: style.radius,
        fillOpacity: style.fillOpacity,
    };
}

/**
 * Builds the data-driven style for the merged endpoint layer.
 *
 * The start style is the layer's base style and the end style is expressed as a
 * `role == "end"` rule on top of it, so a single circle sub-layer renders both.
 * `styleRulesToPaint()` composes a full paint per rule — radius included — which is
 * what allows start and end to differ in size, not only in colour.
 */
function toEndpointStyleOptions(cfg: {
    startStyle: RouteEndpointStyle;
    endStyle: RouteEndpointStyle;
}): Record<string, unknown> {
    return {
        ...toLayerStyle(cfg.startStyle),
        styleRules: [
            {
                when: { field: "role", operator: "==", value: "end" },
                style: toLayerStyle(cfg.endStyle),
            },
        ],
    };
}

/** Removes the derived endpoint sub-layer of a layer (idempotent). */
export function clearEndpoints(adapter: RouteMapAdapter, layerId: string): void {
    adapter.removeLayer?.(endpointsLayerId(layerId));
}

/**
 * (Re)derives and renders the start / end endpoint markers of a bound line
 * layer. No-op when the layer is not bound or has no line geometry.
 *
 * @param adapter - The active MapLibre adapter (`Core.getMap()`).
 * @param config - The `modules.route` config.
 * @param layerId - GeoLeaf layer id.
 * @param geometryTypes - GeoJSON geometry types present on the layer.
 */
export function applyToLayer(
    adapter: RouteMapAdapter,
    config: RouteConfig,
    layerId: string,
    geometryTypes: readonly string[]
): void {
    const binding = resolveLayerBinding(config, layerId);
    if (!binding) return;
    if (!geometryTypes.some((t) => LINE_TYPES.has(t))) return;

    const cfg = resolveEndpointConfig(binding);
    const features = Layers.getFeatures(layerId);

    // Idempotent refresh: drop any previously derived endpoints first.
    clearEndpoints(adapter, layerId);

    // One source, one sub-layer: the two endpoint kinds are merged and told apart by
    // `properties.role`, which deriveEndpoints() already writes.
    const endpoints = [
        ...(cfg.showStart ? deriveEndpoints(features, "start").features : []),
        ...(cfg.showEnd ? deriveEndpoints(features, "end").features : []),
    ];
    if (endpoints.length === 0) return;

    adapter.addGeoJSONLayer(
        endpointsLayerId(layerId),
        { type: "FeatureCollection", features: endpoints },
        toEndpointStyleOptions(cfg)
    );
}
