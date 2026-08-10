/**
 * Integration tests — ImagesDB against a REAL IndexedDB engine (CAPACITÉS S1 / B.6)
 *
 * The rest of the offline DB suite runs on a hand-rolled mock whose index lookup is a
 * plain `arr.filter(v => v[field] === queryVal)`. That mock accepts anything as a key, so
 * it validated a store that could not work in a browser: `local_images` records were
 * written with `uploaded: false`, and **a boolean is not a valid IndexedDB key** (the spec
 * allows number, string, Date, ArrayBuffer/view and Array).
 *
 * ⚠️ The failure mode is SILENT, not an exception — this was measured here, and it
 * corrects the first reading of the bug. A boolean-flagged record still lands in the
 * store, but never enters the index, so `getPendingImages()` returned an empty list
 * forever: the deferred upload found nothing to do and reported success while queued
 * images accumulated unreachable. (`index.getAll(false)` resolves to `[]` under
 * fake-indexeddb; the spec has it throw `DataError`, which a browser may well do — that
 * part is NOT reproduced here, so nothing below asserts it.)
 *
 * These tests use `fake-indexeddb`, which enforces real key validation.
 */

const DB_NAME = "geoleaf-images-keys-test";

describe("ImagesDB — real IndexedDB key semantics", () => {
    let IndexedDB;
    let DBImages;
    /** Every connection opened by a test, closed in afterEach — a live handle blocks deleteDatabase. */
    let open;

    function openRaw(version, onUpgrade) {
        return new Promise((resolve, reject) => {
            const req = globalThis.indexedDB.open(DB_NAME, version);
            req.onupgradeneeded = (event) => onUpgrade(event, req);
            req.onsuccess = () => {
                open.push(req.result);
                resolve(req.result);
            };
            req.onerror = () => reject(req.error);
        });
    }

    /** Opens at `version` through the production upgrade path. */
    const openAt = (version) => openRaw(version, (event) => IndexedDB._upgradeDatabase(event));

    function tx(db, mode = "readonly") {
        return db.transaction(["local_images"], mode).objectStore("local_images");
    }

    function request(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        // Deferred on purpose — the modules load AFTER fake-indexeddb installs
        // `globalThis.indexedDB`. `await import()` preserves that order exactly.
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ DBImages } = await import("../../../src/capabilities/offline/db/images.js"));
    });

    beforeEach(() => {
        open = [];
    });

    afterEach(async () => {
        // Close first: an open connection makes deleteDatabase fire `blocked` and hang.
        for (const db of open) db.close();
        await new Promise((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    const image = (id) => ({
        id,
        blob: new Blob(["x"]),
        filename: `${id}.jpg`,
        type: "image/jpeg",
        size: 1,
    });

    // ── The root cause, pinned so the trap stays documented ──

    test("a boolean flag keeps the record OUT of the index — the store still holds it", async () => {
        const db = await openAt(3);

        // Write the way v2 did, bypassing the module.
        const store = tx(db, "readwrite");
        store.put({ ...image("legacy"), timestamp: 1, uploaded: false, url: null });
        await new Promise((r) => (store.transaction.oncomplete = r));

        expect(await request(tx(db).getAll())).toHaveLength(1); // in the store…
        expect(await request(tx(db).index("uploaded").getAll())).toHaveLength(0); // …not in the index
    });

    test("a 0/1 flag DOES enter the index — the difference the fix relies on", async () => {
        const db = await openAt(3);

        const store = tx(db, "readwrite");
        store.put({ ...image("fixed"), timestamp: 1, uploaded: 0, url: null });
        await new Promise((r) => (store.transaction.oncomplete = r));

        expect(await request(tx(db).index("uploaded").getAll())).toHaveLength(1);
    });

    // ── The fix, through the module's own API ──

    test("getPendingImages() returns freshly stored images", async () => {
        const db = await openAt(3);
        DBImages.init(db);

        await DBImages.storeImageLocally(image("img-1"));

        const pending = await DBImages.getPendingImages();
        expect(pending.map((i) => i.id)).toEqual(["img-1"]);
    });

    test("an uploaded image leaves the pending set and is cleanable", async () => {
        const db = await openAt(3);
        DBImages.init(db);

        await DBImages.storeImageLocally(image("img-1"));
        await DBImages.storeImageLocally(image("img-2"));

        // Public surface stays boolean — stored as 0/1.
        await DBImages.updateImageUploadStatus("img-1", {
            uploaded: true,
            url: "https://cdn.example.org/img-1.jpg",
        });

        expect((await DBImages.getPendingImages()).map((i) => i.id)).toEqual(["img-2"]);
        expect(await DBImages.getImageStats()).toMatchObject({
            total: 2,
            pending: 1,
            uploaded: 1,
        });

        expect(await DBImages.cleanUploadedImages()).toBe(1);
        expect((await DBImages.getImageStats()).total).toBe(1);
    });

    // ── The v3 migration ──

    test("v3 re-flags legacy boolean records and puts them back in the index", async () => {
        // A v2 database, built with the old schema and the old boolean values.
        const v2 = await openRaw(2, (_event, req) => {
            const store = req.result.createObjectStore("local_images", { keyPath: "id" });
            store.createIndex("uploaded", "uploaded", { unique: false });
            store.createIndex("timestamp", "timestamp", { unique: false });
        });

        const store = tx(v2, "readwrite");
        store.put({ ...image("legacy-pending"), timestamp: 1, uploaded: false, url: null });
        store.put({
            ...image("legacy-done"),
            timestamp: 2,
            uploaded: true,
            url: "https://cdn.example.org/d.jpg",
        });
        await new Promise((r) => (store.transaction.oncomplete = r));

        // Both are invisible to the index before the migration.
        expect(await request(tx(v2).index("uploaded").getAll())).toHaveLength(0);
        v2.close();

        // Reopening at v3 runs the migration.
        const v3 = await openAt(3);
        DBImages.init(v3);

        expect((await DBImages.getPendingImages()).map((i) => i.id)).toEqual(["legacy-pending"]);
        expect(await DBImages.cleanUploadedImages()).toBe(1);
        expect(await DBImages.getImageStats()).toMatchObject({
            total: 1,
            pending: 1,
            uploaded: 0,
        });
    });
});
