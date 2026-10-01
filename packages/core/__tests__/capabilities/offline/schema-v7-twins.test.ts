/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * The v6 → v7 migration: the twin records a device kept from the identity defect are merged.
 *
 * 🛑 THE STOCK THIS REPAIRS. Until 3.4.0, modifying an EXISTING entity through the queue wrote a
 * SECOND record for it — keyed by the bare server id, `serverId: null` — beside the one the
 * pull left under `srv:<id>`. The producer was closed on 17/09/2026 (an edit resolves the
 * entity's identity to its store key since then), but a device that edited before keeps the
 * pair: the layer draws the entity twice, and no pull can merge them — the twin's `serverId`
 * is `null`, which the `serverId` index does not hold, so the pull never finds it, and the
 * sweep of a complete pull skips it as unsynchronised work.
 *
 * It is a stock, not a flow: one pass at the upgrade, in the version-change transaction that
 * covers `features` AND `outbox`, is enough — and a pull, which reads `features` alone, could
 * not tell which twin the queue references.
 *
 * The rule, arbitrated on 27/09/2026:
 *  - the twin carrying work (not `synced`, or named by an outbox entry) is kept, and gets back
 *    its server identity; the other one, `synced`, is removed;
 *  - neither carrying work: the pull's record stays, the bare twin goes;
 *  - both carrying work: nothing is removed — two captures are never merged blind — and it is
 *    logged.
 *
 * Every case marked `🛑` is a TARGET, seen red before the upgrade existed — those of the last
 * block against the repair as first written, whose reads logged without cancelling, whose writes
 * had no error handler and whose handlers were not guarded. Plain titles are GUARDS against
 * over-reach.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-schema-v7-twins";
const T0 = "2026-09-01T08:00:00+00:00";
const AT = { type: "Point", coordinates: [-60.64, -32.94] };

/** A record as the pull leaves it: `srv:<id>`, synced. */
const pulled = (id: string, extra: Record<string, unknown> = {}) => ({
    layerId: "sites",
    localId: `srv:${id}`,
    serverId: id,
    syncState: "synced",
    updatedAt: 1_700_000_000_000,
    version: { kind: "timestamp", value: T0 },
    feature: { type: "Feature", id, geometry: AT, properties: { id, title: `servi ${id}` } },
    ...extra,
});

/** The twin the defect wrote: the bare server id as key, no server identity. */
const twin = (id: string, extra: Record<string, unknown> = {}) => ({
    layerId: "sites",
    localId: id,
    serverId: null,
    syncState: "pending",
    updatedAt: 1_700_000_100_000,
    feature: { type: "Feature", id, geometry: AT, properties: { id, title: `modifié ${id}` } },
    ...extra,
});

const entry = (localId: string, seqTag: string, extra: Record<string, unknown> = {}) => ({
    id: `update:sites:${localId}:${seqTag}`,
    layerId: "sites",
    localId,
    kind: "update",
    state: "pending",
    attempts: 0,
    createdAt: 1_700_000_100_000,
    ...extra,
});

let IndexedDB: any;

const request = <T>(req: IDBRequest<T>) =>
    new Promise<T>((done, fail) => {
        req.onsuccess = () => done(req.result);
        req.onerror = () => fail(req.error);
    });

const readAll = (store: string): Promise<any[]> =>
    request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

/** The records the store holds for entity `id`, by key. */
async function heldFor(id: string): Promise<Record<string, any>> {
    const rows = (await readAll("features")).filter(
        (r) => r.localId === id || r.localId === `srv:${id}` || r.serverId === id
    );
    return Object.fromEntries(rows.map((r) => [r.localId, r]));
}

/**
 * Creates the database AT VERSION 6, as the v6 upgrade leaves it, and fills it. The stores
 * and indexes are spelled out by hand, like `schema-v6-migration.test.ts` does for v5: a
 * fixture derived from the engine would follow the code it is supposed to hold still.
 */
function seedV6(features: object[], outbox: object[]): Promise<void> {
    return new Promise((done, fail) => {
        const open = indexedDB.open(DB_NAME, 6);
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
            const f = db.createObjectStore("features", { keyPath: ["layerId", "localId"] });
            f.createIndex("serverId", "serverId", { unique: false });
            f.createIndex("syncState", "syncState", { unique: false });
            f.createIndex("updatedAt", "updatedAt", { unique: false });
            const o = db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
            o.createIndex("id", "id", { unique: true });
            o.createIndex("state", "state", { unique: false });
            o.createIndex("localId", ["layerId", "localId"], { unique: false });
            db.createObjectStore("conflicts", { keyPath: ["layerId", "localId"] });
        };
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(["features", "outbox"], "readwrite");
            for (const r of features) tx.objectStore("features").put(r);
            for (const e of outbox) tx.objectStore("outbox").add(e);
            tx.oncomplete = () => {
                db.close();
                done();
            };
            tx.onerror = () => fail(tx.error);
        };
    });
}

async function openAfter(features: object[], outbox: object[] = []): Promise<void> {
    await seedV6(features, outbox);
    IndexedDB._dbName = DB_NAME;
    await IndexedDB.init();
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
});

afterEach(async () => {
    IndexedDB.close();
    await new Promise<void>((done) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => done();
    });
});

describe("une base v6 portant des jumeaux, ouverte par le moteur", () => {
    test("🛑 monte en v7", async () => {
        await openAfter([pulled("42")]);
        expect(IndexedDB._db.version).toBe(7);
    });

    test("🛑 le jumeau qui porte le travail reste, reprend son identité serveur, et l'autre part", async () => {
        // The case of a device that edited before 3.4.0: the twin's entry went to quarantine,
        // not replayable as it was. Kept, with its identity back, a re-try reaches its row.
        await openAfter(
            [pulled("42"), twin("42")],
            [entry("42", "q", { state: "quarantined", quarantine: "rejectedByServer" })]
        );

        const held = await heldFor("42");
        expect(Object.keys(held)).toEqual(["42"]);
        expect(held["42"].serverId).toBe("42");
        expect(held["42"].feature.properties.title).toBe("modifié 42");
        // The queue is not touched: its entry still names the record it names.
        expect((await readAll("outbox")).map((e) => e.localId)).toEqual(["42"]);
    });

    test("🛑 aucun des deux ne porte de travail : le jumeau nu part, celui du rapatriement reste", async () => {
        // Re-edited and pushed after the fix: both synced, the bare one carrying the server id.
        await openAfter([pulled("43"), twin("43", { serverId: "43", syncState: "synced" })]);

        const held = await heldFor("43");
        expect(Object.keys(held)).toEqual(["srv:43"]);
    });

    test("🛑 travail côté rapatriement seulement : le jumeau nu, synchronisé, part", async () => {
        await openAfter(
            [pulled("46", { syncState: "pending" }), twin("46", { syncState: "synced" })],
            [entry("srv:46", "p")]
        );

        const held = await heldFor("46");
        expect(Object.keys(held)).toEqual(["srv:46"]);
    });

    test("garde : les deux portent du travail — rien n'est retiré", async () => {
        await openAfter(
            [pulled("44", { syncState: "pending" }), twin("44")],
            [entry("srv:44", "a"), entry("44", "b")]
        );

        const held = await heldFor("44");
        expect(Object.keys(held).sort()).toEqual(["44", "srv:44"]);
    });

    test("garde : une clé nue sans double n'est pas touchée", async () => {
        const lone = twin("45");
        await openAfter([lone]);

        expect(await heldFor("45")).toEqual({ "45": lone });
    });

    test("garde : une création et ses données restent à l'octet", async () => {
        const created = {
            layerId: "sites",
            localId: "loc:1b2c",
            serverId: null,
            syncState: "pending",
            updatedAt: 1_700_000_200_000,
            feature: { type: "Feature", geometry: AT, properties: { title: "neuf" } },
        };
        const served = pulled("47");
        await openAfter([created, served], [entry("loc:1b2c", "c", { kind: "create" })]);

        const rows = await readAll("features");
        expect(rows).toHaveLength(2);
        expect(rows).toEqual(expect.arrayContaining([created, served]));
    });

    test("garde : les jumeaux sont cherchés PAR COUCHE", async () => {
        // The same server id in two layers is two entities, not a pair.
        const other = { ...twin("48"), layerId: "routes" };
        await openAfter([pulled("48"), other]);

        const rows = await readAll("features");
        expect(rows).toHaveLength(2);
    });
});

/**
 * "Never throws and never aborts": the repair runs INSIDE the version-change transaction, and an
 * error event left uncancelled on any of its requests — or an exception out of one of its
 * handlers — aborts that transaction, so the whole open fails and the engine falls back to a
 * store without persistence. A fake transaction, because nothing makes `fake-indexeddb` fail a
 * read or a write on demand.
 */
describe("la réparation ne fait jamais avorter la montée", () => {
    type FakeRequest = {
        result?: unknown;
        error?: unknown;
        onsuccess?: ((e: Event) => void) | null;
        onerror?: ((e: Event) => void) | null;
    };
    type Kind = "getAll" | "put" | "delete";
    const requests: Record<Kind, FakeRequest[]> = { getAll: [], put: [], delete: [] };
    const request = (kind: Kind, result?: unknown): FakeRequest => {
        const r: FakeRequest = { result };
        requests[kind].push(r);
        return r;
    };
    let failWrites = false;
    let failOutbox = false;
    const tx = {
        objectStore: (name: string) => {
            if (name === "outbox" && failOutbox) throw new DOMException("gone", "NotFoundError");
            return store(name);
        },
    } as unknown as IDBTransaction;
    const store = (name: string) => ({
        getAll: () => request("getAll", name === "features" ? [pulled("42"), twin("42")] : []),
        put: () => {
            if (failWrites) throw new DOMException("clone", "DataCloneError");
            return request("put");
        },
        delete: () => request("delete"),
    });
    const errorEvent = () => ({ preventDefault: vi.fn() }) as unknown as Event;

    let mergeIdentityTwins: (tx: IDBTransaction) => void;
    beforeEach(async () => {
        for (const k of ["getAll", "put", "delete"] as const) requests[k] = [];
        failWrites = false;
        failOutbox = false;
        ({ mergeIdentityTwins } =
            await import("../../../src/capabilities/offline/db/identity-twins.js"));
    });

    test("🛑 une lecture de `features` en échec est annulée, pas propagée", () => {
        mergeIdentityTwins(tx);
        const e = errorEvent();
        requests.getAll[0]!.onerror?.(e);
        expect(e.preventDefault).toHaveBeenCalled();
    });

    test("🛑 une lecture de la file en échec est annulée, pas propagée", () => {
        mergeIdentityTwins(tx);
        requests.getAll[0]!.onsuccess?.({} as Event);
        const e = errorEvent();
        requests.getAll[1]!.onerror?.(e);
        expect(e.preventDefault).toHaveBeenCalled();
    });

    test("🛑 une écriture en échec — put comme delete — est annulée, pas propagée", () => {
        mergeIdentityTwins(tx);
        requests.getAll[0]!.onsuccess?.({} as Event);
        requests.getAll[1]!.onsuccess?.({} as Event);
        expect(requests.put).toHaveLength(1);
        expect(requests.delete).toHaveLength(1);
        for (const r of [requests.put[0]!, requests.delete[0]!]) {
            const e = errorEvent();
            r.onerror?.(e);
            expect(e.preventDefault).toHaveBeenCalled();
        }
    });

    test("🛑 une exception à la lecture de la file ne sort pas de son gestionnaire", () => {
        failOutbox = true;
        mergeIdentityTwins(tx);
        expect(() => requests.getAll[0]!.onsuccess?.({} as Event)).not.toThrow();
    });

    test("🛑 une exception dans la réparation ne sort pas de son gestionnaire", () => {
        failWrites = true;
        mergeIdentityTwins(tx);
        requests.getAll[0]!.onsuccess?.({} as Event);
        expect(() => requests.getAll[1]!.onsuccess?.({} as Event)).not.toThrow();
    });
});

/**
 * The v3 migration of `local_images` made the same promise in a comment — "never fail the
 * upgrade over the migration" — and did not keep it: its read logged without cancelling, its
 * writes had no error handler, and its success handler was not guarded.
 */
describe("la migration v3 des images ne fait jamais avorter la montée non plus", () => {
    type FakeRequest = {
        result?: unknown;
        error?: unknown;
        onsuccess?: ((e: Event) => void) | null;
        onerror?: ((e: Event) => void) | null;
    };
    const errorEvent = () => ({ preventDefault: vi.fn() }) as unknown as Event;

    let updates: FakeRequest[];
    let failUpdate: boolean;
    let cursorRequest: FakeRequest;
    const cursorOver = (value: Record<string, unknown>) => ({
        value,
        update: () => {
            if (failUpdate) throw new DOMException("clone", "DataCloneError");
            const r: FakeRequest = {};
            updates.push(r);
            return r;
        },
        continue: vi.fn(),
    });
    const tx = {
        objectStore: () => ({
            openCursor: () => {
                cursorRequest = {};
                return cursorRequest;
            },
        }),
    } as unknown as IDBTransaction;

    let reflagLocalImages: (tx: IDBTransaction) => void;
    beforeEach(async () => {
        updates = [];
        failUpdate = false;
        ({ reflagLocalImages } =
            await import("../../../src/capabilities/offline/db/local-images-v3.js"));
    });

    test("garde : un booléen est réécrit en 0/1, et le curseur avance", () => {
        reflagLocalImages(tx);
        const record: Record<string, unknown> = { id: 1, uploaded: true };
        const cursor = cursorOver(record);
        cursorRequest.result = cursor;
        cursorRequest.onsuccess?.({} as Event);
        expect(record.uploaded).toBe(1);
        expect(updates).toHaveLength(1);
        expect(cursor.continue).toHaveBeenCalled();
    });

    test("🛑 une lecture du curseur en échec est annulée, pas propagée", () => {
        reflagLocalImages(tx);
        const e = errorEvent();
        cursorRequest.onerror?.(e);
        expect(e.preventDefault).toHaveBeenCalled();
    });

    test("🛑 une réécriture en échec est annulée, pas propagée", () => {
        reflagLocalImages(tx);
        cursorRequest.result = cursorOver({ id: 1, uploaded: false });
        cursorRequest.onsuccess?.({} as Event);
        const e = errorEvent();
        updates[0]!.onerror?.(e);
        expect(e.preventDefault).toHaveBeenCalled();
    });

    test("🛑 une exception à la réécriture ne sort pas de son gestionnaire", () => {
        failUpdate = true;
        reflagLocalImages(tx);
        cursorRequest.result = cursorOver({ id: 1, uploaded: true });
        expect(() => cursorRequest.onsuccess?.({} as Event)).not.toThrow();
    });
});
