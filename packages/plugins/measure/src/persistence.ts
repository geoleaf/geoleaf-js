/*!
 * @geoleaf-plugins/measure — localStorage persistence
 * © 2026 Mattieu Pottier — MIT License
 *
 * Serialises the FeatureCollection to localStorage with debounced writes (~300 ms).
 * Restores features on plugin boot. Respects persist:false and maxFeatures ceiling.
 * https://geoleaf.dev
 */
import type { MeasureConfig, MeasureFeature } from "./types.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _cfg: MeasureConfig | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialises the persistence module and reads any saved FeatureCollection.
 * Returns the saved Feature array, or null if absent / disabled / invalid.
 */
export function initPersistence(cfg: MeasureConfig): MeasureFeature[] | null {
    _cfg = cfg;
    if (!cfg.persist) return null;
    try {
        const raw = localStorage.getItem(cfg.storageKey);
        if (!raw) return null;
        const fc = JSON.parse(raw) as GeoJSON.FeatureCollection;
        if (fc?.type !== "FeatureCollection" || !Array.isArray(fc.features)) return null;
        return fc.features as MeasureFeature[];
    } catch {
        return null;
    }
}

/**
 * Schedules a debounced save (~300 ms) of the current FeatureCollection.
 * No-op when persist is disabled or maxFeatures has been reached.
 */
export function scheduleSave(getCollection: () => GeoJSON.FeatureCollection): void {
    if (!_cfg?.persist) return;
    if (_timer !== null) clearTimeout(_timer);
    _timer = setTimeout(() => {
        _timer = null;
        if (!_cfg) return;
        try {
            const col = getCollection();
            if (col.features.length > _cfg.maxFeatures) {
                console.warn(
                    `[GeoLeaf.Measure] maxFeatures (${_cfg.maxFeatures}) exceeded — localStorage save skipped`
                );
                return;
            }
            localStorage.setItem(_cfg.storageKey, JSON.stringify(col));
        } catch {
            // Quota exceeded or private mode — fail silently
        }
    }, 300);
}

/**
 * Removes the saved FeatureCollection from localStorage immediately.
 */
export function clearStorage(cfg: MeasureConfig): void {
    if (_timer !== null) {
        clearTimeout(_timer);
        _timer = null;
    }
    try {
        localStorage.removeItem(cfg.storageKey);
    } catch {
        // Private mode — fail silently
    }
}
