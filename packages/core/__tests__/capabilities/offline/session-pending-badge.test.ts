/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * An entity queued IN THIS SESSION carries the "pending" badge — not only after a reload.
 *
 * The badge (`_syncStatus: "pending"`, the orange stroke of `maplibre-sync-badge.ts`) was baked
 * by the restore of pending edits alone, at boot. A capture made since the boot was owed to the
 * server and drawn like any other entity, until the page was reloaded.
 *
 * 🛑 THE ORDER IS THE SUBJECT, and it was measured in a browser before this file was written:
 * the core announces the queue moved (`geoleaf:offline:outbox-queued`) BEFORE the capture is on
 * its layer — the editor writes the layer once the write is safe. Marking at the announcement
 * finds nothing. So the cases below put the feature on the layer AFTER `applyEdit` resolved,
 * as the editor does.
 *
 * Every case marked `🛑` is a TARGET: red while the module did not exist, and each bitten by a
 * mutation of the module named in the commit. Plain titles are PREMISES or GUARDS.
 *
 * Runs against `fake-indexeddb` with the real engine and the real layer store, like
 * `pushed-entity-badge.test.ts`, whose set-up it mirrors.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-session-badge";
const ENDPOINT = "https://backend.test/sites";
const T1 = "2026-09-01T08:00:00+00:00";
const POSITION = { type: "Point", coordinates: [-60.64, -32.94] };

let IndexedDB: any;
let StorageContract: any;
let applyEdit: any;
let pushOutbox: any;
let registerSessionBadge: any;
let buildLayersPublicApi: any;
let GeoJSONShared: any;

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
let detach: () => void;
let announced: string[];
const onUpdated = (e: Event) => announced.push((e as CustomEvent).detail?.layerId);

/** Answers every write with `reply`. */
function serve(reply: unknown): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, status: 200, json: async () => reply }))
    );
}

/** Lets the store read the module issues, and what follows it, land. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((done) => setTimeout(done, 0));
};

/** Puts a capture on its layer the way the editor does — AFTER the write is queued. */
function drawOnLayer(localId: string): void {
    layers.mergeFeatures("sites", [
        { ...captured, id: localId, properties: { ...captured.properties, id: localId } },
    ]);
}

/** The badge the layer paints for the entity `id` — `"pending"` is the orange stroke. */
const badgeOf = (id: string): unknown =>
    layers.getFeatureById("sites", id)?.properties?._syncStatus ?? null;

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
    ({ registerSessionBadge } =
        await import("../../../src/capabilities/offline/poi-restore/poi-restore-boot.js"));
    ({ buildLayersPublicApi } = await import("../../../src/kernel/geojson/layers-public-api.js"));
    ({ GeoJSONShared } = await import("../../../src/kernel/geojson/shared.js"));
});

beforeEach(async () => {
    layers = buildLayersPublicApi();
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
    GeoJSONShared.state.adapter = {
        updateLayerData: vi.fn(),
        setFeatureState: vi.fn(),
        applyDataDiff: vi.fn(() => true),
    };
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
    announced = [];
    document.addEventListener("geoleaf:layer:updated", onUpdated);
    detach = registerSessionBadge();
});

afterEach(async () => {
    detach?.();
    document.removeEventListener("geoleaf:layer:updated", onUpdated);
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

describe("le liseré « en attente » d'une saisie de la session", () => {
    test("🛑 une création mise en file, puis posée sur sa couche, le porte", async () => {
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        await settle();
        // The premise the order rests on: queued, and not on its layer yet.
        expect(layers.getFeatureById("sites", localId)).toBeNull();

        drawOnLayer(localId);
        await settle();

        expect(badgeOf(localId)).toBe("pending");
    });

    test("🛑 une entité servie, déjà sur sa couche, le porte dès sa modification", async () => {
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
        await settle();

        expect(badgeOf("3")).toBe("pending");
    });

    test("🛑 poussée, la création de la session ne le porte plus", async () => {
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        drawOnLayer(localId);
        await settle();
        expect(badgeOf(localId)).toBe("pending");

        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();

        expect(badgeOf(localId)).not.toBe("pending");
    });

    test("🛑 créée ici, nommée par le serveur, puis modifiée : le liseré va à son identité SUR LA COUCHE", async () => {
        // The queue holds an entity under its client key for ever; once the server named it, a
        // layer drawn from the store holds it under the server's id. Marked by the queue's key,
        // the badge would find nobody.
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        serve([{ id: 7, updated_at: T1 }]);
        await pushOutbox();
        // As a reload — or a re-read after a pull — draws it: what the store presents.
        const collection = await IndexedDB.getLayerFeatureCollection("sites");
        GeoJSONShared.state.layers.get("sites").features = collection.features;
        const drawn = collection.features.find((f: any) => f.properties.title === "Relevé");
        const onLayer = String(drawn.id ?? drawn.properties.id);
        // The premise: two names for one entity.
        expect(onLayer).not.toBe(localId);
        expect(badgeOf(onLayer)).toBeNull();

        const report = await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: onLayer,
            feature: { ...captured, properties: { ...captured.properties, title: "Corrigé" } },
        });
        await settle();

        expect(report.localId).toBe(localId);
        expect(badgeOf(onLayer)).toBe("pending");
    });

    test("une seconde modification de la même entité ne la repeint pas", async () => {
        const edit = (title: string) =>
            applyEdit({
                layerId: "sites",
                kind: "update",
                localId: "3",
                feature: { type: "Feature", geometry: POSITION, properties: { id: "3", title } },
            });
        await edit("Une fois");
        await settle();
        const afterFirst = announced.length;

        await edit("Deux fois");
        await settle();

        expect(badgeOf("3")).toBe("pending");
        // Already marked: no write, hence no announcement of its own.
        expect(announced.length).toBe(afterFirst);
    });

    test("🛑 poser le liseré n'entre pas en boucle sur sa propre annonce", async () => {
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        await settle();
        announced = [];

        drawOnLayer(localId);
        await settle();

        // The editor's write, then the mark — and nothing after.
        expect(announced).toEqual(["sites", "sites"]);
    });

    test("une suppression ne pose rien, et une création annulée n'attend plus sa couche", async () => {
        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        await applyEdit({ layerId: "sites", kind: "delete", localId });
        await settle();

        // Drawn late, by a caller that did not hear of the deletion: it is owed nothing.
        drawOnLayer(localId);
        await settle();

        expect(badgeOf(localId)).toBeNull();
    });

    test("une couche qui n'est pas affichée ne fait rien jeter", async () => {
        GeoJSONShared.state.layers.delete("sites");

        const report = await applyEdit({ layerId: "sites", kind: "create", feature: captured });
        await settle();

        expect(report.refused).toBeNull();
    });

    test("🛑 détaché, le module ne pose plus rien", async () => {
        detach();

        const { localId } = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: captured,
        });
        drawOnLayer(localId);
        await settle();

        expect(badgeOf(localId)).toBeNull();
    });
});
