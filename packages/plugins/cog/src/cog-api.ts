/*!
 * GeoLeaf COG Plugin — API implementation
 * © 2026 Mattieu Pottier — MIT License
 *
 * The COG pipeline behind `GeoLeaf.COG.*`. Split out of `public-api.ts` (backlog B.12):
 * that file held the module counter, the viewport probe and the whole
 * overview→decode→canvas→inject pipeline, so the facade WAS the implementation.
 * `public-api.ts` now re-exports from here and carries no logic (INV-FACADE).
 * https://geoleaf.dev
 */

import { getCogInfo, loadViewportRasters, selectOverview } from "./cog-loader.js";
import {
    canvasToDataUrl,
    injectImageSource,
    rastersToCanvas,
    removeImageSource,
} from "./cog-renderer.js";
import type { CogInfo, CogLayerHandle, CogLayerOptions, CogLoadOptions, MapLike } from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────────

let _layerCounter = 0;

/** Generates a unique layer id for each COG layer instance. */
function generateLayerId(): string {
    return `cog-layer-${Date.now()}-${++_layerCounter}`;
}

/** Returns the visible viewport width in pixels, or 512 in non-browser environments. */
function resolveViewportWidth(): number {
    return typeof globalThis.window !== "undefined" ? (globalThis.window.innerWidth ?? 512) : 512;
}

/**
 * Runs the full COG rendering pipeline: overview selection → raster decode → canvas → inject.
 * Shared by addLayer() and handle.update().
 */
async function executeCogPipeline(
    url: string,
    map: MapLike,
    layerId: string,
    opts: CogLayerOptions,
    cachedInfo: CogInfo
): Promise<void> {
    const loadOpts: CogLoadOptions = {
        ...(opts.signal !== undefined && { signal: opts.signal }),
        ...(opts.maxBytes !== undefined && { maxBytes: opts.maxBytes }),
    };
    const overviewIdx =
        opts.overview === "auto" || opts.overview === undefined
            ? selectOverview(cachedInfo, resolveViewportWidth())
            : opts.overview;
    const rasterData = await loadViewportRasters(url, loadOpts, overviewIdx);
    const canvas = rastersToCanvas(rasterData, opts);
    const dataUrl = await canvasToDataUrl(canvas);
    injectImageSource(map, layerId, dataUrl, rasterData.bounds, opts);
}

// ─── addLayer ─────────────────────────────────────────────────────────────────

/**
 * Loads a Cloud Optimized GeoTIFF, decodes pixels, and injects the result into
 * a MapLibre map as a georeferenced image layer.
 *
 * @param url - Absolute http/https URL pointing to the COG file.
 * @param map - MapLibre `Map` instance.
 * @param opts - Layer options (id, opacity, overview, bands, colorMap, nodata).
 * @returns A handle exposing `.id`, `.remove()`, and `.update()`.
 */
export async function addLayer(
    url: string,
    map: MapLike,
    opts: CogLayerOptions = {}
): Promise<CogLayerHandle> {
    const layerId = opts.id ?? generateLayerId();
    const loadOpts: CogLoadOptions = {
        ...(opts.signal !== undefined && { signal: opts.signal }),
        ...(opts.maxBytes !== undefined && { maxBytes: opts.maxBytes }),
    };

    // 1. Fetch COG metadata — cached so update() does not re-fetch file headers
    const info = await getCogInfo(url, loadOpts);

    // 2–6. Overview selection → raster decode → canvas → data URL → MapLibre inject
    await executeCogPipeline(url, map, layerId, opts, info);

    return {
        id: layerId,

        remove(): void {
            removeImageSource(map, layerId);
        },

        async update(newOpts: Partial<CogLayerOptions>): Promise<void> {
            const mergedOpts: CogLayerOptions = { ...opts, ...newOpts, id: layerId };
            removeImageSource(map, layerId);
            await executeCogPipeline(url, map, layerId, mergedOpts, info);
        },
    };
}

// ─── removeLayer ──────────────────────────────────────────────────────────────

/**
 * Removes a COG layer and its source from a MapLibre map.
 *
 * @param map - MapLibre `Map` instance.
 * @param layerId - The layer id returned by `addLayer()`.
 */
export function removeLayer(map: MapLike, layerId: string): void {
    removeImageSource(map, layerId);
}

// ─── getInfo ──────────────────────────────────────────────────────────────────

/**
 * Fetches metadata from a COG file without loading any pixel data.
 *
 * @param url - Absolute http/https URL pointing to the COG file.
 * @param opts - Load options (signal, maxBytes).
 * @returns Resolved `CogInfo` object.
 */
export async function getInfo(url: string, opts: CogLoadOptions = {}): Promise<CogInfo> {
    return getCogInfo(url, opts);
}
