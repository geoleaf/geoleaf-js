/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Applies a flat GeoLeaf style to the sub-layers of a registered MapLibre layer.
 * Extracted from MaplibreAdapter to keep the adapter file within the 700-line limit.
 */
import {
    normalizeToFlat,
    toFillExtrusionPaint,
    toCasingPaint,
    styleRulesToPaint,
    collectHatchPatterns,
    type CasingConfig,
} from "./maplibre-style-converter.js";
import {
    toSubLayerId,
    toFillPaint,
    toLinePaint,
    toCirclePaint,
    setPaintAt,
} from "./maplibre-primitives.js";
import { applyPendingBadgePaint } from "./maplibre-sync-badge.js";
import { applyTaxonomyMarkerPaint } from "./maplibre-taxonomy-paint.js";
import {
    registerHatchPattern,
    buildHatchPatternId,
    type HatchConfig,
} from "./maplibre-hatch-patterns.js";
import type { MaplibreLayerRegistry } from "./maplibre-layer-registry.js";
import type { MaplibreMap } from "./maplibre-adapter-types.js";
import type { GeoLeafStyleOptions } from "../../contracts/map-adapter.contract.ts";
import type { GeoJSONStyleRule } from "../../kernel/geojson/geojson-types.js";

/** Returns true when rules are a non-empty array. */
function _hasRules(rules: GeoJSONStyleRule[] | undefined): rules is GeoJSONStyleRule[] {
    return Array.isArray(rules) && rules.length > 0;
}

/** Builds the paint object for a casing sub-layer from a flat style. */
function _buildCasingPaint(flat: Record<string, unknown>): Record<string, unknown> {
    const casingConfig = (flat.casing ?? {}) as CasingConfig;
    const mainWeight = typeof flat.weight === "number" ? flat.weight : 1;
    return toCasingPaint(casingConfig, mainWeight);
}

/** Builds the paint object for a fill sub-layer, with or without styleRules. */
function _buildFillPaint(
    map: MaplibreMap,
    flat: Record<string, unknown>,
    rules: GeoJSONStyleRule[] | undefined,
    id: string
): Record<string, unknown> {
    if (_hasRules(rules)) {
        const hatchPatterns = collectHatchPatterns(flat, rules, id);
        for (const { patternId, hatchConfig } of hatchPatterns) {
            registerHatchPattern(map, patternId, hatchConfig);
        }
        return styleRulesToPaint(rules, flat, "fill", id);
    }
    const hatch = flat.hatch as HatchConfig | undefined;
    if (hatch?.enabled) {
        registerHatchPattern(map, buildHatchPatternId(id, hatch), hatch);
    }
    return toFillPaint(flat, id);
}

/**
 * Builds the paint for a circle sub-layer, with the same two decorations
 * `_addPointSubLayers` applies at creation time — and in the same order.
 *
 * This is the RE-STYLE path (a theme switch, `setLayerStyle`), and it rebuilds the
 * paint from scratch. Anything the creation path layered on top has to be layered
 * on again here, or a theme switch silently strips it: taxonomy's marker disc, and
 * — a bug that predates it — the pending-sync badge, which used to vanish the first
 * time the user changed theme.
 *
 * Order is not negotiable: taxonomy replaces the DEFAULT branch, then the sync badge
 * WRAPS the result. Swap them and the badge is overwritten.
 */
function _buildCirclePaint(
    flat: Record<string, unknown>,
    rules: GeoJSONStyleRule[] | undefined,
    id: string
): Record<string, unknown> {
    const paint = _hasRules(rules)
        ? styleRulesToPaint(rules, flat, "circle")
        : (toCirclePaint(flat) as Record<string, unknown>);
    applyTaxonomyMarkerPaint(paint, id);
    applyPendingBadgePaint(paint);
    return paint;
}

/**
 * Updates the MapLibre paint properties for all sub-layers of `id`
 * to match the given GeoLeaf style options.
 */
export function applyLayerStyle(
    map: MaplibreMap,
    registry: MaplibreLayerRegistry,
    id: string,
    style: GeoLeafStyleOptions
): void {
    const entry = registry.get(id);
    if (!entry) return;

    const flat = normalizeToFlat(style as Record<string, unknown>);
    const rules = (style as Record<string, unknown>)?.styleRules as GeoJSONStyleRule[] | undefined;

    for (const subType of entry.subLayerTypes) {
        const subId = toSubLayerId(id, subType);
        if (!map.getLayer(subId)) continue;

        let paint: Record<string, unknown>;
        switch (subType) {
            case "fill":
                paint = _buildFillPaint(map, flat, rules, id);
                break;
            case "line":
                paint = _hasRules(rules)
                    ? styleRulesToPaint(rules, flat, "line")
                    : toLinePaint(flat);
                break;
            case "casing":
                paint = _buildCasingPaint(flat);
                break;
            case "circle":
                paint = _buildCirclePaint(flat, rules, id);
                break;
            case "fill-extrusion":
                paint = toFillExtrusionPaint(flat) as Record<string, unknown>;
                break;
            default:
                continue;
        }

        for (const [prop, value] of Object.entries(paint)) {
            setPaintAt(map, subId, prop, value);
        }
    }
}
