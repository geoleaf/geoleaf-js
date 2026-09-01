/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description GeoJSON layer cache management in IndexedDB.
 * Extracted from indexeddb.js (Phase 6 - Modularisation v3)
 *
 * Responsibilities:
 * - Caching GeoJSON layers
 * - Retrieving layers from cache
 * - Removing individual layers
 * - Removing layers by profile
 * - Managing cache metadata (ETag, Last-Modified)
 */

import { Log } from "../../../utils/log/index.js";

interface LayerMetadata {
    etag?: string | null;
    lastModified?: string | null;
    /**
     * As produced by `FetchManager._extractMetadata`, i.e. `response.headers.get(…)`:
     * a STRING when the header is present, `null` when it is not. Declared as such
     * rather than as `number` — `cacheLayer` is the place that coerces it, and the
     * type has to say what callers really hand over, not what the store ends up with.
     */
    contentLength?: string | number | null;
    contentType?: string | null;
    /** Content nature; see {@link LAYER_RESOURCE_TYPES}. An unknown value is legal and means "non-binary". */
    resourceType?: LayerResourceType | (string & {}) | null;
}

/** Binary wrapper produced by FetchManager for tiles/glyphs/sprite images. */
interface BinaryWrapper {
    kind: "binary";
    buffer: ArrayBuffer;
    mimeType?: string;
}

/**
 * Binary resource types whose raw bytes are worth gzipping in IndexedDB.
 * The 0.92 ratio guard in `_maybeCompressBinary` rejects already-compressed
 * payloads (e.g. PNG), which are then stored as the raw wrapper.
 */
/**
 * The content natures the `layers` store RECOGNISES — named in one place.
 *
 * 🛑 A RESIDUE TO FIX, NOT TO DELETE. The store mixes configs, icons, layers, tiles,
 * styles, glyphs, sprite images and sprite JSON; the field was a FREE string of which
 * only three values were actually read, and the set was written nowhere — hence
 * neither re-readable nor enforceable.
 *
 * ⚠️ BUT A **CLOSED** UNION WOULD BE A LYING TYPE, and I wrote it before measuring.
 * Two producers derive the value from a PROFILE field — `resource-enumerator.ts`
 * writes `layerConfig.type || "geojson"` and `layer.type || "data"` — and no schema
 * constrains `layer.type`. A profile setting `"wms"` would thus produce a legal value
 * the union refuses, without `tsc` even able to see it: the value crosses the facade
 * as `Record<string, unknown>`. A closed set here would be decorative at best, false
 * at worst.
 *
 * ⚠️ My first survey was biased the same way: `grep 'type: "…"'` only sees literals
 * and missed precisely the two fallbacks. Sixth instrument bias of the file.
 *
 * The real gesture is therefore: **name the recognised set**, DERIVE the binary set
 * from it instead of copying it, and state plainly that an unknown value is legal
 * and means "non-binary". That is what will make the **by-nature** eviction the sync
 * contract requires (`lru` / `never` classes) possible: it needs a RECOGNISED set,
 * not a closed one.
 *
 * Re-derivable:
 *   grep -hoE 'type: (\"[a-z-]+\"|[A-Za-z.]+ \|\| \"[a-z]+\")' src/capabilities/offline/cache/*.ts | sort -u
 */
const LAYER_RESOURCE_TYPES = {
    config: "text",
    data: "text",
    geojson: "text",
    glyph: "binary",
    icon: "text",
    layer: "text",
    "sprite-image": "binary",
    "sprite-json": "text",
    style: "text",
    tile: "binary",
} as const;

/** A recognised nature. ⚠️ The stored field also accepts an unknown value — see above. */
type LayerResourceType = keyof typeof LAYER_RESOURCE_TYPES;

/**
 * Natures stored as gzipped binary — **computed** from the table above.
 *
 * 🛑 It was `new Set(["tile", "glyph", "sprite-image"])`: a literal list facing
 * ANOTHER literal list, which no line confronted. Renaming a nature on one side let
 * the other keep compiling **while guarding nothing any more** — the exact shape of
 * the empty guard, on a compression decision.
 *
 * Here the nature CARRIES its storage mode, and the set is computed. There are no
 * longer two truths to keep aligned; there is one, and it is the table. This is also
 * what will make **by-nature** eviction (the contract's `lru` / `never` classes)
 * possible: it needs a property carried by the nature, not a second set to maintain.
 */
const BINARY_GZIP_TYPES: ReadonlySet<string> = new Set(
    Object.entries(LAYER_RESOURCE_TYPES)
        .filter(([, storage]) => storage === "binary")
        .map(([nature]) => nature)
);

interface CompressionResult {
    data: string | ArrayBuffer | object;
    storedSize: number;
    originalSize: number;
    compressed: boolean;
    encoding: string | null;
    dataType: string | null;
    mimeType: string | null;
}

interface LayerRecord {
    id: string;
    profileId: string;
    data: string | ArrayBuffer | object;
    timestamp: number;
    size: number;
    originalSize?: number;
    etag?: string | null;
    lastModified?: string | null;
    contentLength?: number;
    contentType?: string | null;
    /** Content nature; see {@link LAYER_RESOURCE_TYPES}. An unknown value is legal and means "non-binary". */
    resourceType?: LayerResourceType | (string & {}) | null;
    dataCompressed?: boolean;
    dataEncoding?: string | null;
    dataType?: string | null;
    dataMimeType?: string | null;
}

/**
 * The cached-layers store of the offline database — layer payloads kept for offline reads.
 *
 * One of the IndexedDB sub-modules, wired by `init()` with the shared database handle. It is
 * the only store that compresses: the `_maybeCompress*` members are deliberately *maybe*, as
 * compression is skipped when the runtime lacks support (`_supportsCompression`) or when the
 * payload would not benefit (`_isCompressibleResource` — already-compressed binaries, small
 * records). Reads go back through `_maybeDecompressRecord`, so a caller never has to know
 * whether a given record was stored compressed.
 */
export interface LayersDBInstance {
    _db: IDBDatabase | null;
    /** Wires the IndexedDB handle and returns the module API (consumed by _ensureModule). */
    init(db: IDBDatabase): LayersDBInstance;
    _supportsCompression(): boolean;
    _estimateDataSize(data: string | ArrayBuffer | ArrayBufferView | Blob | object): number;
    _isCompressibleResource(data: string | object, metadata?: LayerMetadata): boolean;
    _maybeCompressData(
        data: string | ArrayBuffer | object,
        metadata?: LayerMetadata
    ): Promise<CompressionResult>;
    _maybeCompressBinary(
        wrapper: BinaryWrapper,
        metadata?: LayerMetadata
    ): Promise<CompressionResult>;
    _maybeDecompressRecord(record: LayerRecord | null): Promise<LayerRecord | null>;
    cacheLayer(
        id: string,
        data: string | ArrayBuffer | object,
        profileId: string,
        metadata?: LayerMetadata
    ): Promise<void>;
    getLayer(id: string): Promise<LayerRecord | null>;
    removeLayer(id: string): Promise<void>;
    getLayersByProfile(profileId: string): Promise<LayerRecord[]>;
    clearProfile(profileId: string): Promise<number>;
}

/**
 * @class LayersDB
 * @description Layer cache manager for IndexedDB
 */
const LayersDB: LayersDBInstance = {
    _db: null,

    init: function (db: IDBDatabase) {
        this._db = db;
        Log.debug("[LayersDB] Module initialized");
        // Return the module API so IndexedDB._ensureModule stores it (returning void
        // left _modules.Layers undefined → layer compat methods were silent no-ops).
        return this;
    },

    _supportsCompression: function (): boolean {
        return (
            typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined"
        );
    },

    _estimateDataSize: function (
        data: string | ArrayBuffer | ArrayBufferView | Blob | object
    ): number {
        if (typeof data === "string") {
            return new Blob([data]).size;
        }

        if (data instanceof ArrayBuffer) {
            return data.byteLength;
        }

        if (ArrayBuffer.isView(data)) {
            return data.byteLength;
        }

        if (data instanceof Blob) {
            return data.size;
        }

        try {
            return new Blob([JSON.stringify(data)]).size;
        } catch (error) {
            Log.debug(
                "[LayersDB] Failed to estimate data size:",
                (error as Error)?.message || error
            );
            return 0;
        }
    },

    _isCompressibleResource: function (
        data: string | object,
        metadata: LayerMetadata = {}
    ): boolean {
        // Binary payloads (vector tiles .pbf, glyph .pbf, sprite .png) arrive as a
        // { kind:"binary", buffer } wrapper. Gzip the raw bytes only for the
        // allowlisted types; the ratio guard handles already-compressed formats.
        if (data && typeof data === "object" && (data as { kind?: string }).kind === "binary") {
            return BINARY_GZIP_TYPES.has(String(metadata.resourceType));
        }

        if (metadata.resourceType === "tile") {
            return false;
        }

        if (!(typeof data === "string" || (data && typeof data === "object"))) {
            return false;
        }

        const contentType = String(metadata.contentType || "").toLowerCase();

        if (!contentType) {
            return true;
        }

        return (
            contentType.includes("json") ||
            contentType.includes("text/") ||
            contentType.includes("xml") ||
            contentType.includes("svg") ||
            contentType.includes("javascript") ||
            contentType.includes("css")
        );
    },

    _maybeCompressData: async function (
        data: string | ArrayBuffer | object,
        metadata: LayerMetadata = {}
    ): Promise<CompressionResult> {
        // Binary payloads arrive as { kind:"binary", buffer, mimeType } from FetchManager.
        if (
            data &&
            typeof data === "object" &&
            (data as { kind?: string }).kind === "binary" &&
            (data as { buffer?: unknown }).buffer instanceof ArrayBuffer
        ) {
            return this._maybeCompressBinary(data as BinaryWrapper, metadata);
        }

        const originalSize = this._estimateDataSize(data);

        if (
            !this._supportsCompression() ||
            !this._isCompressibleResource(data, metadata) ||
            originalSize < 4096
        ) {
            return {
                data,
                storedSize: originalSize,
                originalSize,
                compressed: false,
                encoding: null,
                dataType: null,
                mimeType: null,
            };
        }

        const dataType = typeof data === "string" ? "text" : "json";
        const mimeType =
            dataType === "json" ? "application/json" : metadata.contentType || "text/plain";
        const payload: string = dataType === "json" ? JSON.stringify(data) : (data as string);

        try {
            const compressedBuffer = await new Response(
                new Blob([payload]).stream().pipeThrough(new CompressionStream("gzip"))
            ).arrayBuffer();

            if (compressedBuffer.byteLength >= originalSize * 0.92) {
                return {
                    data,
                    storedSize: originalSize,
                    originalSize,
                    compressed: false,
                    encoding: null,
                    dataType: null,
                    mimeType: null,
                };
            }

            return {
                data: compressedBuffer,
                storedSize: compressedBuffer.byteLength,
                originalSize,
                compressed: true,
                encoding: "gzip",
                dataType,
                mimeType,
            };
        } catch (error) {
            Log.debug("[LayersDB] Compression skipped:", (error as Error)?.message || error);
            return {
                data,
                storedSize: originalSize,
                originalSize,
                compressed: false,
                encoding: null,
                dataType: null,
                mimeType: null,
            };
        }
    },

    /**
     * Gzips the raw bytes of a binary wrapper for the allowlisted resource types.
     * Returns the original wrapper untouched when compression is unavailable, the
     * payload is small, or gzip saves less than 8% (already-compressed formats),
     * so the Service Worker's binary branch can serve it as-is.
     */
    _maybeCompressBinary: async function (
        wrapper: BinaryWrapper,
        metadata: LayerMetadata = {}
    ): Promise<CompressionResult> {
        const buffer = wrapper.buffer;
        const originalSize = buffer.byteLength;
        const mimeType = wrapper.mimeType || metadata.contentType || "application/octet-stream";

        const uncompressed = (): CompressionResult => ({
            data: wrapper,
            storedSize: originalSize,
            originalSize,
            compressed: false,
            encoding: null,
            dataType: "binary",
            mimeType,
        });

        if (
            !this._supportsCompression() ||
            !this._isCompressibleResource(wrapper, metadata) ||
            originalSize < 4096
        ) {
            return uncompressed();
        }

        try {
            const compressedBuffer = await new Response(
                new Blob([buffer]).stream().pipeThrough(new CompressionStream("gzip"))
            ).arrayBuffer();

            // Abort if gzip saves less than 8% (e.g. PNG is already DEFLATE-compressed).
            if (compressedBuffer.byteLength >= originalSize * 0.92) {
                return uncompressed();
            }

            return {
                data: compressedBuffer,
                storedSize: compressedBuffer.byteLength,
                originalSize,
                compressed: true,
                encoding: "gzip",
                dataType: "binary",
                mimeType,
            };
        } catch (error) {
            Log.debug("[LayersDB] Binary compression skipped:", (error as Error)?.message || error);
            return uncompressed();
        }
    },

    _maybeDecompressRecord: async function (
        record: LayerRecord | null
    ): Promise<LayerRecord | null> {
        if (!record?.dataCompressed) {
            return record;
        }

        if (!this._supportsCompression() || !(record.data instanceof ArrayBuffer)) {
            return record;
        }

        try {
            const decompressedBuffer = await new Response(
                new Blob([record.data])
                    .stream()
                    .pipeThrough(
                        new DecompressionStream(
                            (record.dataEncoding || "gzip") as "gzip" | "deflate"
                        )
                    )
            ).arrayBuffer();

            // Binary records (tiles/glyphs/sprite images) must NOT be text-decoded:
            // rebuild the wrapper so getLayer returns the same shape that was cached.
            if (record.dataType === "binary") {
                return {
                    ...record,
                    data: {
                        kind: "binary",
                        buffer: decompressedBuffer,
                        mimeType:
                            record.dataMimeType || record.contentType || "application/octet-stream",
                    },
                };
            }

            const text = new TextDecoder().decode(decompressedBuffer);
            const decompressedData =
                record.dataType === "json" ? (JSON.parse(text) as object) : text;

            return {
                ...record,
                data: decompressedData,
            };
        } catch (error) {
            // `record` stays guarded — only the dead `Log &&` half is dropped.
            if (record)
                Log.warn(
                    `[LayersDB] Failed to decompress record ${record.id}: ${(error as Error)?.message || error}`
                );
            return record;
        }
    },

    /**
     * Caches a GeoJSON/data layer
     *
     * @param {string} id - Unique layer identifier
     * @param {Object} data - Data to cache
     * @param {string} profileId - Owner profile ID
     * @param {Object} [metadata] - Optional metadata (etag, lastModified, contentLength)
     * @returns {Promise<void>}
     * @example
     * await LayersDB.cacheLayer('tourism_pois', geojsonData, 'tourism', {
     *   etag: '"abc123"',
     *   lastModified: 'Wed, 15 Dec 2025 12:00:00 GMT'
     * });
     */
    cacheLayer: async function (
        id: string,
        data: string | ArrayBuffer | object,
        profileId: string,
        metadata: LayerMetadata = {}
    ) {
        const db = this._db;
        if (!db) {
            throw new Error("[LayersDB] Database not initialized");
        }

        const compressionResult = await this._maybeCompressData(data, metadata);
        const size = compressionResult.storedSize;
        // Coercion point: `metadata.contentLength` arrives as the raw header STRING (or
        // null). The record field is a number, and downstream budget sums depend on it —
        // pinned end-to-end by `__tests__/capabilities/offline/content-length-persistence.test.js`.
        const contentLength =
            metadata.contentLength != null
                ? Number.parseInt(String(metadata.contentLength), 10)
                : compressionResult.originalSize;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["layers"], "readwrite");
            const store = transaction.objectStore("layers");

            const layerObject = {
                id: id,
                profileId: profileId,
                data: compressionResult.data,
                timestamp: Date.now(),
                size: size,
                originalSize: compressionResult.originalSize,
                // Metadata for cache validation
                etag: metadata.etag || null,
                lastModified: metadata.lastModified || null,
                contentLength: Number.isFinite(contentLength)
                    ? contentLength
                    : compressionResult.originalSize,
                contentType: metadata.contentType || null,
                resourceType: metadata.resourceType || null,
                dataCompressed: compressionResult.compressed,
                dataEncoding: compressionResult.encoding,
                dataType: compressionResult.dataType,
                dataMimeType: compressionResult.mimeType,
            };

            const request = store.put(layerObject);

            request.onsuccess = () => {
                const compressionInfo = compressionResult.compressed
                    ? `, compressed from ${(compressionResult.originalSize / 1024).toFixed(2)} KB`
                    : "";
                Log.debug(
                    `[LayersDB] Cached layer: ${id} (${(size / 1024).toFixed(2)} KB${compressionInfo})`
                );
                resolve();
            };

            request.onerror = () => {
                const err = request.error;
                const error = new Error(`[LayersDB] Failed to cache layer ${id}: ${err}`);
                Log.error(error.message);

                // Check if quota exceeded
                if (err && err.name === "QuotaExceededError") {
                    document.dispatchEvent(
                        new CustomEvent("geoleaf:storage:quota-exceeded", {
                            detail: { id, size },
                        })
                    );
                }

                reject(error);
            };
        });
    },

    /**
     * Retrieves a layer from cache
     *
     * @param {string} id - Layer identifier
     * @returns {Promise<Object|null>}
     * @example
     * const cached = await LayersDB.getLayer('tourism_pois');
     * if (cached) console.log(cached.data);
     */
    getLayer: async function (id: string): Promise<LayerRecord | null> {
        const db = this._db;
        if (!db) {
            throw new Error("[LayersDB] Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["layers"], "readonly");
            const store = transaction.objectStore("layers");
            const request = store.get(id);

            request.onsuccess = () => {
                if (!request.result) {
                    resolve(null);
                    return;
                }

                this._maybeDecompressRecord(request.result as LayerRecord | null)
                    .then((record) => {
                        // `record` stays guarded — only the dead `Log` half is dropped.
                        if (record) {
                            Log.debug(`[LayersDB] Retrieved layer from cache: ${id}`);
                        }
                        resolve(record || null);
                    })
                    .catch((error: unknown) => {
                        Log.warn(
                            `[LayersDB] Failed to decode layer ${id}: ${(error as Error)?.message || error}`
                        );
                        resolve((request.result || null) as LayerRecord | null);
                    });
            };

            request.onerror = () => {
                Log.error(`[LayersDB] Failed to get layer ${id}: ${request.error}`);
                reject(request.error);
            };
        });
    },

    /**
     * Removes a layer from cache
     *
     * @param {string} id - Layer identifier
     * @returns {Promise<void>}
     */
    removeLayer: async function (id: string) {
        const db = this._db;
        if (!db) {
            throw new Error("[LayersDB] Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["layers"], "readwrite");
            const store = transaction.objectStore("layers");
            const request = store.delete(id);

            request.onsuccess = () => {
                Log.debug(`[LayersDB] Removed layer: ${id}`);
                resolve();
            };

            request.onerror = () => {
                Log.error(`[LayersDB] Failed to remove layer ${id}: ${request.error}`);
                reject(request.error);
            };
        });
    },

    /**
     * Retrieves all layers for a profile
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<Array>}
     * @example
     * const layers = await LayersDB.getLayersByProfile('tourism');
     */
    getLayersByProfile: async function (profileId: string): Promise<LayerRecord[]> {
        const db = this._db;
        if (!db) {
            throw new Error("[LayersDB] Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["layers"], "readonly");
            const store = transaction.objectStore("layers");
            const index = store.index("profileId");
            const request = index.getAll(profileId);

            request.onsuccess = () => {
                Log.debug(
                    `[LayersDB] Retrieved ${request.result.length} layers for profile: ${profileId}`
                );
                resolve(request.result);
            };

            request.onerror = () => {
                Log.error(
                    `[LayersDB] Failed to get layers for profile ${profileId}: ${request.error}`
                );
                reject(request.error);
            };
        });
    },

    /**
     * Clears all layers for a profile
     *
     * @param {string} profileId - Profile ID
     * @returns {Promise<number>} Number of deleted layers
     */
    clearProfile: async function (profileId: string): Promise<number> {
        const db = this._db;
        if (!db) {
            throw new Error("[LayersDB] Database not initialized");
        }

        const layers = await this.getLayersByProfile(profileId);
        const totalLayers = layers.length;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["layers"], "readwrite");
            const store = transaction.objectStore("layers");

            let deleted = 0;
            let lastProgressUpdate = Date.now();

            layers.forEach((layer: LayerRecord) => {
                const request = store.delete(layer.id);
                request.onsuccess = () => {
                    deleted++;

                    // Emit a progress event every 500ms or every 100 files
                    const now = Date.now();
                    if (
                        now - lastProgressUpdate >= 500 ||
                        deleted % 100 === 0 ||
                        deleted === totalLayers
                    ) {
                        document.dispatchEvent(
                            new CustomEvent("geoleaf:cache:clear-progress", {
                                detail: {
                                    current: deleted,
                                    total: totalLayers,
                                    profileId: profileId,
                                },
                            })
                        );
                        lastProgressUpdate = now;
                    }
                };
            });

            transaction.oncomplete = () => {
                Log.info(`[LayersDB] Cleared ${deleted} layers from profile: ${profileId}`);
                resolve(deleted);
            };

            transaction.onerror = () => {
                Log.error(`[LayersDB] Failed to clear profile ${profileId}: ${transaction.error}`);
                reject(transaction.error);
            };
        });
    },
};

// Factory function for module initialization

// Module loaded — ESM namespace active
Log.debug("[LayersDB] Module loaded");

/**
 * Public name of the {@link LayersDB} module: the GeoJSON layer cache backed by the
 * `layers` object store — write with transparent gzip, read with transparent gunzip,
 * plus removal by id and by profile.
 *
 * Registered into {@link DBModulesRegistry} and reached through `IndexedDB` rather than
 * imported directly by callers.
 */
const DBLayers = LayersDB;

export { DBLayers };
