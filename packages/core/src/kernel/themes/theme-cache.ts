/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Theme Cache
 * Cache lightweight for thes GeoJSON layers used par the themes.
 */

import { Log } from "../../utils/log/index.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";

/**
 * The three relays of `GeoLeaf.Storage.DB` the theme cache reads — a `Pick` of the
 * namespace's own declaration, itself typed from the engine. Not a view written here: one
 * was, and it declared a `profileId` the engine did not.
 */
type StorageDBLike = Required<Pick<GeoLeafStorageDB, "getLayer" | "cacheLayer" | "removeLayer">>;

/** A cached layer record, as `Storage.DB.getLayer` returns it. */
type CachedLayerEntry = NonNullable<Awaited<ReturnType<StorageDBLike["getLayer"]>>>;

/** What `Storage.DB.cacheLayer` stores: a string, a buffer or an object. */
type LayerPayload = Parameters<StorageDBLike["cacheLayer"]>[1];

/**
 * Phase 7 — Package Separation: IndexedDB lives in the Storage plugin.
 * Access it only via GeoLeaf.Storage.DB at runtime (after the plugin is loaded).
 */
function _getIndexedDB(): StorageDBLike | null {
    const storage = getGeoLeaf()?.Storage as { DB?: StorageDBLike } | undefined;
    return storage?.DB ?? null;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

function _isCachedEntryValid(
    cached: CachedLayerEntry,
    profileId: string | null | undefined,
    maxAge: number
): boolean {
    if (profileId && cached.profileId && cached.profileId !== profileId) return false;
    return Date.now() - cached.timestamp <= maxAge;
}

const ThemeCache = {
    _config: {
        enabled: true,
        maxAge: MAX_AGE_MS,
    },

    /**
     * Retrieves a layer from the cache si elle est encore valide.
     * @param {string} layerId
     * @param {string} [profileId]
     * @returns {Promise<Object|null>}
     */
    async get(layerId: string, profileId?: string | null): Promise<unknown> {
        if (!this._config.enabled) {
            return null;
        }

        const StorageDB = _getIndexedDB();
        if (!StorageDB) {
            return null;
        }

        try {
            const cached = await StorageDB.getLayer(layerId);
            if (!cached) {
                return null;
            }

            if (!_isCachedEntryValid(cached, profileId, this._config.maxAge)) {
                Log?.debug(`[ThemeCache] Cache invalide pour ${layerId}`);
                return null;
            }

            Log?.info(`[ThemeCache] Cache hit pour ${layerId}`);
            return cached.data;
        } catch (err) {
            Log?.warn(
                `[ThemeCache] Lecture cache impossible pour ${layerId}: ${(err as Error).message}`
            );
            return null;
        }
    },

    /**
     * Stocke a layer in the cache.
     * @param {string} layerId
     * @param {string} [profileId]
     * @param {Object} data
     * @param {Object} [metadata]
     * @returns {Promise<void>}
     */
    async store(
        layerId: string,
        profileId: string | null | undefined,
        data: LayerPayload,
        metadata: Record<string, unknown> = {}
    ): Promise<void> {
        if (!this._config.enabled) {
            return;
        }

        const StorageDB = _getIndexedDB();
        if (!StorageDB) {
            return;
        }

        try {
            await StorageDB.cacheLayer(layerId, data, profileId || null, metadata);
            if (Log) Log.debug(`[ThemeCache] Couche mise en cache: ${layerId}`);
        } catch (err) {
            if (Log)
                Log.warn(`[ThemeCache] Cache write failed ${layerId}: ${(err as Error).message}`);
        }
    },

    /**
     * Invalid a layer en cache.
     * @param {string} layerId
     * @returns {Promise<void>}
     */
    async invalidate(layerId: string): Promise<void> {
        const StorageDB = _getIndexedDB();
        if (!StorageDB) {
            return;
        }

        try {
            await StorageDB.removeLayer(layerId);
            if (Log) Log.info(`[ThemeCache] Cache invalidated for ${layerId}`);
        } catch (err) {
            if (Log)
                Log.warn(
                    `[ThemeCache] Impossible d'invalider ${layerId}: ${(err as Error).message}`
                );
        }
    },
};

export { ThemeCache };
