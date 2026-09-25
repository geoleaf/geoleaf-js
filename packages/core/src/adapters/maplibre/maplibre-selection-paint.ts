/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre selection paint — what makes the `selected` feature-state visible.
 *
 * `LayerFeatureState.selected` is public ("Selection halo") and `GeoLeaf.Layers.focus` sets
 * it; until this module, no shipped paint read it, so a selected feature looked like any
 * other. It wraps a point's circle stroke and a line's (or a polygon outline's) stroke in a
 * `case` on the feature-state — the same technique as the pending-sync badge, and applied
 * AFTER it: a selection is the user's current gesture and outranks the badge while it lasts;
 * the badge stays the fallback, so it reappears the moment the selection is cleared.
 *
 * Both paint builders call it — creation (`maplibre-primitives.ts`) and re-style
 * (`maplibre-style-applier.ts`), which rebuilds the paint from scratch and would otherwise
 * drop it at the first theme switch. Held by `__tests__/adapters/maplibre-selection-paint.test.js`.
 *
 * ⚠️ A feature-state is addressed by the source's promoted id (`properties.id`): a feature
 * without one cannot be selected, and a whole-collection write clears every state.
 */

/** `true` while the feature's `selected` feature-state is set. */
const SELECTED: unknown = ["boolean", ["feature-state", "selected"], false];

/** Stroke colour of a selected feature. */
const SELECTED_COLOR = "#00b8d4";
/** Circle stroke width (px) of a selected point. */
const SELECTED_CIRCLE_STROKE = 4;
/** Width (px) ADDED to a selected line's own width, so a thick line stays thicker. */
const SELECTED_LINE_EXTRA = 3;

/**
 * Wraps a circle paint's stroke so a selected point shows a halo. Mutates `paint` in place.
 * Visually neutral for a feature that is not selected.
 *
 * @param paint - The circle paint, after the pending-sync badge has been applied.
 */
export function applyCircleSelectionPaint(paint: Record<string, unknown>): void {
    const color = paint["circle-stroke-color"] ?? SELECTED_COLOR;
    const width = paint["circle-stroke-width"] ?? 0;
    paint["circle-stroke-color"] = ["case", SELECTED, SELECTED_COLOR, color];
    paint["circle-stroke-width"] = ["case", SELECTED, SELECTED_CIRCLE_STROKE, width];
}

/**
 * Wraps a line paint's colour and width so a selected line — or polygon outline — stands
 * out. Mutates `paint` in place. Visually neutral for a feature that is not selected.
 *
 * @param paint - The line paint of a `line` sub-layer.
 */
export function applyLineSelectionPaint(paint: Record<string, unknown>): void {
    const color = paint["line-color"] ?? SELECTED_COLOR;
    const width = paint["line-width"] ?? 1;
    paint["line-color"] = ["case", SELECTED, SELECTED_COLOR, color];
    paint["line-width"] = ["case", SELECTED, ["+", width, SELECTED_LINE_EXTRA], width];
}
