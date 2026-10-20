/**
 * A local edit is drawn only under the profile it was captured under.
 *
 * 🛑 What this suite guards: a queued write carries its `profileId`, and the drain only replays
 * the active profile's entries. But the ENTITY it edits lives in the `features` store, keyed
 * `[layerId, localId]` and shared by every profile of the origin. After a switch to a profile
 * declaring a layer of the same id, two readers drew the other profile's work on it:
 *
 *  1. the boot restore (`restorePendingPois`) merged its creations;
 *  2. the device-first read (`getLayerFeatureCollection`) returned its pending captures;
 *  3. the boot restore also replayed the other profile's deletions on this profile's layer.
 *
 * An entry written before `profileId` existed carries none, and stays visible everywhere — the
 * same rule as the drain's.
 *
 * Runs against `fake-indexeddb`, as `outbox-profile-routing.test.ts` does: what is asserted is
 * what the real stores hand back.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DB_NAME = "geoleaf-local-view-profile";

interface Profile {
    id: string;
    layers: Array<Record<string, unknown>>;
}

/** A writable `sites` layer — the same id under both profiles. */
function sitesLayer(endpoint: string): Record<string, unknown> {
    return {
        id: "sites",
        edition: { create: true, update: true, delete: true },
        write: {
            enabled: true,
            endpoint,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["title"],
        },
    };
}

const PROFILE_A: Profile = { id: "profil-a", layers: [sitesLayer("https://backend-a.test/sites")] };
const PROFILE_B: Profile = { id: "profil-b", layers: [sitesLayer("https://backend-b.test/sites")] };

interface Collection {
    features: Array<{ id?: unknown; properties?: Record<string, unknown> }>;
}

type Db = {
    _db: IDBDatabase;
    _dbName: string;
    init(): Promise<void>;
    close(): void;
    getLayerFeatureCollection(layerId: string): Promise<Collection | null>;
    putLayerFeatures(records: readonly Record<string, unknown>[]): Promise<unknown>;
};

interface RestoreResult {
    merged: number;
    deleted: number;
}

let IndexedDB: Db;
let applyEdit: (input: Record<string, unknown>) => Promise<{ localId: string }>;
let restorePendingPois: (deps: { layers: unknown }) => Promise<RestoreResult>;
let active: Profile;

const host = globalThis as unknown as { GeoLeaf?: unknown };

function activate(profile: Profile): void {
    active = profile;
}

/** Removes `profileId` from every queued row — how an entry written before 3.18.0 is seeded. */
function stripProfiles(): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = IndexedDB._db.transaction(["outbox"], "readwrite");
        const store = tx.objectStore("outbox");
        const req = store.getAll();
        req.onsuccess = () => {
            for (const row of req.result as Array<Record<string, unknown>>) {
                delete row["profileId"];
                store.put(row);
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function capture(title: string): Promise<{ localId: string }> {
    return applyEdit({
        layerId: "sites",
        kind: "create",
        feature: {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-60.64, -32.94] },
            properties: { title },
        },
    });
}

/** A synchronised entity both profiles' layers hold under the same key. */
function seedSynced(): Promise<unknown> {
    return IndexedDB.putLayerFeatures([
        {
            layerId: "sites",
            localId: "srv:1",
            serverId: "1",
            syncState: "synced",
            updatedAt: 1,
            version: null,
            feature: {
                type: "Feature",
                id: "1",
                geometry: { type: "Point", coordinates: [-60.6, -32.9] },
                properties: { id: "1", title: "Entité tirée" },
            },
        },
    ]);
}

/** The `GeoLeaf.Layers` seam the restore pushes to, recording what it receives. */
function fakeLayers() {
    return {
        hasLayer: () => true,
        mergeFeatures: vi.fn(),
        removeFeature: vi.fn(() => true),
    };
}

const titles = (collection: Collection | null): unknown[] =>
    (collection?.features ?? []).map((f) => f.properties?.["title"]);

describe("une saisie locale ne se dessine que sous SON profil", () => {
    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } =
            (await import("../../../src/capabilities/offline/db/indexeddb.js")) as unknown as {
                IndexedDB: Db;
            });
        const { StorageContract } = await import("../../../src/kernel/shared/storage-contract.js");
        ({ applyEdit } =
            (await import("../../../src/capabilities/offline/write/local-edit-api.js")) as unknown as {
                applyEdit: typeof applyEdit;
            });
        ({ restorePendingPois } =
            (await import("../../../src/capabilities/offline/poi-restore/poi-restore.js")) as unknown as {
                restorePendingPois: typeof restorePendingPois;
            });
        (StorageContract as unknown as { init(m: unknown): void }).init({
            get DB() {
                return IndexedDB;
            },
            isAvailable: () => true,
        });
    });

    beforeEach(async () => {
        activate(PROFILE_A);
        host.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({ layers: active.layers }),
                getActiveProfileId: () => active.id,
            },
        };
        IndexedDB.close();
        IndexedDB._dbName = DB_NAME;
        await IndexedDB.init();
    });

    afterEach(async () => {
        IndexedDB.close();
        delete host.GeoLeaf;
        await new Promise<void>((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    describe("restauration du boot", () => {
        it("🛑 une création saisie sous A n'est pas fusionnée sous B", async () => {
            await capture("Saisi sous A");
            activate(PROFILE_B);
            const layers = fakeLayers();

            const result = await restorePendingPois({ layers });

            expect(result.merged).toBe(0);
            expect(layers.mergeFeatures).not.toHaveBeenCalled();
        });

        it("🛑 une suppression saisie sous A ne retire rien de la couche de B", async () => {
            await seedSynced();
            await applyEdit({ layerId: "sites", kind: "delete", localId: "srv:1" });
            activate(PROFILE_B);
            const layers = fakeLayers();

            const result = await restorePendingPois({ layers });

            expect(result.deleted).toBe(0);
            expect(layers.removeFeature).not.toHaveBeenCalled();
        });

        it("témoin : sous A, la création est fusionnée", async () => {
            await capture("Saisi sous A");
            const layers = fakeLayers();

            const result = await restorePendingPois({ layers });

            expect(result.merged).toBe(1);
        });

        it("témoin : une entrée sans profil (antérieure à 3.18.0) est fusionnée partout", async () => {
            await capture("Saisi avant le champ");
            await stripProfiles();
            activate(PROFILE_B);
            const layers = fakeLayers();

            const result = await restorePendingPois({ layers });

            expect(result.merged).toBe(1);
        });
    });

    describe("lecture locale de la couche", () => {
        it("🛑 la saisie en attente de A n'est pas rendue sous B", async () => {
            await seedSynced();
            await capture("Saisi sous A");
            activate(PROFILE_B);

            const collection = await IndexedDB.getLayerFeatureCollection("sites");

            expect(titles(collection)).toEqual(["Entité tirée"]);
        });

        it("🛑 une couche que seule la saisie de A remplit se lit comme jamais tirée sous B", async () => {
            await capture("Saisi sous A");
            activate(PROFILE_B);

            // `null`, not an empty collection: B never pulled this layer, so its loader must
            // fall back to the network rather than display zero entities.
            expect(await IndexedDB.getLayerFeatureCollection("sites")).toBeNull();
        });

        // ⚠️ KNOWN LIMIT, frozen on purpose. A deletion leaves the record `pending`, and the store
        // keeps ONE record per `[layerId, localId]` for every profile: under B it is an entity
        // holding another profile's queued work, so it stays out of B's layer until that work
        // leaves the queue — not because it is deleted, but because its state is not B's to
        // draw. The day the store is partitioned by profile, this case turns red and must say
        // the entity is drawn.
        it("limite connue : une entité que A a supprimée reste hors de la couche de B tant que la suppression est en file", async () => {
            await seedSynced();
            await applyEdit({ layerId: "sites", kind: "delete", localId: "srv:1" });
            activate(PROFILE_B);

            const collection = await IndexedDB.getLayerFeatureCollection("sites");

            expect(titles(collection)).toEqual([]);
        });

        it("témoin : sous A, la saisie est rendue et la suppression masque", async () => {
            await seedSynced();
            await capture("Saisi sous A");
            await applyEdit({ layerId: "sites", kind: "delete", localId: "srv:1" });

            const collection = await IndexedDB.getLayerFeatureCollection("sites");

            expect(titles(collection)).toEqual(["Saisi sous A"]);
        });

        it("témoin : une entité que B a aussi éditée reste dessinée sous B", async () => {
            const { localId } = await capture("Saisi sous A");
            activate(PROFILE_B);
            await applyEdit({
                layerId: "sites",
                kind: "update",
                localId,
                feature: { type: "Feature", properties: { title: "Repris sous B" } },
            });

            const collection = await IndexedDB.getLayerFeatureCollection("sites");

            expect(titles(collection)).toEqual(["Repris sous B"]);
        });

        it("témoin : une saisie sans profil (antérieure à 3.18.0) est rendue partout", async () => {
            await capture("Saisi avant le champ");
            await stripProfiles();
            activate(PROFILE_B);

            const collection = await IndexedDB.getLayerFeatureCollection("sites");

            expect(titles(collection)).toEqual(["Saisi avant le champ"]);
        });
    });
});
