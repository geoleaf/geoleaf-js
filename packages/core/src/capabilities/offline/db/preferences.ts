/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Preferences Module - User preferences and storage statistics
 * Part of the IndexedDB modular architecture
 */

import { Log } from "../../../utils/log/index.js";

/**
 * Key/value preferences persisted in the offline database, plus the storage report.
 *
 * Narrower than the other sub-modules on purpose: it exposes no `init()` and no `_db`, because
 * its three members are all a consumer needs. `getStorageStats` sits here rather than in a
 * store of its own since it reports on the whole database — quota, usage, and the row counts
 * that make a « why is it full » answer possible.
 *
 * Values are `unknown` on both ends: preferences are integrator-defined, so the core stores
 * them without asserting a shape it does not own.
 */
export interface PreferencesAPI {
    getStorageStats(): Promise<StorageStats>;
    setPreference(key: string, value: unknown): Promise<void>;
    getPreference(key: string, defaultValue?: unknown): Promise<unknown>;
}

/**
 * Tallies returned by {@link PreferencesAPI.getStorageStats}.
 *
 * 🛑 **`featuresCount` and `outboxCount` are here because their absence was a
 * measured defect.** This function counted only `layers` and `sync_queue` — the two
 * v3 stores. As long as `features` had no writer, that zero was TRUE; it became
 * false the day the pull wrote 27 entities and `getStats()` kept reporting 0.
 *
 * ⚠️ **`layersCount` STAYS** — the defect was the omission, not its presence.
 *
 * 🛑 **`syncQueueCount` leaves with the store.** The sentence above said it stayed
 * because `sync_queue` "still carries backup restoration", in `addpoi`'s backup
 * module: that was its last use, and that module is deleted with the whole chain. A
 * counter for a removed store counts nothing.
 */
interface StorageStats {
    used: number;
    quota: number;
    percentage: number;
    layersCount: number;
    featuresCount: number;
    outboxCount: number;
}

/**
 * Initialize Preferences module with database instance
 * @param {IDBDatabase} db - IndexedDB database instance
 * @returns {Object} Public API
 */
function init(db: IDBDatabase): PreferencesAPI {
    if (!db) {
        throw new Error("[DB.Preferences] Database instance is required");
    }

    return {
        /**
         * Get storage statistics
         * @returns {Promise<Object>} Storage stats with used/quota/percentage/counts
         */
        async getStorageStats() {
            const stats = {
                used: 0,
                quota: 0,
                percentage: 0,
                layersCount: 0,
                featuresCount: 0,
                outboxCount: 0,
            };

            try {
                // Browser quota — ORIGIN-WIDE, never this database alone. The counts gathered
                // just below are per store; these two numbers are not, and putting them in one
                // object is what makes them easy to read as if they were.
                //
                // ⚠️ `used` here is the same number that `CacheManager.getStorageQuota()` calls
                // `usage`, and `percentage` is kept as a float where that one rounds. Two names
                // and two shapes for one measurement: a caller that picks the wrong reader gets
                // `undefined` rather than an error. Kept as-is because this shape is what
                // `getStats()` has always returned to its callers; the divergence is recorded
                // rather than silently repaired.
                if (navigator.storage && navigator.storage.estimate) {
                    const estimate = await navigator.storage.estimate();
                    stats.used = estimate.usage || 0;
                    stats.quota = estimate.quota || 0;
                    stats.percentage = stats.quota > 0 ? (stats.used / stats.quota) * 100 : 0;
                }

                // Counts the three data-bearing stores: the layer cache, and the two
                // v4 stores. The last two were missing, so a pull of 27 entities left
                // `getStats()` reporting 0.
                // ⚠️ `sync_queue` used to be among them — the store is removed, and
                // counting it here would throw on a fresh database.
                const transaction = db.transaction(["layers", "features", "outbox"], "readonly");

                const layersStore = transaction.objectStore("layers");
                const layersRequest = layersStore.count();

                const featuresStore = transaction.objectStore("features");
                const featuresRequest = featuresStore.count();

                const outboxStore = transaction.objectStore("outbox");
                const outboxRequest = outboxStore.count();

                await new Promise<void>((resolve, reject) => {
                    transaction.oncomplete = () => {
                        stats.layersCount = layersRequest.result;
                        stats.featuresCount = featuresRequest.result;
                        stats.outboxCount = outboxRequest.result;
                        resolve();
                    };
                    transaction.onerror = () => reject(transaction.error);
                });

                Log.debug(
                    `[DB.Preferences] Storage stats: ${(stats.used / 1024 / 1024).toFixed(2)} MB used, ` +
                        `${stats.layersCount} layers, ` +
                        `${stats.featuresCount} features, ${stats.outboxCount} outbox`
                );
            } catch (error) {
                Log.error(
                    `[DB.Preferences] Failed to get storage stats: ${(error as Error).message}`
                );
            }

            return stats;
        },

        /**
         * Set user preference
         * @param {string} key - Preference key
         * @param {*} value - Preference value
         * @returns {Promise<void>}
         */
        async setPreference(key: string, value: unknown) {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(["preferences"], "readwrite");
                const store = transaction.objectStore("preferences");
                const request = store.put({ key, value, timestamp: Date.now() });

                request.onsuccess = () => {
                    Log.debug(`[DB.Preferences] Set preference: ${key}`);
                    resolve();
                };
                request.onerror = () => {
                    Log.error(`[DB.Preferences] Failed to set preference ${key}: ${request.error}`);
                    reject(request.error);
                };
            });
        },

        /**
         * Get user preference
         * @param {string} key - Preference key
         * @param {*} defaultValue - Default value if not found
         * @returns {Promise<*>} Preference value or default
         */
        async getPreference(key: string, defaultValue: unknown = null) {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(["preferences"], "readonly");
                const store = transaction.objectStore("preferences");
                const request = store.get(key);

                request.onsuccess = () => {
                    const value = request.result
                        ? (request.result as { value: unknown }).value
                        : defaultValue;
                    Log.debug(
                        `[DB.Preferences] Get preference ${key}: ${value !== null ? "found" : "using default"}`
                    );
                    resolve(value);
                };
                request.onerror = () => {
                    Log.error(`[DB.Preferences] Failed to get preference ${key}: ${request.error}`);
                    reject(request.error);
                };
            });
        },
    };
}

Log.debug("[DB.Preferences] Module loaded");

const DBPreferences = { init };

export { DBPreferences };
