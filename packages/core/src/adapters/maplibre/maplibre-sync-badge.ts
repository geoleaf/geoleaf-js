/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre pending-sync badge paint (addpoi D4).
 *
 * The badge marks an entity queued for offline sync with an orange stroke: a point's circle
 * stroke, a line's own stroke, a polygon's outline. It is shared by the generic sub-layer
 * builders (`maplibre-primitives`), the re-style path (`maplibre-style-applier`) and the POI
 * cluster renderer (`maplibre-poi-builders`) so the paint stays byte-identical across them.
 */

import { DEFAULT_FEATURE_COLOR } from "../../utils/constants/constants.js";

/**
 * Pending-sync test expression. The live `syncStatus` feature-state (set via
 * `setFeatureState`, no source rebuild) takes precedence over the baked
 * `_syncStatus` property. `setData` clears feature-state, so the baked property
 * is the fallback for the initial/rebuilt render; with neither flag set,
 * `coalesce` yields the (absent) property and the test is `false`, so a plain
 * feature renders unchanged.
 */
export const SYNC_PENDING: unknown = [
    "==",
    ["coalesce", ["feature-state", "syncStatus"], ["get", "_syncStatus"]],
    "pending",
];

/** Orange stroke colour of the pending-sync badge. */
const SYNC_PENDING_STROKE_COLOR = "#ff9800";
/** Stroke width (px) of the pending-sync badge. */
const SYNC_PENDING_STROKE_WIDTH = 2.5;

/**
 * Wraps a circle paint's stroke so a feature flagged `pending` (via the
 * `_syncStatus` property or the `syncStatus` feature-state) shows the orange
 * sync badge, falling back to the paint's existing stroke otherwise. Mutates
 * `paint` in place.
 *
 * Visually neutral for features with neither flag: `SYNC_PENDING` evaluates to
 * `false`, so the existing stroke — or MapLibre's default width of `0` (no
 * stroke) when none was declared — is kept, and static features render exactly
 * as before.
 */
export function applyPendingBadgePaint(paint: Record<string, unknown>): void {
    const existingColor = paint["circle-stroke-color"] ?? DEFAULT_FEATURE_COLOR;
    const existingWidth = paint["circle-stroke-width"] ?? 0;
    paint["circle-stroke-color"] = ["case", SYNC_PENDING, SYNC_PENDING_STROKE_COLOR, existingColor];
    paint["circle-stroke-width"] = ["case", SYNC_PENDING, SYNC_PENDING_STROKE_WIDTH, existingWidth];
}

/**
 * Wraps a line paint's colour and width so a line — or a polygon outline — flagged `pending`
 * shows the orange sync badge. Mutates `paint` in place.
 *
 * 🛑 THE BADGE WAS A CIRCLE STROKE AND NOTHING ELSE. A line or a polygon owed to the server was
 * drawn like any other: the flag was on the feature, and no paint read it.
 *
 * The width is the stroke's own, raised to the badge's when it is thinner — a hairline outline
 * turned orange would not be seen. Visually neutral for a feature with neither flag. To apply
 * BEFORE the selection paint, as on a circle: the selection outranks the badge while it lasts.
 *
 * @param paint - The line paint of a `line` sub-layer.
 */
export function applyPendingLineBadgePaint(paint: Record<string, unknown>): void {
    const existingColor = paint["line-color"] ?? DEFAULT_FEATURE_COLOR;
    const existingWidth = paint["line-width"] ?? 1;
    paint["line-color"] = ["case", SYNC_PENDING, SYNC_PENDING_STROKE_COLOR, existingColor];
    paint["line-width"] = [
        "case",
        SYNC_PENDING,
        ["max", existingWidth, SYNC_PENDING_STROKE_WIDTH],
        existingWidth,
    ];
}
