/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview ProgressTracker - Tracks download progress and emits events
 * Extracted from downloader.js for better modularity
 *
 * @version 3.0.0
 * @phase Phase 1 - Priority 1 Critical Refactoring
 */
"use strict";

import { Log } from "../../../utils/log/index.js";

interface ProgressInitOptions {
    total?: number;
    estimatedTotalSize?: number;
    alreadyCached?: number;
    alreadyCachedSize?: number;
}

/**
 * The snapshot a caching run publishes to its listeners on every progress tick.
 *
 * Every field is required: a partial snapshot would force each consumer to invent its own
 * default for the missing ones, which is how two progress bars end up disagreeing. Sizes are
 * in bytes, speeds in bytes per second, `eta` and `elapsedTime` in milliseconds, and
 * `percentage` is already scaled to 0-100 — consumers display it, they do not recompute it.
 */
export interface ProgressData {
    current: number;
    total: number;
    percentage: number;
    downloadedSize: number;
    estimatedTotalSize: number;
    currentSpeed: number;
    averageSpeed: number;
    eta: number;
    successful: number;
    failed: number;
    elapsedTime: number;
}

/**
 * ProgressTracker - Tracks and reports download progress
 */
const ProgressTracker = {
    _state: {
        startTime: null as number | null,
        lastUpdateTime: null as number | null,
        completed: 0,
        total: 0,
        downloadedSize: 0,
        estimatedTotalSize: 0,
        downloadedSinceLastUpdate: 0,
        successfulDownloads: [] as string[],
        failedDownloads: [] as Array<{ url: string; error: string }>,
    },

    _config: {
        updateInterval: 500,
        updateThreshold: 20,
    },

    init(options: ProgressInitOptions = {}) {
        this._state = {
            startTime: Date.now(),
            lastUpdateTime: Date.now(),
            completed: options.alreadyCached || 0,
            total: options.total || 0,
            downloadedSize: options.alreadyCachedSize || 0,
            estimatedTotalSize: options.estimatedTotalSize || 0,
            downloadedSinceLastUpdate: 0,
            successfulDownloads: [],
            failedDownloads: [],
        };

        Log.info("[ProgressTracker] Initialized:", {
            total: this._state.total,
            alreadyCached: options.alreadyCached || 0,
        });
    },

    /**
     * Record successful download
     *
     * @param {Object} resource - Downloaded resource
     * @param {string} resource.url - Resource URL
     * @param {number} [resource.size=0] - Resource size in bytes
     * @param {Function} [callback] - Optional user callback
     * @returns {Object|null} Progress update or null if not emitted
     */
    recordSuccess(
        resource: { url: string; size?: number },
        callback?: (data: ProgressData) => void
    ): ProgressData | null {
        this._state.completed++;
        this._state.downloadedSize += resource.size || 0;
        this._state.downloadedSinceLastUpdate += resource.size || 0;
        this._state.successfulDownloads.push(resource.url);

        Log.debug(`[ProgressTracker] ✓ ${resource.url} (${(resource.size || 0) / 1024} KB)`);

        return this._emitProgressIfNeeded(callback);
    },

    /**
     * Record failed download
     *
     * @param {Object} resource - Failed resource
     * @param {string} resource.url - Resource URL
     * @param {string} error - Error message
     * @param {Function} [callback] - Optional user callback
     * @returns {Object|null} Progress update or null if not emitted
     */
    recordFailure(
        resource: { url: string },
        error: string,
        callback?: (data: ProgressData) => void
    ): ProgressData | null {
        this._state.completed++;
        this._state.failedDownloads.push({ url: resource.url, error });

        Log.warn(`[ProgressTracker] ✗ ${resource.url}: ${error}`);

        return this._emitProgressIfNeeded(callback);
    },

    /**
     * Emit progress update if threshold reached
     *
     * @private
     * @param {Function} [callback] - Optional user callback
     * @returns {Object|null} Progress data or null if not emitted
     */
    _emitProgressIfNeeded(callback?: (data: ProgressData) => void): ProgressData | null {
        const now = Date.now();
        const lastUpdate = this._state.lastUpdateTime ?? now;
        const timeSinceUpdate = now - lastUpdate;
        const shouldUpdate =
            timeSinceUpdate >= this._config.updateInterval ||
            this._state.completed % this._config.updateThreshold === 0 ||
            this._state.completed === this._state.total; // Always emit on completion

        if (!shouldUpdate) {
            return null;
        }

        const progressData = this._calculateProgress(now);

        // Emit DOM event — guarded like `cache/storage.ts` does. The engine's modules
        // are also reachable from DOM-less hosts (worker / SW context), where an
        // unguarded dispatch threw and aborted the whole download.
        if (typeof document !== "undefined") {
            document.dispatchEvent(
                new CustomEvent("geoleaf:cache:progress", {
                    detail: progressData,
                })
            );
        }

        // Call user callback if provided
        if (callback) {
            try {
                callback(progressData);
            } catch (error: unknown) {
                Log.error("[ProgressTracker] Callback error:", error);
            }
        }

        this._state.lastUpdateTime = now;
        this._state.downloadedSinceLastUpdate = 0;

        return progressData;
    },

    /**
     * Calculate current progress metrics
     *
     * @private
     * @param {number} now - Current timestamp
     * @returns {Object} Progress data
     */
    _calculateProgress(now: number): ProgressData {
        const lastUpdate = this._state.lastUpdateTime ?? this._state.startTime ?? now;
        const startTime = this._state.startTime ?? now;
        const elapsed = (now - lastUpdate) / 1000;
        const totalElapsed = (now - startTime) / 1000;

        // Current speed (bytes/second)
        const currentSpeed = elapsed > 0 ? this._state.downloadedSinceLastUpdate / elapsed : 0;

        // Average speed (bytes/second)
        const averageSpeed = totalElapsed > 0 ? this._state.downloadedSize / totalElapsed : 0;

        // ETA (seconds)
        const remainingBytes = this._state.estimatedTotalSize - this._state.downloadedSize;
        const eta = averageSpeed > 0 ? remainingBytes / averageSpeed : 0;

        // Progress percentage.
        //
        // ⚠️ Clamped, and that is not defensive dressing (B.12). `completed` is incremented
        // unconditionally by both `recordSuccess` and `recordFailure`, so anything counted
        // twice — a retry recorded as both, an enumeration yielding duplicates — pushes the
        // ratio past 1. Measured before the clamp: 150 % and 200 % out of `emitProgress`,
        // straight into the download UI.
        //
        // The bound comes from `CacheMetrics.calculateProgress`, which this function
        // superseded by reimplementation and which clamped from the start. That method had
        // no production caller and read as dead code — purging it without reading it would
        // have destroyed the one thing it still knew that the live path did not.
        const rawPercentage =
            this._state.total > 0 ? (this._state.completed / this._state.total) * 100 : 0;
        const percentage = Math.min(100, Math.max(0, rawPercentage));

        return {
            current: this._state.completed,
            total: this._state.total,
            percentage: Math.round(percentage * 10) / 10,
            downloadedSize: this._state.downloadedSize,
            estimatedTotalSize: this._state.estimatedTotalSize,
            currentSpeed: Math.round(currentSpeed),
            averageSpeed: Math.round(averageSpeed),
            eta: Math.round(eta),
            successful: this._state.successfulDownloads.length,
            failed: this._state.failedDownloads.length,
            elapsedTime: Math.round(totalElapsed),
        };
    },

    /**
     * Force emit progress update
     *
     * @param {Function} [callback] - Optional user callback
     * @returns {Object} Current progress data
     */
    emitProgress(callback?: (data: ProgressData) => void): ProgressData {
        const now = Date.now();
        const progressData = this._calculateProgress(now);

        // Emit DOM event — guarded, see `_emitProgressIfNeeded`.
        if (typeof document !== "undefined") {
            document.dispatchEvent(
                new CustomEvent("geoleaf:cache:progress", {
                    detail: progressData,
                })
            );
        }

        // Call user callback
        if (callback) {
            try {
                callback(progressData);
            } catch (error: unknown) {
                Log.error("[ProgressTracker] Callback error:", error);
            }
        }

        return progressData;
    },

    getSummary() {
        const now = Date.now();
        const start = this._state.startTime ?? now;
        const duration = now - start;

        return {
            duration: Math.round(duration),
            completed: this._state.completed,
            total: this._state.total,
            successful: this._state.successfulDownloads.length,
            failed: this._state.failedDownloads.length,
            totalSize: this._state.downloadedSize,
            // Guarded like `_calculateProgress` does: a summary requested in the same
            // millisecond as `init()` gave `duration === 0`, so this yielded Infinity —
            // or NaN with nothing downloaded — and shipped it in the completion event.
            averageSpeed:
                duration > 0 ? Math.round(this._state.downloadedSize / (duration / 1000)) : 0,
            successfulDownloads: this._state.successfulDownloads,
            failedDownloads: this._state.failedDownloads,
            failedUrls: this._state.failedDownloads.map(
                (f: { url: string; error: string }) => f.url
            ),
        };
    },

    reset() {
        this._state = {
            startTime: null,
            lastUpdateTime: null,
            completed: 0,
            total: 0,
            downloadedSize: 0,
            estimatedTotalSize: 0,
            downloadedSinceLastUpdate: 0,
            successfulDownloads: [],
            failedDownloads: [],
        };
    },
};

export { ProgressTracker };
