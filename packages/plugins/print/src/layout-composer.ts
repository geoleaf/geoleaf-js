/*!
 * @geoleaf-plugins/print — Layout composer
 *
 * Assembles the final print canvas from the off-screen map capture and the
 * various content zones (title, legend, scale bar, north arrow, footer).
 *
 * Design:
 *  - `createComposedCanvas()` is the main entry point. It is pure (no side
 *    effects on the DOM) and can be called repeatedly for live preview updates.
 *  - When only title/description/checkboxes change, the caller should pass the
 *    same `mapCanvas` (cached from the last off-screen render) — no re-render
 *    is triggered.
 *  - External modules can add custom content via `registerSlot()`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { ComposeSlot, EmpriseBbox, PageZones, PrintableAnnotation, Rect } from "./types.js";
import { getGeoLeaf } from "@geoleaf/host-runtime";
import { drawScaleOverlay } from "./overlays/scale-overlay.js";
import { drawNorthArrow } from "./overlays/north-arrow.js";
import { drawLegendInline } from "./overlays/legend-inline.js";
import { drawAnnotations } from "./overlays/annotations-overlay.js";

// ---------------------------------------------------------------------------
// Slot registry
// ---------------------------------------------------------------------------

const _slots: ComposeSlot[] = [];

/**
 * Registers a custom composition slot.
 * Slots are rendered after all built-in zones.
 */
export function registerSlot(slot: ComposeSlot): void {
    const existing = _slots.findIndex((s) => s.id === slot.id);
    if (existing >= 0) {
        _slots[existing] = slot;
    } else {
        _slots.push(slot);
    }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for a single composition pass. */
export interface ComposeOptions {
    /** Page title (plain text, escaped before rendering). */
    title: string;
    /** Optional description shown in the footer area. */
    description: string;
    /** Locked scale denominator (e.g. 10000 for 1:10 000). */
    scaleDenominator: number;
    /** Print DPI (e.g. 300). */
    dpi: number;
    /** Include scale bar overlay on the map zone. */
    includeScale: boolean;
    /** Include north arrow overlay on the map zone. */
    includeNorthArrow: boolean;
    /** Include inline legend below the map zone. */
    includeLegend: boolean;
    /** Include measure annotations (DOM overlays, drawn via getPrintableAnnotations()). */
    includeAnnotations?: boolean;
    /** Geographic bbox of the map zone — required when includeAnnotations is true. */
    bbox?: EmpriseBbox;
    /** Full page dimensions in mm (after orientation swap). */
    pageSizeMm: { widthMm: number; heightMm: number };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _mmToPx(mm: number, dpi: number): number {
    return Math.round((mm / 25.4) * dpi);
}

function _rectMmToPx(
    r: Rect,
    dpi: number
): { x: number; y: number; widthPx: number; heightPx: number } {
    return {
        x: _mmToPx(r.x, dpi),
        y: _mmToPx(r.y, dpi),
        widthPx: _mmToPx(r.width, dpi),
        heightPx: _mmToPx(r.height, dpi),
    };
}

function _rectPx(r: Rect, dpi: number): Rect {
    return {
        x: _mmToPx(r.x, dpi),
        y: _mmToPx(r.y, dpi),
        width: _mmToPx(r.width, dpi),
        height: _mmToPx(r.height, dpi),
    };
}

/**
 * Draws the captured map into the composed map zone.
 *
 * The capture is sized against the *full* map zone of the format — bands (title,
 * legend, footer) can only shrink that zone — so the source is normally a superset
 * of the destination. It is therefore **centre-cropped at 1:1 pixel**, which is what
 * holds the locked scale exact. Stretching it to fit, as this did until PLUGINS S6,
 * silently rescaled the map as soon as any band was present: a title alone cost
 * ~5 % vertically (1:25 000 printed as 1:26 331), a title + legend + footer ~17 %
 * (1:30 240) — while the scale bar kept quoting the nominal denominator.
 *
 * Cropping from the centre keeps the extent the user framed centred on the page.
 *
 * When the source is *smaller* than the destination there is nothing to crop — the
 * mobile DPI clamp (`_boundedDpi`) is the real case — so it falls back to a scaled
 * draw rather than leaving part of the zone blank.
 */
function _drawMapZone(
    ctx: CanvasRenderingContext2D,
    mapCanvas: HTMLCanvasElement,
    mapPx: { x: number; y: number; widthPx: number; heightPx: number }
): void {
    const srcW = mapCanvas.width;
    const srcH = mapCanvas.height;

    if (srcW < mapPx.widthPx || srcH < mapPx.heightPx) {
        ctx.drawImage(mapCanvas, mapPx.x, mapPx.y, mapPx.widthPx, mapPx.heightPx);
        return;
    }

    const sx = Math.round((srcW - mapPx.widthPx) / 2);
    const sy = Math.round((srcH - mapPx.heightPx) / 2);
    ctx.drawImage(
        mapCanvas,
        sx,
        sy,
        mapPx.widthPx,
        mapPx.heightPx,
        mapPx.x,
        mapPx.y,
        mapPx.widthPx,
        mapPx.heightPx
    );
}

/** Draws escaped text centred horizontally in the given px rect. */
function _drawTitleZone(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; widthPx: number; heightPx: number },
    title: string,
    dpi: number
): void {
    if (!title.trim()) return;
    const fontSize = Math.round(Math.max(10, 3.5 * (dpi / 25.4)));
    ctx.save();
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = "#111";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(title, rect.x + rect.widthPx / 2, rect.y + rect.heightPx / 2, rect.widthPx);
    ctx.restore();
}

/** Draws the footer: attribution + optional description. */
function _drawFooterZone(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; widthPx: number; heightPx: number },
    description: string,
    dpi: number
): void {
    const attribution: string =
        (
            getGeoLeaf()?.Core?.getMap?.() as { getAttributionText?(): string } | undefined
        )?.getAttributionText?.() ?? "";
    const text = [attribution, description].filter(Boolean).join(" — ");
    if (!text) return;

    const fontSize = Math.round(Math.max(7, 2 * (dpi / 25.4)));
    ctx.save();
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = "#555";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rect.x, rect.y + rect.heightPx / 2, rect.widthPx);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assembles the final composed page canvas.
 *
 * Pass the same `mapCanvas` (from OffscreenSession.getCanvas()) whenever only
 * the title, description, or overlay checkboxes change — this avoids triggering
 * a new off-screen render.
 */
export async function createComposedCanvas(
    mapCanvas: HTMLCanvasElement,
    zones: PageZones,
    // qualite Q3.3 (26/07/2026) — genuinely unused in the body (page dimensions are
    // recomputed from pageSizeMm/dpi below instead). Kept in the signature: 3 production
    // call sites and the full test suite pass a real computed value, and dropping it would
    // be a public API change unrelated to this sprint. Worth a closer look — see backlog.
    _targetPixels: Record<keyof PageZones, { widthPx: number; heightPx: number }>,
    opts: ComposeOptions
): Promise<HTMLCanvasElement> {
    const { dpi, pageSizeMm } = opts;
    const pageWidthPx = _mmToPx(pageSizeMm.widthMm, dpi);
    const pageHeightPx = _mmToPx(pageSizeMm.heightMm, dpi);

    const canvas = document.createElement("canvas");
    canvas.width = pageWidthPx;
    canvas.height = pageHeightPx;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("[GeoLeaf.Print] createComposedCanvas: no 2D context.");

    // White background
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, pageWidthPx, pageHeightPx);

    // --- Map zone ---
    const mapPx = _rectMmToPx(zones.map, dpi);
    _drawMapZone(ctx, mapCanvas, mapPx);

    // --- Scale bar overlay (bottom-left of map zone) ---
    if (opts.includeScale) {
        drawScaleOverlay(ctx, mapPx, opts.scaleDenominator, dpi);
    }

    // --- North arrow overlay (top-right of map zone) ---
    if (opts.includeNorthArrow) {
        await drawNorthArrow(ctx, mapPx, dpi);
    }

    // --- Title zone ---
    if (zones.title.height > 0) {
        const titlePx = _rectMmToPx(zones.title, dpi);
        _drawTitleZone(ctx, titlePx, opts.title, dpi);
    }

    // --- Legend zone ---
    if (opts.includeLegend && zones.legend.height > 0) {
        const legendPx = _rectMmToPx(zones.legend, dpi);
        await drawLegendInline(ctx, legendPx, dpi);
    }

    // --- Footer zone ---
    if (zones.footer.height > 0) {
        const footerPx = _rectMmToPx(zones.footer, dpi);
        _drawFooterZone(ctx, footerPx, opts.description, dpi);
    }

    // --- Annotations overlay (measure plugin DOM overlays, repainted at print DPI) ---
    _drawAnnotationsOverlay(ctx, mapPx, opts, dpi);

    // --- Custom slots ---
    _drawCustomSlots(ctx, zones, dpi);

    return canvas;
}

/** Resolves the mm rect of a custom slot from its placement (zones or fixed overlay corners). */
function _resolveSlotRect(placement: ComposeSlot["placement"], zones: PageZones): Rect | undefined {
    switch (placement) {
        case "title":
            return zones.title;
        case "legend":
            return zones.legend;
        case "footer":
            return zones.footer;
        case "overlay-tl":
            return { x: zones.map.x, y: zones.map.y, width: 40, height: 40 };
        case "overlay-tr":
            return { x: zones.map.x + zones.map.width - 40, y: zones.map.y, width: 40, height: 40 };
        case "overlay-bl":
            return {
                x: zones.map.x,
                y: zones.map.y + zones.map.height - 40,
                width: 40,
                height: 40,
            };
        case "overlay-br":
            return {
                x: zones.map.x + zones.map.width - 40,
                y: zones.map.y + zones.map.height - 40,
                width: 40,
                height: 40,
            };
    }
}

/** Renders all registered custom slots after the built-in zones. */
function _drawCustomSlots(ctx: CanvasRenderingContext2D, zones: PageZones, dpi: number): void {
    for (const slot of _slots) {
        const rectMm = _resolveSlotRect(slot.placement, zones);
        if (rectMm) {
            slot.render(ctx, _rectPx(rectMm, dpi), undefined);
        }
    }
}

/** Draws measure-plugin annotations over the map zone, repainted at print DPI. */
function _drawAnnotationsOverlay(
    ctx: CanvasRenderingContext2D,
    mapPx: { x: number; y: number; widthPx: number; heightPx: number },
    opts: ComposeOptions,
    dpi: number
): void {
    if (opts.includeAnnotations === false || !opts.bbox) return;
    const annotations =
        (
            getGeoLeaf()?.Measure as
                { getPrintableAnnotations?(): PrintableAnnotation[] } | undefined
        )?.getPrintableAnnotations?.() ?? [];
    if (annotations.length > 0) {
        drawAnnotations(ctx, mapPx, opts.bbox, annotations, dpi);
    }
}
