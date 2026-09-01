/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview CacheDownloader - Lightweight orchestrator for download operations
 * @version 3.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { RetryHandler } from "./retry-handler.js";
import { ProgressTracker, type ProgressData } from "./progress-tracker.js";
import { FetchManager } from "./fetch-manager.js";
import { CacheStorage } from "./storage.js";
import { CacheMetrics } from "./metrics.js";
import { IndexedDB } from "../db/indexeddb.js";

const ESTIMATED_RESOURCE_SIZE_BYTES = 15 * 1024;

// Initialize namespace

/**
 * CacheDownloader - Orchestrates profile caching operations
 * Delegates to specialized modules for retry, progress, and fetching
 *
 * @namespace GeoLeaf.Storage.Cache.Downloader
 */
interface DownloaderResource {
    url: string;
    type: string;
    [key: string]: unknown;
}

interface DownloaderConfig {
    enableProfileCache: boolean;
    /**
     * ⚠️ `enableTileCache` IS NOT HERE (removed), and its absence is the subject: it
     * was declared, defaulted and forwarded by this module without a single line
     * READING it. The downloader receives an already-enumerated resource list — the
     * "tiles, or not" decision is made upstream, in
     * `ResourceEnumerator._tilesRequested()`, now its single reader. A setting carried
     * by a module that does not use it reads like a switch, and is not one.
     */
    concurrentDownloads: number;
    concurrentTileDownloads: number;
    tileDownloadDelay: number;
    /** TOTAL attempts per resource, initial try included — see {@link RetryHandler}. */
    maxAttempts: number;
}

const CacheDownloader = {
    _cachingProfiles: new Set<string>(),
    _abortController: null as AbortController | null,
    _config: {
        enableProfileCache: true,
        concurrentDownloads: 10,
        concurrentTileDownloads: 2,
        tileDownloadDelay: 100,
        maxAttempts: 3,
    } as DownloaderConfig,

    init(config: Record<string, unknown> = {}) {
        // `maxRetries` never meant retries here either: fold the deprecated spelling into
        // the canonical key and drop it, so `_config` holds one budget, not two.
        const { maxRetries, ...rest } = config as { maxRetries?: number } & Record<string, unknown>;
        this._config = {
            ...this._config,
            ...rest,
            ...(rest.maxAttempts === undefined && maxRetries !== undefined
                ? { maxAttempts: maxRetries }
                : {}),
        };

        // Initialize sub-modules
        RetryHandler.init({
            maxAttempts: this._config.maxAttempts,
        });

        Log.info("[CacheDownloader] Initialized");
    },

    /**
     * Cache a complete profile
     *
     * @param profileId - Profile id, used to scope the cached entries.
     * @param _profile - Unused. The resource list is enumerated by the caller, so the profile
     *   configuration itself is never read here.
     * @param resources - The resources to fetch and store.
     * @param options - Optional settings.
     * @param options.onProgress - Called on each progress tick with a {@link ProgressData}-shaped
     *   snapshot.
     * @returns A summary of the run, or `{ error }` when the profile cache is disabled.
     */
    async cacheProfile(
        profileId: string,
        _profile: Record<string, unknown>,
        resources: DownloaderResource[],
        options: { onProgress?: (p: Record<string, unknown>) => void } = {}
    ) {
        if (!this._config.enableProfileCache) {
            return { error: "Profile cache disabled" };
        }

        if (this._cachingProfiles.has(profileId)) {
            return { error: "Already caching", profileId };
        }

        this._cachingProfiles.add(profileId);
        this._abortController = new AbortController();

        try {
            Log.info(`[CacheDownloader] Caching profile: ${profileId}`);

            // 1. Check already cached resources (resume capability)
            const cachedUrls = await this._getAlreadyCachedUrls(profileId);
            const resourcesToDownload = resources.filter((r) => !cachedUrls.has(r.url));

            // 2. Calculate sizes
            const cachedSize = await this._getCachedSize(profileId);
            const estimatedTotal = await this._estimateSize(profileId, resources);

            Log.info(
                `[CacheDownloader] ${cachedUrls.size} cached, ${resourcesToDownload.length} to download`
            );

            const ProgressTracker_ = ProgressTracker;
            ProgressTracker_.init({
                total: resources.length,
                estimatedTotalSize: Number(estimatedTotal),
                alreadyCached: cachedUrls.size,
                alreadyCachedSize: Number(cachedSize),
            });

            // 4. Separate tiles from other resources
            const tiles = resourcesToDownload.filter((r) => r.type === "tile");
            const others = resourcesToDownload.filter((r) => r.type !== "tile");

            // 5. Download other resources first (parallel)
            if (others.length > 0) {
                await this._downloadResources(
                    others,
                    profileId,
                    this._config.concurrentDownloads,
                    0,
                    options.onProgress
                );
            }

            // 6. Download tiles (rate-limited)
            if (tiles.length > 0) {
                await this._downloadResources(
                    tiles,
                    profileId,
                    this._config.concurrentTileDownloads,
                    this._config.tileDownloadDelay,
                    options.onProgress
                );
            }

            const summary = ProgressTracker.getSummary() as Record<string, unknown>;
            summary.profileId = profileId;
            const successfulUrls = (summary.successfulDownloads as string[]) ?? [];
            const allCachedUrls = [...Array.from(cachedUrls), ...successfulUrls];
            summary.cached = allCachedUrls;

            // Guarded like `cache/storage.ts` does: the engine is also reachable from
            // DOM-less hosts, where an unguarded dispatch threw AFTER every resource
            // had been downloaded and turned a completed run into a rejected one.
            if (typeof document !== "undefined") {
                document.dispatchEvent(
                    new CustomEvent("geoleaf:cache:completed", {
                        detail: summary,
                    })
                );
            }

            Log.info(
                `[CacheDownloader] ✓ Complete: ${summary.successful} ok, ${summary.failed} failed`
            );

            return summary;
        } catch (error: unknown) {
            if ((error as Error)?.name === "AbortError") {
                Log.info(`[CacheDownloader] Cancelled: ${profileId}`);
                return { cancelled: true, profileId };
            }
            Log.error(`[CacheDownloader] Error:`, error as Error);
            throw error;
        } finally {
            this._cachingProfiles.delete(profileId);
            this._abortController = null;
        }
    },

    /**
     * Download resources with worker pool
     *
     * @private
     * @param {Array<Object>} resources - Resources to download
     * @param {string} profileId - Profile ID
     * @param {number} concurrency - Concurrent downloads
     * @param {number} delay - Delay between downloads (ms)
     * @param {Function} userCallback - User progress callback
     */
    async _downloadResources(
        resources: DownloaderResource[],
        profileId: string,
        concurrency: number,
        delay: number,
        userCallback?: (p: Record<string, unknown>) => void
    ) {
        const queue = [...resources];
        const workers: Promise<void>[] = [];

        for (let i = 0; i < concurrency; i++) {
            workers.push(this._worker(queue, profileId, delay, userCallback));
        }

        await Promise.all(workers);
    },

    /**
     * Download worker
     *
     * @private
     * @param {Array<Object>} queue - Resource queue (mutated)
     * @param {string} profileId - Profile ID
     * @param {number} delay - Delay (ms)
     * @param {Function} userCallback - Progress callback
     */
    async _worker(
        queue: DownloaderResource[],
        profileId: string,
        delay: number,
        userCallback?: (p: Record<string, unknown>) => void
    ) {
        const RetryHandler_ = RetryHandler;
        const ProgressTracker_ = ProgressTracker;

        while (queue.length > 0) {
            if (this._abortController?.signal.aborted) {
                break;
            }

            const resource = queue.shift();
            if (!resource) break;

            // Add delay for tiles
            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }

            try {
                // Retry download
                const signal = this._abortController?.signal;
                await RetryHandler_.retry(
                    async () => await this._downloadResource(resource, profileId),
                    {
                        ...(signal && { signal }),
                        resourceName: resource.url,
                    }
                );

                ProgressTracker_.recordSuccess(
                    resource,
                    userCallback as unknown as (data: ProgressData) => void
                );
            } catch (error: unknown) {
                ProgressTracker_.recordFailure(
                    resource,
                    (error as Error)?.message ?? String(error),
                    userCallback as unknown as (data: ProgressData) => void
                );
            }
        }
    },

    /**
     * Download and store single resource
     *
     * @private
     * @param {Object} resource - Resource to download
     * @param {string} profileId - Profile ID
     */
    async _downloadResource(resource: DownloaderResource & { size?: number }, profileId: string) {
        const FetchManager_ = FetchManager;

        Log.debug("[Downloader] Fetching resource:", resource.url);
        const abortSignal = this._abortController?.signal;
        const fetchResult = await FetchManager_.fetch(resource, {
            ...(abortSignal && { signal: abortSignal }),
        });

        if (fetchResult.skipped) {
            Log.debug("[Downloader] Resource skipped (optional):", resource.url);
            return; // Optional resource not found
        }

        Log.debug("[Downloader] Fetched:", resource.url, "Size:", fetchResult.size, "bytes");

        // Store in IndexedDB
        const StorageDB = IndexedDB;
        Log.debug("[Downloader] Storing in IndexedDB:", resource.url);

        // ⚠️ THE `ttl` WAS REMOVED FROM HERE — a pre-flight finding.
        //
        // 🛑 It was not merely unused: it was **discarded at write time**. This
        // function computed it (`Date.now() + 7 days`) and passed it to `cacheLayer`,
        // but `LayerMetadata` does not DECLARE it and `layerObject` does not write it
        // — the value fell into the void. And `tsc` could not see it, the facade
        // retyping as `Record<string, unknown>`.
        //
        // So it is not "kept" awaiting a reader: it was never written, hence no data
        // in the database carries it. Bringing it back one day means writing it for
        // real, not rewiring a field. ⚠️ And the one-year immutability claim the
        // worker put on rebuilt responses was already removed for this motive:
        // freshness was guaranteed by nothing.
        await StorageDB.cacheLayer(resource.url, fetchResult.data, profileId, {
            etag: fetchResult.metadata?.etag as string | undefined,
            lastModified: fetchResult.metadata?.lastModified as string | undefined,
            // NOT `as number`: the value is the raw `Content-Length` header, so it is a
            // string (or null). The cast used to claim `number`, which was simply false —
            // `cacheLayer` is what turns it into one.
            contentLength: fetchResult.metadata?.contentLength as string | null | undefined,
            contentType: fetchResult.metadata?.contentType as string | undefined,
            resourceType: resource.type,
        });

        Log.debug("[Downloader] Stored successfully:", resource.url);

        // Update resource size
        resource.size = fetchResult.size;
    },

    /**
     * Get already cached URLs for profile
     *
     * @private
     * @param {string} profileId - Profile ID
     * @returns {Promise<Set<string>>} Set of cached URLs
     */
    async _getAlreadyCachedUrls(profileId: string): Promise<Set<string>> {
        try {
            const cached = await CacheStorage.getCachedUrls(profileId);
            return new Set(cached);
        } catch (error: unknown) {
            Log.warn("[CacheDownloader] Failed to get cached URLs:", error);
            return new Set();
        }
    },

    /**
     * Get size of already cached resources
     *
     * @private
     * @param {string} profileId - Profile ID
     * @returns {Promise<number>} Size in bytes
     */
    async _getCachedSize(profileId: string): Promise<number> {
        try {
            const manifest = (await CacheStorage.getManifest(profileId)) as {
                resources?: Array<{ size?: number }>;
            } | null;
            if (!manifest?.resources) return 0;
            return manifest.resources.reduce((total, res) => total + (res.size ?? 0), 0);
        } catch (error: unknown) {
            Log.warn("[CacheDownloader] Failed to calculate cached size:", error);
            return 0;
        }
    },

    /**
     * Estimate total profile size
     *
     * @private
     * @param {string} profileId - Profile ID
     * @param {Array<Object>} resources - Resources
     * @returns {Promise<number>} Estimated size in bytes
     */
    async _estimateSize(profileId: string, resources: DownloaderResource[]): Promise<number> {
        try {
            if (CacheMetrics?.estimateProfileSize) {
                const result = await CacheMetrics.estimateProfileSize(profileId, resources);
                return result.totalSize ?? 0;
            }
            return resources.length * ESTIMATED_RESOURCE_SIZE_BYTES;
        } catch (error: unknown) {
            Log.warn("[CacheDownloader] Failed to estimate size:", error);
            return 0;
        }
    },

    /**
     * Cancel ongoing download
     */
    cancelDownload() {
        if (this._abortController) {
            Log.info("[CacheDownloader] Cancelling...");
            this._abortController.abort();
        }
    },

    /**
     * Check if download in progress
     * @returns {boolean} True if downloading
     */
    isDownloading() {
        return this._cachingProfiles.size > 0;
    },
};

const Downloader = CacheDownloader;

export { Downloader };
