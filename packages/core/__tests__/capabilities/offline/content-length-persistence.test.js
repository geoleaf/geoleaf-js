/**
 * Integration tests — what `contentLength` actually is once persisted (CAPACITÉS B.11).
 *
 * The reported defect: `fetch-manager.ts:97` yields `response.headers.get("Content-Length")`,
 * i.e. `string | null`; `downloader.ts` casts it `as number | undefined`; and `cacheLayer`
 * was said to write it through unchanged, so a string would sit in a field typed `number`
 * and every downstream budget sum would concatenate instead of adding.
 *
 * The first two links are real. The third is NOT: `db/layers.ts:396` coerces with
 * `Number.parseInt(String(...), 10)` and falls back to the measured size when that is not
 * finite. These tests pin that end-to-end, because a TypeScript cast proves nothing about
 * runtime and the only claim that matters is what lands in the store.
 *
 * Run against `fake-indexeddb`: what is asserted is the persisted record, not a mock's echo.
 */

const DB_NAME = "geoleaf-contentlength-test";

describe("cacheLayer — contentLength is persisted as a number", () => {
    let IndexedDB;
    let DBLayers;
    let FetchManager;
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

    const openAt = (version) => openRaw(version, (event) => IndexedDB._upgradeDatabase(event));

    function request(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    const read = (db, id) =>
        request(db.transaction(["layers"], "readonly").objectStore("layers").get(id));

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        // Deferred on purpose — the modules load AFTER fake-indexeddb installs
        // `globalThis.indexedDB`. `await import()` preserves that order exactly.
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ DBLayers } = await import("../../../src/capabilities/offline/db/layers.js"));
        ({ FetchManager } = await import(
            "../../../src/capabilities/offline/cache/fetch-manager.js"
        ));
    });

    beforeEach(() => {
        open = [];
    });

    afterEach(async () => {
        for (const db of open) db.close();
        await new Promise((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    // ── The source of the confusion, pinned ──

    test("FetchManager really hands downstream a STRING Content-Length", () => {
        const metadata = FetchManager._extractMetadata({
            headers: { get: (k) => (k === "Content-Length" ? "2048" : null) },
        });

        expect(metadata.contentLength).toBe("2048");
        expect(typeof metadata.contentLength).toBe("string");
    });

    // ── What the store ends up holding ──

    test("a string header is coerced, not stored verbatim", async () => {
        const db = await openAt(3);
        DBLayers.init(db);

        await DBLayers.cacheLayer("res-1", { a: 1 }, "tourism", { contentLength: "2048" });

        const record = await read(db, "res-1");
        expect(typeof record.contentLength).toBe("number");
        expect(record.contentLength).toBe(2048);
    });

    test("summing persisted values adds, it does not concatenate", async () => {
        const db = await openAt(3);
        DBLayers.init(db);

        await DBLayers.cacheLayer("res-1", { a: 1 }, "tourism", { contentLength: "20" });
        await DBLayers.cacheLayer("res-2", { a: 2 }, "tourism", { contentLength: "30" });

        const total =
            (await read(db, "res-1")).contentLength + (await read(db, "res-2")).contentLength;
        expect(total).toBe(50);
    });

    test("a missing header falls back to the measured size, never null", async () => {
        const db = await openAt(3);
        DBLayers.init(db);

        // `null` is exactly what headers.get() returns for an absent Content-Length.
        await DBLayers.cacheLayer("res-null", { a: 1 }, "tourism", { contentLength: null });

        const record = await read(db, "res-null");
        expect(typeof record.contentLength).toBe("number");
        expect(record.contentLength).toBe(record.originalSize);
    });

    test("an unparseable header does not persist NaN", async () => {
        const db = await openAt(3);
        DBLayers.init(db);

        await DBLayers.cacheLayer("res-junk", { a: 1 }, "tourism", {
            contentLength: "not-a-number",
        });

        const record = await read(db, "res-junk");
        expect(Number.isFinite(record.contentLength)).toBe(true);
        expect(record.contentLength).toBe(record.originalSize);
    });

    test("a numeric contentLength still round-trips unchanged", async () => {
        const db = await openAt(3);
        DBLayers.init(db);

        await DBLayers.cacheLayer("res-num", { a: 1 }, "tourism", { contentLength: 4096 });

        expect((await read(db, "res-num")).contentLength).toBe(4096);
    });
});
