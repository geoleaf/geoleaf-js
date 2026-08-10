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
"use strict";

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
     * @deprecated Misnomer kept so existing profile configs keep working — it never
     * meant "retries". Use {@link CacheManagerConfig.maxAttempts}.
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
    // ⚠️ Pas de `enableTileCache` ici (3.13) : ce champ n'était lu par personne — le
    // gestionnaire le portait et le transmettait sans jamais s'en servir. Son lecteur unique
    // est `_tilesRequested()` de `resource-enumerator.ts`.
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

            // ── Pré-contrôle de quota (tâche 3.13) ──────────────────────────────────────
            //
            // 🛑 IL VIENT DE `Storage.downloadProfileForOffline()`, ET IL EST ARRIVÉ AVANT
            // QUE LA COQUILLE NE PARTE. Cette fonction-là était morte — zéro appelant dans
            // tout le dépôt — mais son corps portait le SEUL pré-contrôle de quota du
            // téléchargement, et `cacheProfile()`, le chemin VIVANT, n'en avait aucun. La
            // supprimer d'abord aurait retiré la garde en croyant retirer du code mort :
            // c'est le contre-exemple « mort ≠ jetable » de l'inventaire des suppressions.
            //
            // ⚠️ ET LE MOTIF EST PLUS FORT ICI QU'IL NE L'ÉTAIT LÀ-BAS. Le relevé du 02/08
            // montre l'origine en `bestEffort` sur un profil neuf (~800 Mo, persistance
            // refusée) : dépasser le quota ne rend pas une erreur, il fait ÉVINCER — et une
            // éviction d'origine emporte la file de synchronisation avec le cache. Un
            // téléchargement qu'on sait trop gros ne se tente pas.
            const estimated = await this.estimateProfileSize(profileId);
            const quota = await this.getStorageQuota();
            // ⚠️ `estimated?.` malgré un type de retour qui l'interdit — et ce n'est pas de
            // la prudence de principe : `estimateProfileSize` REND `undefined` dès que
            // `CacheMetrics.estimateProfileSize` le fait, parce qu'elle relaie sans vérifier
            // et que son `try/catch` n'attrape qu'une exception, pas une valeur absente. Le
            // trou existait déjà dans la façade morte ; il n'était juste exécuté par rien.
            const estimatedSize = estimated?.totalSize ?? 0;
            const available = quota?.available ?? 0;
            // Les deux gardes disent la même chose : on ne refuse JAMAIS sur une mesure
            // qu'on n'a pas. `available` vaut 0 quand `navigator.storage.estimate` est
            // absent, `estimatedSize` vaut 0 quand l'estimation a échoué — un navigateur
            // muet n'est pas un navigateur plein, et une estimation manquante n'est pas
            // une estimation énorme.
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
     * Interrompt le téléchargement en cours, **et le DIT**.
     *
     * 🛑 L'ÉVÉNEMENT MANQUAIT, ET CE N'ÉTAIT PAS UN ÉCOUTEUR MORT MAIS UN BUG. Mesuré à la
     * clôture de S3c : `geoleaf:cache:cancelled` avait **deux écouteurs et zéro émetteur**.
     * Le pré-vol E3.5 avait relevé le même chiffre et en avait tiré « l'interface l'écoute
     * pour rien » — vrai sur la mesure, **faux sur le geste**.
     *
     * Ce que fait l'écouteur (`handleCancelled`, `offline-ui`) : il remet la barre de
     * progression à zéro, réactive le bouton et rend la main. Sans émetteur, un utilisateur
     * qui annule voit « ⏹️ Stopping… » **indéfiniment**, bouton désactivé, sans aucun moyen
     * de relancer autre chose qu'un rechargement de page. L'écouteur avait raison ; c'est
     * l'émetteur qui manquait.
     *
     * ⚠️ Émis ici et non dans `Downloader` : c'est l'orchestrateur qui possède le cycle de
     * vie d'un téléchargement de profil, et `Downloader.cancelDownload()` est aussi appelé
     * par des chemins internes. Un émetteur par intention, pas par mécanisme.
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
