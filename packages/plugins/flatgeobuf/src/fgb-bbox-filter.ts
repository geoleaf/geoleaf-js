/*!
 * GeoLeaf FlatGeobuf Plugin — Bbox-filtered Loader
 *
 * Loads features spatially filtered by a bounding box via FlatGeobuf's
 * built-in R-tree index and HTTP Range requests.
 *
 * Optionally provides auto-refresh: re-fetches when the map viewport changes.
 *
 * Security:
 *   - URL validated before any network request.
 *   - maxFeatures limit enforced (default 100 000).
 *   - AbortSignal propagated.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { deserialize } from "flatgeobuf/lib/mjs/geojson.js";
import type { Feature } from "geojson";
import type { FgbBbox, FgbBboxOptions, FgbLoadResult } from "./types.js";
import { validateLoadPreconditions, collectFeatures } from "./internal.js";

/** Default auto-refresh debounce in ms. */
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Validates that a bbox has finite, non-NaN coordinates.
 * @internal
 */
function _validateBbox(bbox: FgbBbox): boolean {
    return (
        Number.isFinite(bbox.minX) &&
        Number.isFinite(bbox.minY) &&
        Number.isFinite(bbox.maxX) &&
        Number.isFinite(bbox.maxY) &&
        bbox.minX <= bbox.maxX &&
        bbox.minY <= bbox.maxY
    );
}

/**
 * Loads features from a FlatGeobuf file filtered by a bounding box.
 *
 * FlatGeobuf uses an R-tree spatial index and HTTP Range requests to fetch
 * only the features that intersect the bbox — no need to download the entire file.
 *
 * @param url - Remote URL of the .fgb file.
 * @param bbox - Bounding box filter.
 * @param options - Load options (maxFeatures, signal, onHeader).
 * @returns The filtered FeatureCollection.
 * @throws Error if the URL or bbox is invalid, or the fetch fails.
 */
export async function loadFgbBbox(
    url: string,
    bbox: FgbBbox,
    options: FgbBboxOptions = {}
): Promise<FgbLoadResult> {
    validateLoadPreconditions(url, options.signal);

    if (!_validateBbox(bbox)) {
        throw new Error(
            `[GeoLeaf.FlatGeobuf] Invalid bbox: [${bbox.minX}, ${bbox.minY}, ${bbox.maxX}, ${bbox.maxY}]`
        );
    }

    // flatgeobuf bbox mode: pass the URL string + rect object, it handles Range requests internally
    const fgbRect = { minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY };
    const iter = deserialize(url, fgbRect) as AsyncIterable<Feature>;

    return collectFeatures(iter, options);
}

// ─── Auto-refresh ─────────────────────────────────────────────────────────────

/** Minimal map interface for auto-refresh. */
interface MapLike {
    on(event: string, fn: () => void): void;
    off(event: string, fn: () => void): void;
    getBounds?(): {
        getWest(): number;
        getSouth(): number;
        getEast(): number;
        getNorth(): number;
    } | null;
}

/**
 * Creates a simple debounce wrapper.
 * @internal
 */
function _debounce(fn: () => void, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(fn, ms);
    };
}

/**
 * Registers a `moveend` listener on the map to re-fetch FGB features
 * when the viewport changes. Returns a cleanup function.
 *
 * @param map - MapLibre map instance.
 * @param _url - Unused. The URL is captured by `reloadFn`, so this listener never needs to know
 *   which file it refreshes; the parameter stays for call-shape compatibility.
 * @param options - Bbox load options; `debounceMs` throttles the refresh.
 * @param reloadFn - Callback invoked with the new bbox on each viewport change.
 * @returns Cleanup function that removes the listener.
 */
export function setupAutoRefresh(
    map: MapLike,
    _url: string,
    options: FgbBboxOptions,
    reloadFn: (bbox: FgbBbox) => void
): () => void {
    const ms = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    const handler = _debounce(() => {
        const bounds = map.getBounds?.();
        if (!bounds) return;
        reloadFn({
            minX: bounds.getWest(),
            minY: bounds.getSouth(),
            maxX: bounds.getEast(),
            maxY: bounds.getNorth(),
        });
    }, ms);

    map.on("moveend", handler);
    return () => map.off("moveend", handler);
}
