/**
 * StorageDB — boot seam: init / _ensureModule / close (CAPACITÉS B.7)
 *
 * `sync-queue-compat-surface.test.js` and `images-idb-keys.test.js` reach the façade by
 * assigning `IndexedDB._db` by hand, so `init()` — the method every plugin call funnels
 * through — had never run in the core suite, and neither had the lazy `_ensureModule`
 * path nor `close()`. What is exercised here is the degradation contract: when IndexedDB
 * is unavailable the engine must keep the application alive rather than reject.
 *
 * ⚠️ ESM `import`, not `require()` — see the measurement note in
 * `storage-helper-validation.test.js`.
 */

import "fake-indexeddb/auto";
import { IndexedDB } from "../../../src/capabilities/offline/db/indexeddb.ts";
import { DBModulesRegistry } from "../../../src/capabilities/offline/db/db-modules-registry.ts";

const DB_NAME = "geoleaf-db"; // fixed by StorageDB._dbName — not a choice here.

// ⚠️ THE `geoleaf:storage:ready` LISTENER WAS REMOVED FROM HERE (03/08/2026)
// — the signal no longer exists. It carried no payload, fired at every base
// opening and had no production listener; these tests were its only consumer
// in the world.
//
// 🛑 WHAT IT SERVED TO PROVE STAYS PROVEN, by a BETTER instrument: `init()`'s
// idempotence is now measured on the number of `indexedDB.open` calls, which
// says "the base was not reopened" rather than "an event was not re-emitted".
// The second was a consequence of the first, not the property itself.

afterEach(async () => {
    vi.unstubAllGlobals();
    // Teardown deliberately does NOT call IndexedDB.close(): that method is under test here,
    // and a broken close would leave a live connection blocking deleteDatabase, turning one
    // failing assertion into a whole file of timeouts that says nothing about the cause.
    const handle = IndexedDB._db;
    if (handle && typeof handle.close === "function") handle.close();
    IndexedDB._db = null;
    IndexedDB._modules = {};
    await new Promise((resolve) => {
        const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
});

describe("StorageDB.init — success", () => {
    test("opens the database, keeps the handle and announces readiness", async () => {
        const db = await IndexedDB.init();

        expect(db).toBeInstanceOf(IDBDatabase);
        expect(db.name).toBe(DB_NAME);
        expect(db.version).toBe(5);
        expect(IndexedDB._db).toBe(db);
    });

    // The v4 schema's fine shape (keys, indexes, uniqueness) is exercised by
    // `schema-v4.test.js`; here we only keep the inventory, which belongs to
    // the boot contract.
    test("creates the seven object stores the engine expects (v5)", async () => {
        // ⚠️ Eight until recently: `sync_queue` and `sync_backups` (the backup
        // chain) are no longer created. The test guarding their ABSENCE lives
        // in `schema-v4.test.js` — this one counts what exists, the other
        // refuses what comes back.
        //
        // ⚠️ SIX before `routes`, which takes the base to v5. The assertion
        // stays EXHAUSTIVE: it is what would catch an eighth store appearing
        // by accident, and loosening it to `arrayContaining` would make
        // invisible exactly what it guards.
        const db = await IndexedDB.init();

        expect([...db.objectStoreNames].sort()).toEqual([
            "features",
            "layers",
            "local_images",
            "metadata",
            "outbox",
            "preferences",
            "routes",
        ]);
    });

    test("eagerly initialises every module in the registry", async () => {
        await IndexedDB.init();

        expect(Object.keys(IndexedDB._modules).sort()).toEqual(
            Object.keys(DBModulesRegistry).sort()
        );
    });

    test("a second init is a no-op — same handle, and the base is NOT reopened", async () => {
        // Handle identity is not enough: a second opening that happened to
        // return the same object would pass. What proves the short-circuit is
        // that `open` is called only ONCE — and that is what costs, an
        // opening being able to time out at 15 s.
        const openSpy = vi.spyOn(globalThis.indexedDB, "open");

        const first = await IndexedDB.init();
        const second = await IndexedDB.init();

        expect(second).toBe(first);
        expect(openSpy).toHaveBeenCalledTimes(1);
        openSpy.mockRestore();
    });
});

describe("StorageDB.init — degradation when IndexedDB is unavailable", () => {
    /** Reproduces a browser that refuses storage access (private mode, sandboxed frame). */
    function refuseIndexedDB() {
        vi.stubGlobal("indexedDB", {
            open: () => {
                throw new DOMException("storage is disabled", "SecurityError");
            },
        });
    }

    test("resolves to a stub instead of rejecting — the app keeps booting", async () => {
        refuseIndexedDB();

        await expect(IndexedDB.init()).resolves.toEqual({ _isStub: true });
        // ⚠️ The `readyEvents` assertion is removed with the signal. What it
        // guarded — "an opening failure does not announce a success" — is
        // carried by the return's shape itself: a stub, not a base. More
        // direct than an absent event.
    });

    test("the stub IS retained — `_db` holds it and the open is not retried", async () => {
        refuseIndexedDB();
        await IndexedDB.init();

        // Was pinned the other way round: the `.catch` returned the stub to the caller but
        // never assigned `this._db`, so the `if (this._db)` short-circuit never fired and
        // every later façade call paid another full open attempt — up to the 15 s timeout
        // each. Fixed as B.47b; the stub was always meant to live here, the three guards
        // that read `_db` already test `"_isStub" in this._db`.
        expect(IndexedDB._db).toEqual({ _isStub: true });
    });

    test("read/write façade calls become silent no-ops, returning undefined", async () => {
        refuseIndexedDB();

        await expect(IndexedDB.cacheLayer("l1", {}, "p1")).resolves.toBeUndefined();
        await expect(IndexedDB.getLayer("l1")).resolves.toBeUndefined();
        await expect(IndexedDB.storeImageLocally({ id: "i1" })).resolves.toBeUndefined();
    });

    test("the list-returning calls still answer with an empty list, never undefined", async () => {
        refuseIndexedDB();

        // ⚠️ This case's two `sync_queue` calls are removed with the facade.
        // `listPendingEdits` takes their place: it is now THE list read that
        // must return `[]` rather than `undefined` when the base refuses to
        // open — an `undefined` here would crash `autoSync`'s tally, hence
        // the replay on network return.
        await expect(IndexedDB.listPendingEdits()).resolves.toEqual([]);
        await expect(IndexedDB.getStorageStats()).resolves.toEqual({
            used: 0,
            quota: 0,
            percentage: 0,
            layersCount: 0,
            featuresCount: 0,
            outboxCount: 0,
        });
    });

    test("preferences are the exception — they throw instead of degrading", async () => {
        refuseIndexedDB();

        await expect(IndexedDB.setPreference("theme", "dark")).rejects.toThrow(
            "[StorageDB] Preferences module not available"
        );
        await expect(IndexedDB.getPreference("theme")).rejects.toThrow(
            "[StorageDB] Preferences module not available"
        );
    });
});

describe("StorageDB — cède la place sur versionchange (hygiène de connexion, préalable de 3.1)", () => {
    // ⚠️ This guard is INVISIBLE today and becomes visible the moment the
    // schema moves — exactly why it is set BEFORE the migration and not with it.
    //
    // A live connection is the ONLY thing that can block a schema upgrade.
    // Without `onversionchange`, the engine holding the base leaves the other
    // context's upgrade hanging until its timeout, after which that context
    // falls back to `_isStub`: no more storage, silently, on a device that
    // may carry unsynced captures.
    test("ferme sa connexion quand un autre contexte demande une montée de version", async () => {
        const db = await IndexedDB.init();
        expect(IndexedDB._db).not.toBeNull();

        // 🛑 The next version is DERIVED from the one just opened, never
        // hardcoded. It was — `open(DB_NAME, 5)` —, and the day the engine
        // moved to v5 that call stopped being an upgrade: the request no
        // longer emitted `versionchange`, the promise was no longer kept, and
        // the leaked connection made six unrelated tests TIME OUT, thirty to
        // forty seconds each.
        //
        // ⚠️ The failure mode is the real cost: it points nowhere near its
        // cause. A "+ 1" on the READ version cannot desynchronise from a bump.
        const next = db.version + 1;

        // A second context requests the next version. It must NOT be blocked.
        const upgraded = await new Promise((resolve, reject) => {
            const req = globalThis.indexedDB.open(DB_NAME, next);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error("BLOQUÉ — le moteur n'a pas cédé la place"));
        });

        expect(upgraded.version).toBe(next);
        // And the engine did let go: its handle is released, not just quietly closed.
        expect(IndexedDB._db).toBeNull();
        expect(IndexedDB._modules).toEqual({});

        upgraded.close();
    });
});

describe("StorageDB._ensureModule", () => {
    test("returns the module and memoises it — init runs once, not once per call", async () => {
        await IndexedDB.init();
        IndexedDB._modules = {}; // force the lazy path the eager init normally pre-empts
        const initSpy = vi.spyOn(DBModulesRegistry.Layers, "init");

        const first = IndexedDB._ensureModule("Layers");
        const second = IndexedDB._ensureModule("Layers");

        try {
            expect(first).not.toBeNull();
            expect(second).toBe(first);
            expect(IndexedDB._modules.Layers).toBe(first);
            // The call count is the only witness of the cache: every `db/*` module's init()
            // returns its own singleton, so a repeated init and a memoised lookup hand back
            // the very same object. Identity alone cannot tell them apart — and a mutation
            // deleting the cache lookup survived a test that only checked identity.
            expect(initSpy).toHaveBeenCalledTimes(1);
        } finally {
            initSpy.mockRestore();
        }
    });

    test("returns null for a name that is not in the registry", async () => {
        await IndexedDB.init();
        expect(IndexedDB._ensureModule("Nonexistent")).toBeNull();
    });

    test("returns null when there is no database", () => {
        IndexedDB._db = null;
        IndexedDB._modules = {};
        expect(IndexedDB._ensureModule("Layers")).toBeNull();
    });

    test("returns null when the database is the stub", () => {
        IndexedDB._db = { _isStub: true };
        IndexedDB._modules = {};

        expect(IndexedDB._ensureModule("Layers")).toBeNull();
        expect(IndexedDB._modules).toEqual({});
    });
});

describe("StorageDB.close", () => {
    test("closes the connection and clears the handle and the module cache", async () => {
        const db = await IndexedDB.init();
        expect(Object.keys(IndexedDB._modules).length).toBeGreaterThan(0);

        IndexedDB.close();

        expect(IndexedDB._db).toBeNull();
        expect(IndexedDB._modules).toEqual({});
        // A closed connection refuses to start a transaction — proof `db.close()` ran and
        // not merely that the reference was dropped.
        expect(() => db.transaction(["layers"], "readonly")).toThrow();
    });

    test("closing a stubbed connection resets state without throwing", () => {
        IndexedDB._db = { _isStub: true };
        IndexedDB._modules = { Layers: {} };

        IndexedDB.close();

        expect(IndexedDB._db).toBeNull();
        expect(IndexedDB._modules).toEqual({});
    });

    test("after close, the next façade call re-opens the database", async () => {
        await IndexedDB.init();
        IndexedDB.close();

        await IndexedDB.cacheLayer("l1", { type: "FeatureCollection", features: [] }, "p1");

        expect(IndexedDB._db).toBeInstanceOf(IDBDatabase);
        expect(await IndexedDB.getLayer("l1")).toMatchObject({ id: "l1", profileId: "p1" });
    });
});

describe("StorageDB — delegation through a live database", () => {
    test("cacheLayer / getLayer / removeLayer round-trip through DB.Layers", async () => {
        await IndexedDB.init();
        const geojson = { type: "FeatureCollection", features: [] };

        await IndexedDB.cacheLayer("l1", geojson, "tourism", { source: "test" });

        expect(await IndexedDB.getLayer("l1")).toMatchObject({
            id: "l1",
            profileId: "tourism",
            data: geojson,
        });
        expect(await IndexedDB.getLayersByProfile("tourism")).toHaveLength(1);

        await IndexedDB.removeLayer("l1");
        expect(await IndexedDB.getLayer("l1")).toBeNull();
    });

    test("clearProfile drops only the profile's layers", async () => {
        await IndexedDB.init();
        await IndexedDB.cacheLayer("a", {}, "p1");
        await IndexedDB.cacheLayer("b", {}, "p2");

        await IndexedDB.clearProfile("p1");

        expect(await IndexedDB.getLayersByProfile("p1")).toHaveLength(0);
        expect(await IndexedDB.getLayersByProfile("p2")).toHaveLength(1);
    });

    // ⚠️ REWRITTEN on 02/08/2026. This test was called "addToSyncQueue
    // rewrites the caller's payload into SyncDB's entry shape" and LOCKED the
    // remap: it called the facade with TWO arguments as `{endpoint, data}`
    // and asserted the rewrite into `{layerId, poiData}`. Yet no production
    // caller ever used that form — all three pass ONE argument. The test thus
    // proved a userless path worked, while the real path wrote
    // `poiData: null` on every capture.

    // ⚠️ The `status === "pending"` fast path (indexeddb.ts) is REDUNDANT: deleting it
    // leaves this test green. `SyncDB.getSyncQueue(profileId, "pending")` filters on the same
    // field the `status` index selects, so both routes return the same records. They differ
    // only in that `getPendingSyncQueue` sorts by timestamp — and since the primary key is
    // `sync_<Date.now()>_<random>`, timestamp order and key order cannot be made to disagree
    // through the public API. The branch is exercised below; its mutation is a documented
    // survivor, not an untested path.
    // ⚠️ THE `getSyncQueue` ROUTING TEST IS REMOVED. It exercised a
    // compatibility branch — "if status === 'pending', delegate to
    // getPendingSyncQueue" — of a method itself legacy and callerless. The
    // branch left with the method.

    test("preferences round-trip and fall back to the supplied default", async () => {
        await IndexedDB.init();

        await IndexedDB.setPreference("theme", "dark");

        expect(await IndexedDB.getPreference("theme")).toBe("dark");
        expect(await IndexedDB.getPreference("absent", "light")).toBe("light");
    });

    test("images round-trip through DB.Images, including the pending index", async () => {
        await IndexedDB.init();
        const image = {
            id: "img-1",
            blob: new Blob(["x"]),
            filename: "img-1.jpg",
            type: "image/jpeg",
            size: 1,
        };

        await IndexedDB.storeImageLocally(image);

        // ⚠️ Re-read through the "pending" index and not `getLocalImage` —
        // removed, its only consumer (`addpoi/getLocalImageUrl`) being
        // redundant with the base64 data-URL the same module writes. The
        // index is the right instrument anyway: it is the ONE a prior bug
        // class made blind.
        expect((await IndexedDB.getPendingImages()).map((i) => i.id)).toEqual(["img-1"]);

        await IndexedDB.updateImageUploadStatus("img-1", {
            uploaded: true,
            url: "https://cdn.example.org/img-1.jpg",
        });
        expect(await IndexedDB.getPendingImages()).toHaveLength(0);

        await IndexedDB.deleteLocalImage("img-1");
        // After deletion, the image can no longer be pending: re-reading
        // through the index equals re-reading by key here, and it requires no
        // extra accessor.
        expect(await IndexedDB.getPendingImages()).toHaveLength(0);
    });

    test("getStorageStats counts what is actually stored", async () => {
        // ⚠️ This case wrote into `sync_queue` and counted `syncQueueCount`;
        // both are removed. It now counts the outbox, through the entry point
        // that really feeds it — `applyEdit`, the sole writer.
        await IndexedDB.init();
        await IndexedDB.cacheLayer("l1", {}, "p1");
        await IndexedDB.applyLocalEdit({
            layerId: "pois",
            kind: "create",
            localId: "l-1",
            feature: { type: "Feature", geometry: null, properties: {} },
        });

        expect(await IndexedDB.getStorageStats()).toMatchObject({
            layersCount: 1,
            featuresCount: 1,
            outboxCount: 1,
        });
    });
});

// ── an opening failure is not memoised ────────────────────────────────────────
//
// `init()` short-circuits on `this._db`, but the failure path never fills
// `_db`: it returns the `{_isStub:true}` stub retaining nothing. Every later
// facade call thus goes back into `StorageHelper.openDatabase` and pays a
// full attempt again — up to 15 s of timeout each. On a durably unopenable
// base (quota exceeded, private browsing, IDB disabled), this is not an edge
// case: it is the permanent state.
describe("IndexedDB.init — un échec d'ouverture ne se retente pas indéfiniment (B.47b)", () => {
    let IndexedDB;
    let StorageHelper;
    let openSpy;

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        // Deferred on purpose — the modules load AFTER fake-indexeddb installs
        // `globalThis.indexedDB`. `await import()` preserves that order exactly.
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageHelperModule: StorageHelper } =
            await import("../../../src/capabilities/offline/db/storage-helper.js"));
    });

    beforeEach(() => {
        IndexedDB._db = null;
        IndexedDB._modules = {};
        openSpy = vi
            .spyOn(StorageHelper, "openDatabase")
            .mockRejectedValue(new Error("QuotaExceededError"));
    });

    afterEach(() => {
        openSpy.mockRestore();
        IndexedDB._db = null;
        IndexedDB._modules = {};
    });

    test("n'ouvre la base qu'UNE fois même après plusieurs échecs", async () => {
        await IndexedDB.init();
        await IndexedDB.init();
        await IndexedDB.init();

        expect(openSpy).toHaveBeenCalledTimes(1);
    });

    test("rend le même stub à chaque appel, plutôt qu'un neuf à chaque tentative", async () => {
        const first = await IndexedDB.init();
        const second = await IndexedDB.init();

        expect(first).toMatchObject({ _isStub: true });
        expect(second).toBe(first);
    });

    test("une ouverture qui redevient possible n'est PAS masquée par l'échec mémorisé", async () => {
        // The failure cache must not be definitive: `close()` resets, and
        // that is the recovery point. Without this exit, a temporarily
        // unavailable base would stay unreachable for the page's whole lifetime.
        await IndexedDB.init();
        expect(openSpy).toHaveBeenCalledTimes(1);

        IndexedDB.close();
        openSpy.mockResolvedValue({ name: "ok", objectStoreNames: { contains: () => true } });
        await IndexedDB.init();

        expect(openSpy).toHaveBeenCalledTimes(2);
    });
});
