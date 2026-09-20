/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * A layer that WAS pulled and came back empty is an EMPTY layer, not an unstored one.
 *
 * 🛑 THE DEFECT: `getLayerFeatureCollection` answers `null` on an empty store, and the loader
 * reads that `null` as "never pulled" — so it falls back to `data.*`, the display source, which
 * is a static file that may be months old. A user whose server no longer holds anything for the
 * layer, or whose download zone holds nothing, sees STALE ENTITIES believing they are theirs.
 * Silently: nothing in the interface says the store was bypassed.
 *
 * The distinction exists already — `offline.pullState` says what the last pull did — and nothing
 * read it. `null` keeps its meaning for a layer no pull ever reached; the fallback is what it is
 * for.
 *
 * ⚠️ A pull that FAILED or was cut leaves the fallback in place, deliberately: the store is empty
 * because the run did not conclude, not because the source is empty. Only a COMPLETE run speaks
 * for the layer's content.
 *
 * Every case is a TARGET (`🛑`), seen red on the defect before the fix, or a GUARD — green before
 * as after, whose bite was seen by mutating the fix.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-empty-pulled-layer";
const OGC = "https://backend.test/ogc";

// ⚠️ Loaded DYNAMICALLY, after `fake-indexeddb/auto` has installed `indexedDB`.
let IndexedDB: any;
let StorageContract: any;
let pullLayer: any;

let layer: any;

/** An entity as an OGC API Features server returns it. */
function row(id: number) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [-60.6 + id / 100, -32.9] },
        properties: { id, local_id: null, title: `Site ${id}`, updated_at: "2026-09-01T08:00:00Z" },
    };
}

/** Serves one page, exactly what the collection holds at that moment. */
function serve(features: ReturnType<typeof row>[]) {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                type: "FeatureCollection",
                numberMatched: features.length,
                numberReturned: features.length,
                features,
                links: [],
            }),
        }))
    );
}

/** A source that cannot be reached: the pull concludes `failed`. */
function serveUnreachable() {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            throw new Error("réseau coupé");
        })
    );
}

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ pullLayer } = await import("../../../src/capabilities/offline/pull/layer-pull.js"));
});

beforeEach(async () => {
    layer = { id: "sites", offline: { enabled: true, maxFeatures: 1000, source: { url: OGC } } };
    vi.stubGlobal("GeoLeaf", { Config: { getActiveProfile: () => ({ layers: [layer] }) } });
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

describe("une couche rapatriée et vide s'affiche VIDE", () => {
    test("🛑 un rapatriement complet qui ne rend rien n'est pas « jamais rapatriée »", async () => {
        serve([]);
        const report = await pullLayer("sites");
        expect(report.refused).toBeNull();
        expect(report.written).toBe(0);

        const read = await IndexedDB.getLayerFeatureCollection("sites");

        expect(read, "le magasin se dit vide, pas absent").not.toBeNull();
        expect(read.features).toEqual([]);
    });

    test("🛑 une couche VIDÉE par le balayage ne retombe pas sur la source d'affichage", async () => {
        // The scenario the convergence made frequent: the entities were there, the server
        // dropped them all, and the complete pull removed what it did not return.
        serve([row(1), row(2)]);
        await pullLayer("sites");
        expect((await IndexedDB.getLayerFeatureCollection("sites")).features).toHaveLength(2);

        serve([]);
        const second = await pullLayer("sites");
        expect(second.removed, "prémisse : le balayage a bien retiré les deux").toBe(2);

        const read = await IndexedDB.getLayerFeatureCollection("sites");

        expect(read, "la couche vidée est rendue « jamais rapatriée »").not.toBeNull();
        expect(read.features).toEqual([]);
    });

    test("une couche jamais rapatriée rend `null` — le repli réseau reste", async () => {
        expect(await IndexedDB.getLayerFeatureCollection("sites")).toBeNull();
    });

    test("un rapatriement en ÉCHEC laisse le repli réseau", async () => {
        serveUnreachable();
        const report = await pullLayer("sites");
        expect(report.refused, "prémisse : la course a bien échoué").toBe("sourceUnreachable");

        expect(await IndexedDB.getLayerFeatureCollection("sites")).toBeNull();
    });
});
