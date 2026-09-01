/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Cache Manager v3 (Lightweight Orchestrator)
 *
 * @version 3.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { Downloader } from "./downloader.js";
import { ResourceEnumerator } from "./resource-enumerator.js";
import { CacheMetrics } from "./metrics.js";
import { CacheStorage } from "./storage.js";
import { formatFileSize } from "../../../utils/general/formatters.js";
import { IndexedDB } from "../db/indexeddb.js";
import { evictToQuota } from "../db/eviction.js";

/**
 * Default byte budget for the persistent offline layer/tile cache. Generous
 * enough not to evict a normal regional vector download (gzipped tiles for a
 * region capped ~z14 are tens of MB), while bounding runaway growth across
 * repeated downloads / multiple profiles. Override via `storage.cache.maxCacheBytes`.
 */
const DEFAULT_MAX_CACHE_BYTES = 250 * 1024 * 1024; // 250 MB

interface CacheManagerConfig {
    enableProfileCache?: boolean;
    /**
     * Byte budget for the IndexedDB layer/tile cache. After each profile
     * download the least-recently-cached records are evicted until the store
     * fits this budget. Set to `0` to disable eviction. Default 250 MB.
     */
    maxCacheBytes?: number;
    /**
     * TOTAL download attempts per resource, initial try included (`3` = 1 try + 2
     * retries). See {@link RetryHandler} — the budget has always been counted this way.
     */
    maxAttempts?: number;
    /**
     * Kept alias for {@link CacheManagerConfig.maxAttempts}, normalised into it on read.
     *
     * A misnomer — it never meant "retries" — kept so existing profile configs keep
     * working. It is **not deprecated**: nothing schedules its removal, and no MAJOR is
     * announced for it. The distinction is not cosmetic. A `@deprecated` tag strikes the
     * key through in the integrator's editor and promises a removal; saying that about a
     * key we intend to keep makes the tag lie to autocompletion. See the Deprecation
     * section of `VERSIONING_POLICY.md` for what the tag does and does not mark.
     */
    maxRetries?: number;
    concurrentDownloads?: number;
    concurrentTileDownloads?: number;
    tileDownloadDelay?: number;
    [key: string]: unknown;
}

interface CacheProfileOptions {
    onProgress?: (progress: unknown) => void;
    selection?: unknown;
}

interface CacheResult {
    cached?: string[];
    urls?: string[];
    failedUrls?: string[];
    failedDownloads?: string[];
    totalSize?: number;
    duration?: number;
    error?: string;
    profileId?: string;
}

interface EnumerateResource {
    type?: string;
    url?: string;
    [key: string]: unknown;
}

interface ManifestLike {
    resources?: Array<{ url: string; [key: string]: unknown }>;
    cached?: string[];
    totalSize?: number;
    resourcesCount?: number;
    cachedAt?: number | null;
    version?: string | null;
}

interface CacheStatusResult {
    cached: boolean;
    size: number;
    resourcesCount: number;
    resources: Array<{ url: string; [key: string]: unknown }>;
    cachedAt: number | null;
    version?: string | null;
    error?: string;
}

interface LayerSelection {
    layers?: string[];
    basemaps?: string[];
    includeTiles?: boolean;
    [key: string]: unknown;
}

interface QuotaError extends Error {
    isQuotaError?: boolean;
    originalError?: unknown;
}

const CacheManager = {
    // Profile cache is enabled by default so that a missing/late init() call (plugin
    // registered after core boot) cannot silently disable offline caching. A profile may
    // still opt out explicitly via storage.cache.enableProfileCache:false (merged in init()).
    // ⚠️ No `enableTileCache` here: the field was read by nobody — the manager carried
    // and forwarded it without ever using it. Its single reader is `_tilesRequested()`
    // in `resource-enumerator.ts`.
    _config: {
        enableProfileCache: true,
        maxCacheBytes: DEFAULT_MAX_CACHE_BYTES,
    } as CacheManagerConfig,
    _cachingProfiles: new Set<string>(),

    init(options: CacheManagerConfig = {}) {
        // Merge over defaults instead of replacing, so a partial cache config keeps the
        // default flags (e.g. init({ maxAttempts: 5 }) must not drop enableProfileCache).
        this._config = { ...this._config, ...options };

        Downloader.init({
            ...options,
            // `maxRetries` is the deprecated spelling of the same budget — honoured here
            // so a profile that still uses it does not silently fall back to the default.
            maxAttempts: options.maxAttempts || options.maxRetries || 3,
            concurrentDownloads: options.concurrentDownloads || 10,
            concurrentTileDownloads: options.concurrentTileDownloads || 2,
            tileDownloadDelay: options.tileDownloadDelay || 100,
        });

        Log.info("[CacheManager] Initialized v3 (orchestrator) with config:", this._config);
    },

    async cacheProfile(profileId: string, options: CacheProfileOptions = {}): Promise<CacheResult> {
        if (!this._config?.enableProfileCache) {
            Log.warn("[CacheManager] Profile cache is disabled");
            return { error: "Profile cache disabled" };
        }

        if (this._cachingProfiles.has(profileId)) {
            Log.warn(`[CacheManager] Profile ${profileId} is already being cached`);
            return { error: "Already caching", profileId };
        }

        this._cachingProfiles.add(profileId);

        try {
            Log.info(`[CacheManager] Starting cache for profile: ${profileId}`);

            const profile = await this._loadProfileConfig(profileId);
            if (!profile) {
                throw new Error(`Profile ${profileId} configuration not found`);
            }

            // ── Quota pre-check ─────────────────────────────────────────────────────────
            //
            // 🛑 IT COMES FROM `Storage.downloadProfileForOffline()`, AND IT ARRIVED
            // BEFORE THE SHELL LEFT. That function was dead — zero callers in the whole
            // repo — but its body carried the download's ONLY quota pre-check, and
            // `cacheProfile()`, the LIVE path, had none. Deleting it first would have
            // removed the guard believing it removed dead code: the "dead ≠ disposable"
            // counter-example of the deletions inventory.
            //
            // ⚠️ AND THE MOTIVE IS STRONGER HERE THAN IT WAS THERE. The 02/08 reading
            // shows the origin in `bestEffort` on a fresh profile (~800 MB, persistence
            // refused): exceeding the quota does not return an error, it EVICTS — and
            // an origin eviction takes the sync queue away with the cache. A download
            // known to be too big is not attempted.
            const estimated = await this.estimateProfileSize(profileId);
            const quota = await this.getStorageQuota();
            // ⚠️ `estimated?.` despite a return type that forbids it — and this is not
            // caution on principle: `estimateProfileSize` RETURNS `undefined` whenever
            // `CacheMetrics.estimateProfileSize` does, because it relays unchecked and
            // its `try/catch` only catches an exception, not an absent value. The hole
            // already existed in the dead facade; it was just executed by nothing.
            const estimatedSize = estimated?.totalSize ?? 0;
            const available = quota?.available ?? 0;
            // Both guards say the same thing: NEVER refuse on a measurement we do not
            // have. `available` is 0 when `navigator.storage.estimate` is absent,
            // `estimatedSize` is 0 when estimation failed — a mute browser is not a
            // full browser, and a missing estimate is not a huge one.
            if (available > 0 && estimatedSize > 0 && estimatedSize > available) {
                const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
                throw new Error(
                    `Not enough storage: need ${mb(estimatedSize)} MB, available ${mb(available)} MB`
                );
            }

            const resources = await ResourceEnumerator.enumerateAll(
                profile,
                profileId,
                options.selection as
                    | { layers?: string[]; basemaps?: string[]; includeTiles?: boolean }
                    | null
                    | undefined
            );
            Log.info(`[CacheManager] Found ${resources.length} resources to cache`);

            const result = await Downloader.cacheProfile(
                profileId,
                profile as Record<string, unknown>,
                resources,
                options as { onProgress?: (p: Record<string, unknown>) => void }
            );

            await this._saveManifest(profileId, result);

            // Cap the persistent cache after the download settles (off the critical
            // offline read path) — evicts least-recently-cached tiles/layers if over budget.
            await this._enforceCacheQuota();

            return result;
        } catch (error) {
            const err = error as Error;
            const isQuotaError =
                err.name === "QuotaExceededError" ||
                err.message.includes("quota") ||
                err.message.includes("QuotaExceeded");

            const errorMsg = isQuotaError
                ? `[CacheManager] QUOTA EXCEEDED while caching profile ${profileId}. Clear cache or reduce selection.`
                : `[CacheManager] Failed to cache profile ${profileId}:`;

            Log.error(errorMsg, error);

            const enhancedError = new Error(
                isQuotaError ? "Storage quota exceeded" : err.message
            ) as QuotaError;
            enhancedError.isQuotaError = isQuotaError;
            enhancedError.originalError = error;
            throw enhancedError;
        } finally {
            this._cachingProfiles.delete(profileId);
        }
    },

    /**
     * Interrupts the download in progress, **and SAYS SO**.
     *
     * 🛑 THE EVENT WAS MISSING, AND IT WAS NOT A DEAD LISTENER BUT A BUG. Measured:
     * `geoleaf:cache:cancelled` had **two listeners and zero emitters**. A pre-flight
     * had read the same figure and concluded "the UI listens for nothing" — true on
     * the measurement, **false on the action to take**.
     *
     * What the listener does (`handleCancelled`, `offline-ui`): it resets the progress
     * bar, re-enables the button and hands control back. Without an emitter, a user
     * who cancels sees "⏹️ Stopping…" **indefinitely**, button disabled, with no way
     * to relaunch anything short of a page reload. The listener was right; the
     * emitter was what was missing.
     *
     * ⚠️ Emitted here and not in `Downloader`: the orchestrator owns a profile
     * download's lifecycle, and `Downloader.cancelDownload()` is also called by
     * internal paths. An emitter per intent, not per mechanism.
     */
    cancelDownload() {
        Downloader.cancelDownload();
        document.dispatchEvent(new CustomEvent("geoleaf:cache:cancelled"));
    },

    isDownloading(): boolean {
        return Downloader.isDownloading();
    },

    async _loadProfileConfig(profileId: string): Promise<unknown> {
        try {
            const Storage = CacheStorage;
            return await Storage.loadProfileConfig(profileId);
        } catch (error) {
            Log.error("[CacheManager] Failed to load profile config:", error);
            throw error;
        }
    },

    async _saveManifest(profileId: string, result: CacheResult) {
        const manifestData = {
            cached: result.cached || result.urls || [],
            failed: result.failedUrls || result.failedDownloads || [],
            totalSize: result.totalSize || 0,
            resourcesCount: (result.cached || result.urls || []).length,
            duration: result.duration || 0,
        };

        try {
            const Storage = CacheStorage;
            await Storage.saveManifest(profileId, manifestData);
            Log.info(
                `[CacheManager] Manifest saved for ${profileId}: ${manifestData.resourcesCount} resources`
            );
        } catch (error) {
            Log.error("[CacheManager] Failed to save manifest:", error);
        }
    },

    /**
     * Enforces the configured `maxCacheBytes` budget over the IndexedDB layer/tile
     * cache by evicting least-recently-cached records. No-op when the budget is
     * disabled (`0`/missing) or IndexedDB is unavailable. Emits
     * `geoleaf:cache:evicted` (detail = eviction summary) when records are removed.
     * Failures are swallowed — eviction must never break a successful download.
     */
    async _enforceCacheQuota(): Promise<void> {
        const maxBytes = this._config?.maxCacheBytes;
        if (!maxBytes || maxBytes <= 0) return;

        const rawDb = IndexedDB?._db;
        if (!rawDb || ("_isStub" in rawDb && rawDb._isStub)) return;

        try {
            const result = await evictToQuota(rawDb as IDBDatabase, maxBytes);
            if (result.evicted > 0) {
                Log.info(
                    `[CacheManager] Cache eviction freed ${this._formatBytes(result.freedBytes)} ` +
                        `(${result.evicted} record(s); budget ${this._formatBytes(maxBytes)})`
                );
                document.dispatchEvent(
                    new CustomEvent("geoleaf:cache:evicted", { detail: result })
                );
            }
        } catch (error) {
            Log.error("[CacheManager] Cache eviction failed:", error);
        }
    },

    async clearProfile(profileId: string): Promise<number> {
        Log.info(`[CacheManager] Clearing cache for profile: ${profileId}`);

        try {
            const Storage = CacheStorage;
            const result = await Storage.clearCache(profileId);
            Log.info(`[CacheManager] ✓ Cache cleared for ${profileId}`);
            return result;
        } catch (error) {
            Log.error("[CacheManager] Failed to clear cache:", error);
            throw error;
        }
    },

    async clearCache(profileId: string): Promise<number> {
        return await this.clearProfile(profileId);
    },

    async estimateProfileSize(profileId: string): Promise<{
        totalSize: number;
        totalSizeFormatted: string;
        byType?: unknown;
        resourceCounts?: unknown;
    }> {
        try {
            const profile = await this._loadProfileConfig(profileId);
            if (!profile) {
                Log.warn(`[CacheManager] Profile ${profileId} not found`);
                return { totalSize: 0, totalSizeFormatted: "0 Bytes" };
            }

            const resources = await ResourceEnumerator.enumerateAll(profile, profileId);

            const Metrics = CacheMetrics;
            if (!Metrics || !(Metrics as { estimateProfileSize?: unknown }).estimateProfileSize) {
                Log.warn("[CacheManager] Metrics module not available, using fallback estimation");
                return this._fallbackEstimation(resources);
            }

            return await (
                Metrics as {
                    estimateProfileSize: (
                        id: string,
                        r: EnumerateResource[]
                    ) => Promise<{ totalSize: number; totalSizeFormatted: string }>;
                }
            ).estimateProfileSize(profileId, resources);
        } catch (error) {
            Log.error("[CacheManager] Failed to estimate size:", error);
            return { totalSize: 0, totalSizeFormatted: "0 Bytes" };
        }
    },

    _fallbackEstimation(resources: EnumerateResource[]): {
        totalSize: number;
        totalSizeFormatted: string;
        resourceCounts: { total: number };
    } {
        let totalSize = 0;

        resources.forEach((r) => {
            if (r.type === "config" || r.type === "profile") totalSize += 100 * 1024;
            else if (r.type === "icon") totalSize += 500 * 1024;
            else if (r.type === "layer" || r.type === "data") totalSize += 500 * 1024;
            else if (r.type === "tile") totalSize += 15 * 1024;
            else totalSize += 10 * 1024;
        });

        return {
            totalSize,
            totalSizeFormatted: this._formatBytes(totalSize),
            resourceCounts: { total: resources.length },
        };
    },

    _formatBytes(bytes: number, decimals = 2): string {
        return formatFileSize(bytes, { precision: decimals });
    },

    async listCachedProfiles(): Promise<string[]> {
        const rawDb = IndexedDB?._db;
        if (!rawDb || ("_isStub" in rawDb && rawDb._isStub)) {
            return [];
        }

        try {
            const db = rawDb as IDBDatabase;
            const transaction = db.transaction(["metadata"], "readonly");
            const store = transaction.objectStore("metadata");

            return new Promise((resolve, reject) => {
                const request = store.getAllKeys();

                request.onsuccess = () => {
                    const profiles = (request.result as string[])
                        .filter((key) => key.startsWith("cache_manifest_"))
                        .map((key) => key.replace("cache_manifest_", ""));
                    resolve(profiles);
                };

                request.onerror = () => {
                    Log.error("[CacheManager] Failed to list cached profiles:", request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            Log.error("[CacheManager] Error listing cached profiles:", error);
            return [];
        }
    },

    async isProfileCached(profileId: string): Promise<boolean> {
        try {
            const Storage = CacheStorage;
            const manifest = (await Storage.getManifest(profileId)) as ManifestLike | null;
            return manifest !== null && (manifest.resourcesCount ?? 0) > 0;
        } catch (_error) {
            return false;
        }
    },

    /**
     * Origin-wide storage usage, as the browser reports it.
     *
     * 🛑 `navigator.storage.estimate()` measures the WHOLE ORIGIN, never one store. Nothing in
     * the returned numbers is attributable to layer caching, to the tile cache, or to any
     * single database — everything the page has ever stored is in there, including what other
     * features wrote. Reading a drop in `usage` as "the eviction worked" is therefore a
     * mistake the shape of this value invites.
     *
     * ## The four readers of that one measurement, and why they do not agree
     *
     * This is the reference reader — the only one with a caller outside its own file. Three
     * others exist, and each names the same numbers differently, which is what makes picking
     * the wrong one silent: a caller that reads `used` off this object gets `undefined`.
     *
     *   • `offline/db/preferences.ts` — `getStats()` says `used` where this one says `usage`,
     *     and keeps `percentage` as a float where this one rounds.
     *   • `offline-ui`, `cache/download-handler.ts` — `_checkQuota()` reads the estimate raw.
     *   • `offline-ui`, `cache/layer-selector/selection-cache.ts` — reads it raw too.
     *
     * ⚠️ The two plugin-side readers are NOT a dedup opportunity, and the reason is in this
     * function's own return: when the browser cannot answer, it returns zeros, which are
     * indistinguishable from "the origin is empty and the quota is nought". Both plugin
     * readers depend on telling those apart — an unreadable quota there means "proceed", while
     * a zero quota means "refuse". Routing them through this reader would turn every
     * unreadable quota into a refusal. The duplication carries a distinction this signature
     * cannot express; removing it without changing the signature would introduce a bug.
     *
     * @returns Origin usage and quota in bytes, the percentage rounded, and the remainder.
     */
    async getStorageQuota(): Promise<{
        usage: number;
        quota: number;
        percentage: number;
        available?: number;
    }> {
        if (!navigator.storage?.estimate) {
            return { usage: 0, quota: 0, percentage: 0 };
        }

        try {
            const estimate = await navigator.storage.estimate();
            const usage = estimate.usage ?? 0;
            const quota = estimate.quota ?? 0;
            const percentage = quota > 0 ? Math.round((usage / quota) * 100) : 0;

            return { usage, quota, percentage, available: quota - usage };
        } catch (error) {
            Log.error("[CacheManager] Failed to get storage quota:", error);
            return { usage: 0, quota: 0, percentage: 0 };
        }
    },

    async getCacheStatus(profileId: string): Promise<CacheStatusResult> {
        try {
            const Storage = CacheStorage;
            if (!Storage || !(Storage as { getManifest?: unknown }).getManifest) {
                Log.warn("[CacheManager] Storage module not available");
                return {
                    cached: false,
                    size: 0,
                    resourcesCount: 0,
                    resources: [],
                    cachedAt: null,
                };
            }

            const manifest = (await Storage.getManifest(profileId)) as ManifestLike | null;
            Log.debug("[CacheManager] getManifest returned:", manifest);

            if (!manifest) {
                Log.debug("[CacheManager] No manifest found for", profileId);
                return {
                    cached: false,
                    size: 0,
                    resourcesCount: 0,
                    resources: [],
                    cachedAt: null,
                };
            }

            let resources: Array<{ url: string; [key: string]: unknown }> = [];
            if (manifest.resources && Array.isArray(manifest.resources)) {
                resources = manifest.resources;
            } else if (manifest.cached && Array.isArray(manifest.cached)) {
                resources = manifest.cached.map((url: string) => ({ url }));
            }

            return {
                cached: true,
                size: manifest.totalSize || 0,
                resourcesCount: resources.length || manifest.resourcesCount || 0,
                resources,
                cachedAt: manifest.cachedAt ?? null,
                version: manifest.version ?? null,
            };
        } catch (error) {
            const err = error as Error;
            Log.error("[CacheManager] Failed to get cache status:", error);
            return {
                cached: false,
                size: 0,
                resourcesCount: 0,
                resources: [],
                cachedAt: null,
                error: err.message,
            };
        }
    },

    async saveLayerSelection(profileId: string, selection: LayerSelection) {
        try {
            const Storage = CacheStorage;
            await Storage.saveLayerSelection(profileId, selection);
            Log.info(`[CacheManager] Layer selection saved for profile: ${profileId}`);
        } catch (error) {
            Log.error("[CacheManager] Failed to save layer selection:", error);
            throw error;
        }
    },

    async loadLayerSelection(profileId: string): Promise<LayerSelection | null> {
        try {
            const Storage = CacheStorage;
            return (await Storage.loadLayerSelection(profileId)) as LayerSelection | null;
        } catch (error) {
            Log.error("[CacheManager] Failed to load layer selection:", error);
            return null;
        }
    },
};

export { CacheManager };
