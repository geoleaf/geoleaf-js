/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf - ImagesDB Module
 * Version: 3.0.0
 *
 * Management of images stored locally in IndexedDB.
 * Allows storing pending upload images and managing their status.
 */

import { Log } from "../../../utils/log/index.js";

/**
 * What a caller hands in to store an image locally.
 *
 * 🛑 THE FOUR LAST FIELDS ARE THE RETURN ADDRESS, AND THEY WERE MISSING. `storeImageLocally`
 * rebuilt the record field by field from this shape, so `endpoint` — which the editor plugin
 * DID pass — was silently dropped, and its retry loop (`if (!img?.endpoint) continue`)
 * skipped every image forever: not one photo was ever re-uploaded. Nothing referenced the
 * entity either, so even a successful upload had nowhere to send the resulting URL back to.
 * A local image without a return address is a file nobody can ever finish delivering.
 */
interface LocalImageData {
    id: string;
    blob: Blob;
    filename: string;
    type: string;
    size: number;
    /**
     * Where to POST the file. `null` when the field declared no `uploadEndpoint`: the image
     * is then kept for display only and NEVER retried — a distinct state from "the endpoint
     * was lost", which must stay loud.
     */
    endpoint?: string | null;
    /** Layer the owning feature belongs to. */
    layerId?: string;
    /** Client identity of the owning feature, so the reconciling edit can find it. */
    localId?: string;
    /** Schema path of the field holding the token (e.g. `properties.photo_principale`). */
    fieldPath?: string;
}

/**
 * Stored flag for the `uploaded` index — `0` pending, `1` uploaded.
 *
 * ⚠️ NOT a boolean, and that is the whole point. IndexedDB valid keys are numbers,
 * strings, Dates, ArrayBuffers and Arrays — booleans are excluded by the spec. Records
 * written with `uploaded: false` therefore never entered the `uploaded` index, and the
 * failure was SILENT: `getPendingImages()` returned an empty list forever, so the
 * deferred upload found nothing to do and reported success while queued images piled up
 * unreachable. Measured under fake-indexeddb; the spec has
 * `getAll(false)` throw `DataError`, which a browser may additionally do.
 *
 * The unit mock never surfaced any of it — it compares keys with `===`.
 *
 * The PUBLIC surface stays boolean: {@link ImageUploadStatus} takes `uploaded: boolean`
 * and the flag is converted on write, so no CONSUMER of that surface is affected. (It named
 * the one consumer of the day until the 19/08/2026 — which made the guarantee look narrower
 * than it is: the conversion protects the surface, not a particular caller.)
 */
type UploadedFlag = 0 | 1;

interface LocalImageRecord {
    id: string;
    blob: Blob;
    filename: string;
    type: string;
    size: number;
    timestamp: number;
    uploaded: UploadedFlag;
    url: string | null;
    /** See {@link LocalImageData.endpoint}. `null` means "display only, never retry". */
    endpoint: string | null;
    /** See {@link LocalImageData.layerId}. */
    layerId: string | null;
    /** See {@link LocalImageData.localId}. */
    localId: string | null;
    /** See {@link LocalImageData.fieldPath}. */
    fieldPath: string | null;
}

/**
 * The feature a stored image belongs to — its return address.
 *
 * 🛑 WRITTEN AFTER THE FACT, AND IT HAS TO BE. A photo is captured while the form is open,
 * BEFORE the feature exists: off-network the client identity is only minted when the edit is
 * enqueued. So the image is stored first with the field path alone, and bound to its feature
 * at save time — without that second step the upload has nowhere to send the resulting URL,
 * which is exactly why the URL used to be thrown away.
 */
interface ImageOwner {
    layerId: string;
    localId: string;
}

interface ImageUploadStatus {
    /** Public surface stays boolean; stored as {@link UploadedFlag}. */
    uploaded: boolean;
    url?: string;
}

interface ImageStats {
    total: number;
    pending: number;
    uploaded: number;
    totalSize: number;
}

/**
 * The local-images store of the offline database — photos captured in the field before they
 * reach a server.
 *
 * One of the IndexedDB sub-modules, wired by `init()` with the shared database handle. Each
 * record carries an upload status, so `getPendingImages` is what a sync run consumes and
 * `cleanUploadedImages` is what reclaims space once the server has acknowledged them —
 * an image is never dropped on the strength of its age alone.
 */
/**
 * ⚠️ WHAT WAS REMOVED FROM HERE, AND WHAT WAS KEPT — measurement split an inventory
 * line that announced "local images chain, 0 callers, delete".
 *
 * **Removed on 08/08/2026, RESTORED on 04/09/2026 — and the removal's own motive is what
 * restored it.** `getLocalImage(id)` went because it was redundant with the base64 data-URL
 * `storeImageLocally` also wrote into the POI's data: two read paths for one role, one never
 * taken. That data-URL is now GONE — it was the defect, since it put the whole photo inside
 * the feature's attribute and shipped it to the server inside the create. With the value in
 * the attribute reduced to an opaque token, this read is no longer a second path: it is the
 * ONLY one, and without it `storeImageLocally` becomes exactly the write-only store the
 * paragraph below says must not exist.
 *
 * 🛑 **Kept, and the bet held — but not by the announced sprint.** The motive was
 * that the PRODUCER (`storeImageLocally`, repaired: the blob and `uploaded: 0`) is
 * alive, and that removing its readers would do two damages:
 *
 *   1. `storeImageLocally` would become **write-only** — written bytes nothing could
 *      re-read;
 *   2. the `local_images` store would have **no purge left**, while a live writer
 *      feeds it. Same error as removing the quota pre-check because its shell was
 *      dead, and on a field device the quota decides everything.
 *
 * ⚠️ **THIS BLOCK SAID "none of the four has a production caller" and "all four are
 * RESERVED for an upcoming batch, with `addpoi/image-upload.ts` →
 * `retryPendingUploads()`" UNTIL 08/08/2026 — three statements, none yet true.**
 * ① The targeted batch **closed on 05/08 without them**: nothing had wired that
 * chain. ② A LATER batch is what made it live, under another name and in another
 * package — `editor/persistence/image-store.ts` → `retryPendingImages()`, armed by
 * `initImageUpload()`. ③ `addpoi` **no longer exists** (merged into `editor`).
 *
 * **State measured on 08/08/2026** — and this is where damage no. 2 had happened
 * from the other end:
 *
 * | Member | Reachable through |
 * | --- | --- |
 * | `getPendingImages` · `updateImageUploadStatus` | `editor` (`retryPendingImages`), **wired** |
 * | `deleteLocalImage` | relayed on `GeoLeaf.Storage.DB` — **public surface**, not dead |
 * | `cleanUploadedImages` | **0 callers, 0 relay, 0 exposure** until 08/08 — the purge existed and nobody could call it — relay added since |
 *
 * The missing relay is in place, and `retryPendingImages` calls the purge after each
 * acknowledgement. The bet therefore holds — but it took three sprint closures for
 * someone to check that it did.
 */
export interface ImagesDBInstance {
    _db: IDBDatabase | null;
    /** Wires the IndexedDB handle and returns the module API (consumed by _ensureModule). */
    init(db: IDBDatabase): ImagesDBInstance;
    _ensureInitialized(): void;
    storeImageLocally(imageData: LocalImageData): Promise<void>;
    getLocalImage(id: string): Promise<LocalImageRecord | null>;
    getPendingImages(): Promise<LocalImageRecord[]>;
    updateImageUploadStatus(id: string, status: ImageUploadStatus): Promise<void>;
    bindLocalImage(id: string, owner: ImageOwner): Promise<void>;
    deleteLocalImage(id: string): Promise<void>;
    cleanUploadedImages(): Promise<number>;
    getImageStats(): Promise<ImageStats>;
}

/**
 * Local image management module in IndexedDB
 * @namespace GeoLeaf.Storage.DB.Images
 */
const ImagesDB: ImagesDBInstance = {
    _db: null,

    init(db: IDBDatabase) {
        if (!db) {
            throw new Error("[ImagesDB] Database instance is required");
        }
        this._db = db;
        Log.debug("[ImagesDB] Module initialized");
        // Return the module API so IndexedDB._ensureModule stores it (returning void
        // left _modules.Images undefined → image compat methods were silent no-ops).
        return this;
    },

    /**
     * Checks that the DB is initialized
     * @private
     * @throws {Error} If the DB is not initialized
     */
    _ensureInitialized(): void {
        if (!this._db) {
            throw new Error("[ImagesDB] Module not initialized. Call init() first.");
        }
    },

    /**
     * Stores an image locally for deferred upload
     *
     * @param {Object} imageData - Image data
     * @param {string} imageData.id - Unique image ID
     * @param {Blob} imageData.blob - Image blob
     * @param {string} imageData.filename - File name
     * @param {string} imageData.type - Type MIME
     * @param {number} imageData.size - Taille en octets
     * @param {string|null} [imageData.endpoint] - Upload target, `null` for display-only
     * @param {string} [imageData.layerId] - Layer of the owning feature
     * @param {string} [imageData.localId] - Client identity of the owning feature
     * @param {string} [imageData.fieldPath] - Schema path of the field holding the token
     * @returns {Promise<void>}
     */
    async storeImageLocally(imageData: LocalImageData) {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readwrite");
            const store = transaction.objectStore("local_images");

            const entry: LocalImageRecord = {
                id: imageData.id,
                blob: imageData.blob,
                filename: imageData.filename,
                type: imageData.type,
                size: imageData.size,
                timestamp: Date.now(),
                uploaded: 0 as UploadedFlag,
                url: null,
                // ⚠️ The return address. Rebuilding the record field by field is what dropped
                // it: these four are written EXPLICITLY so a caller passing them keeps them,
                // and `?? null` so an old caller that does not is still a valid record.
                endpoint: imageData.endpoint ?? null,
                layerId: imageData.layerId ?? null,
                localId: imageData.localId ?? null,
                fieldPath: imageData.fieldPath ?? null,
            };

            const request = store.put(entry);

            request.onsuccess = () => {
                Log.debug(`[ImagesDB] Stored local image: ${imageData.id}`);
                resolve();
            };

            request.onerror = () => {
                reject(new Error(`[ImagesDB] Failed to store image: ${request.error}`));
            };
        });
    },

    /**
     * Retrieves all images pending upload
     *
     * @returns {Promise<Array>} - List of non-uploaded images
     */
    async getPendingImages() {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readonly");
            const store = transaction.objectStore("local_images");
            const index = store.index("uploaded");
            // `0`, not `false`: a boolean is not a valid IndexedDB key (see UploadedFlag).
            const request = index.getAll(0);

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(new Error(`[ImagesDB] Failed to get pending images: ${request.error}`));
            };
        });
    },

    /**
     * Reads one stored image back.
     *
     * @param {string} id - Image ID
     * @returns {Promise<Object|null>} The record, or `null` when it is not there.
     */
    async getLocalImage(id: string) {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise<LocalImageRecord | null>((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readonly");
            const store = transaction.objectStore("local_images");
            const request = store.get(id);

            request.onsuccess = () => {
                resolve((request.result as LocalImageRecord | undefined) ?? null);
            };
            request.onerror = () => {
                reject(new Error(`[ImagesDB] Failed to read image: ${request.error}`));
            };
        });
    },

    /**
     * Binds a stored image to the feature that carries it.
     *
     * Idempotent and forgiving: an image the caller no longer knows about is a NO-OP, not an
     * error. The caller scans a form's values for tokens, and a token pointing at a record
     * already purged is an ordinary outcome, not a failure worth propagating into a save.
     *
     * @param {string} id - Image ID
     * @param {Object} owner - The feature the image belongs to
     * @param {string} owner.layerId - Layer of the feature
     * @param {string} owner.localId - Client identity of the feature
     * @returns {Promise<void>}
     */
    async bindLocalImage(id: string, owner: ImageOwner) {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readwrite");
            const store = transaction.objectStore("local_images");
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const entry = getRequest.result as LocalImageRecord | undefined;
                if (!entry) {
                    Log.debug(`[ImagesDB] bindLocalImage: unknown image, ignored: ${id}`);
                    resolve();
                    return;
                }
                entry.layerId = owner.layerId;
                entry.localId = owner.localId;

                const putRequest = store.put(entry);
                putRequest.onsuccess = () => {
                    Log.debug(`[ImagesDB] Bound image ${id} to ${owner.layerId}/${owner.localId}`);
                    resolve();
                };
                putRequest.onerror = () => {
                    reject(new Error(`[ImagesDB] Failed to bind image: ${putRequest.error}`));
                };
            };

            getRequest.onerror = () => {
                reject(new Error(`[ImagesDB] Failed to read image: ${getRequest.error}`));
            };
        });
    },

    /**
     * Updates the upload status of an image
     *
     * @param {string} id - Image ID
     * @param {Object} status - Status to update
     * @param {boolean} status.uploaded - Whether the image has been uploaded
     * @param {string} [status.url] - Server URL of the image
     * @returns {Promise<void>}
     */
    async updateImageUploadStatus(id: string, status: ImageUploadStatus) {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readwrite");
            const store = transaction.objectStore("local_images");
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const entry = getRequest.result as LocalImageRecord | undefined;
                if (!entry) {
                    reject(new Error(`[ImagesDB] Image not found: ${id}`));
                    return;
                }

                // Boolean in, UploadedFlag out — the index needs a valid key.
                entry.uploaded = status.uploaded ? 1 : 0;
                if (status.url) {
                    entry.url = status.url;
                }

                const putRequest = store.put(entry);

                putRequest.onsuccess = () => {
                    Log.debug(`[ImagesDB] Updated image upload status: ${id}`);
                    resolve();
                };

                putRequest.onerror = () => {
                    reject(
                        new Error(`[ImagesDB] Failed to update image status: ${putRequest.error}`)
                    );
                };
            };

            getRequest.onerror = () => {
                reject(new Error(`[ImagesDB] Failed to get image: ${getRequest.error}`));
            };
        });
    },

    /**
     * Deletes a local image
     *
     * @param {string} id - Image ID
     * @returns {Promise<void>}
     */
    async deleteLocalImage(id: string) {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readwrite");
            const store = transaction.objectStore("local_images");
            const request = store.delete(id);

            request.onsuccess = () => {
                Log.debug(`[ImagesDB] Deleted local image: ${id}`);
                resolve();
            };

            request.onerror = () => {
                reject(new Error(`[ImagesDB] Failed to delete image: ${request.error}`));
            };
        });
    },

    /**
     * Cleans up already-uploaded images
     *
     * @returns {Promise<number>} - Number of images deleted
     */
    async cleanUploadedImages() {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readwrite");
            const store = transaction.objectStore("local_images");
            const index = store.index("uploaded");
            // `1` = uploaded. Same key-validity reason as getPendingImages(). A bare key
            // rather than IDBKeyRange.only(1): equivalent to the engine, and it keeps the
            // unit mock — which compares queries with `===` — able to exercise this path.
            const request = index.openCursor(1);

            let deletedCount = 0;

            request.onsuccess = (event: Event) => {
                const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    if (deletedCount > 0) {
                        Log.info(`[ImagesDB] Cleaned ${deletedCount} uploaded images`);
                    }
                    resolve(deletedCount);
                }
            };

            request.onerror = () => {
                reject(new Error(`[ImagesDB] Failed to clean uploaded images: ${request.error}`));
            };
        });
    },

    /**
     * Gets statistics on stored images
     *
     * @returns {Promise<Object>} - Statistics (total, pending, uploaded, totalSize)
     */
    async getImageStats() {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readonly");
            const store = transaction.objectStore("local_images");
            const request = store.getAll();

            request.onsuccess = () => {
                const images = (request.result || []) as LocalImageRecord[];

                // Truthiness, deliberately: it reads both the legacy boolean records and
                // the migrated 0/1 flags, so stats stay right even if a record somehow
                // escaped the v3 migration.
                const stats: ImageStats = {
                    total: images.length,
                    pending: images.filter((img) => !img.uploaded).length,
                    uploaded: images.filter((img) => img.uploaded).length,
                    totalSize: images.reduce((sum, img) => sum + (img.size || 0), 0),
                };

                resolve(stats);
            };

            request.onerror = () => {
                reject(new Error(`[ImagesDB] Failed to get image stats: ${request.error}`));
            };
        });
    },
};

// Factory function for module initialization

Log.debug("[DB.Images] Module loaded");

const DBImages = ImagesDB;

export { DBImages };
