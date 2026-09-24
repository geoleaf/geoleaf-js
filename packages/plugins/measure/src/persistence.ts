/*!
 * @geoleaf-plugins/measure — localStorage persistence
 * © 2026 Mattieu Pottier — MIT License
 *
 * Serialises the FeatureCollection to localStorage with debounced writes (~300 ms), and
 * flushes a pending write when the page is hidden or unloaded. Restores features on plugin
 * boot. Respects persist:false and maxFeatures ceiling.
 * https://geoleaf.dev
 */
import type { MeasureConfig, MeasureFeature } from "./types.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _cfg: MeasureConfig | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _pending: (() => GeoJSON.FeatureCollection) | null = null;
let _flushWired = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Writes the collection now. Skips (with a warning) above maxFeatures; storage errors are silent. */
function _write(getCollection: () => GeoJSON.FeatureCollection): void {
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
}

/** Runs the pending debounced write immediately, if there is one. */
function _flush(): void {
    if (_timer === null) return;
    clearTimeout(_timer);
    _timer = null;
    const getCollection = _pending;
    _pending = null;
    if (getCollection) _write(getCollection);
}

/**
 * Flushes the pending write when the page goes away.
 *
 * The debounce alone lost the last measure on a reload: a write still waiting for its timer
 * when the page unloads never runs, and under load the timer can fire well after its 300 ms.
 * `pagehide` covers reload, navigation and close; `visibilitychange` to `hidden` covers the
 * mobile case, where a backgrounded tab may be killed without a `pagehide`. Wired once.
 */
function _wireFlushOnHide(): void {
    if (_flushWired || typeof window === "undefined" || typeof document === "undefined") return;
    _flushWired = true;
    window.addEventListener("pagehide", _flush);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") _flush();
    });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialises the persistence module and reads any saved FeatureCollection.
 * When persistence is enabled, also arranges for a pending write to be flushed when the
 * page is hidden or unloaded.
 * Returns the saved Feature array, or null if absent / disabled / invalid.
 */
export function initPersistence(cfg: MeasureConfig): MeasureFeature[] | null {
    _cfg = cfg;
    if (!cfg.persist) return null;
    _wireFlushOnHide();
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
 * Schedules a debounced save (~300 ms) of the current FeatureCollection. A save still
 * pending when the page is hidden or unloaded is written at that moment instead.
 * No-op when persist is disabled; the write is skipped when maxFeatures has been exceeded.
 */
export function scheduleSave(getCollection: () => GeoJSON.FeatureCollection): void {
    if (!_cfg?.persist) return;
    if (_timer !== null) clearTimeout(_timer);
    _pending = getCollection;
    _timer = setTimeout(_flush, 300);
}

/**
 * Removes the saved FeatureCollection from localStorage immediately, and cancels any
 * pending save.
 */
export function clearStorage(cfg: MeasureConfig): void {
    if (_timer !== null) {
        clearTimeout(_timer);
        _timer = null;
    }
    _pending = null;
    try {
        localStorage.removeItem(cfg.storageKey);
    } catch {
        // Private mode — fail silently
    }
}
