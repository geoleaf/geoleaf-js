/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @file calculator.js
 * @description Cache calculation utilities for GeoLeaf Storage
 * Tile coordinates, bounds calculations, size estimations
 * @version 2.0.0
 * @phase Phase 5 - Storage Refactoring
 */

import { Log } from "../../../utils/log/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import { formatFileSize } from "../../../utils/general/formatters.js";
// Pure tile arithmetic, kept dependency-free so `plugin-storage` can bundle it without
// dragging the core logger along (CAPACITÉS S1). Delegated to, never duplicated.
import * as TileMath from "./tile-math.js";
import type { Bounds, TileCoord } from "./tile-math.js";
import { validateFetchUrl } from "./url-guard.js";

/**
 * Assumed size of one cached tile, in bytes, whenever no measurement is available.
 *
 * Single source of truth for the whole raster cache path: the calculator's
 * `estimateTileSize` default and BOTH of `metrics.ts`'s estimation branches (the
 * unsampled >100k-tiles path and the sampled path when no HEAD returned a
 * Content-Length) read this constant. Those three sites used to hold three literals —
 * 25 KB, 25 KB and 15000 — for the same quantity in the same situation.
 *
 * The 25 KB figure is the empirical one, so it is the one that survived.
 *
 * ⚠️ Distinct from `tile-math.ts`'s `AVG_PBF_BYTES`, which sizes VECTOR .pbf tiles.
 */
export const AVG_TILE_SIZE_BYTES = 25 * 1024;

interface TileConfig {
    maxTilesPerZoom?: number;
}
interface ResourceWithSize {
    size?: number;
    type?: string;
    url?: string;
    [key: string]: unknown;
}
interface LayerConfigWithBounds {
    bounds?: Bounds;
    offlineBounds?: Bounds;
    url?: string;
    fallbackUrl?: string;
    minZoom?: number;
    maxZoom?: number;
    cacheMinZoom?: number;
    cacheMaxZoom?: number;
}

/**
 * CacheCalculator
 * Pure calculation logic for cache operations
 * Extracted from cache-manager.js (Phase 5)
 */
const CacheCalculator = {
    defaults: {
        maxTilesPerZoom: 30000,
        maxTotalTiles: 200000,
        avgTileSize: AVG_TILE_SIZE_BYTES,
        boundsMargin: 0.1,
        webMercatorMaxLat: 85.0511,
    },

    getTileCoordsForBounds(
        bounds: Bounds | null | undefined,
        zoom: number,
        config: TileConfig = {}
    ): TileCoord[] {
        const coords: TileCoord[] = [];
        const maxTilesPerZoom = config.maxTilesPerZoom ?? this.defaults.maxTilesPerZoom;

        // Validate bounds
        if (!bounds || bounds.north <= bounds.south || bounds.east <= bounds.west) {
            Log.warn("[CacheCalculator] Invalid bounds for tile enumeration");
            return coords;
        }

        // Convert lat/lng to tile coordinates
        const minTile = this.latLngToTile(bounds.south, bounds.west, zoom);
        const maxTile = this.latLngToTile(bounds.north, bounds.east, zoom);

        Log.debug(
            `[CacheCalculator] Tile coords at zoom ${zoom}: minTile=(${minTile.x},${minTile.y}), maxTile=(${maxTile.x},${maxTile.y})`
        );

        // Safety: limit number of tiles per zoom
        const tileCountX = Math.abs(maxTile.x - minTile.x) + 1;
        const tileCountY = Math.abs(minTile.y - maxTile.y) + 1;
        const estimatedCount = tileCountX * tileCountY;

        if (estimatedCount > maxTilesPerZoom) {
            const estimatedSize = this.estimateTileSize(estimatedCount);
            const sizeDisplay = this.formatBytes(estimatedSize);

            Log.warn(
                `[CacheCalculator] Too many tiles for zoom ${zoom}: ${estimatedCount} (max: ${maxTilesPerZoom}), estimated size: ~${sizeDisplay}. Skipping this zoom.`
            );
            return coords;
        }

        Log.debug(`[CacheCalculator] Will generate ${estimatedCount} tiles for zoom ${zoom}`);

        // Generate all tiles in the area
        // Note: In Web Mercator, Y increases towards SOUTH (Y=0 at top)
        const startX = Math.min(minTile.x, maxTile.x);
        const endX = Math.max(minTile.x, maxTile.x);
        const startY = Math.min(minTile.y, maxTile.y);
        const endY = Math.max(minTile.y, maxTile.y);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                coords.push({ x, y });
            }
        }

        Log.debug(`[CacheCalculator] Generated ${coords.length} tile coordinates for zoom ${zoom}`);
        return coords;
    },

    /**
     * Convert lat/lng to tile coordinates (Web Mercator projection)
     *
     * Delegates to `tile-math.js`. `defaults.webMercatorMaxLat` is forwarded explicitly
     * so that mutating it on this object stays effective.
     *
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} zoom - Zoom level
     * @returns {{x: number, y: number}} Tile coordinates
     */
    latLngToTile(lat: number, lng: number, zoom: number): TileCoord {
        return TileMath.latLngToTile(lat, lng, zoom, this.defaults.webMercatorMaxLat);
    },

    /**
     * Build tile URL from template
     * @param {string} template - URL template with {x}, {y}, {z} placeholders
     * @param {number} x - Tile X coordinate
     * @param {number} y - Tile Y coordinate
     * @param {number} zoom - Zoom level
     * @returns {string} Complete tile URL
     */
    buildTileUrl(template: string, x: number, y: number, zoom: number): string {
        return template
            .replace("{x}", String(x))
            .replace("{y}", String(y))
            .replace("{z}", String(zoom))
            .replace("{s}", "a");
    },

    /**
     * Calculate bounds from layer geometries
     *
     * ⚠️ `resource.url` is not trusted: the enumerated resource list is fed, among
     * others, by StyleResolver from a REMOTE TileJSON, so a hostile document can put an
     * arbitrary URL in it. Each entry is scheme-guarded before it is fetched; a refused
     * one is skipped like any unreadable layer, so one poisoned entry cannot blind the
     * whole bounds computation (CAPACITÉS B.10).
     *
     * @param _profile - Unused. Kept in the signature so the four `calculate*` members share
     *   one call shape; bounds come from `resources` alone.
     * @param resources - The enumerated resources; only `type: "layer"` entries contribute.
     * @returns Bounds `{ north, south, east, west }`, or `null` if no layer was readable.
     */
    async calculateProfileBounds(
        _profile: unknown,
        resources: ResourceWithSize[]
    ): Promise<Bounds | null> {
        let bounds: Bounds | null = null;

        for (const resource of resources) {
            if (resource.type !== "layer" || !resource.url) continue;
            try {
                validateFetchUrl(resource.url);
            } catch (error) {
                Log.warn(`[CacheCalculator] URL blocked, skipping: ${(error as Error).message}`);
                continue;
            }
            try {
                const response = await fetchBounded(resource.url);
                if (!response.ok) continue;
                const contentType = response.headers.get("content-type") || "";
                const isJson =
                    contentType.includes("json") ||
                    resource.url.endsWith(".json") ||
                    resource.url.endsWith(".geojson");
                if (!isJson) continue;

                const data = (await response.json()) as {
                    type?: string;
                    features?: Array<{
                        geometry?: { type?: string; coordinates?: unknown };
                    }>;
                };
                if (data.type !== "FeatureCollection" || !data.features) continue;

                for (const feature of data.features) {
                    if (
                        feature.geometry &&
                        (feature.geometry as { coordinates?: unknown }).coordinates
                    ) {
                        const coords = this.extractCoordinates(
                            feature.geometry as {
                                type?: string;
                                coordinates?: unknown[];
                                geometries?: unknown[];
                            }
                        );
                        bounds = this.expandBounds(bounds, coords);
                    }
                }
            } catch {
                Log.debug(`[CacheCalculator] Could not load layer for bounds: ${resource.url}`);
            }
        }

        // Add 10% margin around the bounds
        if (bounds) {
            const margin = this.defaults.boundsMargin;
            const latMargin = (bounds.north - bounds.south) * margin;
            const lngMargin = (bounds.east - bounds.west) * margin;
            const maxLat = this.defaults.webMercatorMaxLat;

            bounds.north = Math.min(maxLat, bounds.north + latMargin);
            bounds.south = Math.max(-maxLat, bounds.south - latMargin);
            bounds.east = Math.min(180, bounds.east + lngMargin);
            bounds.west = Math.max(-180, bounds.west - lngMargin);

            Log.info(
                `[CacheCalculator] Profile bounds: N=${bounds.north.toFixed(4)}, S=${bounds.south.toFixed(4)}, E=${bounds.east.toFixed(4)}, W=${bounds.west.toFixed(4)}`
            );
        }

        return bounds;
    },

    /**
     * Extract all coordinates from a geometry
     * @param {Object} geometry - GeoJSON geometry object
     * @returns {Array<Array<number>>} Array of [lng, lat] coordinates
     */
    extractCoordinates(geometry: {
        type?: string;
        coordinates?: unknown[];
        geometries?: unknown[];
    }): number[][] {
        const coords: number[][] = [];

        const extract = (geom: {
            type?: string;
            coordinates?: unknown[];
            geometries?: unknown[];
        }) => {
            if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
                coords.push(geom.coordinates as number[]);
            } else if (
                (geom.type === "MultiPoint" || geom.type === "LineString") &&
                Array.isArray(geom.coordinates)
            ) {
                geom.coordinates.forEach((c) => coords.push(c as number[]));
            } else if (
                (geom.type === "MultiLineString" || geom.type === "Polygon") &&
                Array.isArray(geom.coordinates)
            ) {
                geom.coordinates.forEach((part) =>
                    (part as unknown[]).forEach((c) => coords.push(c as number[]))
                );
            } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
                geom.coordinates.forEach((poly) =>
                    (poly as unknown[]).forEach((ring: unknown) =>
                        (ring as unknown[]).forEach((c) => coords.push(c as number[]))
                    )
                );
            } else if (geom.type === "GeometryCollection" && Array.isArray(geom.geometries)) {
                geom.geometries.forEach((g) =>
                    extract(g as { type?: string; coordinates?: unknown[]; geometries?: unknown[] })
                );
            }
        };

        extract(geometry);
        return coords;
    },

    /**
     * Expand bounds with new coordinates
     * @param {Object|null} bounds - Current bounds or null
     * @param {Array<Array<number>>} coords - Array of [lng, lat] coordinates
     * @returns {Object} Updated bounds { north, south, east, west }
     */
    expandBounds(bounds: Bounds | null, coords: number[][]): Bounds | null {
        if (!coords || coords.length === 0) return bounds;

        for (const coord of coords) {
            const [lng, lat] = coord;
            // A GeoJSON position is [lng, lat, alt?]; a shorter one is malformed, and expanding
            // bounds with `undefined` would poison every later Math.max (qualite Q5).
            if (lng === undefined || lat === undefined) continue;

            if (!bounds) {
                bounds = { north: lat, south: lat, east: lng, west: lng };
            } else {
                bounds.north = Math.max(bounds.north, lat);
                bounds.south = Math.min(bounds.south, lat);
                bounds.east = Math.max(bounds.east, lng);
                bounds.west = Math.min(bounds.west, lng);
            }
        }

        return bounds;
    },

    /**
     * Estimate total size of tiles
     * @param {number} tileCount - Number of tiles
     * @param {number} [avgSize] - Average size per tile in bytes
     * @returns {number} Estimated size in bytes
     */
    estimateTileSize(tileCount: number, avgSize?: number): number {
        const size = avgSize || this.defaults.avgTileSize;
        return tileCount * size;
    },

    /**
     * Calculate total size of resources
     * @param {Array} resources - Array of resource objects with size property
     * @returns {number} Total size in bytes
     */
    calculateResourcesSize(resources: ResourceWithSize[]): number {
        return resources.reduce((total, resource) => {
            return total + (resource.size || 0);
        }, 0);
    },

    /**
     * Format bytes to human-readable string
     * @param {number} bytes - Size in bytes
     * @param {number} [decimals=2] - Number of decimal places
     * @returns {string} Formatted string (e.g., "1.23 MB")
     */
    // Phase 4 dedup: delegate to Formatters.formatFileSize
    formatBytes(bytes: number, decimals = 2): string {
        return formatFileSize(bytes, { precision: decimals });
    },

    /**
     * Estimate download time based on size and connection speed
     * @param {number} bytes - Size in bytes
     * @param {number} [speedMbps=10] - Connection speed in Mbps
     * @returns {number} Estimated time in seconds
     */
    estimateDownloadTime(bytes: number, speedMbps = 10): number {
        const bitsPerSecond = speedMbps * 1000000;
        const bytesPerSecond = bitsPerSecond / 8;
        return Math.ceil(bytes / bytesPerSecond);
    },

    /**
     * Format time duration to human-readable string
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted string (e.g., "2h 30m 15s")
     */
    formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        const parts: string[] = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

        return parts.join(" ");
    },

    /**
     * Enumerate all tile URLs for a layer or basemap
     * @param layerConfig - Layer or basemap configuration; supplies the bounds and zoom range.
     * @param _profileId - Unused, kept for call-shape compatibility with the sibling members.
     * @returns One entry per tile, `{ url, type: "tile", x, y, z }`.
     */
    async enumerateTiles(
        layerConfig: LayerConfigWithBounds,
        _profileId: string
    ): Promise<Array<{ url: string; type: string; x: number; y: number; z: number }>> {
        const tiles: Array<{ url: string; type: string; x: number; y: number; z: number }> = [];

        // Extract configuration
        const bounds = layerConfig.bounds ?? layerConfig.offlineBounds;

        const minZoom =
            layerConfig.cacheMinZoom !== undefined
                ? layerConfig.cacheMinZoom
                : (layerConfig.minZoom ?? 1);
        const maxZoom =
            layerConfig.cacheMaxZoom !== undefined
                ? layerConfig.cacheMaxZoom
                : (layerConfig.maxZoom ?? 15);
        const urlTemplate = layerConfig.url ?? layerConfig.fallbackUrl;

        if (!bounds) {
            Log.warn("[CacheCalculator] No bounds specified for tile enumeration");
            return tiles;
        }

        if (!urlTemplate) {
            Log.warn("[CacheCalculator] No URL template for tile layer");
            return tiles;
        }

        Log.info(
            `[CacheCalculator] Enumerating tiles for zoom ${minZoom}-${maxZoom}, bounds: N=${bounds.north}, S=${bounds.south}, E=${bounds.east}, W=${bounds.west}`
        );

        let totalTiles = 0;
        const maxTotalTiles = this.defaults.maxTotalTiles;

        // Enumerate tiles for each zoom level
        for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
            const coords = this.getTileCoordsForBounds(bounds, zoom);

            if (coords.length === 0) {
                Log.warn(`[CacheCalculator] Skipping zoom ${zoom}: too many tiles`);
                continue;
            }

            // Build URLs for each tile
            for (const coord of coords) {
                if (totalTiles >= maxTotalTiles) {
                    Log.warn(
                        `[CacheCalculator] Reached maximum tile limit (${maxTotalTiles}), stopping enumeration`
                    );
                    return tiles;
                }

                const url = this.buildTileUrl(urlTemplate, coord.x, coord.y, zoom);
                tiles.push({
                    url,
                    type: "tile",
                    x: coord.x,
                    y: coord.y,
                    z: zoom,
                });

                totalTiles++;
            }
        }

        Log.info(
            `[CacheCalculator] Enumerated ${tiles.length} tiles across ${maxZoom - minZoom + 1} zoom levels`
        );
        return tiles;
    },
};

export { CacheCalculator };
