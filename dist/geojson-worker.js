/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * GeoLeaf GeoJSON Web Worker
 * Executes fetch + JSON parse off the main thread.
 *
 * Protocole de messages :
 *   → { type: "fetch", url, layerId, chunkSize }
 *   ← { type: "chunk",    layerId, features: [...], index, total }
 *   ← { type: "done",     layerId, featureCount }
 *   ← { type: "error",    layerId, message }
 *
 * When the Service Worker (core or full) is registered, the requests
 * fetch() requests here will be intercepted by the SW cache-first strategy.
 *
 * Version: 3.0.0
 */
// Worker globals (self, postMessage, importScripts…) are provided via the
// `**/geojson-worker.ts` override in eslint.config.mjs. The legacy
// `/* eslint-env worker */` directive is unsupported in flat config (error in ESLint 10).
"use strict";
/** Default chunk size (number of features per message) */
const DEFAULT_CHUNK_SIZE = 500;
/** Allowed protocols for fetch requests */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
/**
 * Validates a URL before handing it to fetch().
 * Blocks dangerous protocols (javascript:, data:, file:, blob:, etc.).
 *
 * @param {string} url - URL to validate
 * @returns {string} Validated URL
 * @throws {Error} When the URL is invalid or uses a forbidden protocol
 */
function validateWorkerUrl(url) {
    if (!url || typeof url !== "string") {
        throw new Error("URL must be a non-empty string");
    }
    const trimmed = url.trim();
    // Relative URLs are allowed (resolved against worker origin).
    // This includes paths starting with /, ./, ../ OR bare relative paths (e.g. "profiles/tourism/...").
    // A relative URL has no protocol separator "://" so it cannot contain a dangerous scheme.
    if (!trimmed.includes("://")) {
        return trimmed;
    }
    try {
        const parsed = new URL(trimmed);
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
            throw new Error('Protocol "' +
                parsed.protocol +
                '" not allowed. Only http: and https: are permitted.');
        }
        return parsed.href;
    }
    catch (e) {
        throw new Error("Invalid URL: " + (e instanceof Error ? e.message : String(e)), {
            cause: e,
        });
    }
}
function _normalizeFeatures(data) {
    const d = data;
    if (d?.type === "FeatureCollection" && Array.isArray(d.features))
        return d.features;
    if (d?.type === "Feature")
        return [d];
    if (Array.isArray(data))
        return data;
    return Array.isArray(d?.features) ? d.features : [];
}
/**
 * Handles a "fetch" message: downloads, parses and returns the data in chunks.
 *
 * @param {Object} msg - Received message data
 */
async function handleFetch(msg) {
    const { url, layerId, chunkSize } = msg;
    const size = typeof chunkSize === "number" && chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE;
    try {
        const validatedUrl = validateWorkerUrl(url);
        const response = await fetch(validatedUrl, msg.headers ? { headers: msg.headers } : undefined);
        if (!response.ok) {
            throw new Error("HTTP " + response.status + " for " + url);
        }
        const data = await response.json();
        // Normaliser en FeatureCollection
        const features = _normalizeFeatures(data);
        const total = features.length;
        // Send the features in chunks so postMessage never blocks
        for (let i = 0; i < total; i += size) {
            const chunk = features.slice(i, i + size);
            self.postMessage({
                type: "chunk",
                layerId: layerId,
                features: chunk,
                index: Math.floor(i / size),
                total: total,
            });
        }
        // Signal de fin
        self.postMessage({
            type: "done",
            layerId: layerId,
            featureCount: total,
        });
    }
    catch (err) {
        self.postMessage({
            type: "error",
            layerId: layerId,
            message: (err instanceof Error ? err.message : String(err)) || String(err),
        });
    }
}
/**
 * Handles a "fetch-text" message: downloads a text file (e.g. GPX) and returns it.
 * Perf 6.3.1: off-load the GPX network call to the Worker — DOMParser parsing stays on the main thread.
 *
 * @param {Object} msg - Received message data
 */
async function handleFetchText(msg) {
    const { url, layerId } = msg;
    try {
        const validatedUrl = validateWorkerUrl(url);
        const response = await fetch(validatedUrl, msg.headers ? { headers: msg.headers } : undefined);
        if (!response.ok) {
            throw new Error("HTTP " + response.status + " for " + url);
        }
        const text = await response.text();
        self.postMessage({
            type: "text-done",
            layerId: layerId,
            text: text,
        });
    }
    catch (err) {
        self.postMessage({
            type: "error",
            layerId: layerId,
            message: (err instanceof Error ? err.message : String(err)) || String(err),
        });
    }
}
/**
 * Listnsur de messages main.
 */
self.onmessage = function (event) {
    const msg = event.data;
    if (!msg || !msg.type)
        return;
    switch (msg.type) {
        case "fetch":
            // Both handlers wrap their whole body in try/catch and report failures via
            // `self.postMessage({ type: "error", … })`, so they cannot reject. A message
            // dispatcher has nothing to await either — the reply travels by postMessage.
            void handleFetch(msg);
            break;
        case "fetch-text":
            // Perf 6.3.1: Fetch GPX text off-thread (see the note above on `void`)
            void handleFetchText(msg);
            break;
        case "ping":
            self.postMessage({ type: "pong" });
            break;
        default:
            self.postMessage({
                type: "error",
                layerId: msg.layerId || null,
                message: "Type de message inconnu : " + msg.type,
            });
    }
};
