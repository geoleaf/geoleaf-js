/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Performance Profiler – Baseline Storage
 * Pure storage helpers extracted from performance-profiler.js (Phase 8.2.5)
 */

const STORAGE_KEY = "geoleaf_performance_baseline";

/** Which Web Storage area to read/write the baseline from. */
type StorageType = "localStorage" | "sessionStorage";

/**
 * Loads the profile de baseline from the storage browser.
 * Returns the baseline ou null si absente / invalid.
 *
 * @param {'localStorage'|'sessionStorage'} storageType
 * @returns {Object|null}
 */
export function loadBaselineFromStorage(storageType: StorageType): unknown {
    try {
        const storage = storageType === "localStorage" ? localStorage : sessionStorage;
        const saved = storage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (_) {
        // Storage non available ou data corrompues
    }
    return null;
}

/**
 * Sauvegarde the profile de baseline in the storage browser.
 *
 * @param {Object} baseline     - Object baseline to sauvegarder
 * @param {'localStorage'|'sessionStorage'} storageType
 */
export function saveBaselineToStorage(baseline: unknown, storageType: StorageType): void {
    try {
        const storage = storageType === "localStorage" ? localStorage : sessionStorage;
        storage.setItem(STORAGE_KEY, JSON.stringify(baseline));
    } catch (_) {
        // Storage non available
    }
}
