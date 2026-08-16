/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre adapter — taxonomy marker paint.
 *
 * Splices the taxonomy's marker-disc colours into a point layer's circle paint,
 * replacing only the DEFAULT branch so the layer's own style rules keep winning.
 * The expression itself is built by the taxonomy capability; this module is just
 * the seam that hands it the paint and writes the answer back.
 *
 * Read through the runtime seam (`GeoLeaf.Taxonomy`), never a static import:
 * `taxonomy/public-api.ts` already imports `maplibre-poi-icons.js`, so an adapter →
 * taxonomy import would close a cycle. Same pattern as `_getTaxonomyIcons`.
 *
 * ⚠ No-op when the seam is absent. The Lite bundle and most adapter tests run
 * without `GeoLeaf.Taxonomy`, and their paint must come out byte-identical.
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";

/**
 * MapLibre `icon-size` used when the profile does not set one. The value this
 * pipeline has always hard-coded — changing it would resize every shipped profile's
 * icons.
 */
const DEFAULT_ICON_SIZE = 0.5;

/** The taxonomy methods this module needs. */
interface TaxonomyPaintSeam {
    resolveMarkerPaint?: (
        layerId: string,
        existingPaint: Record<string, unknown>
    ) => Record<string, unknown> | null;
    getIcons?: () => { iconSize?: unknown } | null;
}

/**
 * The `icon-size` for a symbol sub-layer: `modules.taxonomy.icons.iconSize`, or the
 * historical default. Falls back silently when the seam is absent (Lite, tests).
 */
export function resolveIconSize(): number {
    const gl = getGeoLeaf() as { Taxonomy?: TaxonomyPaintSeam } | null;
    const size = gl?.Taxonomy?.getIcons?.()?.iconSize;
    return typeof size === "number" && size > 0 ? size : DEFAULT_ICON_SIZE;
}

/**
 * Applies the taxonomy's marker-disc paint to a circle sub-layer, in place.
 *
 * Must run BEFORE `applyPendingBadgePaint`: that one wraps `circle-stroke-*` in a
 * `["case", SYNC_PENDING, …, existing]`, taking whatever is there as its fallback.
 * Run in this order, the taxonomy expression ends up nested inside the sync case —
 * both features work. Reverse them and the pending-sync badge is overwritten.
 *
 * @param paint - The circle paint, mutated in place. Untouched when taxonomy has
 *   nothing to say about this layer.
 * @param layerId - GeoLeaf layer id.
 */
export function applyTaxonomyMarkerPaint(paint: Record<string, unknown>, layerId: string): void {
    const gl = getGeoLeaf() as { Taxonomy?: TaxonomyPaintSeam } | null;
    const resolve = gl?.Taxonomy?.resolveMarkerPaint;
    if (typeof resolve !== "function") return;

    const overrides = resolve(layerId, paint);
    if (!overrides) return;

    for (const [key, value] of Object.entries(overrides)) {
        paint[key] = value;
    }
}
