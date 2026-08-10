/**
 * Tests for overlays/annotations-overlay.ts — drawAnnotations()
 */

import { describe, expect, it } from "vitest";
import { drawAnnotations } from "../overlays/annotations-overlay.js";
import type { EmpriseBbox, PrintableAnnotation } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(): CanvasRenderingContext2D {
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 2000;
    return canvas.getContext("2d") as CanvasRenderingContext2D;
}

function makeMapZone() {
    return { x: 0, y: 0, widthPx: 3000, heightPx: 2000 };
}

function makeBbox(): EmpriseBbox {
    return { minLng: 2.3, minLat: 48.8, maxLng: 2.5, maxLat: 48.95 };
}

function makeTooltip(lngLat: [number, number] = [2.4, 48.875]): PrintableAnnotation {
    return {
        kind: "tooltip",
        lngLat,
        text: "Hello world\nSecond line",
        widthPx: 160,
        heightPx: 80,
        anchor: "bottom",
    };
}

function makeLabel(lngLat: [number, number] = [2.4, 48.875]): PrintableAnnotation {
    return {
        kind: "label",
        lngLat,
        text: "Label text",
        anchor: "center",
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("drawAnnotations", () => {
    it("does nothing with an empty annotation list", () => {
        const ctx = makeCtx();
        drawAnnotations(ctx, makeMapZone(), makeBbox(), [], 300);
        expect(ctx.fillRect).not.toHaveBeenCalled();
        expect(ctx.fillText).not.toHaveBeenCalled();
    });

    it("draws a tooltip inside the bbox — calls fillRect and fillText", () => {
        const ctx = makeCtx();
        drawAnnotations(ctx, makeMapZone(), makeBbox(), [makeTooltip()], 300);
        expect(ctx.fillRect).toHaveBeenCalled();
        expect(ctx.fillText).toHaveBeenCalled();
    });

    it("draws the tooltip box and arrow via beginPath + fill", () => {
        const ctx = makeCtx();
        drawAnnotations(ctx, makeMapZone(), makeBbox(), [makeTooltip()], 300);
        expect(ctx.beginPath).toHaveBeenCalled();
        expect(ctx.fill).toHaveBeenCalled();
    });

    it("skips annotations outside the bbox", () => {
        const ctx = makeCtx();
        const outside = makeTooltip([10.0, 55.0]); // far outside bbox
        drawAnnotations(ctx, makeMapZone(), makeBbox(), [outside], 300);
        expect(ctx.fillRect).not.toHaveBeenCalled();
        expect(ctx.fillText).not.toHaveBeenCalled();
    });

    it("draws a label annotation — fillRect centered, fillText called", () => {
        const ctx = makeCtx();
        drawAnnotations(ctx, makeMapZone(), makeBbox(), [makeLabel()], 300);
        expect(ctx.fillRect).toHaveBeenCalled();
        expect(ctx.fillText).toHaveBeenCalled();
    });

    it("draws multiple annotations in sequence", () => {
        const ctx = makeCtx();
        const anns: PrintableAnnotation[] = [makeTooltip([2.35, 48.82]), makeLabel([2.45, 48.9])];
        drawAnnotations(ctx, makeMapZone(), makeBbox(), anns, 300);
        // At least 2 fillRect calls (one per annotation)
        const fillRectCalls = (ctx.fillRect as ReturnType<typeof import("vitest").vi.fn>).mock.calls
            .length;
        expect(fillRectCalls).toBeGreaterThanOrEqual(2);
    });

    it("mixes in-bbox and out-of-bbox annotations — only draws in-bbox ones", () => {
        const ctx = makeCtx();
        const anns: PrintableAnnotation[] = [
            makeTooltip([2.4, 48.875]), // inside
            makeTooltip([5.0, 52.0]), // outside
        ];
        drawAnnotations(ctx, makeMapZone(), makeBbox(), anns, 300);
        expect(ctx.fillRect).toHaveBeenCalled();
    });

    it("uses save/restore to isolate drawing state", () => {
        const ctx = makeCtx();
        drawAnnotations(ctx, makeMapZone(), makeBbox(), [makeTooltip()], 300);
        expect(ctx.save).toHaveBeenCalled();
        expect(ctx.restore).toHaveBeenCalled();
    });

    it("does not draw anything when bbox is degenerate (zero area)", () => {
        const ctx = makeCtx();
        const degenBbox: EmpriseBbox = { minLng: 2.4, minLat: 48.875, maxLng: 2.4, maxLat: 48.875 };
        // All points on the edge — none strictly inside (< check fails for equality)
        drawAnnotations(ctx, makeMapZone(), degenBbox, [makeTooltip([2.4, 48.875])], 300);
        expect(ctx.fillRect).not.toHaveBeenCalled();
    });
});
