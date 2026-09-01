/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Worker Manager
 * Orchestrates the GeoJSON Web Worker lifecycle.
 *
 * Features :
 *   - Lazy creation of a single Worker (singleton)
 *   - Communication postMessage / onmessage
 *   - Transparent fallback to a main-thread fetch when the Worker is unavailable
 *   - Automatic Worker teardown after an idle delay
 */

import { getLog } from "../../utils/general/di-accessors.js";
import type { GeoJSONFeature } from "./geojson-types.js";

/** A FeatureCollection accumulated from Worker chunks. */
interface FetchedFeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
}

/** Per-layer pending request tracked while the Worker streams chunks. */
interface PendingEntry {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    features: GeoJSONFeature[];
    onChunk:
        ((features: GeoJSONFeature[] | undefined, index?: number, total?: number) => void) | null;
}

/** Internal manager state. */
interface WorkerManagerState {
    worker: Worker | null;
    workerAvailable: boolean;
    pending: Map<string, PendingEntry>;
    idleTimer: ReturnType<typeof setTimeout> | null;
    /**
     * Cancellation of the MAIN-THREAD fallbacks, carried by the manager's lifecycle.
     *
     * 🛑 `dispose()` already covered the Worker's requests — it rejects every
     * `pending` entry and `terminate()`s the worker. But **the two main-thread
     * fallbacks never enter `pending`**: `_mainThreadFetch()` and the text fallback
     * return a direct `fetch` promise. Their lifecycle owner **existed and ignored
     * them** — they survived `dispose()` and resolved in a dismantled caller.
     *
     * ⚠️ Set back to `null` by `dispose()`: an aborted `AbortController` is aborted
     * **for life**, and this manager is a **lazy singleton** — a `fetchGeoJSON()` after
     * `dispose()` recreates its worker and must be able to fall back again.
     */
    mainThreadController: AbortController | null;
}

/** Message payload received from the GeoJSON Worker. */
interface WorkerMessage {
    type: string;
    layerId?: string;
    features?: GeoJSONFeature[];
    index?: number;
    total?: number;
    text?: string;
    message?: string;
}

/** Optional connector hook returning per-URL auth headers. */
type WorkerHeadersHook = (url: string) => Record<string, string> | undefined;

/** Delay before an idle Worker is terminated (ms) */
const IDLE_TIMEOUT = 30000;

/** Chunk size sent to the Worker */
const DEFAULT_CHUNK_SIZE = 500;

/** Worker file name */
const WORKER_FILENAME = "geojson-worker.js";

/**
 * Detects the GeoLeaf bundle's base directory by scanning <script> tags.
 * Lets the Worker URL resolve relative to the bundle, not to the host HTML page.
 *
 * @returns {string} Base URL ending with '/' (e.g. "../dist" or "/assets/js/")
 * @private
 */
function _detectScriptBase() {
    // Method 1: document.currentScript (only available during synchronous script execution)
    const currentSrc =
        typeof document !== "undefined"
            ? (document.currentScript as { src?: string } | null)?.src
            : undefined;
    if (currentSrc) {
        return currentSrc.substring(0, currentSrc.lastIndexOf("/") + 1);
    }

    // Method 2: scan <script> tags looking for geoleaf*.js
    if (typeof document !== "undefined") {
        // Decreasing index kept: `for..of` does not walk backwards, and
        // `[...].reverse()` would allocate the collection for nothing while the loop
        // exits at the first match.
        const scripts = document.getElementsByTagName("script");
        for (let i = scripts.length - 1; i >= 0; i--) {
            const src = scripts[i]?.src || "";
            if (/geoleaf[\w.-]*\.js/i.test(src)) {
                return src.substring(0, src.lastIndexOf("/") + 1);
            }
        }
    }

    // Method 3: fallback — same directory as the page
    return "";
}

/** Base URL captured when the module loads */
const _scriptBase = _detectScriptBase();

/**
 * Internal manager state.
 * @private
 */
const _state: WorkerManagerState = {
    worker: null,
    workerAvailable: true,
    pending: new Map(),
    idleTimer: null,
    mainThreadController: null,
};

/** Returns the main-thread fallback signal, creating the controller on first need. */
function _mainThreadSignal(): AbortSignal | undefined {
    if (typeof AbortController !== "function") return undefined;
    _state.mainThreadController ??= new AbortController();
    return _state.mainThreadController.signal;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Attempts to create the Worker. Returns null when that is not possible.
 * @returns {Worker|null}
 * @private
 */
function _createWorker() {
    if (!_state.workerAvailable) return null;
    if (_state.worker) return _state.worker;

    try {
        // Resolve the Worker URL relative to the GeoLeaf script (not the page HTML)
        const workerUrl = _scriptBase + WORKER_FILENAME;
        const worker = new Worker(workerUrl);

        worker.onmessage = _onMessage;
        worker.onerror = _onError;

        _state.worker = worker;
        getLog().debug("[WorkerManager] Web Worker GeoJSON created:", workerUrl);
        return worker;
    } catch (err: unknown) {
        getLog().warn(
            "[WorkerManager] Unable to create Web Worker, main-thread fallback:",
            err instanceof Error ? err.message : err
        );
        _state.workerAvailable = false;
        return null;
    }
}

/**
 * Resets the idle timer.
 * @private
 */
function _resetIdleTimer() {
    if (_state.idleTimer) clearTimeout(_state.idleTimer);
    _state.idleTimer = setTimeout(() => {
        if (_state.pending.size === 0 && _state.worker) {
            _state.worker.terminate();
            _state.worker = null;
            getLog().debug("[WorkerManager] Worker terminated after inactivity");
        }
    }, IDLE_TIMEOUT);
}

// ─── Worker message handlers ────────────────────────────────────

/**
 * Handles messages received from the Worker.
 * @param {MessageEvent} event
 * @private
 */

function _onMessage(event: MessageEvent) {
    const msg = event.data as WorkerMessage | null | undefined;
    if (!msg || !msg.type) return;

    const layerId = msg.layerId ?? "";
    const entry = msg.layerId ? _state.pending.get(layerId) : null;

    switch (msg.type) {
        case "chunk":
            if (entry) {
                // Accumulate the features
                if (msg.features && msg.features.length) {
                    entry.features.push(...msg.features);
                }
                // Optional per-chunk callback (for progressive rendering)
                if (typeof entry.onChunk === "function") {
                    entry.onChunk(msg.features, msg.index, msg.total);
                }
            }
            break;

        case "done":
            if (entry) {
                _state.pending.delete(layerId);
                entry.resolve({
                    type: "FeatureCollection",
                    features: entry.features,
                } satisfies FetchedFeatureCollection);
                _resetIdleTimer();
            }
            break;

        case "text-done":
            // Perf 6.3.1: GPX text fetch completeed in Worker
            if (entry) {
                _state.pending.delete(layerId);
                entry.resolve(msg.text || "");
                _resetIdleTimer();
            }
            break;

        case "error":
            if (entry) {
                _state.pending.delete(layerId);
                entry.reject(new Error(msg.message));
                _resetIdleTimer();
            } else {
                getLog().warn("[WorkerManager] Worker error without layerId:", msg.message);
            }
            break;

        case "pong":
            getLog().debug("[WorkerManager] Worker pong received");
            break;
    }
}

/**
 * Global Worker error handler.
 * @param {ErrorEvent} err
 * @private
 */
function _onError(err: ErrorEvent) {
    const details =
        err.message ||
        err.filename ||
        "unknown (possible 404 on " + _scriptBase + WORKER_FILENAME + ")";
    getLog().error("[WorkerManager] Worker error:", details);
    // Reject every in-flight request → fall back to the main thread
    _state.pending.forEach(function (entry: PendingEntry) {
        entry.reject(new Error("Worker error: " + details));
    });
    _state.pending.clear();
    // Mark the Worker unavailable → subsequent calls take the fallback path
    _state.workerAvailable = false;
    if (_state.worker) {
        _state.worker.terminate();
        _state.worker = null;
    }
}

// ─── Fallback main-thread ───────────────────────────────────────

/**
 * Fallback: fetch + parse on the main thread.
 *
 * @param {string} url
 * @param {string} layerId
 * @returns {Promise<Object>} FeatureCollection
 * @private
 */
function _mainThreadFetch(url: string, layerId: string): Promise<unknown> {
    const Log = getLog();
    Log.debug("[WorkerManager] Main-thread fallback for:", layerId);

    const signal = _mainThreadSignal();
    return fetch(url, signal ? { signal } : undefined)
        .then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status + " for " + url);
            }
            return response.json();
        })
        .then(function (data: unknown) {
            // Normaliser
            const obj = data as { type?: string } | null;
            if (obj && obj.type === "FeatureCollection") return data;
            if (obj && obj.type === "Feature") {
                return { type: "FeatureCollection", features: [data] };
            }
            if (Array.isArray(data)) {
                return { type: "FeatureCollection", features: data };
            }
            return data;
        });
}

// ─── API public ───────────────────────────────────────────────

const WorkerManager = {
    /**
     * Fetches and parses GeoJSON through the Web Worker (or the main-thread fallback).
     *
     * @param {string} url - GeoJSON URL
     * @param {string} layerId - Unique layer id
     * @param {Object} [options={}]
     * @param {number} [options.chunkSize=500] - Number of features per chunk
     * @param {Function} [options.onChunk] - Callback(features[], chunkIndex, totalFeatures)
     * @returns {Promise<Object>} - Resolved with a complete FeatureCollection
     */
    fetchGeoJSON: function (
        url: string,
        layerId: string,
        options?: {
            chunkSize?: number;
            onChunk?: (
                features: GeoJSONFeature[] | undefined,
                index?: number,
                total?: number
            ) => void;
        }
    ): Promise<unknown> {
        options = options || {};

        // Resolve relative URLs to absolute before sending to the Worker.
        // The Worker resolves relative paths against its own location (dist/),
        // not the page URL — so we must pass an absolute URL.
        let absoluteUrl = url;
        if (typeof location !== "undefined" && url && !url.includes("://")) {
            try {
                absoluteUrl = new URL(url, location.href).href;
            } catch (_) {
                // keep original url if resolution fails
            }
        }

        const worker = _createWorker();

        if (!worker) {
            return _mainThreadFetch(absoluteUrl, layerId);
        }

        return new Promise(function (resolve, reject) {
            _state.pending.set(layerId, {
                resolve: resolve,
                reject: reject,
                features: [],
                onChunk: options.onChunk || null,
            });

            // Read connector auth headers if @geoleaf-plugins/connector is installed
            const _headersHook = (
                globalThis as { __GEOLEAF_WORKER_HEADERS_HOOK__?: WorkerHeadersHook }
            ).__GEOLEAF_WORKER_HEADERS_HOOK__;
            const headers: Record<string, string> | undefined =
                typeof _headersHook === "function" ? _headersHook(absoluteUrl) : undefined;

            worker.postMessage({
                type: "fetch",
                url: absoluteUrl,
                layerId: layerId,
                chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
                headers: headers,
            });

            _resetIdleTimer();
        });
    },

    /**
     * Fetches the raw text of a URL through the Web Worker (or the main-thread fallback).
     * Perf 6.3.1: Used for GPX files to offload network from the main thread.
     * Note: DOMParser parsing stays on the main thread — it is not available in every Worker.
     *
     * @param {string} url - Text file URL
     * @param {string} layerId - Unique layer id
     * @returns {Promise<string>} - Resolved with raw text
     */
    fetchText: function (url: string, layerId: string): Promise<unknown> {
        // Resolve relative URLs to absolute (same reason as fetchGeoJSON)
        let absoluteUrl = url;
        if (typeof location !== "undefined" && url && !url.includes("://")) {
            try {
                absoluteUrl = new URL(url, location.href).href;
            } catch (_) {
                /* invalid URL, use original */
            }
        }

        const worker = _createWorker();

        if (!worker) {
            // Main-thread fallback — same cancellation as `_mainThreadFetch`: this
            // path does not enter `_state.pending`, so `dispose()` did not see it.
            const signal = _mainThreadSignal();
            return fetch(absoluteUrl, signal ? { signal } : undefined).then(function (response) {
                if (!response.ok)
                    throw new Error("HTTP " + response.status + " for " + absoluteUrl);
                return response.text();
            });
        }

        return new Promise(function (resolve, reject) {
            _state.pending.set(layerId, {
                resolve: resolve,
                reject: reject,
                features: [], // unused for text, kept for consistency
                onChunk: null,
            });

            // Read connector auth headers if @geoleaf-plugins/connector is installed
            const _headersHook = (
                globalThis as { __GEOLEAF_WORKER_HEADERS_HOOK__?: WorkerHeadersHook }
            ).__GEOLEAF_WORKER_HEADERS_HOOK__;
            const headers: Record<string, string> | undefined =
                typeof _headersHook === "function" ? _headersHook(absoluteUrl) : undefined;

            worker.postMessage({
                type: "fetch-text",
                url: absoluteUrl,
                layerId: layerId,
                headers: headers,
            });

            _resetIdleTimer();
        });
    },

    /**
     * Checks whether the Web Worker is available.
     * @returns {boolean}
     */
    isAvailable: function () {
        return _state.workerAvailable && typeof Worker !== "undefined";
    },

    /**
     * Terminates the Worker and clears its state.
     * Called during application teardown.
     */
    dispose: function () {
        if (_state.idleTimer) clearTimeout(_state.idleTimer);
        _state.pending.forEach(function (entry: PendingEntry) {
            entry.reject(new Error("WorkerManager disposed"));
        });
        _state.pending.clear();
        // 🛑 The MAIN-THREAD fallbacks do not enter `pending`: the loop above does
        // not reach them. Without this line, a fallback `fetch` survives `dispose()`
        // and resolves in a dismantled caller. Set back to `null` — an aborted
        // controller is aborted for life, and this manager is a lazy singleton that
        // can serve again after `dispose()`.
        if (_state.mainThreadController) {
            _state.mainThreadController.abort();
            _state.mainThreadController = null;
        }
        if (_state.worker) {
            _state.worker.terminate();
            _state.worker = null;
        }
        getLog().debug("[WorkerManager] Disposed");
    },
};

export { WorkerManager };
