/*!
 * GeoLeaf COG Plugin — COG Loader
 * Reads COG headers and fetches raster data via geotiff.js range requests.
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { fromUrl, GeoTIFF, GeoTIFFImage } from "geotiff";
import type { CogInfo, CogLoadOptions, CogRasterData } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// ─── URL validation ───────────────────────────────────────────────────────────

/**
 * Validates that the given URL is an absolute http/https URL.
 * Throws a TypeError if invalid.
 */
function validateCogUrl(url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new TypeError(`[GeoLeaf COG] Invalid URL: "${url}"`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new TypeError(`[GeoLeaf COG] URL must use http or https protocol: "${url}"`);
    }
}

// ─── Geotiff.js helpers ───────────────────────────────────────────────────────

/**
 * Opens a COG file from a remote URL using geotiff.js.
 * The caller is responsible for aborting via the signal.
 */
async function openCog(url: string, signal?: AbortSignal): Promise<GeoTIFF> {
    validateCogUrl(url);
    // geotiff.fromUrl uses fetch internally; wrap abort via a race
    const tiffPromise = fromUrl(url, { allowFullFile: false });
    if (!signal) return tiffPromise;

    return Promise.race([
        tiffPromise,
        new Promise<never>((_, reject) => {
            if (signal.aborted) {
                reject(new DOMException("COG fetch aborted", "AbortError"));
                return;
            }
            signal.addEventListener(
                "abort",
                () => reject(new DOMException("COG fetch aborted", "AbortError")),
                { once: true }
            );
        }),
    ]);
}

/**
 * geotiff >= 3: reads the EPSG code from the image's parsed geo keys.
 * `image.fileDirectory` is now an `ImageFileDirectory` (Map-backed) with no raw
 * `GeoKeyDirectory` property — the keys are exposed via `getGeoKeys()`.
 * ProjectedCSTypeGeoKey is preferred over GeographicTypeGeoKey. Never throws.
 */
function epsgFromGeoKeys(image: GeoTIFFImage): number | null {
    try {
        const withGeoKeys = image as unknown as {
            getGeoKeys?: () => Record<string, unknown> | null | undefined;
        };
        if (typeof withGeoKeys.getGeoKeys !== "function") return null;
        const keys = withGeoKeys.getGeoKeys();
        const code = keys?.["ProjectedCSTypeGeoKey"] ?? keys?.["GeographicTypeGeoKey"];
        return typeof code === "number" && code > 0 ? code : null;
    } catch {
        return null;
    }
}

/**
 * Legacy fallback: reads the EPSG code from the raw `GeoKeyDirectory` array
 * (geotiff < 3, or unit-test mocks that expose a plain `fileDirectory`). Never throws.
 */
function epsgFromRawDirectory(image: GeoTIFFImage): number | null {
    try {
        const fileDir = image.fileDirectory as unknown as Record<string, unknown>;
        const geoKeys = fileDir["GeoKeyDirectory"] as number[] | undefined;
        if (!geoKeys || geoKeys.length < 4) return null;
        // GeoKeyDirectory layout: header(4) + keys(4 each)
        // Key 3072 = ProjectedCSTypeGeoKey, Key 2048 = GeographicTypeGeoKey
        const keyCount = geoKeys[3] ?? 0;
        for (let i = 0; i < keyCount; i++) {
            const offset = 4 + i * 4;
            if (geoKeys[offset] === 3072 || geoKeys[offset] === 2048) {
                const valueOffset = geoKeys[offset + 3] ?? 0;
                return valueOffset > 0 ? valueOffset : null;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Extracts the EPSG code from a GeoTIFF image. Tries the geotiff >= 3 parsed geo
 * keys first, then the legacy raw-array layout. Returns null if not determinable.
 */
function extractEpsg(image: GeoTIFFImage): number | null {
    return epsgFromGeoKeys(image) ?? epsgFromRawDirectory(image);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads COG metadata (bounds, dimensions, bands, overviews) without loading
 * any pixel data. Performs only a minimal range request for TIFF headers.
 */
export async function getCogInfo(url: string, opts: CogLoadOptions = {}): Promise<CogInfo> {
    validateCogUrl(url);
    const tiff = await openCog(url, opts.signal);
    const image = await tiff.getImage();

    const bbox = image.getBoundingBox() as [number, number, number, number];
    const width = image.getWidth();
    const height = image.getHeight();
    const bandCount = image.getSamplesPerPixel();
    const overviewCount = (await tiff.getImageCount()) - 1;
    const nodata = image.getGDALNoData();
    const epsg = extractEpsg(image);

    return {
        url,
        bounds: bbox,
        width,
        height,
        bandCount,
        nodata: nodata != null ? Number(nodata) : null,
        overviewCount,
        epsg,
    };
}

/**
 * Selects the best overview index based on the target pixel width.
 * Returns 0 for full resolution, or a higher index for lower-resolution overviews.
 *
 * @param info - CogInfo from getCogInfo()
 * @param targetPixelWidth - Approximate viewport/canvas width in pixels
 */
export function selectOverview(info: CogInfo, targetPixelWidth: number): number {
    if (info.overviewCount === 0) return 0;
    // Overview 0 = full resolution; overviews 1..N = progressively smaller
    // The full image width is halved at each overview level
    for (let i = info.overviewCount; i >= 1; i--) {
        const overviewWidth = info.width / Math.pow(2, i);
        if (overviewWidth > targetPixelWidth * 0.5) {
            return i;
        }
    }
    return 0;
}

/**
 * Fetches raster pixel data for the given overview index.
 * Enforces a `maxBytes` guard to prevent memory exhaustion on large COGs.
 */
export async function loadViewportRasters(
    url: string,
    opts: CogLoadOptions = {},
    overviewIdx: number = 0
): Promise<CogRasterData> {
    validateCogUrl(url);
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

    const tiff = await openCog(url, opts.signal);
    const imageCount = await tiff.getImageCount();
    const safeIdx = Math.min(overviewIdx, imageCount - 1);
    const image = await tiff.getImage(safeIdx);

    const width = image.getWidth();
    const height = image.getHeight();
    const bandCount = image.getSamplesPerPixel();

    // Byte estimate: 4 bytes per sample (float32 worst case) × pixels × bands
    const estimatedBytes = width * height * bandCount * 4;
    if (estimatedBytes > maxBytes) {
        throw new RangeError(
            `[GeoLeaf COG] Raster data exceeds maxBytes limit (${estimatedBytes} > ${maxBytes}). ` +
                `Use a higher overview index or increase maxBytes.`
        );
    }

    const rasters = (await image.readRasters({ interleave: false })) as Array<
        | Int8Array
        | Uint8Array
        | Int16Array
        | Uint16Array
        | Int32Array
        | Uint32Array
        | Float32Array
        | Float64Array
    >;

    const bbox = image.getBoundingBox() as [number, number, number, number];

    return { rasters, width, height, bounds: bbox };
}
