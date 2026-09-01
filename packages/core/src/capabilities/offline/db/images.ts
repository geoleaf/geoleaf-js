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

interface LocalImageData {
    id: string;
    blob: Blob;
    filename: string;
    type: string;
    size: number;
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
 * **Removed**: `getLocalImage(id)`. Its sole consumer was
 * `addpoi/image-upload.ts` → `getLocalImageUrl()`, itself redundant:
 * `storeImageLocally` ALSO writes a base64 data-URL into the POI's data, "so images
 * display in popups/panels without IndexedDB retrieval". Two read paths for one
 * role, one never taken.
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
    getPendingImages(): Promise<LocalImageRecord[]>;
    updateImageUploadStatus(id: string, status: ImageUploadStatus): Promise<void>;
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
     * @returns {Promise<void>}
     */
    async storeImageLocally(imageData: LocalImageData) {
        this._ensureInitialized();
        const db = this._db!;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["local_images"], "readwrite");
            const store = transaction.objectStore("local_images");

            const entry = {
                id: imageData.id,
                blob: imageData.blob,
                filename: imageData.filename,
                type: imageData.type,
                size: imageData.size,
                timestamp: Date.now(),
                uploaded: 0 as UploadedFlag,
                url: null,
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
