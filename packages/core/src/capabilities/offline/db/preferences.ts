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
"use strict";

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
 * Décomptes rendus par {@link PreferencesAPI.getStorageStats}.
 *
 * 🛑 **`featuresCount` et `outboxCount` sont là parce que leur absence était B-121.** Cette
 * fonction ne comptait que `layers` et `sync_queue` — les deux magasins v3. Tant que `features`
 * n'avait aucun écrivain, ce zéro était VRAI ; il est devenu faux le jour où 4.1 a écrit 27
 * entités et où `getStats()` a continué de rapporter 0.
 *
 * ⚠️ **`layersCount` RESTE** — le défaut était l'omission, pas sa présence.
 *
 * 🛑 **`syncQueueCount` part avec le magasin (tâche 4.11).** La phrase du dessus disait qu'il
 * restait parce que `sync_queue` « porte encore la restauration de sauvegarde », côté module
 * de sauvegarde d'`addpoi` : c'était son dernier usage, et ce module est
 * supprimé avec toute la chaîne. Un compteur de magasin retiré ne compte plus rien.
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
                // Get browser quota
                if (navigator.storage && navigator.storage.estimate) {
                    const estimate = await navigator.storage.estimate();
                    stats.used = estimate.usage || 0;
                    stats.quota = estimate.quota || 0;
                    stats.percentage = stats.quota > 0 ? (stats.used / stats.quota) * 100 : 0;
                }

                // Compte les trois magasins qui portent de la donnée : le cache de couches, et
                // les deux magasins v4. B-121 : les deux derniers manquaient, donc un
                // rapatriement de 27 entités laissait `getStats()` rapporter 0.
                // ⚠️ `sync_queue` en faisait partie jusqu'à la tâche 4.11 — le magasin est
                // retiré, et le compter ici jetterait sur une base neuve.
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
