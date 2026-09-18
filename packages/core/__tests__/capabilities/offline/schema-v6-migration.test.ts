/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * The v5 → v6 migration, proven against a REAL v5 database.
 *
 * 🛑 **THE REPOSITORY HAD NO UNIT MIGRATION TEST AT ALL** — measured 17/09/2026. The only
 * migration ever exercised is the browser one (`e2e/27-offline-idb.spec.js`, from the v3
 * dump), which proves the upgrade runs but says nothing about what it PRESERVES, and says it
 * only on the shipped bundle. The v6 store is the first schema change made while field data
 * could exist, so the question "does the upgrade keep what is already there" needed an
 * instrument of its own.
 *
 * The v5 base below is written BY HAND rather than read from a dump: a dump would freeze one
 * device's data, while what is under test is the SHAPE the v5 upgrade leaves — seven stores
 * and their indexes. `fake-indexeddb` is required and the offline suite's home-made mock
 * cannot serve here: it produces neither `versionchange`, nor composite indexes, nor
 * `autoIncrement`.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-schema-v6-migration";

/** The record a pull leaves, carrying local work nothing has sent yet. */
const OWED = {
    layerId: "sites",
    localId: "srv:42",
    serverId: "42",
    syncState: "pending",
    updatedAt: 1_700_000_000_000,
    version: { kind: "timestamp", value: "2026-09-01T08:00:00+00:00" },
    feature: {
        type: "Feature",
        id: 42,
        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        properties: { id: 42, title: "relevé jamais envoyé" },
    },
};

/** Its queue entry, at the `seq` the v5 generator handed out. */
const QUEUED = {
    id: "update:sites:srv:42:1700000000000-1",
    layerId: "sites",
    localId: "srv:42",
    kind: "update",
    state: "pending",
    attempts: 0,
    createdAt: 1_700_000_000_000,
};

let IndexedDB: any;

const request = <T>(req: IDBRequest<T>) =>
    new Promise<T>((done, fail) => {
        req.onsuccess = () => done(req.result);
        req.onerror = () => fail(req.error);
    });

const readAll = (store: string): Promise<any[]> =>
    request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

/**
 * Creates the database AT VERSION 5, exactly as the v5 upgrade leaves it, and fills it.
 *
 * ⚠️ The seven stores and every index are spelled out here rather than derived from the
 * engine: deriving them would make the fixture follow the code it is supposed to hold still.
 */
function seedV5(): Promise<void> {
    return new Promise((done, fail) => {
        const open = indexedDB.open(DB_NAME, 5);
        open.onupgradeneeded = () => {
            const db = open.result;
            const layers = db.createObjectStore("layers", { keyPath: "id" });
            layers.createIndex("profileId", "profileId", { unique: false });
            layers.createIndex("timestamp", "timestamp", { unique: false });
            db.createObjectStore("preferences", { keyPath: "key" });
            const routes = db.createObjectStore("routes", { keyPath: "id" });
            routes.createIndex("timestamp", "timestamp", { unique: false });
            db.createObjectStore("metadata", { keyPath: "key" });
            const images = db.createObjectStore("local_images", { keyPath: "id" });
            images.createIndex("uploaded", "uploaded", { unique: false });
            images.createIndex("timestamp", "timestamp", { unique: false });
            const features = db.createObjectStore("features", { keyPath: ["layerId", "localId"] });
            features.createIndex("serverId", "serverId", { unique: false });
            features.createIndex("syncState", "syncState", { unique: false });
            features.createIndex("updatedAt", "updatedAt", { unique: false });
            const outbox = db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
            outbox.createIndex("id", "id", { unique: true });
            outbox.createIndex("state", "state", { unique: false });
            outbox.createIndex("localId", ["layerId", "localId"], { unique: false });
        };
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(
                ["features", "outbox", "layers", "preferences", "local_images"],
                "readwrite"
            );
            tx.objectStore("features").put(OWED);
            tx.objectStore("outbox").add(QUEUED);
            tx.objectStore("layers").put({
                id: "sites",
                profileId: "tourism",
                timestamp: 1,
                data: {},
            });
            tx.objectStore("preferences").put({ key: "offline.lastSyncAt", value: 1 });
            tx.objectStore("local_images").put({ id: "img-1", uploaded: 0, timestamp: 1 });
            tx.oncomplete = () => {
                db.close();
                done();
            };
            tx.onerror = () => fail(tx.error);
        };
    });
}

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
});

beforeEach(async () => {
    IndexedDB.close();
    await new Promise<void>((done) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => done();
    });
    await seedV5();
    IndexedDB._dbName = DB_NAME;
    await IndexedDB.init();
});

afterEach(async () => {
    IndexedDB.close();
    await new Promise<void>((done) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => done();
    });
});

describe("une base v5 ouverte par le moteur", () => {
    // Red on 17/09/2026: expected 5 to be 6
    test("🛑 monte en v6", () => {
        expect(IndexedDB._db.version).toBe(6);
    });

    // Red on 17/09/2026: expected [ 'features', 'layers', …(5) ] to include 'conflicts'
    test("🛑 gagne le magasin `conflicts`, vide", async () => {
        expect([...IndexedDB._db.objectStoreNames]).toContain("conflicts");
        expect(await readAll("conflicts")).toHaveLength(0);
    });

    // Red on 17/09/2026: expected [ 'features', 'layers', …(5) ] to include 'conflicts'
    //
    // 🛑 THE DECISION OF 17/09/2026, WRITTEN AS AN ASSERTION: no zone index. Reading a layer
    // costs 0,45 to 0,8 s at 30 000 entities from disk, which does not justify one — and the
    // composite key already gives per-layer traversal by key range, exactly as `features`
    // does. An index here would be a second truth for the same question.
    test("🛑 et ce magasin ne porte AUCUN index", () => {
        const tx = IndexedDB._db.transaction(["conflicts"], "readonly");
        const store = tx.objectStore("conflicts");
        expect([...store.indexNames]).toEqual([]);
        expect(store.keyPath).toEqual(["layerId", "localId"]);
    });

    /**
     * 🛑 THE HALF THAT MATTERS ON A FIELD DEVICE. A migration that creates its store and
     * loses the capture it was added to protect would be worse than none — and nothing in
     * the repository watched for it.
     *
     * ⚠️ **GREEN ON 17/09/2026, AND TRIVIALLY SO** — the engine opened this base at 5, so
     * nothing migrated and nothing could be lost. Saying otherwise would be claiming a proof
     * this run did not make. The three preservation cases below become real assertions the
     * moment the version bumps, and each was seen RED by mutation (an upgrade deleting then
     * recreating `features`, `outbox` and the inherited stores).
     */
    test("garde le travail local non synchronisé, à l'octet", async () => {
        const rows = await readAll("features");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(OWED);
    });

    test("garde la file, son `seq` et la suite de son générateur", async () => {
        const queued = await readAll("outbox");
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject(QUEUED);
        const first = queued[0].seq;
        // The generator lives in the database: it must continue, never restart.
        const tx = IndexedDB._db.transaction(["outbox"], "readwrite");
        const added = await request(
            tx.objectStore("outbox").add({ ...QUEUED, id: "update:sites:srv:42:1700000000001-2" })
        );
        expect(Number(added)).toBeGreaterThan(Number(first));
    });

    test("garde les quatre magasins hérités et leurs index", async () => {
        expect(await readAll("layers")).toHaveLength(1);
        expect(await readAll("preferences")).toHaveLength(1);
        expect(await readAll("local_images")).toHaveLength(1);
        const tx = IndexedDB._db.transaction(["features", "outbox", "layers"], "readonly");
        expect([...tx.objectStore("features").indexNames].sort()).toEqual([
            "serverId",
            "syncState",
            "updatedAt",
        ]);
        expect([...tx.objectStore("outbox").indexNames].sort()).toEqual(["id", "localId", "state"]);
        expect([...tx.objectStore("layers").indexNames].sort()).toEqual(["profileId", "timestamp"]);
        expect(tx.objectStore("outbox").index("id").unique).toBe(true);
    });
});
