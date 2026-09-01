/**
 * Tests for src/db/ modules: layers, images, preferences, sync, backups
 * Uses an in-memory IDB mock to exercise IndexedDB operations without a real browser DB.
 */
"use strict";

import {
    CompressionStream as NodeCompressionStream,
    DecompressionStream as NodeDecompressionStream,
    ReadableStream as NodeReadableStream,
    WritableStream as NodeWritableStream,
    TransformStream as NodeTransformStream,
} from "node:stream/web";

// ─── In-memory IDB mock factory ──────────────────────────────────────────────

/**
 * Creates a minimal in-memory IndexedDB-like object.
 * Supports: put, add (auto-increment), get, delete, getAll, count,
 *           openCursor(), index(field).getAll(query), index(field).openCursor(query?)
 *
 * Index membership follows the SPEC: a record whose indexed field is not a valid key
 * (null / undefined / boolean) is in the store but NOT in the index.
 */
function makeIDB() {
    const stores = new Map(); // storeName → Map<key, value>
    const autoKeys = new Map(); // storeName → next int key

    function ensureStore(name) {
        if (!stores.has(name)) {
            stores.set(name, new Map());
            autoKeys.set(name, 0);
        }
        return stores.get(name);
    }

    /** Fires fn() asynchronously (next microtask) and returns a request-like object */
    function req(fn) {
        const r = { result: undefined, error: null, onsuccess: null, onerror: null };
        Promise.resolve().then(() => {
            try {
                r.result = fn();
                if (r.onsuccess) r.onsuccess({ target: r });
            } catch (e) {
                r.error = e;
                if (r.onerror) r.onerror({ target: r });
            }
        });
        return r;
    }

    /**
     * True when `value` is usable as an IndexedDB key. The spec allows number, string,
     * Date, ArrayBuffer/view and Array — NOT null, undefined or boolean.
     *
     * This matters: a record whose indexed field holds an invalid key still lands in the
     * store but NEVER enters the index. Modelling that is the difference between a mock
     * that validates code and one that validates a fiction (CAPACITÉS B.6, then B.9).
     */
    function isValidKey(value) {
        return (
            typeof value === "number" ||
            typeof value === "string" ||
            value instanceof Date ||
            value instanceof ArrayBuffer ||
            ArrayBuffer.isView(value) ||
            Array.isArray(value)
        );
    }

    /** Walks `entries` ([key, value] pairs) as an IDBCursorWithValue-like request. */
    function makeCursorRequest(sm, entries) {
        let i = 0;
        const r = { result: null, error: null, onsuccess: null, onerror: null };
        function advance() {
            Promise.resolve().then(() => {
                if (i < entries.length) {
                    const [pk, val] = entries[i++];
                    r.result = {
                        value: { ...val },
                        key: pk,
                        delete: () => sm.delete(pk),
                        continue: () => advance(),
                    };
                } else {
                    r.result = null;
                }
                if (r.onsuccess) r.onsuccess({ target: r });
            });
        }
        advance();
        return r;
    }

    function makeIndex(sm, field) {
        /** Index content: records whose indexed value is a valid key, nothing else. */
        const indexed = () => [...sm.entries()].filter(([, v]) => isValidKey(v[field]));
        return {
            getAll(queryVal) {
                return req(() => {
                    const arr = indexed().map(([, v]) => ({ ...v }));
                    return queryVal !== undefined ? arr.filter((v) => v[field] === queryVal) : arr;
                });
            },
            openCursor(queryVal) {
                const snapshot = indexed();
                const filtered =
                    queryVal !== undefined
                        ? snapshot.filter(([, v]) => v[field] === queryVal)
                        : snapshot;
                return makeCursorRequest(sm, filtered);
            },
        };
    }

    /**
     * `keyPath` of each store, mirrored from `db/indexeddb.ts` `_upgradeDatabase`.
     *
     * ⚠️ Named rather than guessed. The previous version inferred the key as
     * `item.id ?? item.key`, which happens to be right for three stores and wrong for the
     * two whose key is generated — and a mock that guesses the key strategy validates a
     * fiction, not the code. Re-derive with:
     *   sed -n '/_upgradeDatabase(/,/^    },$/p' src/capabilities/offline/db/indexeddb.ts \
     *     | grep createObjectStore
     */
    const KEY_PATHS = {
        layers: "id",
        preferences: "key",
        sync_queue: "id",
        metadata: "key",
        sync_backups: null, // autoIncrement, no inline key on the written record
        local_images: "id",
        features: null, // composite [layerId, localId] — not exercised here
        outbox: "seq", // autoIncrement; records are written without a `seq`
    };

    /** The record's own key for this store, or `undefined` when the store must mint one. */
    function inlineKey(name, item) {
        const path = Object.hasOwn(KEY_PATHS, name) ? KEY_PATHS[name] : "id";
        return path === null ? undefined : item[path];
    }

    function makeObjectStore(name) {
        const sm = ensureStore(name);
        return {
            put(item) {
                return req(() => {
                    const key = inlineKey(name, item);
                    sm.set(key ?? item.key, { ...item });
                    return key ?? item.key;
                });
            },
            /**
             * `add`, and the difference with `put` is the point.
             *
             * ⚠️ THIS MOCK USED TO MODEL `add` AS "autoIncrement, always" — it overwrote
             * `item.id` with an integer whatever the store was. That was written when the
             * only caller was `sync_backups`, and it silently made a fiction of any store
             * with an INLINE key. Task 3.10 moved `sync_queue` from `put` to `add`, and the
             * mock answered with an integer key instead of the minted one: six tests went
             * red on the instrument, not on the code.
             *
             * Real behaviour, now modelled: the key comes from the store's `keyPath` when
             * the record carries one, otherwise it is generated; and a key that already
             * exists REJECTS (`ConstraintError`) instead of overwriting. That rejection is
             * the whole reason a caller picks `add` over `put`.
             */
            add(item) {
                return req(() => {
                    const key = inlineKey(name, item);
                    if (key !== undefined) {
                        if (sm.has(key)) {
                            const err = new Error(`Key ${key} already exists`);
                            err.name = "ConstraintError";
                            throw err;
                        }
                        sm.set(key, { ...item });
                        return key;
                    }
                    const newKey = autoKeys.get(name) + 1;
                    autoKeys.set(name, newKey);
                    sm.set(newKey, { ...item, id: newKey });
                    return newKey;
                });
            },
            get(key) {
                return req(() => {
                    const v = sm.get(key);
                    return v != null ? { ...v } : undefined;
                });
            },
            delete(key) {
                return req(() => {
                    sm.delete(key);
                });
            },
            getAll() {
                return req(() => [...sm.values()].map((v) => ({ ...v })));
            },
            count() {
                return req(() => sm.size);
            },
            /** Store-level cursor: every record, indexable or not. */
            openCursor() {
                return makeCursorRequest(sm, [...sm.entries()]);
            },
            index(field) {
                return makeIndex(sm, field);
            },
        };
    }

    return {
        transaction(storeNames, _mode) {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            names.forEach((n) => ensureStore(n));
            const txn = {
                oncomplete: null,
                onerror: null,
                error: null,
                objectStore: (name) => makeObjectStore(name),
            };
            // oncomplete fires after microtasks (Promises) have settled
            setTimeout(() => {
                if (txn.oncomplete) txn.oncomplete();
            }, 20);
            return txn;
        },
    };
}

// ─── Mock navigator.storage ───────────────────────────────────────────────────

beforeAll(() => {
    Object.defineProperty(navigator, "storage", {
        get: () => ({
            estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 65536 }),
        }),
        configurable: true,
    });

    // Expose Node.js Web Stream APIs missing from jsdom, so that the compression path
    // in layers.ts (_maybeCompressData / _maybeDecompressRecord) is reachable.
    if (typeof CompressionStream === "undefined") {
        global.CompressionStream = NodeCompressionStream;
        global.DecompressionStream = NodeDecompressionStream;
        global.ReadableStream = NodeReadableStream;
        global.WritableStream = NodeWritableStream;
        global.TransformStream = NodeTransformStream;
    }
    // Response: unconditionally install a minimal mock that can drain a webStreams ReadableStream
    // into an ArrayBuffer. jsdom's built-in Response does not support webStreams ReadableStream
    // as a body, so the compression pipeline in layers.ts would silently fail otherwise.
    {
        const webReadableStream = NodeReadableStream;
        global.Response = class MockResponse {
            constructor(body) {
                this._body = body;
            }
            async arrayBuffer() {
                if (this._body instanceof webReadableStream) {
                    const reader = this._body.getReader();
                    const chunks = [];
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value)
                            chunks.push(
                                value instanceof Uint8Array ? value : new Uint8Array(value)
                            );
                    }
                    const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
                    const buf = new Uint8Array(totalLen);
                    let off = 0;
                    for (const c of chunks) {
                        buf.set(c, off);
                        off += c.byteLength;
                    }
                    return buf.buffer;
                }
                if (this._body instanceof ArrayBuffer) return this._body;
                const blob = this._body instanceof Blob ? this._body : new Blob([this._body || ""]);
                return blob.arrayBuffer();
            }
        };
    }

    // Polyfill Blob.prototype.stream() for jsdom (needed for .stream().pipeThrough(...))
    // jsdom's Blob has no stream() or arrayBuffer() — use FileReader instead.
    if (!Blob.prototype.stream) {
        Blob.prototype.stream = function () {
            const self = this;
            return new ReadableStream({
                start(controller) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        controller.enqueue(new Uint8Array(reader.result));
                        controller.close();
                    };
                    reader.onerror = () => controller.error(reader.error);
                    reader.readAsArrayBuffer(self);
                },
            });
        };
    }
});

// ─── DBLayers ─────────────────────────────────────────────────────────────────

import { DBLayers } from "../../../src/capabilities/offline/db/layers.js";

describe("DBLayers", () => {
    let db;

    beforeEach(() => {
        db = makeIDB();
        DBLayers.init(db);
    });

    test("throws when not initialized", async () => {
        DBLayers._db = null;
        await expect(DBLayers.getLayer("x")).rejects.toThrow("not initialized");
    });

    test("cacheLayer then getLayer returns the data", async () => {
        await DBLayers.cacheLayer("layer1", { features: [] }, "profile1");
        const result = await DBLayers.getLayer("layer1");
        expect(result).not.toBeNull();
        expect(result.id).toBe("layer1");
        expect(result.profileId).toBe("profile1");
    });

    test("getLayer returns null for unknown id", async () => {
        const result = await DBLayers.getLayer("nonexistent");
        expect(result).toBeNull();
    });

    test("removeLayer deletes the cached layer", async () => {
        await DBLayers.cacheLayer("layer2", { x: 1 }, "p1");
        await DBLayers.removeLayer("layer2");
        const result = await DBLayers.getLayer("layer2");
        expect(result).toBeNull();
    });

    test("getLayersByProfile returns only layers for the given profile", async () => {
        await DBLayers.cacheLayer("a", {}, "profile-A");
        await DBLayers.cacheLayer("b", {}, "profile-B");
        await DBLayers.cacheLayer("c", {}, "profile-A");
        const layers = await DBLayers.getLayersByProfile("profile-A");
        expect(layers.length).toBe(2);
        layers.forEach((l) => expect(l.profileId).toBe("profile-A"));
    });

    test("getLayersByProfile returns empty array for unknown profile", async () => {
        const layers = await DBLayers.getLayersByProfile("no-such-profile");
        expect(layers).toEqual([]);
    });

    test("clearProfile deletes all layers for the given profile", async () => {
        await DBLayers.cacheLayer("x1", { type: "FeatureCollection", features: [] }, "profile-X");
        await DBLayers.cacheLayer("x2", { type: "FeatureCollection", features: [] }, "profile-X");
        await DBLayers.cacheLayer("y1", { type: "FeatureCollection", features: [] }, "profile-Y");
        const deletedCount = await DBLayers.clearProfile("profile-X");
        expect(deletedCount).toBe(2);
        const remaining = await DBLayers.getLayersByProfile("profile-X");
        expect(remaining.length).toBe(0);
        // profile-Y should be untouched
        const profileY = await DBLayers.getLayersByProfile("profile-Y");
        expect(profileY.length).toBe(1);
    });

    test("clearProfile returns 0 for profile with no layers", async () => {
        const deletedCount = await DBLayers.clearProfile("empty-profile");
        expect(deletedCount).toBe(0);
    });

    // ── _isCompressibleResource branch coverage ──────────────────────────────

    test("_isCompressibleResource returns false for tile resources", () => {
        expect(DBLayers._isCompressibleResource({}, { resourceType: "tile" })).toBe(false);
    });

    test("_isCompressibleResource returns false for non-string/object data", () => {
        // null is not a string and not an object → false (covers the second guard branch)
        expect(DBLayers._isCompressibleResource(null, {})).toBe(false);
    });

    test("_isCompressibleResource returns true when contentType is empty", () => {
        // Covers the `!contentType → return true` branch
        expect(DBLayers._isCompressibleResource({ id: 1 }, {})).toBe(true);
    });

    test("_isCompressibleResource returns false for binary contentType", () => {
        // Covers the return-false path when contentType does not match any compressible type
        expect(DBLayers._isCompressibleResource({ id: 1 }, { contentType: "image/png" })).toBe(
            false
        );
    });

    // ── _estimateDataSize branch coverage ────────────────────────────────────

    test("_estimateDataSize handles string data", () => {
        expect(DBLayers._estimateDataSize("hello")).toBe(5);
    });

    test("_estimateDataSize handles ArrayBuffer", () => {
        const ab = new ArrayBuffer(100);
        expect(DBLayers._estimateDataSize(ab)).toBe(100);
    });

    test("_estimateDataSize handles ArrayBufferView (Uint8Array)", () => {
        const view = new Uint8Array(50);
        expect(DBLayers._estimateDataSize(view)).toBe(50);
    });

    test("_estimateDataSize handles Blob", () => {
        const blob = new Blob(["hello world"]);
        expect(DBLayers._estimateDataSize(blob)).toBe(11);
    });

    test("_estimateDataSize returns 0 for circular reference (JSON.stringify throws)", () => {
        // Covers the catch block returning 0
        const circular = {};
        circular.self = circular;
        expect(DBLayers._estimateDataSize(circular)).toBe(0);
    });

    test("cacheLayer with large JSON data exercises compression path", async () => {
        // Data > 4096 bytes triggers _maybeCompressData compression branch (CompressionStream)
        const largeData = {
            features: Array.from({ length: 300 }, (_, i) => ({
                id: `feature-${i}`,
                name: `Feature name number ${i} with some additional padding text to reach the minimum compression threshold`,
            })),
        };
        await expect(
            DBLayers.cacheLayer("large-layer", largeData, "profile1", {
                contentType: "application/json",
            })
        ).resolves.toBeUndefined();
        const result = await DBLayers.getLayer("large-layer");
        expect(result).not.toBeNull();
        // If CompressionStream is available, the data should be stored compressed
        if (result.dataCompressed) {
            // Decompressed data should be retrievable
            expect(result.data).toBeDefined();
        }
    });

    test("_maybeCompressData compresses large JSON when CompressionStream is available", async () => {
        // Data > 4096 bytes with compressible content type → compression path (lines 176+)
        const largePayload = {
            items: Array.from({ length: 300 }, (_, i) => ({
                id: i,
                text: `item ${i} content`.repeat(5),
            })),
        };
        const result = await DBLayers._maybeCompressData(largePayload, {
            contentType: "application/json",
        });
        expect(result).toHaveProperty("compressed");
        expect(result).toHaveProperty("data");
        if (result.compressed) {
            expect(result.data).toBeInstanceOf(ArrayBuffer);
            expect(result.encoding).toBe("gzip");
        }
    });

    test("_maybeDecompressRecord decompresses a compressed record", async () => {
        // Create a compressed record by first compressing data
        const largePayload = {
            items: Array.from({ length: 300 }, (_, i) => ({
                id: i,
                text: `item ${i} content`.repeat(5),
            })),
        };
        const compressionResult = await DBLayers._maybeCompressData(largePayload, {
            contentType: "application/json",
        });
        if (!compressionResult.compressed) {
            // CompressionStream not fully supported in this environment — skip decompression test
            return;
        }
        const fakeRecord = {
            id: "test-decompress",
            profileId: "p1",
            data: compressionResult.data,
            dataCompressed: true,
            dataEncoding: "gzip",
            dataType: "json",
            dataMimeType: "application/json",
            timestamp: Date.now(),
            size: compressionResult.storedSize,
            originalSize: compressionResult.originalSize,
        };
        const decompressed = await DBLayers._maybeDecompressRecord(fakeRecord);
        expect(decompressed).not.toBeNull();
        expect(decompressed.data).toBeDefined();
    });

    test("_maybeDecompressRecord returns record unchanged when data is not ArrayBuffer", async () => {
        // Covers line 230: !_supportsCompression || !(data instanceof ArrayBuffer) → return record
        const record = {
            id: "x",
            data: "string-data-not-arraybuffer",
            dataCompressed: true,
            dataEncoding: "gzip",
            dataType: "json",
            dataMimeType: "text/plain",
            timestamp: 0,
            size: 0,
            originalSize: 0,
            profileId: "p",
        };
        const result = await DBLayers._maybeDecompressRecord(record);
        expect(result).toBe(record); // returned unchanged
    });

    test("_maybeDecompressRecord returns record when decompression fails (catch branch)", async () => {
        // Covers lines 245-247: decompression fails on corrupted data → catch → return record
        // Use invalid/truncated gzip bytes so DecompressionStream throws during stream reading
        const badGzip = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        const fakeRecord = {
            id: "err-decomp",
            profileId: "p",
            data: badGzip,
            dataCompressed: true,
            dataEncoding: "gzip",
            dataType: "json",
            dataMimeType: "text/plain",
            timestamp: 0,
            size: 8,
            originalSize: 10,
        };
        // Should NOT throw — errors are caught internally and original record returned
        const result = await DBLayers._maybeDecompressRecord(fakeRecord);
        expect(result).not.toBeNull();
    });

    test("_maybeCompressData returns uncompressed when compression ratio not beneficial (line 187)", async () => {
        // Covers line 187: compressedBuffer.byteLength >= originalSize * 0.92 → return uncompressed
        // Use a passthrough CompressionStream so compressed size equals original
        const origCS = global.CompressionStream;
        global.CompressionStream = class {
            constructor() {
                const ts = new NodeTransformStream({
                    transform(chunk, ctrl) {
                        ctrl.enqueue(chunk);
                    },
                });
                this.readable = ts.readable;
                this.writable = ts.writable;
            }
        };
        // Use a large string (> 4096) that with passthrough stays at original size
        const largeString = "x".repeat(5000);
        const result = await DBLayers._maybeCompressData(largeString, {
            contentType: "text/plain",
        });
        // Passthrough: compressedSize = originalSize > 0.92 * originalSize → not compressed
        expect(result.compressed).toBe(false);
        global.CompressionStream = origCS;
    });

    test("_maybeCompressData catch branch when CompressionStream constructor throws (lines 208-210)", async () => {
        // Covers lines 208-210: CompressionStream throws → catch → return uncompressed
        const origCS = global.CompressionStream;
        global.CompressionStream = class {
            constructor() {
                throw new Error("mock compress error");
            }
        };
        // Large data ensures size check passes (> 4096 bytes)
        const largePayload = {
            items: Array.from({ length: 300 }, (_, i) => ({
                id: i,
                desc: `description for item ${i} with padding`,
            })),
        };
        const result = await DBLayers._maybeCompressData(largePayload, {
            contentType: "application/json",
        });
        expect(result.compressed).toBe(false);
        global.CompressionStream = origCS;
    });

    // ─── Binary gzip (S3 vector tiles / glyphs / sprite images) ─────────────

    /** Builds a compressible binary wrapper (repeated bytes gzip well). */
    function makeBinaryWrapper(byteLength, fill) {
        const buf = new Uint8Array(byteLength);
        for (let i = 0; i < byteLength; i++) buf[i] = fill ?? i % 7;
        return { kind: "binary", buffer: buf.buffer, mimeType: "application/x-protobuf" };
    }

    test("_isCompressibleResource allows binary tile/glyph/sprite-image wrappers", () => {
        const wrapper = makeBinaryWrapper(16);
        expect(DBLayers._isCompressibleResource(wrapper, { resourceType: "tile" })).toBe(true);
        expect(DBLayers._isCompressibleResource(wrapper, { resourceType: "glyph" })).toBe(true);
        expect(DBLayers._isCompressibleResource(wrapper, { resourceType: "sprite-image" })).toBe(
            true
        );
        // Non-binary resourceType "tile" (legacy) stays non-compressible.
        expect(DBLayers._isCompressibleResource("plain", { resourceType: "tile" })).toBe(false);
    });

    test("binary tile gzip round-trip is byte-identical", async () => {
        const wrapper = makeBinaryWrapper(8192);
        const original = new Uint8Array(wrapper.buffer.slice(0));

        const result = await DBLayers._maybeCompressData(wrapper, {
            resourceType: "tile",
            contentType: "application/x-protobuf",
        });
        expect(result.dataType).toBe("binary");

        if (!result.compressed) {
            // CompressionStream unavailable → wrapper kept as-is.
            expect(result.data).toBe(wrapper);
            return;
        }

        expect(result.data).toBeInstanceOf(ArrayBuffer);

        const record = {
            id: "tile-1",
            data: result.data,
            dataCompressed: true,
            dataEncoding: "gzip",
            dataType: "binary",
            contentType: "application/x-protobuf",
            dataMimeType: "application/x-protobuf",
        };
        const decoded = await DBLayers._maybeDecompressRecord(record);
        expect(decoded.data.kind).toBe("binary");

        const out = new Uint8Array(decoded.data.buffer);
        expect(out.length).toBe(original.length);
        expect(Array.from(out)).toEqual(Array.from(original));
    });

    test("incompressible binary (PNG-like) is stored as the raw wrapper", async () => {
        // High-entropy bytes do not gzip below the 0.92 guard → kept uncompressed.
        const buf = new Uint8Array(8192);
        if (globalThis.crypto?.getRandomValues) {
            // getRandomValues caps at 65536 bytes per call — fine for 8192.
            globalThis.crypto.getRandomValues(buf);
        } else {
            // xorshift fallback using high-order bits (LCG low bits are too regular).
            let seed = 0x9e3779b9;
            for (let i = 0; i < buf.length; i++) {
                seed ^= seed << 13;
                seed ^= seed >>> 17;
                seed ^= seed << 5;
                buf[i] = (seed >>> 16) & 0xff;
            }
        }
        const wrapper = { kind: "binary", buffer: buf.buffer, mimeType: "image/png" };

        const result = await DBLayers._maybeCompressData(wrapper, {
            resourceType: "sprite-image",
            contentType: "image/png",
        });
        expect(result.compressed).toBe(false);
        expect(result.dataType).toBe("binary");
        expect(result.data).toBe(wrapper);
    });
});

// ─── evictToQuota (db/eviction.ts) ────────────────────────────────────────────

import { evictToQuota } from "../../../src/capabilities/offline/db/eviction.js";

describe("evictToQuota", () => {
    let db;

    /** Writes a raw layer record with an explicit timestamp + size (bypasses cacheLayer). */
    function putRecord(id, profileId, timestamp, size) {
        return new Promise((resolve, reject) => {
            const store = db.transaction(["layers"], "readwrite").objectStore("layers");
            const r = store.put({ id, profileId, timestamp, size, data: "" });
            r.onsuccess = () => resolve();
            r.onerror = () => reject(r.error);
        });
    }

    /** Reads back the surviving record ids. */
    async function remainingIds() {
        const layers = await DBLayers.getLayersByProfile("p1");
        const layers2 = await DBLayers.getLayersByProfile("p2");
        return [...layers, ...layers2].map((r) => r.id).sort();
    }

    beforeEach(() => {
        db = makeIDB();
        DBLayers.init(db);
    });

    test("no-op when db is null/undefined", async () => {
        const r = await evictToQuota(null, 1000);
        expect(r).toEqual({ evicted: 0, freedBytes: 0, totalBefore: 0, totalAfter: 0 });
    });

    test("no-op when maxBytes is not a positive finite number", async () => {
        await putRecord("a", "p1", 1, 500);
        expect(await evictToQuota(db, 0)).toMatchObject({ evicted: 0 });
        expect(await evictToQuota(db, -100)).toMatchObject({ evicted: 0 });
        expect(await evictToQuota(db, Number.NaN)).toMatchObject({ evicted: 0 });
    });

    test("no-op when the cache already fits the budget", async () => {
        await putRecord("a", "p1", 1, 300);
        await putRecord("b", "p1", 2, 300);
        const r = await evictToQuota(db, 1000);
        expect(r.evicted).toBe(0);
        expect(r.totalBefore).toBe(600);
        expect(r.totalAfter).toBe(600);
    });

    test("evicts least-recently-cached records first until under budget", async () => {
        await putRecord("old", "p1", 100, 400); // oldest → evicted first
        await putRecord("mid", "p1", 200, 400);
        await putRecord("new", "p2", 300, 400); // newest → survives
        // Total 1200, budget 500 → must drop until ≤ 500: remove old (800), remove mid (400) ≤ 500
        const r = await evictToQuota(db, 500);
        expect(r.totalBefore).toBe(1200);
        expect(r.evicted).toBe(2);
        expect(r.freedBytes).toBe(800);
        expect(r.totalAfter).toBe(400);
        expect(await remainingIds()).toEqual(["new"]);
    });

    test("covers binary tile records (same store) and stops as soon as it fits", async () => {
        await putRecord("tile-z14-1", "p1", 10, 600); // oldest
        await putRecord("tile-z14-2", "p1", 20, 600);
        await putRecord("layer-geojson", "p2", 30, 600); // newest
        // Total 1800, budget 1300 → remove only the oldest (1200 ≤ 1300)
        const r = await evictToQuota(db, 1300);
        expect(r.evicted).toBe(1);
        expect(r.totalAfter).toBe(1200);
        expect(await remainingIds()).toEqual(["layer-geojson", "tile-z14-2"]);
    });
});

// ─── CacheMetrics.getCompressionStats — REMOVED ───────────────────────────────
//
// The method was purged with the 7 others of `cache/metrics.ts`: 0 production
// consumers. Its tests therefore leave with it.
//
// ⚠️ Worth noting for whoever reads the history: the fix —
// `getCompressionStats` walked the `profileId` index and thus missed
// unindexed records, exactly like `eviction.ts` — was applied to this method
// hours before its purge. The fix is not lost, it became MOOT: the defect's
// second site no longer exists. The first site stays fixed and covered
// (`eviction-unindexed.test.js`).

// ─── DBImages ────────────────────────────────────────────────────────────────

import { DBImages } from "../../../src/capabilities/offline/db/images.js";

describe("DBImages", () => {
    let db;

    beforeEach(() => {
        db = makeIDB();
        DBImages.init(db);
    });

    /**
     * Re-reads a record DIRECTLY from the store.
     *
     * ⚠️ Replaces `DBImages.getLocalImage(id)`, REMOVED: it had only one
     * consumer left, those very tests. A symbol only its tests use is dead,
     * and keeping it "because the tests use it" is exactly what the
     * test-orphan rule forbids — the test must change instrument, not
     * production carry a method for it.
     *
     * Reading the store is the right instrument here anyway: what is asserted
     * is what is PERSISTED, not what an accessor cares to say about it.
     */
    const readRaw = (id) =>
        new Promise((resolve, reject) => {
            const req = db
                .transaction(["local_images"], "readonly")
                .objectStore("local_images")
                .get(id);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });

    const baseImage = {
        id: "img1",
        blob: null,
        filename: "photo.jpg",
        type: "image/jpeg",
        size: 2048,
    };

    test("throws when not initialized", async () => {
        DBImages._db = null;
        await expect(DBImages.storeImageLocally(baseImage)).rejects.toThrow("not initialized");
    });

    test("storeImageLocally persists the record, pending", async () => {
        await DBImages.storeImageLocally(baseImage);
        const img = await readRaw("img1");
        expect(img).not.toBeNull();
        expect(img.id).toBe("img1");
        // 0, not false: booleans are not valid IndexedDB keys, so the flag is stored as
        // 0/1 to reach the `uploaded` index (CAPACITÉS S1 / B.6). The PUBLIC surface stays
        // boolean — see updateImageUploadStatus below. Real-engine coverage of this lives
        // in images-idb-keys.test.js; the mock here compares keys with `===` and cannot
        // see the class of bug that motivated the change.
        expect(img.uploaded).toBe(0);
    });

    test("getPendingImages returns only uploaded=false", async () => {
        await DBImages.storeImageLocally({ ...baseImage, id: "img-pending" });
        // Seed an "uploaded" image directly via a second storeImageLocally + updateStatus
        await DBImages.storeImageLocally({ ...baseImage, id: "img-done" });
        await DBImages.updateImageUploadStatus("img-done", { uploaded: true, url: "http://x" });
        const pending = await DBImages.getPendingImages();
        const ids = pending.map((i) => i.id);
        expect(ids).toContain("img-pending");
        expect(ids).not.toContain("img-done");
    });

    test("updateImageUploadStatus updates the record", async () => {
        await DBImages.storeImageLocally(baseImage);
        await DBImages.updateImageUploadStatus("img1", {
            uploaded: true,
            url: "https://example.com/photo.jpg",
        });
        const img = await readRaw("img1");
        // Boolean in (above), 0/1 out — the conversion is the point.
        expect(img.uploaded).toBe(1);
        expect(img.url).toBe("https://example.com/photo.jpg");
    });

    test("updateImageUploadStatus rejects for unknown id", async () => {
        await expect(
            DBImages.updateImageUploadStatus("no-such", { uploaded: true })
        ).rejects.toThrow("not found");
    });

    test("deleteLocalImage removes the image", async () => {
        await DBImages.storeImageLocally(baseImage);
        await DBImages.deleteLocalImage("img1");
        expect(await readRaw("img1")).toBeNull();
    });

    test("cleanUploadedImages deletes uploaded entries and returns count", async () => {
        await DBImages.storeImageLocally({ ...baseImage, id: "u1" });
        await DBImages.storeImageLocally({ ...baseImage, id: "u2" });
        await DBImages.storeImageLocally({ ...baseImage, id: "p1" }); // stays pending
        await DBImages.updateImageUploadStatus("u1", { uploaded: true });
        await DBImages.updateImageUploadStatus("u2", { uploaded: true });
        const count = await DBImages.cleanUploadedImages();
        expect(count).toBe(2);
        expect(await readRaw("p1")).not.toBeNull();
    });

    test("getImageStats returns correct totals", async () => {
        await DBImages.storeImageLocally({ ...baseImage, id: "i1", size: 100 });
        await DBImages.storeImageLocally({ ...baseImage, id: "i2", size: 200 });
        await DBImages.updateImageUploadStatus("i2", { uploaded: true });
        const stats = await DBImages.getImageStats();
        expect(stats.total).toBe(2);
        expect(stats.pending).toBe(1);
        expect(stats.uploaded).toBe(1);
        expect(stats.totalSize).toBe(300);
    });
});

// ─── DBPreferences ────────────────────────────────────────────────────────────

import { DBPreferences } from "../../../src/capabilities/offline/db/preferences.js";

describe("DBPreferences", () => {
    let pref;

    beforeEach(() => {
        const db = makeIDB();
        pref = DBPreferences.init(db);
    });

    test("init throws without db", () => {
        expect(() => DBPreferences.init(null)).toThrow("required");
    });

    test("setPreference then getPreference returns the value", async () => {
        await pref.setPreference("theme", "dark");
        const val = await pref.getPreference("theme");
        expect(val).toBe("dark");
    });

    test("getPreference returns defaultValue for missing key", async () => {
        const val = await pref.getPreference("missing", "fallback");
        expect(val).toBe("fallback");
    });

    test("getPreference returns null when key missing and no default", async () => {
        const val = await pref.getPreference("no-key");
        expect(val).toBeNull();
    });

    test("setPreference overwrites existing value", async () => {
        await pref.setPreference("color", "red");
        await pref.setPreference("color", "blue");
        expect(await pref.getPreference("color")).toBe("blue");
    });

    test("getStorageStats returns structured stats object", async () => {
        const stats = await pref.getStorageStats();
        expect(stats).toHaveProperty("used");
        expect(stats).toHaveProperty("quota");
        expect(stats).toHaveProperty("percentage");
        expect(stats).toHaveProperty("layersCount");
        // ⚠️ `syncQueueCount` leaves with its store. The two replacing it
        // count what the v4 cycle really writes — their absence was the defect.
        expect(stats).toHaveProperty("featuresCount");
        expect(stats).toHaveProperty("outboxCount");
        expect(stats).not.toHaveProperty("syncQueueCount");
        expect(typeof stats.used).toBe("number");
    });
});

// 🛑 The `DBSync` and `DBBackups` suites are REMOVED — their two modules
// (`db/sync.ts`, `db/backups.ts`) are deleted with the `sync_queue` and
// `sync_backups` stores. These are not weakened tests: their subject no
// longer exists, and keeping them would have failed the whole file's load on
// an unresolvable import.
