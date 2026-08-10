/*!
 * @geoleaf-plugins/print — Inline legend overlay
 *
 * Repaints the GeoLeaf legend onto the 2D canvas below the map zone.
 * Uses the same data model as the core legend panel (GeoLeaf.Legend.getAllLayers()),
 * so the output is identical to the interactive legend — no html2canvas required.
 *
 * Symbol rendering strategy:
 *   - Simple types (circle, marker, line-solid, polygon-solid, star): drawn directly.
 *   - Complex types (dashed/outlined line, hatched polygon, icon): delegate to
 *     GeoLeaf._UIComponents.renderSymbol() → serialize inner SVG → Image → drawImage.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { getGeoLeaf, type GeoLeafHost } from "@geoleaf/host-runtime";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Symbol size on paper (mm). */
const SYMBOL_SIZE_MM = 5;
/** Row height on paper (mm). */
const ROW_HEIGHT_MM = 6;
/** Horizontal gap between symbol and label (mm). */
const H_GAP_MM = 1.5;
/** Vertical gap between rows (mm). */
const ROW_GAP_MM = 1;
/** Left/top margin inside the legend zone (mm). */
const LEGEND_MARGIN_MM = 4;

type SymbolConfig = Record<string, unknown>;

/** A legend item within a section (symbol + label). */
interface LegendItem {
    symbol?: SymbolConfig;
    label?: string;
}

/** A legend section (optional heading + items). */
interface LegendSection {
    title?: string;
    items?: LegendItem[];
}

/** Per-layer legend info returned by `GeoLeaf.Legend.getAllLayers()`. */
interface LegendLayerInfo {
    visible?: boolean;
    legendData?: { sections?: LegendSection[] };
}

/** Returns true for symbol types that need the SVG → Image path. */
function _isComplex(sym: SymbolConfig): boolean {
    const t = (sym.type as string) ?? "";
    if (t === "line") return !!(sym.style && sym.style !== "solid") || !!sym.dashArray;
    if (t === "polygon" || t === "fill")
        return !!(sym.hatch && (sym.hatch as { enabled?: boolean }).enabled);
    return t === "icon";
}

/**
 * Rasterises a GeoLeaf UIComponent symbol (SVG HTMLElement) to a canvas Image.
 * Falls back to a plain coloured square on error.
 */
async function _svgElemToImage(
    elem: HTMLElement,
    sizePx: number
): Promise<HTMLImageElement | null> {
    const svgEl = elem.querySelector("svg") ?? (elem.tagName === "SVG" ? elem : null);
    if (!svgEl) return null;
    try {
        const svgStr = new XMLSerializer().serializeToString(svgEl);
        // data: URI — CSP-safe (img-src data: is allowed; blob: is not)
        const dataUrl = `data:image/svg+xml;base64,${btoa(svgStr)}`;
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image(sizePx, sizePx);
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("svg load"));
            img.src = dataUrl;
        });
    } catch {
        return null;
    }
}

/** Draws a simple circle symbol on ctx. */
function _drawCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    sizePx: number,
    sym: SymbolConfig
): void {
    const cx = x + sizePx / 2;
    const cy = y + sizePx / 2;
    const r = sizePx * 0.4;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = (sym.fillColor as string) ?? (sym.color as string) ?? "#888";
    ctx.globalAlpha = (sym.fillOpacity as number) ?? (sym.opacity as number) ?? 1;
    ctx.fill();
    if (sym.color && sym.weight) {
        ctx.strokeStyle = sym.color as string;
        ctx.lineWidth = Math.max(1, Math.round(((sym.weight as number) * sizePx) / 14));
        ctx.globalAlpha = 1;
        ctx.stroke();
    }
    ctx.restore();
}

/** Draws a solid line symbol on ctx. */
function _drawLineSolid(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    sizePx: number,
    sym: SymbolConfig
): void {
    const cy = y + sizePx / 2;
    ctx.save();
    ctx.strokeStyle = (sym.color as string) ?? "#333";
    ctx.lineWidth = Math.max(1, Math.round((((sym.width as number) ?? 2) * sizePx) / 14));
    ctx.globalAlpha = (sym.opacity as number) ?? 1;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + sizePx, cy);
    ctx.stroke();
    ctx.restore();
}

/** Draws a solid polygon symbol on ctx. */
function _drawPolygonSolid(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    sizePx: number,
    sym: SymbolConfig
): void {
    ctx.save();
    ctx.fillStyle = (sym.fillColor as string) ?? "#aaa";
    ctx.globalAlpha = (sym.fillOpacity as number) ?? 0.7;
    ctx.fillRect(x, y + Math.round(sizePx * 0.1), sizePx, Math.round(sizePx * 0.8));
    if (sym.color || sym.borderColor) {
        ctx.strokeStyle = (sym.borderColor as string) ?? (sym.color as string) ?? "#666";
        ctx.lineWidth = Math.max(1, Math.round((((sym.weight as number) ?? 1) * sizePx) / 14));
        ctx.globalAlpha = 1;
        ctx.strokeRect(x, y + Math.round(sizePx * 0.1), sizePx, Math.round(sizePx * 0.8));
    }
    ctx.restore();
}

/** Draws a star symbol on ctx. */
function _drawStar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    sizePx: number,
    sym: SymbolConfig
): void {
    ctx.save();
    ctx.fillStyle = (sym.color as string) ?? "#f59e0b";
    ctx.font = `${Math.round(sizePx * 0.9)}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText("★", x, y);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for the inline legend renderer. */
interface LegendZonePx {
    x: number;
    y: number;
    widthPx: number;
    heightPx: number;
}

/**
 * Draws a single legend symbol at (symX, symY), dispatching on symbol type.
 * Complex symbols are rendered to an offscreen SVG and drawn as an image.
 */
async function _drawLegendSymbol(
    ctx: CanvasRenderingContext2D,
    gl: GeoLeafHost,
    sym: SymbolConfig,
    symType: string,
    symX: number,
    symY: number,
    symbolPx: number
): Promise<void> {
    if (_isComplex(sym)) {
        const tmpDiv = document.createElement("div");
        (
            gl._UIComponents as { renderSymbol?(el: HTMLElement, sym: unknown): void } | undefined
        )?.renderSymbol?.(tmpDiv, sym);
        const img = await _svgElemToImage(tmpDiv, symbolPx);
        if (img) {
            ctx.drawImage(img, symX, symY, symbolPx, symbolPx);
        } else {
            // Fallback placeholder
            ctx.save();
            ctx.fillStyle = "#ccc";
            ctx.fillRect(symX, symY, symbolPx, symbolPx);
            ctx.restore();
        }
        return;
    }
    if (symType === "circle" || symType === "marker") {
        _drawCircle(ctx, symX, symY, symbolPx, sym);
    } else if (symType === "line") {
        _drawLineSolid(ctx, symX, symY, symbolPx, sym);
    } else if (symType === "polygon" || symType === "fill") {
        _drawPolygonSolid(ctx, symX, symY, symbolPx, sym);
    } else if (symType === "star") {
        _drawStar(ctx, symX, symY, symbolPx, sym);
    } else {
        _drawCircle(ctx, symX, symY, symbolPx, sym);
    }
}

/**
 * Draws the GeoLeaf legend inline on the canvas below the map zone.
 * Returns the actual height drawn in pixels (may be less than `zone.heightPx`).
 *
 * If `GeoLeaf.Legend` is not loaded, draws nothing and returns 0.
 */
export async function drawLegendInline(
    ctx: CanvasRenderingContext2D,
    zone: LegendZonePx,
    dpi: number
): Promise<number> {
    const gl = getGeoLeaf();
    if (!gl) return 0;
    const getAllLayers = (
        gl.Legend as { getAllLayers?(): Map<string, LegendLayerInfo> } | undefined
    )?.getAllLayers;
    if (!getAllLayers) return 0;

    const layers = getAllLayers();
    if (!layers || layers.size === 0) return 0;

    const pxPerMm = dpi / 25.4;
    const symbolPx = Math.round(SYMBOL_SIZE_MM * pxPerMm);
    const rowH = Math.round(ROW_HEIGHT_MM * pxPerMm);
    const hGap = Math.round(H_GAP_MM * pxPerMm);
    const rowGap = Math.round(ROW_GAP_MM * pxPerMm);
    const margin = Math.round(LEGEND_MARGIN_MM * pxPerMm);
    const fontSize = Math.round(Math.max(8, 2.2 * pxPerMm));
    const colW = symbolPx + hGap + Math.round(28 * pxPerMm); // symbol + label column width

    let curX = zone.x + margin;
    let curY = zone.y + margin;
    const maxX = zone.x + zone.widthPx - margin;

    // Background
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(zone.x, zone.y, zone.widthPx, zone.heightPx);
    ctx.restore();

    for (const [, info] of layers) {
        if (!info.visible || !info.legendData?.sections) continue;

        for (const section of info.legendData.sections) {
            if (section.title) {
                // Section heading — full width
                if (curX > zone.x + margin) {
                    curX = zone.x + margin;
                    curY += rowH + rowGap;
                }
                ctx.save();
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.fillStyle = "#333";
                ctx.textBaseline = "middle";
                ctx.fillText(section.title, curX, curY + rowH / 2, maxX - curX);
                ctx.restore();
                curY += rowH + rowGap;
                curX = zone.x + margin;
            }

            for (const item of section.items ?? []) {
                const sym: SymbolConfig = (item.symbol as SymbolConfig) ?? {};
                const symType = (sym.type as string) ?? "circle";

                // Wrap to next row if not enough horizontal space
                if (curX + colW > maxX) {
                    curX = zone.x + margin;
                    curY += rowH + rowGap;
                }

                const symX = curX;
                const symY = curY + Math.round((rowH - symbolPx) / 2);

                // Draw symbol (type dispatch extracted to _drawLegendSymbol)
                await _drawLegendSymbol(ctx, gl, sym, symType, symX, symY, symbolPx);

                // Draw label
                const labelX = curX + symbolPx + hGap;
                ctx.save();
                ctx.font = `${fontSize}px sans-serif`;
                ctx.fillStyle = "#222";
                ctx.textBaseline = "middle";
                const maxLabelW = colW - symbolPx - hGap;
                ctx.fillText(item.label ?? "", labelX, curY + rowH / 2, maxLabelW);
                ctx.restore();

                curX += colW + Math.round(2 * pxPerMm);
            }
        }
    }

    // Final row height
    const drawnHeight = curY + rowH + margin - zone.y;
    return Math.min(drawnHeight, zone.heightPx);
}
