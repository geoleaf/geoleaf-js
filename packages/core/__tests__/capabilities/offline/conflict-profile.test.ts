/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * An archived conflict is read, and purged, under the profile whose write met it.
 *
 * 🛑 What this suite guards: the `conflicts` store is keyed `[layerId, localId]` and shared by
 * every profile of the origin. A conflict settled for a write queued under one profile was
 * listed under another — whose layer merely shares the id — and a purge under the other erased
 * it before anyone under the first had looked at it.
 *
 * A conflict archived before 3.18.0 carries no profile, and stays visible everywhere — the same
 * rule as the queue's.
 *
 * Every case below is a TARGET (`🛑`), seen red before the fix, or a plain title: a GUARD, green
 * before the fix as after it, whose bite was seen by mutating the fix (the mutations are named
 * in the commit that brought them).
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-conflict-profile";

// ⚠️ Loaded DYNAMICALLY, after `fake-indexeddb/auto` installed `indexedDB`.
let IndexedDB: any;
let StorageContract: any;
let recordConflict: any;
let listConflicts: any;
let clearConflicts: any;

let activeId: string;

/** Archives one conflict the way the drain does, for a write queued under `profileId`. */
function settle(localId: string, profileId: string | undefined): Promise<void> {
    return recordConflict(
        {
            id: `entry-${localId}`,
            kind: "update",
            layerId: "sites",
            localId,
            baseVersion: null,
            state: "inFlight",
            attempts: 1,
            createdAt: 1,
            ...(profileId === undefined ? {} : { profileId }),
        },
        { layerId: "sites", localId, serverId: localId.replace("srv:", "") },
        { version: null, row: null, outcome: "unreadable" }
    );
}

const ids = (records: Array<{ localId: string }>): string[] => records.map((r) => r.localId).sort();

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ recordConflict, listConflicts, clearConflicts } =
        await import("../../../src/capabilities/offline/write/conflict-store.js"));
});

beforeEach(async () => {
    activeId = "profil-a";
    vi.stubGlobal("GeoLeaf", {
        Config: { getActiveProfile: () => ({ layers: [] }), getActiveProfileId: () => activeId },
    });
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

describe("un conflit archivé reste à son profil", () => {
    test("prémisse : sous A, A lit le conflit de sa propre écriture", async () => {
        await settle("srv:1", "profil-a");
        expect(ids(await listConflicts())).toEqual(["srv:1"]);
    });

    test("🛑 sous B, le conflit d'une écriture de A n'est pas listé", async () => {
        await settle("srv:1", "profil-a");
        activeId = "profil-b";
        expect(await listConflicts()).toEqual([]);
        expect(await listConflicts("sites")).toEqual([]);
    });

    test("🛑 sous B, une purge ne retire pas le conflit de A", async () => {
        await settle("srv:1", "profil-a");
        await settle("srv:2", "profil-b");
        activeId = "profil-b";
        await clearConflicts("sites");

        activeId = "profil-a";
        expect(ids(await listConflicts())).toEqual(["srv:1"]);
    });

    test("`allProfiles` lit et purge ceux de tous les profils, chacun disant le sien", async () => {
        await settle("srv:1", "profil-a");
        await settle("srv:2", "profil-b");
        const all = await listConflicts(undefined, { allProfiles: true });
        expect(all.map((r: any) => [r.localId, r.profileId]).sort()).toEqual([
            ["srv:1", "profil-a"],
            ["srv:2", "profil-b"],
        ]);

        await clearConflicts(undefined, { allProfiles: true });
        expect(await listConflicts(undefined, { allProfiles: true })).toEqual([]);
    });

    test("un conflit archivé avant 3.18.0, sans profil, reste visible partout", async () => {
        await settle("srv:1", undefined);
        activeId = "profil-b";
        expect(ids(await listConflicts())).toEqual(["srv:1"]);
    });
});
