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
 * unreachable (CAPACITÉS S1 / backlog B.6). Measured under fake-indexeddb; the spec has
 * `getAll(false)` throw `DataError`, which a browser may additionally do.
 *
 * The unit mock never surfaced any of it — it compares keys with `===`.
 *
 * The PUBLIC surface stays boolean: {@link ImageUploadStatus} takes `uploaded: boolean`
 * and the flag is converted on write, so `plugin-addpoi` is unaffected.
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
 * ⚠️ CE QUE LA TÂCHE 3.13 A RETIRÉ D'ICI, ET CE QU'ELLE A GARDÉ — la mesure a scindé une
 * ligne d'inventaire qui annonçait « chaîne des images locales, 0 appelant, à supprimer ».
 *
 * **Retiré** : `getLocalImage(id)`. Son unique consommateur était
 * `addpoi/image-upload.ts` → `getLocalImageUrl()`, lui-même redondant : `storeImageLocally`
 * écrit AUSSI une data-URL base64 dans la donnée du POI, « so images display in popups/panels
 * without IndexedDB retrieval ». Deux chemins de lecture pour un rôle, dont un jamais pris.
 *
 * 🛑 **Gardé, et le pari a été tenu — mais pas par le sprint annoncé.** Le motif du 3.13 était
 * que le PRODUCTEUR (`storeImageLocally`, réparé à 3.6 : le blob et `uploaded: 0`) est vivant,
 * et que retirer ses lecteurs ferait deux dégâts :
 *
 *   1. `storeImageLocally` deviendrait **write-only** — des octets écrits que plus rien ne
 *      pourrait relire, soit un compteur C2 ouvert à la place d'un C1 ;
 *   2. le store `local_images` n'aurait **plus aucune purge**, alors qu'un écrivain vivant
 *      l'alimente. C'est la même erreur que retirer le pré-contrôle de quota parce que sa
 *      coquille était morte, et sur un appareil de terrain le quota décide de tout.
 *
 * ⚠️ **CE BLOC A DIT « les quatre n'ont pas d'appelant de production » et « les quatre sont
 * RÉSERVÉS AU SPRINT 4 (4.5), avec `addpoi/image-upload.ts` → `retryPendingUploads()` »
 * JUSQU'AU 08/08/2026 — trois énoncés, aucun encore vrai.** ① Le Sprint 4 s'est **clos le
 * 05/08 sans eux** : 4.5 n'a jamais câblé cette chaîne. ② C'est le **Sprint 5** qui l'a rendue
 * vivante, sous un autre nom et dans un autre paquet —
 * `editor/persistence/image-store.ts` → `retryPendingImages()`, armé par `initImageUpload()`.
 * ③ `addpoi` **n'existe plus** (fusionné dans `editor`, Sprint 5).
 *
 * **État mesuré le 08/08/2026** — et c'est là que le dégât n° 2 s'était réalisé par l'autre bout :
 *
 * | Membre | Atteignable par |
 * | --- | --- |
 * | `getPendingImages` · `updateImageUploadStatus` | `editor` (`retryPendingImages`), **câblés** |
 * | `deleteLocalImage` | relayé sur `GeoLeaf.Storage.DB` — **surface publique**, pas du mort |
 * | `cleanUploadedImages` | **0 appelant, 0 relais, 0 exposition** jusqu'au 08/08 — la purge existait et personne ne pouvait l'appeler (**B-190**) |
 *
 * Le relais manquant est posé, et `retryPendingImages` appelle la purge après chaque
 * acquittement. Le pari du 3.13 tient donc — mais il a fallu trois clôtures de sprint pour
 * que quelqu'un vérifie qu'il tenait.
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
