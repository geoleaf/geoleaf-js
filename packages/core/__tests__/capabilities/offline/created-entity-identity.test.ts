/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * An entity CREATED on the device keeps one identity from the layer's point of view — at the
 * next load, and in what leaves for the server.
 *
 * The chain it guards: a creation is stored as the form submitted it — a geometry and
 * attributes, NO `id` and no `properties.id`; its identity is the record's KEY (`loc:<uuid>`).
 * Everything that puts the stored entity back on a layer read it without that key:
 *  - the restore of pending edits (`poi-restore.ts`) merged it id-less, and `mergeFeatures`
 *    never dedups an id-less feature — one more copy per restore pass, none of them findable
 *    by `getFeatureById`, none of them editable;
 *  - the device-first read of a layer (`IndexedDB.getLayerFeatureCollection`) served it
 *    id-less the same way.
 * And the other direction: once the layer carries the identity, an edit of that entity sends it
 * back in `properties.id` — which a layer without a property whitelist would have pushed to the
 * server as `id: "loc:…"`.
 *
 * Every case marked `🛑` is a TARGET, seen red before the fix. Plain titles are PREMISES or
 * GUARDS against over-reach: green before and after.
 *
 * Runs against `fake-indexeddb` with the real engine and the real layer store, like
 * `partial-edit-keeps-feature.test.ts`.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-created-identity";
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

/** A capture as the editor submits it: a position and its attributes, no identity. */
const captured = {
    type: "Feature",
    geometry: POSITION,
    properties: { title: "Relevé", state: "ok" },
};

/** Writable layer declaring a property whitelist. */
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

/** Writable layer declaring NO whitelist: every property of the entity leaves. */
const OPEN = {
    id: "open",
    edition: { create: true, update: true, delete: true },
    offline: { enabled: true, maxFeatures: 100 },
    write: {
        enabled: true,
        endpoint: `${ENDPOINT}-open`,
        dialect: "collection",
        geometryProperty: "geom",
    },
};

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
    vi.stubGlobal("GeoLeaf", {
        Config: { getActiveProfile: () => ({ layers: [SITES, OPEN] }) },
    });
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
    // The layer as the map holds it: one feature the server already served.
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

/** Captures one entity on `layerId` and returns its client identity. */
async function capture(layerId = "sites"): Promise<string> {
    const report = await applyEdit({ layerId, kind: "create", feature: captured });
    expect(report.refused).toBeNull();
    return report.localId;
}

describe("la restauration pose l'identité de l'enregistrement", () => {
    test("prémisse : la saisie est stockée sans identité, sa clé est client", async () => {
        const localId = await capture();
        expect(localId.startsWith("loc:")).toBe(true);
        const [record] = await readAll("features");
        expect(record.feature.id).toBeUndefined();
        expect(record.feature.properties.id).toBeUndefined();
    });

    test("🛑 deux passes de restauration : UNE copie, trouvable par sa clé", async () => {
        const localId = await capture();
        const layers = buildLayersPublicApi();

        await restorePendingPois({ layers });
        await restorePendingPois({ layers });

        // Before the fix: 3 — the served feature plus one id-less copy per pass.
        expect(layers.getFeatureCount("sites")).toBe(2);
        expect(layers.getFeatureById("sites", localId)?.properties?.id).toBe(localId);
    });

    test("🛑 création déjà poussée, modification en attente : l'identité est celle du SERVEUR", async () => {
        const localId = await capture();
        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId,
            feature: { type: "Feature", properties: { title: "Renommé" } },
        });
        const layers = buildLayersPublicApi();

        await restorePendingPois({ layers });

        // The network serves this entity as "7": stamped with its client key it would show
        // beside the server's row instead of replacing it.
        expect(layers.getFeatureById("sites", "7")?.properties?.title).toBe("Renommé");
        // And only under it: an edit addressed to "7" still reaches this record, which the
        // store resolves through its `serverId` index.
        expect(layers.getFeatureById("sites", localId)).toBeNull();
    });

    test("garde : une entité qui porte déjà son identité n'est pas re-tamponnée", async () => {
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
        const layers = buildLayersPublicApi();

        await restorePendingPois({ layers });

        expect(layers.getFeatureCount("sites")).toBe(1);
        expect(layers.getFeatureById("sites", "3")?.properties?.title).toBe("Modifié");
    });
});

describe("la lecture locale d'une couche pose la même identité", () => {
    test("🛑 une saisie en attente est servie sous sa clé client", async () => {
        const localId = await capture();

        const fc = await IndexedDB.getLayerFeatureCollection("sites");

        expect(fc.features).toHaveLength(1);
        expect(fc.features[0].id).toBe(localId);
        expect(fc.features[0].properties.id).toBe(localId);
    });

    test("🛑 une saisie poussée est servie sous l'identité du serveur", async () => {
        await capture();
        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();

        const fc = await IndexedDB.getLayerFeatureCollection("sites");

        expect(fc.features[0].properties.id).toBe("7");
    });

    test("garde : le tampon ne s'écrit pas dans l'enregistrement", async () => {
        await capture();
        await IndexedDB.getLayerFeatureCollection("sites");

        const [record] = await readAll("features");
        expect(record.feature.properties.id).toBeUndefined();
    });
});

describe("la clé client ne voyage jamais comme attribut", () => {
    test("🛑 une modification portant `properties.id` = sa clé client ne la stocke pas", async () => {
        const localId = await capture();
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId,
            feature: {
                type: "Feature",
                id: localId,
                geometry: POSITION,
                properties: { id: localId, title: "Déplacé" },
            },
        });

        const [record] = await readAll("features");
        expect(record.feature.id).toBeUndefined();
        expect(record.feature.properties).toEqual({ title: "Déplacé", state: "ok" });
    });

    test('🛑 couche sans liste blanche : le POST ne porte pas `id: "loc:…"`', async () => {
        const localId = await capture("open");
        await applyEdit({
            layerId: "open",
            kind: "update",
            localId,
            feature: { type: "Feature", properties: { id: localId, title: "Déplacé" } },
        });

        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();

        expect(bodyOf(0).id).toBeUndefined();
        expect(bodyOf(0).local_id).toBe(localId);
        expect(bodyOf(0).title).toBe("Déplacé");
    });

    test("garde : une entité serveur jamais tirée garde son `properties.id`", async () => {
        // The editor addresses it by the id the map carries; the store keys it `srv:PT-42`.
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "PT-42",
            feature: {
                type: "Feature",
                geometry: POSITION,
                properties: { id: "PT-42", title: "x" },
            },
        });

        const [record] = await readAll("features");
        expect(record.localId).toBe("srv:PT-42");
        expect(record.feature.properties.id).toBe("PT-42");
    });
});
