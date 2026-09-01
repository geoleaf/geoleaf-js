/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview FetchManager - Handles HTTP fetching and response parsing
 * @version 3.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import { validateFetchUrl } from "./url-guard.js";

interface FetchResource {
    url: string;
    type: string;
    optional?: boolean;
}
interface FetchOptions {
    signal?: AbortSignal;
}
interface FetchResult {
    data: unknown;
    size: number;
    metadata: Record<string, unknown>;
    skipped?: boolean;
}

const FetchManager = {
    /**
     * Fetch and parse a resource
     *
     * @param {Object} resource - Resource to fetch
     * @param {string} resource.url - Resource URL
     * @param {string} resource.type - Resource type (tile, icon, config, etc)
     * @param {boolean} [resource.optional=false] - Is optional
     * @param {Object} [options={}] - Fetch options
     * @param {AbortSignal} [options.signal] - Abort signal
     * @returns {Promise<Object>} Parsed resource with metadata
     * @throws {Error} If fetch fails (unless optional and 404)
     *
     * @example
     * const resource = {
     *   url: 'https://example.com/icon.svg',
     *   type: 'icon'
     * };
     * const result = await FetchManager.fetch(resource);
     * // result = { data, size, metadata }
     */
    async fetch(resource: FetchResource, options: FetchOptions = {}): Promise<FetchResult> {
        Log.debug(`[FetchManager] Fetching: ${resource.url}`);
        validateFetchUrl(resource.url);

        // 🛑 A CANCELLATION SIGNAL IS NOT A DEADLINE.
        //
        // This site passed for "already bounded" because it honours `options.signal`.
        // But that signal is the USER-CANCELLATION one (the download's "cancel"
        // button), it is passed CONDITIONALLY by `downloader.ts`, and it does not
        // exist when nobody cancels. In other words: the request stayed deadline-less
        // in the nominal case, i.e. exactly when a slow server hurts.
        //
        // `fetchBounded` CHAINS the two: the request dies on whichever falls first.
        // Cancellation stays immediate, and the deadline exists even without one.
        const response = await fetchBounded(resource.url, {
            // `RequestInit.signal` is `AbortSignal | null` in lib.dom — a target we cannot widen.
            // Coerce to the sentinel it already admits rather than thread `undefined` through.
            signal: options.signal ?? null,
        });

        // Handle non-OK responses
        if (!response.ok) {
            // Allow optional resources to fail gracefully
            if (resource.optional && response.status === 404) {
                Log.debug(`[FetchManager] Optional resource not found: ${resource.url}`);
                return {
                    data: null,
                    size: 0,
                    metadata: { status: 404, optional: true },
                    skipped: true,
                };
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Extract metadata from headers
        const metadata = this._extractMetadata(response);

        // Parse response based on type
        const { data, size } = await this._parseResponse(response, resource);

        Log.debug(`[FetchManager] ✓ ${resource.url} (${(size / 1024).toFixed(2)} KB)`);

        return {
            data,
            size,
            metadata,
        };
    },

    /**
     * Extract metadata from response headers
     *
     * @private
     * @param {Response} response - Fetch response
     * @returns {Object} Metadata object
     */
    _extractMetadata(response: Response): Record<string, unknown> {
        return {
            etag: response.headers.get("ETag"),
            lastModified: response.headers.get("Last-Modified"),
            contentType: response.headers.get("Content-Type"),
            contentLength: response.headers.get("Content-Length"),
            cacheControl: response.headers.get("Cache-Control"),
            fetchedAt: Date.now(),
        };
    },

    /**
     * Parse response based on resource type
     *
     * @private
     * @param {Response} response - Fetch response
     * @param {Object} resource - Resource descriptor
     * @returns {Promise<Object>} { data, size }
     */
    async _parseResponse(
        response: Response,
        resource: FetchResource
    ): Promise<{ data: unknown; size: number }> {
        const contentType = response.headers.get("content-type") || "";
        const url = resource.url.toLowerCase();

        // Binary payloads: raster/vector tiles (.pbf), glyph ranges (.pbf), sprite images (.png)
        if (
            resource.type === "tile" ||
            resource.type === "glyph" ||
            resource.type === "sprite-image"
        ) {
            return await this._parseTile(response);
        }

        // SVG: parse as text
        if (resource.type === "icon" || contentType.includes("image/svg") || url.endsWith(".svg")) {
            return await this._parseText(response);
        }

        // GPX/XML: parse as text
        if (
            url.endsWith(".gpx") ||
            contentType.includes("application/gpx") ||
            contentType.includes("xml")
        ) {
            return await this._parseText(response);
        }

        // JSON/GeoJSON: parse as JSON
        if (contentType.includes("json") || url.endsWith(".json") || url.endsWith(".geojson")) {
            return await this._parseJSON(response);
        }

        // Default: parse as text
        return await this._parseText(response);
    },

    /**
     * Parse tile as binary payload
     *
     * @private
     * @param {Response} response - Fetch response
     * @returns {Promise<Object>} { data: Object, size: number }
     */
    async _parseTile(
        response: Response
    ): Promise<{ data: { kind: string; buffer: ArrayBuffer; mimeType: string }; size: number }> {
        const blob = await response.blob();
        const size = blob.size;
        const buffer = await blob.arrayBuffer();

        return {
            data: {
                kind: "binary",
                buffer,
                mimeType:
                    blob.type || response.headers.get("content-type") || "application/octet-stream",
            },
            size,
        };
    },

    /**
     * Parse response as text
     *
     * @private
     * @param {Response} response - Fetch response
     * @returns {Promise<Object>} { data: string, size: number }
     */
    async _parseText(response: Response): Promise<{ data: string; size: number }> {
        const data = await response.text();
        const size = new Blob([data]).size;

        return { data, size };
    },

    /**
     * Parse response as JSON
     *
     * @private
     * @param {Response} response - Fetch response
     * @returns {Promise<Object>} { data: Object, size: number }
     */
    async _parseJSON(response: Response): Promise<{ data: unknown; size: number }> {
        const data = (await response.json()) as unknown;
        const size = new Blob([JSON.stringify(data)]).size;

        return { data, size };
    },

    /**
     * Fetch multiple resources in parallel with worker pool
     *
     * @param {Array<Object>} resources - Resources to fetch
     * @param {Object} options - Options
     * @param {number} [options.concurrency=10] - Number of concurrent workers
     * @param {AbortSignal} [options.signal] - Abort signal
     * @param {Function} [options.onResource] - Callback per resource (resource, result, error)
     * @returns {Promise<Array<Object>>} Fetch results
     *
     * @example
     * const results = await FetchManager.fetchAll(resources, {
     *   concurrency: 5,
     *   onResource: (resource, result, error) => {
     *     console.log(resource.url, result ? 'OK' : error);
     *   }
     * });
     */
    async fetchAll(
        resources: FetchResource[],
        options: {
            concurrency?: number;
            signal?: AbortSignal;
            onResource?: (r: FetchResource, result: FetchResult | null, error: unknown) => void;
        } = {}
    ) {
        const { concurrency = 10, signal, onResource } = options;
        const queue = [...resources];
        const results: Array<{ resource: FetchResource; result?: FetchResult; error?: unknown }> =
            [];
        const workers: Promise<void>[] = [];

        // Create worker pool
        for (let i = 0; i < concurrency; i++) {
            workers.push(this._worker(queue, results, signal, onResource));
        }

        // Wait for all workers
        await Promise.all(workers);

        return results;
    },

    /**
     * Worker that processes fetch queue
     *
     * @private
     * @param {Array<Object>} queue - Resource queue (mutated)
     * @param {Array<Object>} results - Results array (mutated)
     * @param {AbortSignal} [signal] - Abort signal
     * @param {Function} [onResource] - Resource callback
     */
    async _worker(
        queue: FetchResource[],
        results: Array<{ resource: FetchResource; result?: FetchResult; error?: unknown }>,
        signal?: AbortSignal,
        onResource?: (r: FetchResource, result: FetchResult | null, error: unknown) => void
    ) {
        while (queue.length > 0) {
            // Check abort
            if (signal?.aborted) {
                Log.debug("[FetchManager] Worker stopped (aborted)");
                break;
            }

            const resource = queue.shift();
            if (!resource) break;

            let result: FetchResult | null = null;
            let error: unknown = null;

            try {
                result = await this.fetch(resource, { ...(signal && { signal }) });
                results.push({ resource, result });
            } catch (err) {
                error = err;
                results.push({ resource, error });
            }

            if (onResource) {
                try {
                    onResource(resource, result, error);
                } catch (cbError: unknown) {
                    Log.error("[FetchManager] Callback error:", cbError);
                }
            }
        }
    },

    /**
     * Check if resource has been modified (using ETag/Last-Modified)
     *
     * @param {string} url - Resource URL
     * @param {Object} cachedMetadata - Cached metadata
     * @param {Object} [options={}] - Options
     * @param {AbortSignal} [options.signal] - Abort signal
     * @returns {Promise<boolean>} True if modified
     */
    async isModified(
        url: string,
        cachedMetadata: { etag?: string | null; lastModified?: string | null },
        options: { signal?: AbortSignal } = {}
    ): Promise<boolean> {
        validateFetchUrl(url);
        try {
            // Same reason as above: the cancellation signal bounds nothing when absent.
            const response = await fetchBounded(
                url,
                { method: "HEAD", signal: options.signal ?? null },
                8000
            );

            if (!response.ok) {
                return true; // Assume modified if HEAD fails
            }

            const currentEtag = response.headers.get("ETag");
            const currentLastModified = response.headers.get("Last-Modified");

            // Compare ETags
            if (cachedMetadata.etag && currentEtag) {
                return cachedMetadata.etag !== currentEtag;
            }

            // Compare Last-Modified
            if (cachedMetadata.lastModified && currentLastModified) {
                return cachedMetadata.lastModified !== currentLastModified;
            }

            // Can't determine, assume modified
            return true;
        } catch (error: unknown) {
            Log.warn(`[FetchManager] Failed to check if modified: ${url}`, error);
            return false; // Keep cached version on error
        }
    },
};

export { FetchManager };
