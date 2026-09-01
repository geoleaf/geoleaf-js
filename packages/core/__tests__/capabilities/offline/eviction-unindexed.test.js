/**
 * Integration tests — eviction must see EVERY record in the "layers" store (CAPACITÉS B.9).
 *
 * `_collectEntries` walked `objectStore("layers").index("profileId").openCursor()`.
 * An IndexedDB index only contains records whose indexed key is a VALID key, and
 * `null`/`undefined` are not — the record still lands in the store, it simply never
 * enters the index. Such a record was therefore invisible to the budget total AND
 * un-evictable: pure, silent growth that no amount of cache-capping could reclaim.
 *
 * This is not hypothetical. `kernel/themes/theme-cache.ts` calls
 * `StorageDB.cacheLayer(layerId, data, profileId || null, metadata)` — it writes
 * `profileId: null` by design whenever a theme is cached outside a profile.
 *
 * `store.openCursor()` visits the store itself, so it sees them all — and skips the
 * index lookup, so it is also cheaper.
 *
 * Runs on `fake-indexeddb` (real key semantics) like `images-idb-keys.test.js`: the
 * hand-rolled mock compares index keys with `===` and happily "indexes" null, so it
 * is structurally blind to this bug.
 */

const DB_NAME = "geoleaf-eviction-test";

describe("evictToQuota — records with no indexable profileId", () => {
    let IndexedDB;
    let evictToQuota;
    let DBLayers;
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

    const layersStore = (db, mode = "readonly") =>
        db.transaction(["layers"], mode).objectStore("layers");

    /** Writes records straight into the store, bypassing the module. */
    async function seed(db, records) {
        const store = layersStore(db, "readwrite");
        for (const record of records) store.put(record);
        await new Promise((r) => (store.transaction.oncomplete = r));
    }

    const allIds = async (db) => (await request(layersStore(db).getAll())).map((r) => r.id).sort();

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        // Deferred on purpose — the modules load AFTER fake-indexeddb installs
        // `globalThis.indexedDB`. `await import()` preserves that order exactly.
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ evictToQuota } = await import("../../../src/capabilities/offline/db/eviction.js"));
        ({ DBLayers } = await import("../../../src/capabilities/offline/db/layers.js"));
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

    // ── The trap, pinned ──

    test("a null profileId keeps a record OUT of the index — the store still holds it", async () => {
        const db = await openAt(3);
        await seed(db, [
            { id: "with-profile", profileId: "tourism", timestamp: 1, size: 10 },
            { id: "null-profile", profileId: null, timestamp: 2, size: 10 },
            { id: "no-profile-key", timestamp: 3, size: 10 },
        ]);

        expect(await request(layersStore(db).getAll())).toHaveLength(3);
        expect(await request(layersStore(db).index("profileId").getAll())).toHaveLength(1);
    });

    test("cacheLayer does NOT guarantee the field — it stores what it is handed", async () => {
        const db = await openAt(3);
        DBLayers.init(db);

        // Exactly what themes/theme-cache.ts does for a profile-less theme.
        await DBLayers.cacheLayer("theme-dark", { a: 1 }, null);

        const record = await request(layersStore(db).get("theme-dark"));
        expect(record.profileId).toBeNull();
        expect(await request(layersStore(db).index("profileId").getAll())).toHaveLength(0);
    });

    // ── The consequence on the budget ──

    test("the budget total counts unindexed records", async () => {
        const db = await openAt(3);
        await seed(db, [
            { id: "indexed", profileId: "tourism", timestamp: 2, size: 100 },
            { id: "orphan", profileId: null, timestamp: 1, size: 900 },
        ]);

        // Over budget only if the 900-byte orphan is counted.
        const result = await evictToQuota(db, 500);

        expect(result.totalBefore).toBe(1000);
    });

    test("an over-budget cache made only of unindexed records is actually evicted", async () => {
        const db = await openAt(3);
        await seed(db, [
            { id: "theme-a", profileId: null, timestamp: 1, size: 400 },
            { id: "theme-b", profileId: null, timestamp: 2, size: 400 },
            { id: "theme-c", profileId: null, timestamp: 3, size: 400 },
        ]);

        const result = await evictToQuota(db, 500);

        expect(result.totalBefore).toBe(1200);
        expect(result.evicted).toBe(2);
        expect(result.totalAfter).toBe(400);
        // LRU by timestamp: the two oldest go, the newest survives.
        expect(await allIds(db)).toEqual(["theme-c"]);
    });

    test("LRU order is global, not per-index — an old orphan outranks a recent indexed record", async () => {
        const db = await openAt(3);
        await seed(db, [
            { id: "old-orphan", profileId: null, timestamp: 1, size: 600 },
            { id: "recent-indexed", profileId: "tourism", timestamp: 9, size: 600 },
        ]);

        const result = await evictToQuota(db, 700);

        expect(result.evicted).toBe(1);
        expect(await allIds(db)).toEqual(["recent-indexed"]);
    });

    // ── Non-regression on the indexed path ──

    test("indexed records are still collected and evicted as before", async () => {
        const db = await openAt(3);
        await seed(db, [
            { id: "a", profileId: "p1", timestamp: 1, size: 300 },
            { id: "b", profileId: "p1", timestamp: 2, size: 300 },
            { id: "c", profileId: "p2", timestamp: 3, size: 300 },
        ]);

        const result = await evictToQuota(db, 700);

        expect(result.totalBefore).toBe(900);
        expect(result.evicted).toBe(1);
        expect(result.freedBytes).toBe(300);
        expect(await allIds(db)).toEqual(["b", "c"]);
    });

    test("a cache within budget is left untouched", async () => {
        const db = await openAt(3);
        await seed(db, [{ id: "a", profileId: null, timestamp: 1, size: 100 }]);

        const result = await evictToQuota(db, 500);

        expect(result).toMatchObject({ evicted: 0, totalBefore: 100, totalAfter: 100 });
        expect(await allIds(db)).toEqual(["a"]);
    });

    // ⚠️ This defect's second site (`CacheMetrics.getCompressionStats`, which
    // walked the same index and thus missed the same records) was PURGED — 0
    // production consumers. Its fix is not lost, it became MOOT: the second
    // site no longer exists. The first stays fixed and covered above.
});
