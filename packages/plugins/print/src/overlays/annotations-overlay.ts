/*!
 * @geoleaf-plugins/print — Annotations overlay
 *
 * Draws measure annotations (from GeoLeaf.Measure.getPrintableAnnotations()) onto
 * the composed 2D canvas. Annotations are DOM overlays on the live map and are not
 * captured by the off-screen render — this module repaints them at print resolution.
 *
 * Coupling: zero imports from plugin-measure. The data contract is the
 * PrintableAnnotation interface (types.ts), consumed via globalThis.GeoLeaf.Measure.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { EmpriseBbox, PrintableAnnotation } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pixel rectangle within the composed canvas (output of _rectMmToPx). */
interface MapZonePx {
    x: number;
    y: number;
    widthPx: number;
    heightPx: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Projects a geographic coordinate to a pixel position on the composed canvas.
 * Uses linear interpolation over the bbox — valid for the small extents typically
 * printed (distortion is negligible at city / field scale).
 * Returns null when the point is outside the rendered bbox.
 */
function _project(
    lngLat: [number, number],
    bbox: EmpriseBbox,
    mapPx: MapZonePx
): { x: number; y: number } | null {
    const [lng, lat] = lngLat;
    if (bbox.maxLng <= bbox.minLng || bbox.maxLat <= bbox.minLat) return null; // degenerate bbox
    if (lng < bbox.minLng || lng > bbox.maxLng || lat < bbox.minLat || lat > bbox.maxLat) {
        return null;
    }
    const nx = (lng - bbox.minLng) / (bbox.maxLng - bbox.minLng);
    const ny = (bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat); // Y is top-down
    return {
        x: mapPx.x + nx * mapPx.widthPx,
        y: mapPx.y + ny * mapPx.heightPx,
    };
}

/**
 * Draws multi-line text inside a box, splitting on `\n` and wrapping words to maxWidth.
 * ctx.font must be set before calling.
 */
function _drawMultilineText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
): void {
    const paragraphs = text.split("\n");
    let currentY = y;
    for (const para of paragraphs) {
        if (!para) {
            currentY += lineHeight;
            continue;
        }
        const words = para.split(" ");
        let line = "";
        for (const word of words) {
            const testLine = line ? `${line} ${word}` : word;
            if (ctx.measureText(testLine).width > maxWidth && line) {
                ctx.fillText(line, x, currentY, maxWidth);
                line = word;
                currentY += lineHeight;
            } else {
                line = testLine;
            }
        }
        if (line) {
            ctx.fillText(line, x, currentY, maxWidth);
            currentY += lineHeight;
        }
    }
}

/** Draws a tooltip annotation (white box + bottom arrow + multiline text). */
function _drawTooltip(
    ctx: CanvasRenderingContext2D,
    pt: { x: number; y: number },
    ann: PrintableAnnotation,
    scale: number,
    fontSize: number
): void {
    const w = (ann.widthPx ?? 160) * scale;
    const h = (ann.heightPx ?? 80) * scale;
    const arrowSize = Math.round(9 * scale);
    const padding = Math.round(6 * scale);
    const boxX = pt.x - w / 2;
    const boxY = pt.y - h - arrowSize;

    ctx.save();

    // White box
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = Math.max(1, Math.round(scale));
    ctx.fillRect(boxX, boxY, w, h);
    ctx.strokeRect(boxX, boxY, w, h);

    // Arrow triangle pointing down toward lngLat anchor
    ctx.beginPath();
    ctx.moveTo(pt.x - arrowSize, boxY + h);
    ctx.lineTo(pt.x + arrowSize, boxY + h);
    ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#d1d5db";
    // Only stroke the two diagonal sides, not the base (shared with box border)
    ctx.beginPath();
    ctx.moveTo(pt.x - arrowSize, boxY + h);
    ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(pt.x + arrowSize, boxY + h);
    ctx.stroke();

    // Text
    ctx.fillStyle = "#111";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    _drawMultilineText(
        ctx,
        ann.text,
        boxX + padding,
        boxY + padding,
        w - padding * 2,
        fontSize * 1.4
    );

    ctx.restore();
}

/** Draws a label annotation (white box centred on the anchor point + single-line text). */
function _drawLabel(
    ctx: CanvasRenderingContext2D,
    pt: { x: number; y: number },
    ann: PrintableAnnotation,
    scale: number,
    fontSize: number
): void {
    const padding = Math.round(4 * scale);
    ctx.save();
    ctx.font = `${fontSize}px sans-serif`;
    const textWidth = ctx.measureText(ann.text).width;
    const bw = textWidth + padding * 2;
    const bh = fontSize + padding * 2;

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = Math.max(1, Math.round(scale));
    ctx.fillRect(pt.x - bw / 2, pt.y - bh / 2, bw, bh);
    ctx.strokeRect(pt.x - bw / 2, pt.y - bh / 2, bw, bh);

    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ann.text, pt.x, pt.y);

    ctx.restore();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Draws all printable annotations within the map bbox onto the composed canvas.
 *
 * @param ctx        2D context of the composed page canvas.
 * @param mapPx      Pixel rect of the map zone within that canvas.
 * @param bbox       Geographic bbox of the rendered map zone.
 * @param annotations Array from GeoLeaf.Measure.getPrintableAnnotations().
 * @param dpi        Print DPI (used to scale dimensions and font sizes).
 */
export function drawAnnotations(
    ctx: CanvasRenderingContext2D,
    mapPx: MapZonePx,
    bbox: EmpriseBbox,
    annotations: PrintableAnnotation[],
    dpi: number
): void {
    if (!annotations.length) return;

    // DPI scale factor: maps screen px (96 DPI reference) → print px
    const scale = dpi / 96;
    // Font size consistent with legend-inline.ts (2.2 × pxPerMm, min 8 px)
    const fontSize = Math.round(Math.max(8, 2.2 * (dpi / 25.4)));

    ctx.save();
    ctx.font = `${fontSize}px sans-serif`;

    for (const ann of annotations) {
        const pt = _project(ann.lngLat, bbox, mapPx);
        if (!pt) continue; // out of rendered extent — skip

        if (ann.kind === "tooltip" || ann.anchor === "bottom") {
            _drawTooltip(ctx, pt, ann, scale, fontSize);
        } else {
            _drawLabel(ctx, pt, ann, scale, fontSize);
        }
    }

    ctx.restore();
}
