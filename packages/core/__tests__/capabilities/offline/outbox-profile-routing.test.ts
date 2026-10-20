/**
 * A queued write belongs to the profile it was captured under.
 *
 * 🛑 What this suite guards: the drain resolves a write's TARGET from the profile active at
 * drain time. A profile switch reloads the page and drains on boot, so an entry captured
 * under profile A was replayed under profile B:
 *
 *  1. B declares a writable layer with the SAME id — the capture left for B's endpoint, with
 *     B's credentials, and nothing said so;
 *  2. B has no such layer — the capture was set aside on the spot (`layerNoLongerWritable`),
 *     shown to the operator as stuck under a profile that is not its own.
 *
 * An entry now carries the profile it was captured under, and the drain only replays the
 * active profile's entries; the others wait, untouched. An entry written before the field
 * existed carries none, and keeps the former behaviour.
 *
 * Runs against `fake-indexeddb` with a controlled `fetch`, as `push-engine.test.js` does:
 * what is asserted is the request really sent and the state really persisted.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DB_NAME = "geoleaf-outbox-profile-routing";

interface Row {
    id: string;
    state: string;
    layerId: string;
    profileId?: string;
    quarantine?: string;
}

interface Profile {
    id: string;
    layers: Array<Record<string, unknown>>;
}

/** A writable `sites` layer, posting to the given endpoint. */
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
const PROFILE_C: Profile = { id: "profil-c", layers: [] };

type Db = {
    _db: IDBDatabase;
    _dbName: string;
    init(): Promise<void>;
    close(): void;
    _ensureModule(name: string): unknown;
    getSyncCounts(
        layerIds: readonly string[]
    ): Promise<Record<string, { pendingCount: number; quarantinedCount: number }> | null>;
    listPendingEdits(options?: { allProfiles?: boolean }): Promise<Array<{ profileId?: string }>>;
};

let IndexedDB: Db;
let applyEdit: (input: Record<string, unknown>) => Promise<unknown>;
let pushOutbox: () => Promise<{ pushed: number; failed: number }>;
let requeueQuarantined: (id: string) => Promise<{ ok: boolean; refused?: string }>;
let readSyncStatus: () => Promise<{ owed: number; quarantined: number }>;
let active: Profile;
let fetchSpy: ReturnType<typeof vi.fn>;

const host = globalThis as unknown as { GeoLeaf?: unknown; fetch?: unknown };

function activate(profile: Profile): void {
    active = profile;
}

function readOutbox(): Promise<Row[]> {
    return new Promise((resolve, reject) => {
        const req = IndexedDB._db
            .transaction(["outbox"], "readonly")
            .objectStore("outbox")
            .getAll();
        req.onsuccess = () => resolve(req.result as Row[]);
        req.onerror = () => reject(req.error);
    });
}

/** Overwrites one stored row — how an entry written before `profileId` existed is seeded. */
function rewriteRow(row: Row & { seq?: number }): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = IndexedDB._db
            .transaction(["outbox"], "readwrite")
            .objectStore("outbox")
            .put(row);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

const urls = (): string[] => fetchSpy.mock.calls.map((call) => String(call[0]));

async function capture(title: string): Promise<void> {
    await applyEdit({
        layerId: "sites",
        kind: "create",
        feature: {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-60.64, -32.94] },
            properties: { title },
        },
    });
}

describe("la file d'écriture route chaque entrée vers SON profil", () => {
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
        ({ pushOutbox } =
            (await import("../../../src/capabilities/offline/write/push-engine.js")) as unknown as {
                pushOutbox: typeof pushOutbox;
            });
        ({ readSyncStatus } =
            (await import("../../../src/capabilities/offline/write/sync-status.js")) as unknown as {
                readSyncStatus: typeof readSyncStatus;
            });
        ({ requeueQuarantined } =
            (await import("../../../src/capabilities/offline/write/quarantine-api.js")) as unknown as {
                requeueQuarantined: typeof requeueQuarantined;
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
        fetchSpy = vi.fn(async () => ({ ok: true, status: 201, json: async () => [{ id: 7 }] }));
        host.fetch = fetchSpy;
        IndexedDB.close();
        IndexedDB._dbName = DB_NAME;
        await IndexedDB.init();
    });

    afterEach(async () => {
        IndexedDB.close();
        delete host.GeoLeaf;
        delete host.fetch;
        await new Promise<void>((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    it("l'entrée porte le profil sous lequel elle a été saisie", async () => {
        await capture("Saisi sous A");
        const [row] = await readOutbox();
        expect(row?.profileId).toBe("profil-a");
    });

    it("🛑 après une bascule vers un profil à couche HOMONYME, rien ne part vers sa cible", async () => {
        await capture("Saisi sous A");
        activate(PROFILE_B);
        await pushOutbox();

        expect(urls().filter((u) => u.includes("backend-b"))).toEqual([]);
        const [row] = await readOutbox();
        expect(row?.state).toBe("pending");
    });

    it("🛑 après une bascule vers un profil SANS la couche, l'entrée attend — pas de mise à l'écart", async () => {
        await capture("Saisi sous A");
        activate(PROFILE_C);
        await pushOutbox();

        const [row] = await readOutbox();
        expect(row?.state).toBe("pending");
        expect(row?.quarantine).toBeUndefined();
    });

    it("revenue sous son profil, l'entrée part vers SA cible", async () => {
        await capture("Saisi sous A");
        activate(PROFILE_B);
        await pushOutbox();
        activate(PROFILE_A);
        await pushOutbox();

        expect(urls().some((u) => u.includes("backend-a"))).toBe(true);
        expect(urls().some((u) => u.includes("backend-b"))).toBe(false);
        expect(await readOutbox()).toEqual([]);
    });

    it("le compteur du profil actif ne compte pas les écritures de l'autre", async () => {
        await capture("Saisi sous A");
        activate(PROFILE_B);
        const counts = await IndexedDB.getSyncCounts(["sites"]);
        expect(counts?.["sites"]?.pendingCount).toBe(0);
        activate(PROFILE_A);
        const own = await IndexedDB.getSyncCounts(["sites"]);
        expect(own?.["sites"]?.pendingCount).toBe(1);
    });

    it("le bandeau de synchronisation ne compte que le profil actif", async () => {
        await capture("Saisi sous A");
        activate(PROFILE_B);
        expect(await readSyncStatus()).toMatchObject({ owed: 0, quarantined: 0 });
        activate(PROFILE_A);
        expect(await readSyncStatus()).toMatchObject({ owed: 1 });
    });

    it("la liste des éditions en attente : le profil actif, sauf `allProfiles`", async () => {
        await capture("Saisi sous A");
        activate(PROFILE_B);
        expect(await IndexedDB.listPendingEdits()).toEqual([]);
        const all = await IndexedDB.listPendingEdits({ allProfiles: true });
        expect(all.map((edit) => edit.profileId)).toEqual(["profil-a"]);
    });

    it("🛑 une couche homonyme du profil actif ne « lève » pas la quarantaine d'un autre profil", async () => {
        await capture("Saisi sous A");
        activate(PROFILE_C);
        const [row] = await readOutbox();
        const outbox = IndexedDB._ensureModule("Outbox") as {
            updateState(id: string, state: string, patch: unknown): Promise<void>;
        };
        await outbox.updateState(row!.id, "quarantined", { quarantine: "layerNoLongerWritable" });
        activate(PROFILE_B);

        const outcome = await requeueQuarantined(row!.id);

        expect(outcome).toMatchObject({ ok: false, refused: "causeStillPresent" });
        activate(PROFILE_A);
        expect(await requeueQuarantined(row!.id)).toMatchObject({ ok: true });
    });

    it("une entrée d'avant le champ (sans profileId) garde le comportement d'avant", async () => {
        await capture("Saisi avant la 3.18.0");
        const [row] = (await readOutbox()) as Array<Row & { seq?: number }>;
        const { profileId: _dropped, ...legacy } = row!;
        await rewriteRow(legacy);
        activate(PROFILE_B);
        await pushOutbox();

        expect(urls().some((u) => u.includes("backend-b"))).toBe(true);
        expect(await readOutbox()).toEqual([]);
    });
});

/**
 * Two tabs, one database: the drain of the second waits for the first.
 *
 * Two module instances of the engine stand for two JavaScript contexts — each has its own
 * `_draining`, which is exactly what two tabs have. The fake `LockManager` serialises the
 * callbacks it is given, as the Web Locks API does for one name.
 */
describe("deux contextes ne vident pas la file en même temps", () => {
    let requested: string[];
    let tail: Promise<unknown>;
    const nav = globalThis.navigator as unknown as Record<string, unknown>;

    beforeEach(async () => {
        requested = [];
        tail = Promise.resolve();
        Object.defineProperty(nav, "locks", {
            configurable: true,
            value: {
                request: (name: string, cb: () => Promise<unknown>) => {
                    requested.push(name);
                    const run = tail.then(() => cb());
                    tail = run.catch(() => undefined);
                    return run;
                },
            },
        });
        activate(PROFILE_A);
        host.GeoLeaf = {
            Config: {
                getActiveProfile: () => ({ layers: active.layers }),
                getActiveProfileId: () => active.id,
            },
        };
        // A slow server, so that both drains are in progress at once.
        fetchSpy = vi.fn(
            () =>
                new Promise((resolve) =>
                    setTimeout(
                        () => resolve({ ok: true, status: 201, json: async () => [{ id: 7 }] }),
                        20
                    )
                )
        );
        host.fetch = fetchSpy;
        IndexedDB.close();
        IndexedDB._dbName = DB_NAME;
        await IndexedDB.init();
    });

    afterEach(async () => {
        delete nav["locks"];
        IndexedDB.close();
        delete host.GeoLeaf;
        delete host.fetch;
        await new Promise<void>((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    it("🛑 une capture ne part qu'une fois quand deux contextes vident ensemble", async () => {
        await capture("Saisi une fois");
        vi.resetModules();
        const { StorageContract: second } =
            await import("../../../src/kernel/shared/storage-contract.js");
        (second as unknown as { init(m: unknown): void }).init({
            get DB() {
                return IndexedDB;
            },
            isAvailable: () => true,
        });
        const { pushOutbox: otherTab } =
            (await import("../../../src/capabilities/offline/write/push-engine.js")) as unknown as {
                pushOutbox: typeof pushOutbox;
            };

        await Promise.all([pushOutbox(), otherTab()]);

        expect(requested).toEqual(["geoleaf-outbox-drain", "geoleaf-outbox-drain"]);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(await readOutbox()).toEqual([]);
    });
});
