/*!
 * GeoLeaf COG Plugin — COG Renderer
 * Decodes raster bands to Canvas and injects the result as a MapLibre image source.
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { CogLayerOptions, CogRasterData, MapLike } from "./types.js";

// ─── MapLibre minimal typings ─────────────────────────────────────────────────

// MapLibre image source expects 4 corner coordinates: [[W,N],[E,N],[E,S],[W,S]]
type ImageCoordinates = [[number, number], [number, number], [number, number], [number, number]];

// ─── Canvas helpers ───────────────────────────────────────────────────────────

/**
 * Creates a canvas element. Uses OffscreenCanvas when available (workers, modern browsers),
 * falls back to HTMLCanvasElement (jsdom, older environments).
 */
function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== "undefined") {
        return new OffscreenCanvas(width, height);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/**
 * Normalises a pixel value to the [0, 255] uint8 range.
 * Handles float, int16, uint16, and uint8 TypedArrays.
 */
function normalizeValue(value: number, min: number, max: number): number {
    if (max === min) return 0;
    return Math.round(((value - min) / (max - min)) * 255);
}

/**
 * Computes min/max of a TypedArray for normalisation purposes.
 */
function computeMinMax(band: ArrayLike<number>): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    // ArrayLike is not iterable, so the index stays — only the read is guarded.
    for (let i = 0; i < band.length; i++) {
        const v = band[i];
        if (v === undefined) continue;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return { min, max };
}

// ─── Raster → Canvas ─────────────────────────────────────────────────────────

/** Internal: resolved 0-based band indices used by writePixelsToImageData. */
interface BandIndices {
    redIdx: number;
    greenIdx: number;
    blueIdx: number;
    alphaIdx: number;
    isSingleBand: boolean;
}

/** Resolves user band selection (1-based) into 0-based indices. */
function resolveBandIndices(bandCount: number, bands?: CogLayerOptions["bands"]): BandIndices {
    let redIdx = 0;
    let greenIdx = 1;
    let blueIdx = 2;
    let singleOverride = false;
    if (bands) {
        if (bands.length === 1) {
            redIdx = greenIdx = blueIdx = (bands[0] as number) - 1;
            singleOverride = true;
        } else if (bands.length === 3) {
            // Destructure the tuple, not the array `.map()` returns: `map` erases tuple-ness,
            // so each binding came back possibly-undefined for no reason (qualite Q5).
            const [r, g, b] = bands as [number, number, number];
            redIdx = r - 1;
            greenIdx = g - 1;
            blueIdx = b - 1;
        }
    }
    return {
        redIdx,
        greenIdx,
        blueIdx,
        alphaIdx: bandCount === 4 ? 3 : -1,
        isSingleBand: bandCount === 1 || singleOverride,
    };
}

/**
 * Writes decoded raster values into a flat ImageData pixel buffer.
 * Supports grayscale (1-band), RGB, RGBA, and colorMap LUT rendering.
 * Nodata pixels are left transparent (all channels remain 0 from createImageData).
 */
function writePixelsToImageData(
    pixels: Uint8ClampedArray,
    rasters: CogRasterData["rasters"],
    width: number,
    height: number,
    bi: BandIndices,
    nodata: number | null,
    colorMap: CogLayerOptions["colorMap"] | undefined
): void {
    const n = rasters.length;
    const rBand = rasters[Math.min(bi.redIdx, n - 1)];
    const gBand = rasters[Math.min(bi.greenIdx, n - 1)];
    const bBand = rasters[Math.min(bi.blueIdx, n - 1)];
    // Unreachable for a non-empty `rasters` — Math.min(_, n - 1) is always in range — but the
    // bound is arithmetic, so only a value guard states it to the compiler (qualite Q5).
    if (!rBand || !gBand || !bBand) return;
    // Hoisted out of the loop: the alpha band never varied per pixel, it was simply re-read
    // width × height times.
    const aBand = bi.alphaIdx >= 0 ? rasters[bi.alphaIdx] : undefined;
    const rRange = computeMinMax(rBand);
    const gRange = bi.isSingleBand ? rRange : computeMinMax(gBand);
    const bRange = bi.isSingleBand ? rRange : computeMinMax(bBand);

    for (let i = 0; i < width * height; i++) {
        const rRaw = rBand[i];
        // Short band: nothing to normalise, leave the pixel transparent like nodata does.
        if (rRaw === undefined) continue;
        // Nodata → leave pixel as [0,0,0,0] (createImageData initialises to 0)
        if (nodata !== null && rRaw === nodata) continue;

        _writePixel(pixels, i * 4, rRaw, {
            i,
            gBand,
            bBand,
            aBand,
            rRange,
            gRange,
            bRange,
            colorMap,
            isSingleBand: bi.isSingleBand,
        });
    }
}

interface PixelContext {
    i: number;
    gBand: ArrayLike<number>;
    bBand: ArrayLike<number>;
    aBand: ArrayLike<number> | undefined;
    rRange: { min: number; max: number };
    gRange: { min: number; max: number };
    bRange: { min: number; max: number };
    colorMap: CogLayerOptions["colorMap"] | undefined;
    isSingleBand: boolean;
}

/**
 * Writes the four channels of a single pixel.
 *
 * Extracted from {@link writePixelsToImageData} so that the per-pixel branching does not add to
 * that function's cyclomatic complexity, which the repository caps at 20 (qualite Q5).
 */
function _writePixel(pixels: Uint8ClampedArray, pi: number, rRaw: number, ctx: PixelContext): void {
    const { i, rRange } = ctx;

    if (ctx.colorMap && ctx.isSingleBand) {
        const idx = Math.min(255, Math.max(0, normalizeValue(rRaw, rRange.min, rRange.max)));
        const entry =
            ctx.colorMap[idx] ?? ([idx, idx, idx, 255] as [number, number, number, number]);
        pixels[pi] = entry[0];
        pixels[pi + 1] = entry[1];
        pixels[pi + 2] = entry[2];
        pixels[pi + 3] = entry[3];
        return;
    }

    if (ctx.isSingleBand) {
        const v = normalizeValue(rRaw, rRange.min, rRange.max);
        pixels[pi] = v;
        pixels[pi + 1] = v;
        pixels[pi + 2] = v;
        pixels[pi + 3] = 255;
        return;
    }

    // RGB and RGBA differ only in the alpha channel — a single branch, at the channel.
    pixels[pi] = normalizeValue(rRaw, rRange.min, rRange.max);
    pixels[pi + 1] = normalizeValue(ctx.gBand[i] ?? 0, ctx.gRange.min, ctx.gRange.max);
    pixels[pi + 2] = normalizeValue(ctx.bBand[i] ?? 0, ctx.bRange.min, ctx.bRange.max);
    pixels[pi + 3] = ctx.aBand ? (ctx.aBand[i] ?? 255) : 255;
}

/**
 * Converts decoded raster bands to an HTMLCanvasElement / OffscreenCanvas.
 *
 * - 1 band:  grayscale → RGBA (R=G=B=value, A=255 or 0 on nodata)
 * - 3 bands: RGB → RGBA (A=255 or 0 on nodata)
 * - 4 bands: RGBA direct (A=0 on nodata)
 * - colorMap: LUT applied for single-band rendering (256 entries)
 */
export function rastersToCanvas(
    data: CogRasterData,
    opts: Pick<CogLayerOptions, "bands" | "colorMap" | "nodata">
): OffscreenCanvas | HTMLCanvasElement {
    const { rasters, width, height } = data;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d") as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
    if (!ctx) throw new Error("[GeoLeaf COG] Could not get 2D canvas context");
    const imageData = ctx.createImageData(width, height);
    const bi = resolveBandIndices(rasters.length, opts.bands);
    writePixelsToImageData(
        imageData.data,
        rasters,
        width,
        height,
        bi,
        opts.nodata ?? null,
        bi.isSingleBand ? opts.colorMap : undefined
    );
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

/**
 * Converts a canvas to a data URL string (PNG).
 * Handles both HTMLCanvasElement and OffscreenCanvas.
 */
export async function canvasToDataUrl(
    canvas: OffscreenCanvas | HTMLCanvasElement
): Promise<string> {
    if (canvas instanceof HTMLCanvasElement) {
        return canvas.toDataURL("image/png");
    }
    // OffscreenCanvas
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return URL.createObjectURL(blob);
}

// ─── MapLibre injection ───────────────────────────────────────────────────────

/**
 * Injects a COG-rendered image into a MapLibre map as an image source + raster layer.
 * Uses the MapLibre public API directly (no GeoLeaf core internals).
 *
 * @param map - MapLibre Map instance
 * @param layerId - Unique id for the source and layer
 * @param dataUrl - PNG data URL or Blob URL from canvasToDataUrl()
 * @param bounds - Geographic bounds [west, south, east, north] in WGS84
 * @param opts - Display options (opacity)
 */
export function injectImageSource(
    map: MapLike,
    layerId: string,
    dataUrl: string,
    bounds: [number, number, number, number],
    opts: Pick<CogLayerOptions, "opacity">
): void {
    const [west, south, east, north] = bounds;

    // MapLibre image source expects 4 corner coordinates:
    // [[topLeft], [topRight], [bottomRight], [bottomLeft]]
    const coordinates: ImageCoordinates = [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
    ];

    map.addSource(layerId, {
        type: "image",
        url: dataUrl,
        coordinates,
    });

    map.addLayer({
        id: layerId,
        type: "raster",
        source: layerId,
        paint: {
            "raster-opacity": opts.opacity ?? 1,
        },
    });
}

/**
 * Removes the COG image source and raster layer from a MapLibre map.
 * Safe to call even if the layer/source no longer exist.
 */
export function removeImageSource(map: MapLike, layerId: string): void {
    try {
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
    } catch {
        // Layer may have been removed externally
    }
    try {
        if (map.getSource(layerId)) {
            map.removeSource(layerId);
        }
    } catch {
        // Source may have been removed externally
    }
}
