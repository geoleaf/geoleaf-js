/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * What a settled conflict LEAVES BEHIND — proven here before any fix (17/09/2026).
 *
 * `lastWriteWins` was made observable on 17/09/2026: the drain detects the conflict, logs
 * it, and re-sends the write unfiltered. What it never does is LOOK at what the server was
 * holding. The policy is therefore declared and blind — and on a DELETE the row it crushes
 * is gone for good, with no copy anywhere.
 *
 * Every case below is a TARGET (`🛑`): it states what the cycle must do, and it was seen red
 * on the assertion of the defect before the fix — the failing message is quoted beside it.
 * Each group opens on a PREMISE (plain title, green today): the scenario really reaches the
 * conflicting point, which is what keeps the targets honest.
 *
 * Runs against `fake-indexeddb` with the real engine and a controlled `fetch`, like
 * `write-cycle-defects.test.ts`.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-conflict-store";
const OGC = "https://backend.test/ogc";
const ENDPOINT = "https://backend.test/sites";
const CONFLICT = "geoleaf:offline:write-conflict";

/** The marker the pull left on the record — the base the edit is filtered on. */
const T1 = "2026-09-01T08:00:00+00:00";
/** The marker a THIRD party wrote. This is the version the overwrite destroys. */
const T2 = "2026-09-01T09:30:00+00:00";
/** The marker the unfiltered re-send gets back. */
const T3 = "2026-09-01T11:00:00+00:00";

// ⚠️ Loaded DYNAMICALLY, after `fake-indexeddb/auto` installed `indexedDB`: the engine's
// modules must not evaluate before the global exists. Same reason, same `any`, as
// `write-cycle-defects.test.ts`.
let IndexedDB: any;
let StorageContract: any;
let applyEdit: any;
let pushOutbox: any;

let layer: any;
let fetchSpy: ReturnType<typeof vi.fn>;

type Reply = { status?: number; body?: unknown } | undefined;

const request = <T>(req: IDBRequest<T>) =>
    new Promise<T>((done, fail) => {
        req.onsuccess = () => done(req.result);
        req.onerror = () => fail(req.error);
    });

const readAll = (store: string): Promise<any[]> =>
    request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

/** A controlled server: the OGC source answers a pull, `handler` answers everything else. */
function serve(handler: (url: string, init: RequestInit) => Reply | Promise<Reply>): void {
    fetchSpy = vi.fn(async (input: unknown, init: RequestInit = {}) => {
        const url = String(input);
        const reply: Reply = url.startsWith(OGC)
            ? { body: { type: "FeatureCollection", features: [], links: [] } }
            : await handler(url, init);
        const status = reply?.status ?? 200;
        return { ok: status < 400, status, json: async () => reply?.body ?? null };
    });
    vi.stubGlobal("fetch", fetchSpy);
}

/** The verb of the n-th call, `GET` when the caller declared none. */
const verbOf = (call: number): string =>
    String((fetchSpy.mock.calls[call]?.[1] as RequestInit | undefined)?.method ?? "GET");

const urlOf = (call: number): string => String(fetchSpy.mock.calls[call]?.[0]);

/** Every call, as `<VERB> <filtered?>` — the sequence is what the targets assert. */
const sequence = (): string[] =>
    fetchSpy.mock.calls.map(
        (_call, i) => `${verbOf(i)}${urlOf(i).includes("updated_at=eq.") ? " filtré" : ""}`
    );

/** An entity as the server returns it: `id` on top AND in the properties. */
const serverRow = (id: number, title: string, updatedAt: string) => ({
    id,
    local_id: null,
    title,
    updated_at: updatedAt,
    geom: { type: "Point", coordinates: [-60.64, -32.94] },
});

/** Seeds one entity the way a pull leaves it, with its freshness marker. */
async function stored(id: number, title = `Site ${id}`): Promise<string> {
    const localId = `srv:${id}`;
    await IndexedDB._ensureModule("Features").put({
        layerId: "sites",
        localId,
        serverId: String(id),
        syncState: "synced",
        updatedAt: 1,
        version: { kind: "timestamp", value: T1 },
        feature: {
            type: "Feature",
            id,
            geometry: { type: "Point", coordinates: [-60.64, -32.94] },
            properties: { id, local_id: null, title, updated_at: T1 },
        },
    });
    return localId;
}

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
});

beforeEach(async () => {
    layer = {
        id: "sites",
        edition: { create: true, update: true, delete: true },
        offline: { enabled: true, maxFeatures: 100, source: { url: OGC } },
        write: {
            enabled: true,
            endpoint: ENDPOINT,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["title"],
        },
    };
    vi.stubGlobal("GeoLeaf", { Config: { getActiveProfile: () => ({ layers: [layer] }) } });
    // `close()` and not `_db = null` — the facade caches its sub-modules against the
    // connection that created them.
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
    // Without this the module singleton outlives the file — the trap `quarantine-api.test.ts`
    // records.
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

describe("une MODIFICATION que le serveur a devancée", () => {
    /**
     * Arms the conflict: the row moved to T2 under us, so the filter on T1 matches nothing.
     * The unfiltered re-send succeeds and the server hands T3 back.
     */
    async function conflictingUpdate(reread: Reply = { body: [serverRow(7, "vu du bureau", T2)] }) {
        const localId = await stored(7);
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId,
            feature: {
                type: "Feature",
                geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                properties: { id: 7, title: "relevé sur le terrain" },
            },
        });
        serve((url, init) => {
            const verb = String(init?.method ?? "GET");
            if (verb === "GET") return reread;
            if (url.includes("updated_at=eq.")) return { body: [] };
            return { body: [serverRow(7, "relevé sur le terrain", T3)] };
        });
        return localId;
    }

    test("prémisse : le conflit est détecté, et la version locale l'emporte", async () => {
        await conflictingUpdate();
        const report = await pushOutbox();
        expect(report.conflicts).toBe(1);
        expect(report.pushed).toBe(1);
        // The LAST call is the unfiltered re-send — the count itself is the subject below.
        const last = fetchSpy.mock.calls.length - 1;
        expect(verbOf(last)).toBe("PATCH");
        expect(urlOf(last)).not.toContain("updated_at=eq.");
    });

    // Red on 17/09/2026: NotFoundError: No objectStore named conflicts in this database
    test("🛑 la version que le serveur portait est CONSERVÉE", async () => {
        await conflictingUpdate();
        await pushOutbox();
        const kept = await readAll("conflicts");
        expect(kept).toHaveLength(1);
        expect(kept[0].layerId).toBe("sites");
        expect(kept[0].localId).toBe("srv:7");
        expect(kept[0].serverVersion).toEqual({ kind: "timestamp", value: T2 });
        expect((kept[0].serverFeature as any)?.title).toBe("vu du bureau");
    });

    // Red on 17/09/2026: expected [ 'PATCH filtré', 'PATCH' ] to equal [ 'PATCH filtré', 'GET', 'PATCH' ]
    test("🛑 le drain RELIT la ligne serveur AVANT de l'écraser", async () => {
        await conflictingUpdate();
        await pushOutbox();
        expect(sequence()).toEqual(["PATCH filtré", "GET", "PATCH"]);
        expect(urlOf(1)).toContain("id=eq.7");
    });

    // Red on 17/09/2026: NotFoundError: No objectStore named conflicts in this database
    test("🛑 une relecture IMPOSSIBLE est consignée, et l'écrasement a lieu quand même", async () => {
        await conflictingUpdate({ status: 500 });
        const report = await pushOutbox();
        // The policy does not depend on a read the server may not grant.
        expect(report.pushed).toBe(1);
        const [kept] = await readAll("conflicts");
        expect(kept.readOutcome).toBe("unreadable");
        expect(kept.serverVersion).toBeNull();
        expect(kept.serverFeature).toBeNull();
    });

    // Red on 17/09/2026: expected "spy" to be called at least once
    test("🛑 un événement NOMME l'entrée en conflit", async () => {
        await conflictingUpdate();
        const heard = vi.fn();
        document.addEventListener(CONFLICT, heard);
        await pushOutbox();
        document.removeEventListener(CONFLICT, heard);
        expect(heard).toHaveBeenCalledTimes(1);
        const detail = (heard.mock.calls[0]?.[0] as CustomEvent).detail;
        expect(detail).toMatchObject({
            layerId: "sites",
            localId: "srv:7",
            kind: "update",
            settledBy: "lastWriteWins",
            readOutcome: "read",
        });
    });

    /**
     * 🛑 THE GUARD THE RE-READ EXISTS UNDER, and it is the one that could turn the fix into a
     * defect. The server's row is evidence, never a source: writing it into `features` would
     * overwrite exactly what the operator captured — the defect closed on 17/09/2026 under
     * "the send rewrote what it had read before", in a new place. Seen red by mutation (the
     * re-read writing the pulled row back).
     */
    test("la relecture n'écrase JAMAIS le travail local — le magasin garde la saisie", async () => {
        await conflictingUpdate();
        await pushOutbox();
        const [record] = await readAll("features");
        expect(record.feature.properties.title).toBe("relevé sur le terrain");
        expect(record.version).toEqual({ kind: "timestamp", value: T3 });
    });
});

describe("une SUPPRESSION que le serveur a devancée", () => {
    /** The row moved to T2 since the capture: a DELETE filtered on T1 matches nothing. */
    async function conflictingDelete() {
        const localId = await stored(9, "poteau 9");
        await applyEdit({ layerId: "sites", kind: "delete", localId });
        serve((url, init) => {
            const verb = String(init?.method ?? "GET");
            if (verb === "GET") return { body: [serverRow(9, "poteau 9 — déplacé", T2)] };
            if (url.includes("updated_at=eq.")) return { body: [] };
            return { body: [serverRow(9, "poteau 9 — déplacé", T2)] };
        });
        return localId;
    }

    test("prémisse : la suppression l'emporte, et l'entité quitte le magasin", async () => {
        await conflictingDelete();
        const report = await pushOutbox();
        expect(report.conflicts).toBe(1);
        expect(report.pushed).toBe(1);
        expect(await readAll("features")).toHaveLength(0);
    });

    // Red on 17/09/2026: NotFoundError: No objectStore named conflicts in this database
    //
    // 🛑 THE CASE THE STORE EXISTS FOR. After an overwritten update the server still holds a
    // row; after an overwritten delete it holds nothing, and nothing anywhere else does
    // either. This is the only irrecoverable loss of the whole cycle.
    test("🛑 la ligne détruite est CONSERVÉE avant de l'être", async () => {
        await conflictingDelete();
        await pushOutbox();
        const [kept] = await readAll("conflicts");
        expect(kept.kind).toBe("delete");
        expect((kept.serverFeature as any)?.title).toBe("poteau 9 — déplacé");
        expect(kept.serverVersion).toEqual({ kind: "timestamp", value: T2 });
    });

    // Red on 17/09/2026: NotFoundError: No objectStore named conflicts in this database
    //
    // ⚠️ The entity leaves `features` — the queue and the store both let it go. The conflict
    // record is therefore the ONLY thing that survives it, so it must not be keyed to a
    // record that no longer exists.
    test("🛑 le conflit survit à l'entité qu'il documente", async () => {
        await conflictingDelete();
        await pushOutbox();
        expect(await readAll("features")).toHaveLength(0);
        expect(await readAll("conflicts")).toHaveLength(1);
    });
});
