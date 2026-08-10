/*!
 * @geoleaf-plugins/print — North arrow overlay
 *
 * Rasterises a compact SVG north arrow onto the 2D canvas at the top-right of
 * the map zone. The off-screen render always uses bearing:0, so the arrow
 * always points up.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { MapZonePx } from "./scale-overlay.js";

/** Size of the north-arrow on paper (mm). */
const ARROW_SIZE_MM = 8;

/** Inline SVG for the north arrow (stroke-based, viewBox 32×40). */
const NORTH_ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" fill="none">
  <polygon points="16,2 26,22 16,18 6,22" fill="#333" stroke="#fff" stroke-width="1.2"/>
  <polygon points="16,38 26,18 16,22 6,18" fill="#eee" stroke="#333" stroke-width="1.2"/>
  <text x="16" y="36" text-anchor="middle" font-size="10" font-family="sans-serif" fill="#333" font-weight="bold">N</text>
</svg>`;

/**
 * Draws a north arrow SVG at the top-right of the map zone.
 * Returns a Promise because image loading is asynchronous.
 */
export async function drawNorthArrow(
    ctx: CanvasRenderingContext2D,
    zone: MapZonePx,
    dpi: number
): Promise<void> {
    const pxPerMm = dpi / 25.4;
    const sizePx = Math.round(ARROW_SIZE_MM * pxPerMm);
    const marginPx = Math.round(6 * pxPerMm);

    const xRight = zone.x + zone.widthPx - marginPx - sizePx;
    const yTop = zone.y + marginPx;

    // data: URI — CSP-safe (no blob: needed; avoids img-src blob: requirement)
    const dataUrl = `data:image/svg+xml;base64,${btoa(NORTH_ARROW_SVG)}`;

    await new Promise<void>((resolve, reject) => {
        const img = new Image(sizePx, Math.round(sizePx * 1.25));
        img.onload = () => {
            // Slight white background disc for readability on dark tiles
            ctx.save();
            ctx.globalAlpha = 0.82;
            ctx.fillStyle = "#fff";
            const r = Math.round(sizePx * 0.55);
            ctx.beginPath();
            ctx.arc(xRight + sizePx / 2, yTop + sizePx * 0.5, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.drawImage(img, xRight, yTop, sizePx, Math.round(sizePx * 1.25));
            ctx.restore();
            resolve();
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}
