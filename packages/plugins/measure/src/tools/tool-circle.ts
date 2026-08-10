/*!
 * @geoleaf-plugins/measure — Circle surface measurement tool
 * © 2026 Mattieu Pottier — MIT License
 *
 * Drag interaction: mousedown (centre) → mousemove (radius preview) → mouseup.
 * Minimum radius threshold prevents accidental micro-circles.
 *
 * PLUGINS S5: the drag lifecycle moved to `createDragTool` — what remains here is only
 * what makes this tool a circle.
 * https://geoleaf.dev
 */
import type { MeasureFeature, MeasureMap } from "../types.js";
import { addSurfaceFeature } from "../measure-engine.js";
import { updatePreview } from "../draw-layers.js";
import { circlePolygon, segmentLengths, perimeter, area } from "../compute.js";
import { getMeasureConfig } from "../config.js";
import { createDragTool } from "./tool-shared.js";

// Minimum radius in metres to register as a valid circle.
const MIN_RADIUS_M = 1;

/** Drag state: the fixed centre and the radius the pointer has reached. */
interface CircleDrag {
    center: [number, number];
    radiusM: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Distance in metres between two geographic coordinates (via segmentLengths). */
function _radiusM(a: [number, number], b: [number, number]): number {
    return segmentLengths([a, b])[0] ?? 0;
}

/** Returns the polygon rings approximating a circle at the configured resolution. */
function _rings(center: [number, number], radiusM: number): [number, number][][] {
    return circlePolygon(center, radiusM, getMeasureConfig().circleSteps ?? 64);
}

function _finishCircle(center: [number, number], radiusM: number): void {
    const rings = _rings(center, radiusM);
    const ring = rings[0] ?? [];
    const openRing = ring.slice(0, ring.length - 1);
    const perimM = perimeter(openRing, true);
    const areaM2 = area(rings);

    const feature: MeasureFeature = {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: rings },
        properties: {
            measureType: "circle",
            radiusM,
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

const _tool = createDragTool<CircleDrag>({
    start: (coord) => ({ center: coord, radiusM: 0 }),

    move: (state, coord) => {
        const radiusM = _radiusM(state.center, coord);
        // Below the threshold there is nothing meaningful to draw yet.
        const [outer] = _rings(state.center, radiusM);
        if (radiusM >= MIN_RADIUS_M && outer) updatePreview(outer);
        return { center: state.center, radiusM };
    },

    isValid: (state) => state.radiusM >= MIN_RADIUS_M,

    commit: (state) => _finishCircle(state.center, state.radiusM),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Arms the circle tool: registers mousedown on the map.
 * Safe to call if already active (no-op).
 */
export function activateCircle(map: MeasureMap): void {
    _tool.activate(map);
}

/**
 * Disarms the circle tool: removes event listeners and clears preview.
 */
export function deactivateCircle(): void {
    _tool.deactivate();
}
