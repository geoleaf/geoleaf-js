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
 *   - Per-URL request headers from a plugin's hook (`__GEOLEAF_WORKER_HEADERS_HOOK__`), which
 *     may answer with a promise — see `WorkerHeadersHook` below
 *   - A Worker URL the host sets (`setWorkerUrl`, public as `GeoLeaf.GeoJSON.setWorkerUrl`),
 *     read at every construction; by default the script next to the bundle
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

/** Per-URL request headers a plugin attaches to the worker's requests — plain, cloneable data. */
type WorkerHeaders = Record<string, string>;

/** What the core tells the header hook it can take. */
interface WorkerHeadersHookCapabilities {
    /** The hook may answer with a promise: the request is posted once it settles. */
    readonly acceptsPromise: true;
}

/**
 * The hook a plugin sets on `globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__` to authenticate the
 * worker's requests — the connector does — without the core ever importing it.
 *
 * ⚠️ **It may answer with a promise, and the core says so in `capabilities`.** It was read
 * synchronously, right before `postMessage`: a token provider that answers asynchronously — an
 * identity SDK — could not reach the worker, and a GeoJSON layer loaded by URL left without its
 * token. A hook should answer with a promise only when told: a core that predates the argument
 * hands the answer straight to `postMessage`, which cannot clone a promise.
 */
type WorkerHeadersHook = (
    url: string,
    capabilities?: WorkerHeadersHookCapabilities
) => WorkerHeaders | undefined | PromiseLike<WorkerHeaders | undefined>;

/** Passed to every hook call — frozen, one instance. */
const HOOK_CAPABILITIES: WorkerHeadersHookCapabilities = Object.freeze({ acceptsPromise: true });

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
 * The Worker URL a host set through {@link WorkerManager.setWorkerUrl}, or `null` for the
 * default (`_scriptBase` + {@link WORKER_FILENAME}).
 *
 * ⚠️ Read at EVERY construction, never captured: the default is computed once, when this module
 * loads, but a host only knows its own URL — the one carrying its content token (`?v=`) — once
 * the bundle has loaded. The worker is also rebuilt after its idle teardown, and that rebuild must
 * see a URL set in between.
 */
let _workerUrlOverride: string | null = null;

/** The URL the next Worker is built from: the host's, else the one next to the bundle. */
function _resolveWorkerUrl(): string {
    return _workerUrlOverride ?? _scriptBase + WORKER_FILENAME;
}

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
        // The host's URL when it set one; otherwise resolved relative to the GeoLeaf script
        // (not the page HTML).
        const workerUrl = _resolveWorkerUrl();
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

/** True for anything a `then` can be chained on — a promise, or any other thenable. */
function _isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { then?: unknown }).then === "function"
    );
}

/**
 * Asks the plugin's hook for `url`'s headers, then posts through `post` — at once when the hook
 * answers synchronously, as it always did; once settled when it answers with a promise.
 *
 * - No hook, or a hook that throws or rejects: posted WITHOUT headers. The request still goes —
 *   whether it is authorised is the server's answer, not the hook's.
 * - A deferred post happens only if `entry` is still the one pending for `layerId`. `dispose()`
 *   and a worker error clear the pending map (and reject the entry); a newer load of the same
 *   layer replaces it — that one is rejected here, instead of never settling.
 * - A deferred post that throws — an answer `postMessage` cannot clone — rejects the load
 *   instead of leaving it pending.
 *
 * ⚠️ The hook's promise is not bounded in time, symmetrically with the page's `fetch`, whose
 * token provider is not bounded either: a provider that never answers holds its load.
 */
function _postWithHookHeaders(
    url: string,
    layerId: string,
    entry: PendingEntry,
    post: (headers: WorkerHeaders | undefined) => void
): void {
    const hook = (globalThis as { __GEOLEAF_WORKER_HEADERS_HOOK__?: WorkerHeadersHook })
        .__GEOLEAF_WORKER_HEADERS_HOOK__;
    let answer: ReturnType<WorkerHeadersHook> = undefined;
    try {
        answer = typeof hook === "function" ? hook(url, HOOK_CAPABILITIES) : undefined;
    } catch (err: unknown) {
        getLog().warn(
            "[WorkerManager] Header hook threw — the request goes without its headers:",
            err instanceof Error ? err.message : err
        );
    }
    if (!_isThenable(answer)) {
        post(answer as WorkerHeaders | undefined);
        return;
    }

    const postDeferred = (headers: WorkerHeaders | undefined): void => {
        if (_state.pending.get(layerId) !== entry) {
            // Superseded by a newer load of this layer, or already settled by `dispose()` or a
            // worker error — rejecting an already rejected promise is a no-op.
            entry.reject(new Error("Superseded before its request was sent"));
            return;
        }
        try {
            post(headers);
        } catch (err: unknown) {
            _state.pending.delete(layerId);
            entry.reject(err instanceof Error ? err : new Error(String(err)));
        }
    };
    Promise.resolve(answer).then(
        (headers) => postDeferred(headers ?? undefined),
        (err: unknown) => {
            getLog().warn(
                "[WorkerManager] Header hook rejected — the request goes without its headers:",
                err instanceof Error ? err.message : err
            );
            postDeferred(undefined);
        }
    );
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
        err.message || err.filename || "unknown (possible 404 on " + _resolveWorkerUrl() + ")";
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
     *
     * The worker's request carries the headers a plugin's hook
     * (`__GEOLEAF_WORKER_HEADERS_HOOK__`) gives for `url`; when the hook answers with a promise,
     * the request leaves once it settles.
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
            const entry: PendingEntry = {
                resolve: resolve,
                reject: reject,
                features: [],
                onChunk: options.onChunk || null,
            };
            _state.pending.set(layerId, entry);

            // Auth headers from a plugin's hook (the connector's), synchronous or not.
            _postWithHookHeaders(absoluteUrl, layerId, entry, function (headers) {
                worker.postMessage({
                    type: "fetch",
                    url: absoluteUrl,
                    layerId: layerId,
                    chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
                    headers: headers,
                });
                _resetIdleTimer();
            });
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
     *
     * Same headers hook as {@link WorkerManager.fetchGeoJSON}.
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
            const entry: PendingEntry = {
                resolve: resolve,
                reject: reject,
                features: [], // unused for text, kept for consistency
                onChunk: null,
            };
            _state.pending.set(layerId, entry);

            // Auth headers from a plugin's hook (the connector's), synchronous or not.
            _postWithHookHeaders(absoluteUrl, layerId, entry, function (headers) {
                worker.postMessage({
                    type: "fetch-text",
                    url: absoluteUrl,
                    layerId: layerId,
                    headers: headers,
                });
                _resetIdleTimer();
            });
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
     * Sets the URL the Worker is built from; `null` restores the default, next to the bundle.
     *
     * Applies to the NEXT construction: a Worker already running keeps its script until it is
     * torn down (idle timeout, `dispose()`, or an error). A URL set here survives `dispose()` —
     * it is configuration, not state. Setting one also clears an earlier failure: a Worker error
     * had sent every later load to the main thread, and a new URL is a new attempt.
     *
     * @param url - A non-empty URL — resolved by the browser against the page, as `new Worker`
     *   does — or `null`.
     * @throws {TypeError} For any other value.
     */
    setWorkerUrl: function (url: string | null): void {
        if (url !== null && (typeof url !== "string" || url.trim() === "")) {
            throw new TypeError(
                "[GeoLeaf.GeoJSON] setWorkerUrl() expects a non-empty string, or null to " +
                    "restore the default."
            );
        }
        _workerUrlOverride = url;
        _state.workerAvailable = true;
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
