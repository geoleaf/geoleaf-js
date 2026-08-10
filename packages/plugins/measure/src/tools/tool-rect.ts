/*!
 * @geoleaf-plugins/measure — Rectangle surface measurement tool
 * © 2026 Mattieu Pottier — MIT License
 *
 * Drag interaction: mousedown (top-left anchor) → mousemove (live preview) → mouseup.
 * Minimum pixel threshold prevents accidental micro-rectangles.
 *
 * PLUGINS S5: the drag lifecycle moved to `createDragTool` — what remains here is only
 * what makes this tool a rectangle.
 * https://geoleaf.dev
 */
import type { MeasureFeature, MeasureMap } from "../types.js";
import { addSurfaceFeature } from "../measure-engine.js";
import { updatePreview } from "../draw-layers.js";
import { bboxPolygon, perimeter, area } from "../compute.js";
import { createDragTool } from "./tool-shared.js";

// Minimum pixel drag distance to register as a valid rectangle.
const MIN_DRAG_PX = 5;

/** Drag state: the fixed anchor corner and the corner the pointer has reached. */
interface RectDrag {
    anchor: [number, number];
    cursor: [number, number];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pixel distance between two geographic coordinates on the given map. */
function _pixelDist(map: MeasureMap, a: [number, number], b: [number, number]): number {
    const pa = map.project({ lng: a[0], lat: a[1] });
    const pb = map.project({ lng: b[0], lat: b[1] });
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

function _finishRect(p1: [number, number], p2: [number, number]): void {
    const rings = bboxPolygon(p1, p2);
    const outer = rings[0] ?? [];
    const open = outer.slice(0, outer.length - 1);
    const perimM = perimeter(open, true);
    const areaM2 = area(rings);

    const feature: MeasureFeature = {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: rings },
        properties: {
            measureType: "rect",
            perimeterM: perimM,
            areaM2,
            lengthM: perimM,
            createdAt: new Date().toISOString(),
        },
    };
    addSurfaceFeature(feature);
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

const _tool = createDragTool<RectDrag>({
    start: (coord) => ({ anchor: coord, cursor: coord }),

    move: (state, coord) => {
        const [outer] = bboxPolygon(state.anchor, coord);
        if (outer) updatePreview(outer);
        return { anchor: state.anchor, cursor: coord };
    },

    // Screen-pixel threshold, not metres: a rectangle is judged by how far the user
    // actually dragged, independently of the zoom level.
    isValid: (state, map) => _pixelDist(map, state.anchor, state.cursor) >= MIN_DRAG_PX,

    commit: (state) => _finishRect(state.anchor, state.cursor),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Arms the rectangle tool: registers mousedown on the map.
 * Safe to call if already active (no-op).
 */
export function activateRect(map: MeasureMap): void {
    _tool.activate(map);
}

/**
 * Disarms the rectangle tool: removes event listeners and clears preview.
 */
export function deactivateRect(): void {
    _tool.deactivate();
}
