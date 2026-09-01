/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @file metrics.js
 * @description Cache metrics and statistics for GeoLeaf Storage
 * @version 2.0.0
 * @phase Phase 5 - Storage Refactoring
 */

import { Log } from "../../../utils/log/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import { formatFileSize } from "../../../utils/general/formatters.js";
import { validateFetchUrl } from "./url-guard.js";
import { AVG_TILE_SIZE_BYTES } from "./calculator.js";

interface ResourceWithUrl {
    url?: string;
    type?: string;
    [key: string]: unknown;
}
interface HeadResult {
    resource: ResourceWithUrl;
    contentLength: number | null;
    ok: boolean;
}
/**
 * Size accumulator of {@link CacheMetrics.estimateProfileSize}, by resource kind.
 *
 * Named rather than `Record<string, number>`: an index signature makes every `byType.x` read
 * possibly-undefined, so `+=` stopped compiling for five buckets that are always present. The
 * key set is closed — declaring it is truer than asserting it (qualite Q5).
 *
 * ⚠️ **`type`, not `interface`, and exported — both points are deliberate.** This
 * type ships in the published declaration, through `estimateProfileSize`'s INFERRED
 * return. An `interface` gets no implicit index signature:
 * `const r: Record<string, number> = estimate.byType` stopped compiling on the
 * integrator's side, although it was valid before. A type alias does get one, so the
 * assignment stays possible. And without `export`, the declaration published a
 * return citing a type nobody could name.
 */
export type SizeByType = {
    tiles: number;
    layers: number;
    themes: number;
    config: number;
    other: number;
};

/**
 * CacheMetrics - Cache statistics, quota management, and reporting
 */
const CacheMetrics = {
    /**
     * Fetch Content-Length values concurrently with bounded worker pool.
     *
     * @private
     * @param {Array<Object>} resources - Resources containing { url }
     * @param {number} [concurrency=8] - Max concurrent HEAD requests
     * @returns {Promise<Array<{resource: Object, contentLength: number|null, ok: boolean}>>}
     */
    async _fetchHeadContentLengths(
        resources: ResourceWithUrl[],
        concurrency = 8
    ): Promise<HeadResult[]> {
        const queue = [...resources];
        const results: HeadResult[] = [];
        const safeConcurrency = Math.max(1, Math.min(concurrency, 20));

        const worker = async () => {
            while (queue.length > 0) {
                const resource = queue.shift();
                if (!resource?.url) continue;
                try {
                    validateFetchUrl(resource.url);
                } catch (e) {
                    Log.warn(`[CacheMetrics] URL blocked, skipping: ${(e as Error).message}`);
                    results.push({ resource, contentLength: null, ok: false });
                    continue;
                }

                try {
                    const response = await fetchBounded(resource.url, { method: "HEAD" }, 8000);
                    if (!response.ok) {
                        results.push({ resource, contentLength: null, ok: false });
                        continue;
                    }

                    const rawLength = response.headers.get("Content-Length");
                    const parsedLength = rawLength ? Number.parseInt(rawLength, 10) : null;
                    results.push({
                        resource,
                        contentLength: Number.isFinite(parsedLength) ? parsedLength : null,
                        ok: true,
                    });
                } catch (error) {
                    Log.debug(
                        `[CacheMetrics] HEAD failed for ${resource.url}: ${(error as Error).message}`
                    );
                    results.push({ resource, contentLength: null, ok: false });
                }
            }
        };

        const workers = [];
        for (let i = 0; i < safeConcurrency; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        return results;
    },

    /**
     * Fallback estimate when Content-Length is unavailable.
     *
     * @private
     * @param {Object} resource
     * @returns {number}
     */
    _fallbackResourceSize(resource: ResourceWithUrl): number {
        if (!resource?.type) return 10000;
        if (resource.type === "layer") return 500000;
        if (resource.type === "theme") return 50000;
        return 10000;
    },

    // ⚠️ `getStorageQuota()` WAS REMOVED HERE — one of THREE wrappers around
    // `navigator.storage.estimate()` in the same capability, and one of the TWO with
    // no production caller: only its own `@example` cited it.
    //
    // 🛑 This was not harmless redundancy: the three returned DIFFERENT KEY
    // VOCABULARIES — `usage` here and there, `used` elsewhere — so a caller picking
    // the wrong copy read `undefined` with nothing saying so. The survivor is
    // `CacheManager.getStorageQuota()`, the only one called (by `offline-ui` and by
    // `cacheProfile`'s quota pre-check).
    //
    // ⚠️ This also settles what an audit had just found: "reuse THE quota reader"
    // assumed there was only one. There is one now, and the choice was made on the
    // MEASUREMENT, not a preference.

    /**
     * Estimate profile size before download
     * Uses HEAD requests on sample resources
     *
     * @param {string} profileId - Profile ID
     * @param {Array} resources - Array of resource objects
     * @param {Object} [options] - Options { maxSamples: 50 }
     * @returns {Promise<Object>} Estimation { totalSize, byType: {...}, sampleCount }
     *
     * @example
     * const estimate = await metrics.estimateProfileSize('myprofile', resources);
     * console.log(`Estimated size: ${estimate.totalSizeFormatted}`);
     * console.log(`Breakdown: ${estimate.byType.tiles} tiles, ${estimate.byType.layers} layers`);
     */
    async estimateProfileSize(
        profileId: string,
        resources: ResourceWithUrl[],
        options: { maxSamples?: number; headConcurrency?: number } = {}
    ) {
        const maxSamples = options.maxSamples ?? 50;
        const headConcurrency = options.headConcurrency ?? 8;
        let totalSize = 0;
        let sampleCount = 0;

        const byType: SizeByType = {
            tiles: 0,
            layers: 0,
            themes: 0,
            config: 0,
            other: 0,
        };

        // Separate tiles from other resources
        const tiles = resources.filter((r) => r.type === "tile");
        const others = resources.filter((r) => r.type !== "tile");

        // Separate layers from config files for logging
        const layers = resources.filter(
            (r) =>
                r.type === "data" || r.type === "layer" || r.type === "geojson" || r.type === "json"
        );
        const configFiles = resources.filter(
            (r) => r.type === "config" || r.type === "icon" || r.type === "profile"
        );

        const typeCount: Record<string, number> = {};
        resources.forEach((r) => {
            const t = r.type ?? "unknown";
            typeCount[t] = (typeCount[t] ?? 0) + 1;
        });
        Log.info(`[CacheMetrics] ===== Resource types: ${JSON.stringify(typeCount)} =====`);
        Log.info(
            `[CacheMetrics] Total resources: ${resources.length}, Layers: ${layers.length}, Tiles: ${tiles.length}`
        );

        // Check ALL non-tile resources (config, layers, themes) with bounded concurrency
        const otherHeadResults = await this._fetchHeadContentLengths(others, headConcurrency);
        for (const entry of otherHeadResults) {
            const resource = entry.resource;
            const size = entry.contentLength || this._fallbackResourceSize(resource);
            totalSize += size;

            if (resource.type === "layer") byType.layers += size;
            else if (resource.type === "theme") byType.themes += size;
            else if (resource.type === "config" || resource.type === "profile")
                byType.config += size;
            else byType.other += size;
        }

        // For tiles, check a sample and extrapolate
        if (tiles.length > 0) {
            // For large tile counts (>100k), use direct estimation to avoid memory/network issues
            const useDirectEstimation = tiles.length > 100000;

            if (useDirectEstimation) {
                // Direct estimation: no HEAD at all, fall straight back to the shared
                // empirical average.
                const avgTileSize = AVG_TILE_SIZE_BYTES;
                const estimatedTilesSize = avgTileSize * tiles.length;
                totalSize += estimatedTilesSize;
                byType.tiles = estimatedTilesSize;

                Log.info(
                    `[CacheMetrics] Tiles estimation (direct): ${tiles.length} tiles × ${this.formatBytes(avgTileSize)} = ~${this.formatBytes(estimatedTilesSize)}`
                );
            } else {
                // For smaller counts, try to sample actual tile sizes (concurrent HEAD)
                let tileSampleSize = 0;
                const tileSampleResources = tiles.slice(0, Math.min(maxSamples, tiles.length));
                const tileHeadResults = await this._fetchHeadContentLengths(
                    tileSampleResources,
                    headConcurrency
                );
                for (const entry of tileHeadResults) {
                    if (entry.contentLength) {
                        tileSampleSize += entry.contentLength;
                        sampleCount++;
                    }
                }

                // Calculate average tile size. With zero usable samples we are in the
                // same position as the unsampled branch above — no measurement — so the
                // fallback is the same constant, not a second, lower guess.
                const avgTileSize =
                    sampleCount > 0 ? tileSampleSize / sampleCount : AVG_TILE_SIZE_BYTES;
                const estimatedTilesSize = avgTileSize * tiles.length;
                totalSize += estimatedTilesSize;
                byType.tiles = estimatedTilesSize;

                Log.debug(
                    `[CacheMetrics] Tiles estimation: ${sampleCount} samples, avg ${(avgTileSize / 1024).toFixed(2)} KB, total ${tiles.length} tiles`
                );
            }
        }

        Log.info(
            `[CacheMetrics] Estimated size for ${profileId}: ${this.formatBytes(totalSize)} (${layers.length + tiles.length} resources: ${layers.length} layers + ${tiles.length} tiles)`
        );

        return {
            totalSize,
            totalSizeFormatted: this.formatBytes(totalSize),
            byType,
            sampleCount,
            resourceCounts: {
                total: resources.length,
                tiles: tiles.length,
                layers: layers.length,
                config: configFiles.length,
                others: others.length,
            },
        };
    },

    /**
     * Format bytes to human-readable string
     *
     * @param {number} bytes - Size in bytes
     * @param {number} [decimals=2] - Decimal places
     * @returns {string} Formatted string (e.g., "1.23 MB")
     */
    // Phase 4 dedup: delegate to Formatters.formatFileSize
    formatBytes(bytes: number, decimals = 2): string {
        return formatFileSize(bytes, { precision: decimals });
    },
};

export { CacheMetrics };
