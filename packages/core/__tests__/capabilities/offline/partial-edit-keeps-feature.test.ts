/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * A PARTIAL edit keeps what it does not bring — the geometry and the other attributes.
 *
 * The chain it guards: once a photo taken off-network reaches its server, the editor writes the
 * URL back onto the owning entity with an `update` whose `feature` carries that ONE attribute
 * and nothing else (`packages/plugins/editor/src/persistence/image-store.ts`, `_reconcile`).
 * The store used to keep `input.feature ?? current.feature`: absent, the entity survived; present
 * but partial, it REPLACED the entity — position and every other attribute gone. While the
 * create is still queued the two entries coalesce, so the create itself would leave carrying
 * nothing but the URL and the client identity.
 *
 * `local-edit-api.ts` already promised the opposite ("the store keeps what the edit does not
 * bring"); only the `undefined` half of that promise was implemented.
 *
 * Every case below is a TARGET (`🛑`), seen red on the assertion of the defect before the fix —
 * the failing message is quoted beside it. The group opens on a PREMISE (plain title): the
 * scenario really holds a full entity before the partial edit lands.
 *
 * Runs against `fake-indexeddb` with the real engine — local edit, store and drain — and a
 * controlled `fetch`, like `write-cycle-defects.test.ts`.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-partial-edit";
const ENDPOINT = "https://backend.test/sites";
const T1 = "2026-09-01T08:00:00+00:00";
const PHOTO_URL = "https://backend.test/uploads/p1.jpg";
const POSITION = { type: "Point", coordinates: [-60.64, -32.94] };

// ⚠️ Loaded DYNAMICALLY, after `fake-indexeddb/auto` has installed `indexedDB`: the engine's
// modules must not evaluate before the global exists.
let IndexedDB: any;
let StorageContract: any;
let applyEdit: any;
let pushOutbox: any;

let fetchSpy: ReturnType<typeof vi.fn>;

const request = <T>(req: IDBRequest<T>) =>
    new Promise<T>((done, fail) => {
        req.onsuccess = () => done(req.result);
        req.onerror = () => fail(req.error);
    });

const readAll = (store: string): Promise<any[]> =>
    request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

/** Answers every write with `reply`, and records the requests. */
function serve(reply: unknown): void {
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => reply }));
    vi.stubGlobal("fetch", fetchSpy);
}

/** The body of the `n`-th request the drain sent. */
const bodyOf = (n: number): Record<string, unknown> =>
    JSON.parse(String((fetchSpy.mock.calls[n]?.[1] as RequestInit | undefined)?.body ?? "null"));

/** A capture as the form submits it: a position and its attributes. */
const captured = {
    type: "Feature",
    geometry: POSITION,
    properties: { title: "Relevé", state: "ok" },
};

/** What `_reconcile` submits once the photo is on the server: the URL, and nothing else. */
const reconciled = { type: "Feature", properties: { photo: PHOTO_URL } };

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
});

beforeEach(async () => {
    const layer = {
        id: "sites",
        edition: { create: true, update: true, delete: true },
        offline: { enabled: true, maxFeatures: 100 },
        write: {
            enabled: true,
            endpoint: ENDPOINT,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["title", "state", "photo"],
        },
    };
    vi.stubGlobal("GeoLeaf", { Config: { getActiveProfile: () => ({ layers: [layer] }) } });
    // `close()` and not `_db = null` — the facade caches its sub-modules against the
    // connection that created them (`push-engine.test.js`).
    IndexedDB.close();
    IndexedDB._dbName = DB_NAME;
    await IndexedDB.init();
    StorageContract.init({
        get DB() {
            return IndexedDB;
        },
        isAvailable: () => true,
    });
});

afterEach(async () => {
    IndexedDB.close();
    vi.unstubAllGlobals();
    StorageContract.init({
        get DB() {
            return null;
        },
        isAvailable: () => false,
    });
    await new Promise<void>((done) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => done();
    });
});

describe("une édition PARTIELLE garde ce qu'elle n'apporte pas", () => {
    /** Captures one entity off-network and returns its client identity. */
    async function capture(): Promise<string> {
        const report = await applyEdit({ layerId: "sites", kind: "create", feature: captured });
        expect(report.refused).toBeNull();
        return report.localId;
    }

    test("prémisse : la saisie tient sa position et ses attributs, et sa création attend", async () => {
        await capture();
        const [record] = await readAll("features");
        expect(record.feature.geometry).toEqual(POSITION);
        expect(record.feature.properties).toEqual({ title: "Relevé", state: "ok" });
        const entries = await readAll("outbox");
        expect(entries.map((e) => e.kind)).toEqual(["create"]);
    });

    test("🛑 création en attente : l'URL de la photo s'ajoute, la position et les attributs restent", async () => {
        const localId = await capture();
        await applyEdit({ layerId: "sites", kind: "update", localId, feature: reconciled });

        const [record] = await readAll("features");
        expect(record.feature.geometry).toEqual(POSITION);
        expect(record.feature.properties).toEqual({
            title: "Relevé",
            state: "ok",
            photo: PHOTO_URL,
        });
    });

    test("🛑 création en attente : le POST part avec la position, les attributs ET l'URL", async () => {
        const localId = await capture();
        await applyEdit({ layerId: "sites", kind: "update", localId, feature: reconciled });

        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
        expect(init.method).toBe("POST");
        expect(bodyOf(0)).toEqual({
            title: "Relevé",
            state: "ok",
            photo: PHOTO_URL,
            geom: POSITION,
            local_id: localId,
        });
    });

    test("🛑 création déjà envoyée : l'entité locale garde sa position et ses attributs", async () => {
        const localId = await capture();
        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();

        await applyEdit({ layerId: "sites", kind: "update", localId, feature: reconciled });

        const [record] = await readAll("features");
        expect(record.feature.geometry).toEqual(POSITION);
        expect(record.feature.properties).toEqual({
            title: "Relevé",
            state: "ok",
            photo: PHOTO_URL,
        });
    });

    test("🛑 une modification qui écrit `geometry: undefined` en clair garde la position", async () => {
        const localId = await capture();
        // The shape a caller builds when its geometry is optional: the KEY is present, its
        // value is not. Object spread copies it, so only an explicit rule keeps the position.
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId,
            feature: { type: "Feature", geometry: undefined, properties: { title: "Renommé" } },
        });

        const [record] = await readAll("features");
        expect(record.feature.geometry).toEqual(POSITION);
        expect(record.feature.properties).toEqual({ title: "Renommé", state: "ok" });
    });

    test("🛑 création déjà envoyée : le PATCH ne remet pas la position à vide", async () => {
        const localId = await capture();
        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();

        await applyEdit({ layerId: "sites", kind: "update", localId, feature: reconciled });
        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();

        const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
        expect(init.method).toBe("PATCH");
        expect(bodyOf(0).geom).toEqual(POSITION);
        expect(bodyOf(0).photo).toBe(PHOTO_URL);
    });
});
