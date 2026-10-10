/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * A photo the store REFUSES AS A BLOB is kept as its bytes.
 *
 * WebKit refuses a `Blob` or a `File` in IndexedDB for an ephemeral session — a private tab is
 * one — and the refusal is deliberate (the engine's own commit says so). The write failed, the
 * editor fell back on a data-URL, and the base64 of the photo went back into the feature's
 * attribute: kept, but no longer something a later upload can reconcile.
 *
 * Measured against the real engine before this test was written: where the `Blob` is refused,
 * an `ArrayBuffer` is stored and read back identical. So the write is made in two steps — the
 * `Blob` first, and on its refusal the bytes with their type. No migration: a record written
 * before keeps its `blob`, and the readers accept both shapes.
 *
 * `fake-indexeddb` stores a `Blob` like any engine that accepts one, so the refusal is
 * simulated where it happens — on `put`, for a value carrying a `Blob`.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

const DB_NAME = "geoleaf-images-blob-refused-test";

describe("ImagesDB — a refused Blob is stored as its bytes", () => {
    let IndexedDB: any;
    let DBImages: any;
    let open: IDBDatabase[];

    const request = <T>(req: IDBRequest<T>): Promise<T> =>
        new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

    async function openDb(): Promise<IDBDatabase> {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = globalThis.indexedDB.open(DB_NAME, IndexedDB._dbVersion);
            req.onupgradeneeded = (event) => IndexedDB._upgradeDatabase(event);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        open.push(db);
        DBImages.init(db);
        return db;
    }

    const stored = (db: IDBDatabase, id: string): Promise<Record<string, unknown>> =>
        request(db.transaction(["local_images"], "readonly").objectStore("local_images").get(id));

    // ⚠️ `acceptBytes` is what a caller reading both shapes passes — the editor does. The
    // caller that does not is `blobOnly`, below.
    const photo = (id: string) => ({ ...blobOnly(id), acceptBytes: true });

    const blobOnly = (id: string) => ({
        id,
        blob: new Blob(["photo-bytes"], { type: "image/png" }),
        filename: `${id}.png`,
        type: "image/png",
        size: 11,
        endpoint: "https://backend.test/photos",
        fieldPath: "properties.photo",
    });

    /** Makes the engine refuse any value carrying a `Blob`, as WebKit does in a private tab. */
    function refuseBlobs(alsoBytes = false) {
        const put = IDBObjectStore.prototype.put;
        return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
            this: IDBObjectStore,
            value: Record<string, unknown>,
            key?: IDBValidKey
        ) {
            if (value?.blob instanceof Blob || (alsoBytes && value?.bytes)) {
                throw new DOMException(
                    "Error preparing Blob/File data to be stored in object store",
                    "UnknownError"
                );
            }
            return put.call(this, value, key);
        });
    }

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ DBImages } = await import("../../../src/capabilities/offline/db/images.js"));
    });

    beforeEach(() => {
        open = [];
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        for (const db of open) db.close();
        await new Promise<void>((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    // ⚠️ Judged on what the module WRITES, not on what this engine reads back: under
    // `fake-indexeddb` a stored `Blob` comes back as a plain object, which says nothing of a
    // browser.
    test("an accepted Blob is written as before — one shape, no bytes", async () => {
        await openDb();
        const put = vi.spyOn(IDBObjectStore.prototype, "put");
        await DBImages.storeImageLocally(photo("kept"));
        expect(put).toHaveBeenCalledTimes(1);
        const written = put.mock.calls[0]![0] as Record<string, unknown>;
        expect(written.blob).toBeInstanceOf(Blob);
        expect("bytes" in written).toBe(false);
    });

    test("🛑 a refused Blob is stored as its bytes, with everything else it carried", async () => {
        const db = await openDb();
        refuseBlobs();

        await DBImages.storeImageLocally(photo("private-tab"));

        const record = await stored(db, "private-tab");
        expect("blob" in record).toBe(false);
        expect(new TextDecoder().decode(record.bytes as ArrayBuffer)).toBe("photo-bytes");
        // The type travels with the bytes: it is what rebuilds a Blob the server accepts.
        expect(record.type).toBe("image/png");
        expect(record.endpoint).toBe("https://backend.test/photos");
        expect(record.fieldPath).toBe("properties.photo");
        expect(record.uploaded).toBe(0);
    });

    test("the request for bytes is not written into the record", async () => {
        const db = await openDb();
        refuseBlobs();
        await DBImages.storeImageLocally(photo("private-tab"));
        expect("acceptBytes" in (await stored(db, "private-tab"))).toBe(false);
    });

    // A caller written before the bytes existed reads `blob` alone. Handed a token for a
    // record kept as bytes, it could neither upload nor paint the photo; the rejection
    // leaves it the fallback it always had.
    test("🛑 a refused Blob is NOT kept as bytes for a caller that did not ask — it rejects, and nothing is written", async () => {
        const db = await openDb();
        refuseBlobs();

        await expect(DBImages.storeImageLocally(blobOnly("old-caller"))).rejects.toThrow(
            /ImagesDB/
        );
        expect(await stored(db, "old-caller")).toBeUndefined();
    });

    test("the photo kept as bytes is still PENDING — the retry finds it", async () => {
        await openDb();
        refuseBlobs();
        await DBImages.storeImageLocally(photo("private-tab"));
        vi.restoreAllMocks();

        const pending = await DBImages.getPendingImages();
        expect(pending.map((p: { id: string }) => p.id)).toEqual(["private-tab"]);
    });

    test("when the bytes are refused too, the write fails — the caller keeps its own fallback", async () => {
        await openDb();
        refuseBlobs(true);
        await expect(DBImages.storeImageLocally(photo("nowhere"))).rejects.toThrow(/ImagesDB/);
    });
});
