/*!
 * GeoLeaf COG Plugin — Types
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Metadata extracted from a COG file's headers without loading pixel data.
 */
export interface CogInfo {
    /** Source URL of the COG file. */
    url: string;
    /** Geographic bounding box [west, south, east, north] in WGS84 degrees. */
    bounds: [number, number, number, number];
    /** Image width in pixels (at full resolution). */
    width: number;
    /** Image height in pixels (at full resolution). */
    height: number;
    /** Number of raster bands (1 = grayscale, 3 = RGB, 4 = RGBA). */
    bandCount: number;
    /** NoData value (pixels with this value are treated as transparent). */
    nodata: number | null;
    /** Number of reduced-resolution overviews available. */
    overviewCount: number;
    /** EPSG code extracted from GeoKeyDirectory, e.g. 4326. Null if unknown. */
    epsg: number | null;
}

/**
 * Options for low-level COG loading operations.
 */
export interface CogLoadOptions {
    /** AbortSignal to cancel in-flight fetch requests. */
    signal?: AbortSignal;
    /**
     * Maximum bytes allowed per HTTP range request.
     * Prevents memory exhaustion on very large COGs.
     * @default 52428800 (50 MB)
     */
    maxBytes?: number;
}

/**
 * Options for adding a COG layer to a MapLibre map.
 */
export interface CogLayerOptions extends CogLoadOptions {
    /**
     * MapLibre layer and source id.
     * Defaults to `"cog-layer-{timestamp}"`.
     */
    id?: string;
    /**
     * Layer opacity (0–1).
     * @default 1
     */
    opacity?: number;
    /**
     * Overview index to use for rendering.
     * - `"auto"` selects the best overview for the current viewport width.
     * - A number forces a specific overview index (0 = full resolution).
     * @default "auto"
     */
    overview?: "auto" | number;
    /**
     * Band selection for multi-band COGs.
     * - 3-element array selects RGB bands: [redBand, greenBand, blueBand] (1-based).
     * - 1-element array renders a single band as grayscale: [bandIndex] (1-based).
     * Defaults to the first 3 bands (or single band if bandCount === 1).
     */
    bands?: [number, number, number] | [number];
    /**
     * Optional color map (LUT) for single-band rendering.
     * Array of 256 RGBA entries: `[[r, g, b, a], ...]`.
     */
    colorMap?: Array<[number, number, number, number]>;
    /**
     * Override the nodata value from file metadata.
     */
    nodata?: number;
}

/**
 * Handle returned by `addLayer()`, allowing removal and live updates.
 */
export interface CogLayerHandle {
    /** The MapLibre source/layer id used for this COG layer. */
    id: string;
    /** Removes the COG source and layer from the map. */
    remove(): void;
    /**
     * Re-renders the COG with updated options and injects the result into the map.
     * Resolves when the new frame is injected.
     */
    update(opts: Partial<CogLayerOptions>): Promise<void>;
}

/**
 * Internal raster data returned by the COG loader before rendering.
 */
export interface CogRasterData {
    /** Decoded raster bands as TypedArrays, one per band. */
    rasters: Array<
        | Int8Array
        | Uint8Array
        | Int16Array
        | Uint16Array
        | Int32Array
        | Uint32Array
        | Float32Array
        | Float64Array
    >;
    /** Width of the decoded raster window. */
    width: number;
    /** Height of the decoded raster window. */
    height: number;
    /** Geographic bounding box used for this raster window. */
    bounds: [number, number, number, number];
}

/**
 * Minimal MapLibre Map interface required by the COG renderer and public API.
 * Matches the subset of methods used for image source injection and cleanup.
 */
export interface MapLike {
    addSource(id: string, spec: Record<string, unknown>): void;
    addLayer(spec: Record<string, unknown>): void;
    removeLayer(id: string): void;
    removeSource(id: string): void;
    getLayer(id: string): unknown;
    getSource(id: string): unknown;
}
