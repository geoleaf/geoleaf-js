/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * The "pending" badge the restore paints on an entity leaves it once the entity is pushed.
 *
 * The chain it guards: at boot, the restore of pending edits (`poi-restore.ts`) puts each owed
 * entity back on its layer with `_syncStatus: "pending"` baked into its properties — the orange
 * stroke of `maplibre-sync-badge.ts`. When the drain then pushes the entry, the engine writes the
 * server's answer into the RECORD and nothing else: the layer kept the badge until the next
 * load, saying "owed" of an entity the server already held.
 *
 * Every case marked `🛑` is a TARGET, seen red before the fix. Plain titles are PREMISES or
 * GUARDS against over-reach: green before and after.
 *
 * Runs against `fake-indexeddb` with the real engine and the real layer store, like
 * `created-entity-identity.test.ts`, whose set-up it mirrors.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-pushed-badge";
const ENDPOINT = "https://backend.test/sites";
const T1 = "2026-09-01T08:00:00+00:00";
const POSITION = { type: "Point", coordinates: [-60.64, -32.94] };

let IndexedDB: any;
let StorageContract: any;
let applyEdit: any;
let pushOutbox: any;
let restorePendingPois: any;
let buildLayersPublicApi: any;
let GeoJSONShared: any;

/** Answers every write with `reply` — or runs `during` first, while the push is in flight. */
function serve(reply: unknown, opts: { status?: number; during?: () => Promise<void> } = {}) {
    const status = opts.status ?? 200;
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            await opts.during?.();
            return { ok: status < 300, status, json: async () => reply };
        })
    );
}

const captured = {
    type: "Feature",
    geometry: POSITION,
    properties: { title: "Relevé", state: "ok" },
};

const SITES = {
    id: "sites",
    edition: { create: true, update: true, delete: true },
    offline: { enabled: true, maxFeatures: 100 },
    write: {
        enabled: true,
        endpoint: ENDPOINT,
        dialect: "collection",
        geometryProperty: "geom",
        properties: ["title", "state"],
    },
};

let layers: any;

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
    ({ restorePendingPois } =
        await import("../../../src/capabilities/offline/poi-restore/poi-restore.js"));
    ({ buildLayersPublicApi } = await import("../../../src/kernel/geojson/layers-public-api.js"));
    ({ GeoJSONShared } = await import("../../../src/kernel/geojson/shared.js"));
});

beforeEach(async () => {
    layers = buildLayersPublicApi();
    // The drain reaches the layer where the page does: `GeoLeaf.Layers`.
    vi.stubGlobal("GeoLeaf", {
        Config: { getActiveProfile: () => ({ layers: [SITES] }) },
        Layers: layers,
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
    GeoJSONShared.reset();
    GeoJSONShared.state.adapter = { updateLayerData: vi.fn(), setFeatureState: vi.fn() };
    GeoJSONShared.state.layers.set("sites", {
        id: "sites",
        config: {},
        geometryType: "point",
        features: [
            {
                type: "Feature",
                id: "3",
                geometry: POSITION,
                properties: { id: "3", title: "Servi" },
            },
        ],
    });
});

afterEach(async () => {
    GeoJSONShared.reset();
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

/** The badge the layer paints for the entity `id` — `"pending"` is the orange stroke. */
const badgeOf = (id: string): unknown =>
    layers.getFeatureById("sites", id)?.properties?._syncStatus ?? null;

describe("la pastille « en attente » quitte l'entité poussée", () => {
    test("prémisse : la restauration pose la pastille sur une création due", async () => {
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        await restorePendingPois({ layers });
        expect(badgeOf(localId)).toBe("pending");
    });

    test("🛑 une création restaurée puis poussée ne porte plus la pastille", async () => {
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        await restorePendingPois({ layers });

        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();

        // Before the fix: still "pending", until the next load.
        expect(badgeOf(localId)).not.toBe("pending");
    });

    test("🛑 une entité servie, modifiée, restaurée puis poussée ne porte plus la pastille", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "3",
            feature: {
                type: "Feature",
                geometry: POSITION,
                properties: { id: "3", title: "Modifié" },
            },
        });
        await restorePendingPois({ layers });
        expect(badgeOf("3")).toBe("pending");

        serve([{ id: "3", updated_at: T1 }]);
        await pushOutbox();

        expect(badgeOf("3")).not.toBe("pending");
    });

    test("garde : modifiée PENDANT l'envoi, l'entité reste due et garde la pastille", async () => {
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        await restorePendingPois({ layers });

        serve([{ id: 7, updated_at: T1 }], {
            during: async () => {
                // The engine tells an edit in flight by the record's `updatedAt`, to the
                // millisecond: an edit landing in the capture's own millisecond would pass for
                // none. Measured once under the full suite's load.
                await new Promise((r) => setTimeout(r, 5));
                await applyEdit({
                    layerId: "sites",
                    kind: "update",
                    localId,
                    feature: { type: "Feature", properties: { title: "Corrigé en vol" } },
                });
            },
        });
        await pushOutbox();

        expect(badgeOf(localId)).toBe("pending");
    });

    test("garde : une écriture refusée par le serveur garde la pastille", async () => {
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        await restorePendingPois({ layers });

        serve({ message: "refusé" }, { status: 422 });
        await pushOutbox();

        expect(badgeOf(localId)).toBe("pending");
    });

    test("garde : sans `GeoLeaf.Layers`, la poussée aboutit quand même", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: captured });
        vi.stubGlobal("GeoLeaf", { Config: { getActiveProfile: () => ({ layers: [SITES] }) } });

        serve([{ id: 7, updated_at: T1 }]);
        const report = await pushOutbox();

        expect(report.pushed).toBe(1);
    });
});
