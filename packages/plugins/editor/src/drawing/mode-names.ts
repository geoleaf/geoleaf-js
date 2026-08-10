/*!
 * @geoleaf-plugins/editor — Terra Draw mode names (pure, terra-draw-free)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Pure mode-name constants and mappers, kept free of any `terra-draw` runtime
 * import so they stay in the eager bundle. The terra-draw mode *classes* live in
 * `modes.ts`, which is only pulled in through the lazy adapter chunk.
 * https://geoleaf.dev
 */
import type { EditorTool } from "../types.js";

// Canonical Terra Draw mode names — must match the modeName passed to each mode.

/** Terra Draw mode for placing single points. Maps to the `Point` geometry type. */
export const MODE_POINT = "point" as const;
/** Terra Draw mode for two-vertex lines. Maps to `LineString`, like {@link MODE_POLYLINE}. */
export const MODE_LINE = "line" as const;
/** Terra Draw mode for multi-vertex lines. Maps to `LineString`, like {@link MODE_LINE}. */
export const MODE_POLYLINE = "polyline" as const;
/** Terra Draw mode for closed areas. Maps to the `Polygon` geometry type. */
export const MODE_POLYGON = "polygon" as const;
/**
 * Terra Draw mode for picking and editing existing features.
 *
 * Not a drawing mode: {@link geometryTypeForMode} has no geometry to map it to and returns
 * the mode name unchanged.
 */
export const MODE_SELECT = "select" as const;
/**
 * Terra Draw's inert mode — features are displayed but neither drawn nor selected.
 *
 * The resting state between tools. Like {@link MODE_SELECT}, it maps to no geometry type.
 */
export const MODE_STATIC = "static" as const;

/** Maps an EditorTool to its Terra Draw mode name, or null for non-drawing tools. */
export function getModeNameForTool(tool: EditorTool): string | null {
    switch (tool) {
        case "point":
            return MODE_POINT;
        case "line":
            return MODE_LINE;
        case "polyline":
            return MODE_POLYLINE;
        case "polygon":
            return MODE_POLYGON;
        case "select":
            return MODE_SELECT;
        // undo / redo / delete are actions, not drawing modes
        default:
            return null;
    }
}

/**
 * Maps a Terra Draw mode name back to the geometry type string used in
 * GeoJSON features and the editor form modal.
 */
export function geometryTypeForMode(modeName: string): string {
    switch (modeName) {
        case MODE_POINT:
            return "Point";
        case MODE_LINE:
        case MODE_POLYLINE:
            return "LineString";
        case MODE_POLYGON:
            return "Polygon";
        default:
            return modeName;
    }
}
