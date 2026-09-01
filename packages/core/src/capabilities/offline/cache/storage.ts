/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview CacheStorage - IndexedDB operations for cache management
 */

import { Log } from "../../../utils/log/index.js";
import { fetchBounded, BoundedFetchError } from "../../../utils/general/fetch-bounded.js";
import { coreConfigGet } from "../config-seam.js";
import { resolveProfileLayers, type ProfileWithLayers } from "../../../kernel/config/index.js";
import { resolveProfileIcons, type ProfileWithIcons } from "./profile-icons.js";
import { validateFetchUrl } from "./url-guard.js";
import { IndexedDB } from "../db/indexeddb.js";

interface LayerSelection {
    layers?: string[];
    basemaps?: string[];
    layerStyles?: Record<string, string>;
    timestamp?: number;
    includeTiles?: boolean;
}
interface ManifestResults {
    cached: string[];
    failed: unknown[];
    totalSize: number;
    resourcesCount: number;
    duration: number;
}

const CacheStorage = {
    // ==================== Profile Configuration ====================

    /**
     * Loads a profile's configuration from its profile.json.
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<Object>} Profile configuration
     * @throws {Error} If the profile does not exist or cannot be loaded
     * @example
     * const profile = await GeoLeaf.Storage.Cache.Storage.loadProfileConfig('tourism');
     */
    async loadProfileConfig(profileId: string): Promise<Record<string, unknown>> {
        const profilesBasePath = coreConfigGet("data.profilesBasePath", "../profiles") as string;
        const profileUrl = `${profilesBasePath}/${profileId}/profile.json`;
        validateFetchUrl(profileUrl);

        // ⚠️ "DEGRADE VISIBLY" — the half of the work that bounding does not do. An
        // abandonment must SAY SO, and say it DIFFERENTLY from a missing resource:
        // "the server did not answer within 15 s" calls for a retry, "profile not
        // found" calls for a configuration fix. Confusing them sends the user looking
        // in the wrong place.
        let response: Response;
        try {
            response = await fetchBounded(profileUrl);
        } catch (err) {
            if (err instanceof BoundedFetchError && err.kind === "timeout") {
                Log.warn(`[CacheStorage] Profile config timed out: ${profileUrl}`);
                throw new Error(
                    `Le serveur n'a pas répondu dans le délai imparti pour le profil "${profileId}". Réessayez.`,
                    { cause: err }
                );
            }
            throw err;
        }
        if (!response.ok) {
            throw new Error(`Failed to load profile config: ${response.status}`);
        }

        const profile = (await response.json()) as Record<string, unknown> &
            ProfileWithLayers &
            ProfileWithIcons;

        // The served profile.json does not inline `layers`; resolve them from
        // Files.layersFile so the resource enumerator and validator (which both
        // consume this object) include the profile's layers in the download.
        if (!profile.layers && profile.Files?.layersFile) {
            profile.layers = await resolveProfileLayers(profile, profileId, profilesBasePath, {
                validateUrl: validateFetchUrl,
                onWarn: (message) => Log.warn(message),
            });
        }

        // Same story for `icons`, missed when `layers` was fixed: since taxonomy v3 the
        // sprite lives in the file behind Files.modules.taxonomy, so `profile.icons` was
        // ALWAYS undefined and the enumerator's sprite step returned early, silently —
        // no profile icon was ever cached for offline use. Resolve it here, where the
        // profile object is already being reconciled with the v2 layout.
        if (!profile.icons && profile.Files?.modules?.taxonomy) {
            const icons = await resolveProfileIcons(profile, profileId, profilesBasePath, {
                validateUrl: validateFetchUrl,
            });
            if (icons) profile.icons = icons;
        }

        return profile;
    },

    // ==================== Layer Selection Preferences ====================

    /**
     * Loads the layer-selection preferences from IndexedDB.
     * Tells the enumerator which layers and basemaps are to be cached.
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<Object|null>} Layer selection {layers: [], basemaps: [], layerStyles: {}, timestamp: number}
     * @example
     * const selection = await GeoLeaf.Storage.Cache.Storage.loadLayerSelection('tourism');
     * if (selection) {
     *   console.log(`Selected layers: ${selection.layers.join(', ')}`);
     * }
     */
    async loadLayerSelection(profileId: string): Promise<LayerSelection | null> {
        if (!IndexedDB) {
            console.warn("[CacheStorage] IndexedDB not available");
            return null;
        }

        try {
            const key = `cache_layer_selection_${profileId}`;
            Log.debug("[CacheStorage] loadLayerSelection: loading key:", key);
            const selection = await IndexedDB.getPreference(key);
            Log.debug("[CacheStorage] loadLayerSelection: loaded selection:", selection);
            return selection as LayerSelection | null;
        } catch (error) {
            console.error("[CacheStorage] loadLayerSelection error:", error);
            Log.warn(`[CacheStorage] Failed to load layer selection: ${(error as Error).message}`);
            return null;
        }
    },

    /**
     * Saves the layer-selection preferences into IndexedDB.
     *
     * @param {string} profileId - Profile ID
     * @param {Object} selection - Selection to persist
     * @param {Array<string>} selection.layers - IDs of the selected layers
     * @param {Array<string>} selection.basemaps - IDs of the selected basemaps
     * @param {Object<string, string>} selection.layerStyles - Selected style per layer
     * @returns {Promise<void>}
     * @example
     * await GeoLeaf.Storage.Cache.Storage.saveLayerSelection('tourism', {
     *   layers: ['layer1', 'layer2'],
     *   basemaps: ['osm'],
     *   layerStyles: { 'layer1': 'default' }
     * });
     */
    async saveLayerSelection(profileId: string, selection: LayerSelection) {
        if (!IndexedDB) {
            throw new Error("IndexedDB not initialized");
        }

        try {
            // Stamp the selection if the caller did not.
            if (!selection.timestamp) {
                selection.timestamp = Date.now();
            }

            const key = `cache_layer_selection_${profileId}`;
            Log.debug("[CacheStorage] saveLayerSelection: saving key:", key);
            await IndexedDB.setPreference(key, selection);
            Log.debug("[CacheStorage] saveLayerSelection: saved successfully");

            Log.debug(
                `[CacheStorage] Layer selection saved: ${selection.layers?.length || 0} layers, ${selection.basemaps?.length || 0} basemaps`
            );
        } catch (error) {
            console.error("[CacheStorage] saveLayerSelection error:", error);
            Log.error(`[CacheStorage] Failed to save layer selection: ${(error as Error).message}`);
            throw error;
        }
    },

    // ==================== Cache Manifest Management ====================

    /**
     * Saves the cache manifest into IndexedDB.
     * The manifest holds the list of cached resources plus the run's metadata.
     *
     * @param {string} profileId - Profile ID
     * @param {Object} results - Cache run results
     * @param {Array<string>} results.cached - URLs of the cached resources
     * @param {Array<Object>} results.failed - Resources that failed
     * @param {number} results.totalSize - Total size in bytes
     * @param {number} results.resourcesCount - Resource count
     * @param {number} results.duration - Download duration in ms
     * @returns {Promise<void>}
     * @example
     * await GeoLeaf.Storage.Cache.Storage.saveManifest('tourism', {
     *   cached: ['url1', 'url2'],
     *   failed: [],
     *   totalSize: 1024000,
     *   resourcesCount: 10,
     *   duration: 5000
     * });
     */
    async saveManifest(profileId: string, results: ManifestResults) {
        const manifest = {
            profileId: profileId,
            version: "3.0.0",
            generatedAt: new Date().toISOString(),
            resources: results.cached.map((url) => ({
                url: url,
                cached: true,
            })),
            failedResources: results.failed,
            totalSize: results.totalSize,
            resourcesCount: results.resourcesCount,
            duration: results.duration,
        };

        if (!IndexedDB?._db || "_isStub" in IndexedDB._db) {
            throw new Error("StorageDB not initialized");
        }
        const db = IndexedDB._db;
        const transaction = db.transaction(["metadata"], "readwrite");
        const store = transaction.objectStore("metadata");

        await new Promise<void>((resolve, reject) => {
            const request = store.put({
                key: `cache_manifest_${profileId}`,
                value: manifest,
                timestamp: Date.now(),
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });

        Log.debug(`[CacheStorage] Manifest saved for profile: ${profileId}`);
    },

    /**
     * Retrieves a profile's cache manifest.
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<Object|null>} The manifest, or null when absent
     * @example
     * const manifest = await GeoLeaf.Storage.Cache.Storage.getManifest('tourism');
     * if (manifest) {
     *   console.log(`Cached at: ${manifest.generatedAt}`);
     * }
     */
    async getManifest(profileId: string): Promise<Record<string, unknown> | null> {
        const rawDb = IndexedDB?._db;
        if (!rawDb || "_isStub" in rawDb) return null;

        try {
            const db = rawDb;
            const transaction = db.transaction(["metadata"], "readonly");
            const store = transaction.objectStore("metadata");

            return new Promise((resolve, reject) => {
                const request = store.get(`cache_manifest_${profileId}`);

                request.onsuccess = () => {
                    resolve(
                        request.result
                            ? (request.result as { value: Record<string, unknown> }).value
                            : null
                    );
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            Log.error(`[CacheStorage] Failed to get manifest: ${(error as Error).message}`);
            return null;
        }
    },

    /**
     * Deletes a profile's cache manifest.
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<void>}
     * @example
     * await GeoLeaf.Storage.Cache.Storage.deleteManifest('tourism');
     */
    async deleteManifest(profileId: string): Promise<void> {
        const rawDb = IndexedDB?._db;
        if (!rawDb || "_isStub" in rawDb) return;

        const db = rawDb;
        const transaction = db.transaction(["metadata"], "readwrite");
        const store = transaction.objectStore("metadata");

        await new Promise<void>((resolve, reject) => {
            const request = store.delete(`cache_manifest_${profileId}`);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });

        Log.debug(`[CacheStorage] Manifest deleted for profile: ${profileId}`);
    },

    // ==================== Cache Status & Queries ====================

    /**
     * Returns a profile's cache status, i.e. its manifest (date, size, resource count).
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<Object|null>} Cache status, or null when the profile is not cached
     * @example
     * const status = await GeoLeaf.Storage.Cache.Storage.getCacheStatus('tourism');
     * if (status) {
     *   console.log(`Cached at: ${status.generatedAt}, ${status.resourcesCount} resources`);
     * }
     */
    async getCacheStatus(profileId: string): Promise<Record<string, unknown> | null> {
        return await this.getManifest(profileId);
    },

    /**
     * Lists every cached profile.
     *
     * @returns {Promise<Array<string>>} IDs of the cached profiles
     * @example
     * const profiles = await GeoLeaf.Storage.Cache.Storage.getCachedProfiles();
     * console.log(`Cached profiles: ${profiles.join(', ')}`);
     */
    async getCachedProfiles(): Promise<string[]> {
        const rawDb = IndexedDB?._db;
        if (!rawDb || "_isStub" in rawDb) return [];

        try {
            const db = rawDb;
            const transaction = db.transaction(["metadata"], "readonly");
            const store = transaction.objectStore("metadata");

            return new Promise((resolve, reject) => {
                const request = store.getAllKeys();

                request.onsuccess = () => {
                    const keys = (request.result || []) as string[];
                    const profiles = keys
                        .filter((key) => key.startsWith("cache_manifest_"))
                        .map((key) => key.replace("cache_manifest_", ""));

                    resolve(profiles);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            Log.error(`[CacheStorage] Failed to list cached profiles: ${(error as Error).message}`);
            return [];
        }
    },

    /**
     * Returns the URLs already cached for a profile.
     * Walks the "layers" object store to build the Set.
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<Set<string>>} Set of cached URLs
     * @example
     * const urls = await GeoLeaf.Storage.Cache.Storage.getCachedUrls('tourism');
     * console.log(`${urls.size} URLs in cache`);
     */
    async getCachedUrls(profileId: string): Promise<Set<string>> {
        const cachedUrls = new Set<string>();
        const rawDb = IndexedDB?._db;
        if (!rawDb || "_isStub" in rawDb) return cachedUrls;

        try {
            const db = rawDb;
            const transaction = db.transaction(["layers"], "readonly");
            const store = transaction.objectStore("layers");

            // Cursor rather than getAll: one record materialised at a time.
            return new Promise((resolve) => {
                const request = store.openCursor();

                request.onsuccess = (event: Event) => {
                    const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
                    if (cursor) {
                        const val = cursor.value as { profileId?: string; id?: string };
                        if (val.profileId === profileId && val.id) {
                            cachedUrls.add(val.id);
                        }
                        cursor.continue();
                    } else {
                        resolve(cachedUrls);
                    }
                };

                request.onerror = () => {
                    Log.error("[CacheStorage] Error reading cached URLs");
                    resolve(cachedUrls);
                };
            });
        } catch (error) {
            Log.error(`[CacheStorage] Error getting cached URLs: ${(error as Error).message}`);
            return cachedUrls;
        }
    },

    // ==================== Cache Clearing ====================

    /**
     * Clears a profile's cache: its layers in IndexedDB, its manifest, and its
     * Service Worker Cache API buckets.
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<number>} Number of deleted resources
     * @example
     * const deleted = await GeoLeaf.Storage.Cache.Storage.clearCache('tourism');
     * console.log(`Deleted ${deleted} cached resources`);
     */
    async clearCache(profileId: string): Promise<number> {
        Log.info(`[CacheStorage] Clearing cache for profile: ${profileId}`);

        let deleted = 0;

        try {
            if (IndexedDB) {
                deleted = (await IndexedDB.clearProfile(profileId)) as number;
            }

            // 2. Drop the manifest from IndexedDB.
            await this.deleteManifest(profileId);

            // 3. Drop the Service Worker Cache API buckets, when available.
            //
            // 🛑 A BUG REQUALIFIED at pre-flight — the announced effect was FALSE.
            //
            // The roadmap said "clearing the profile cache stops working at the next
            // bump, silently", because of the hard-coded `geoleaf-v1.1.0-profile-`
            // literal. Measured: the condition was a DISJUNCTION whose second member
            // (`includes("profile-<id>")`) caught every bucket whatever the version.
            // Clearing therefore worked; the literal NEVER decided anything the
            // disjunction did not already decide. It is removed as inert code, not as
            // a behaviour fix.
            //
            // ⚠️ WHAT WAS TRUE, and is the serious half: the TILE cache was never
            // targeted. A "clear the profile cache" left the basemap in place. It is
            // now called `geoleaf-data-tiles` — a stable name, hence finally
            // targetable, which a versioned name had never allowed cleanly.
            if ("caches" in window) {
                const cacheNames = await caches.keys();

                for (const cacheName of cacheNames) {
                    if (
                        cacheName.includes(`profile-${profileId}`) ||
                        cacheName === "geoleaf-data-tiles"
                    ) {
                        const cacheDeleted = await caches.delete(cacheName);
                        if (cacheDeleted) {
                            Log.info(`[CacheStorage] Deleted Cache API: ${cacheName}`);
                        }
                    }
                }
            }

            Log.info(
                `[CacheStorage] Cache cleared: ${deleted} resources deleted from IndexedDB, Cache API cleared`
            );

            // Emit the DOM event — guarded on `document`, which is the reference form
            // the sibling emitters in downloader.ts / progress-tracker.ts now follow.
            if (typeof document !== "undefined") {
                document.dispatchEvent(
                    new CustomEvent("geoleaf:cache:cleared", {
                        detail: { profileId, deleted },
                    })
                );
            }

            return deleted;
        } catch (error) {
            Log.error(`[CacheStorage] Failed to clear cache: ${(error as Error).message}`);
            throw error;
        }
    },

    // ==================== Storage Quota ====================

    // ⚠️ `getStorageQuota()` WAS REMOVED HERE — third copy of the same
    // `navigator.storage.estimate()` wrapper, with no production caller, and carrying
    // a THIRD key vocabulary (`used` where the survivor says `usage`). The only live
    // reader is `CacheManager.getStorageQuota()`.
};

// Public export
export { CacheStorage };
