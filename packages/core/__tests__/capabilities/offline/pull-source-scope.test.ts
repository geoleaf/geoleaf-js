/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * What a pull caches belongs to the SOURCE that served it — not to the layer id alone.
 *
 * 🛑 What this suite guards: the `features` store is keyed `[layerId, localId]`, shared by every
 * profile of the origin, and the pull state was one entry per layer id. Two profiles declaring a
 * layer of the same id over two DIFFERENT sources therefore met in both:
 *
 *  1. a complete pull under B swept the entities A had pulled — B's source did not name them;
 *  2. under A, the layer drew what B had pulled;
 *  3. under A, a layer only B had pulled read as pulled and empty, instead of loading from the
 *     network.
 *
 * Two profiles over the SAME source share the cache, as they always did: the entities are the
 * same rows. A record or a pull state written before the source was recorded carries none, and
 * keeps the old behaviour — visible and swept everywhere.
 *
 * Every case below is a TARGET (`🛑`), seen red before the fix, or a plain title: a PREMISE or a
 * GUARD, green before the fix as after it, whose bite was seen by mutating the fix (the
 * mutations are named in the commit that brought them).
 *
 * Runs against `fake-indexeddb` with the real store and the real pull, as
 * `pull-converges.test.ts` does.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-pull-source-scope";
const SOURCE_A = "https://backend-a.test/ogc";
const SOURCE_B = "https://backend-b.test/ogc";
const T1 = "2026-09-01T08:00:00+00:00";

// ⚠️ Loaded DYNAMICALLY, after `fake-indexeddb/auto` has installed `indexedDB`.
let IndexedDB: any;
let StorageContract: any;
let pullLayer: any;

interface Profile {
    id: string;
    layer: any;
}

let active: Profile;
let profileA: Profile;
let profileB: Profile;
/** Every URL a source was asked for, in order. */
let requests: URL[];
/** What each source holds, by its URL. */
let sources: Map<string, Map<number, Row>>;

interface Row {
    type: "Feature";
    id: number;
    geometry: { type: "Point"; coordinates: number[] };
    properties: Record<string, unknown>;
}

/** An entity as an OGC API Features server returns it: `id` on top AND in the properties. */
function row(id: number, title: string, updatedAt = T1): Row {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [-60.64 + id / 1000, -32.94] },
        properties: { id, local_id: null, title, updated_at: updatedAt },
    };
}

function sitesLayer(url: string): any {
    return { id: "sites", offline: { enabled: true, maxFeatures: 1000, source: { url } } };
}

/** Serves every declared source from `sources`, by the request's origin and path. */
function serveSources(): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown) => {
            const url = new URL(String(input));
            requests.push(url);
            const base = [...sources.keys()].find((s) => url.href.startsWith(s));
            const all = [...(base ? sources.get(base)! : new Map()).values()];
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    type: "FeatureCollection",
                    numberMatched: all.length,
                    numberReturned: all.length,
                    features: all,
                    links: [{ rel: "self", href: url.toString() }],
                }),
            };
        })
    );
}

function activate(profile: Profile): void {
    active = profile;
}

const titles = (collection: { features: any[] } | null): unknown[] =>
    (collection?.features ?? []).map((f) => f.properties?.title).sort();

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ pullLayer } = await import("../../../src/capabilities/offline/pull/layer-pull.js"));
});

beforeEach(async () => {
    requests = [];
    profileA = { id: "profil-a", layer: sitesLayer(SOURCE_A) };
    profileB = { id: "profil-b", layer: sitesLayer(SOURCE_B) };
    sources = new Map([
        [SOURCE_A, new Map([1, 2].map((id) => [id, row(id, `A${id}`)]))],
        [SOURCE_B, new Map([10, 11].map((id) => [id, row(id, `B${id}`)]))],
    ]);
    activate(profileA);
    vi.stubGlobal("GeoLeaf", {
        Config: {
            getActiveProfile: () => ({ layers: [active.layer] }),
            getActiveProfileId: () => active.id,
        },
    });
    serveSources();
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

describe("deux profils, une couche de même identifiant, deux sources", () => {
    test("prémisse : sous A seul, la couche dessine ce que A a tiré", async () => {
        await pullLayer("sites");
        expect(titles(await IndexedDB.getLayerFeatureCollection("sites"))).toEqual(["A1", "A2"]);
    });

    test("🛑 un rapatriement complet sous B ne balaie pas ce que A a tiré", async () => {
        await pullLayer("sites");
        activate(profileB);
        await pullLayer("sites");

        activate(profileA);
        expect(titles(await IndexedDB.getLayerFeatureCollection("sites"))).toEqual(["A1", "A2"]);
    });

    test("🛑 sous B, la couche ne dessine pas ce que A a tiré", async () => {
        await pullLayer("sites");
        activate(profileB);
        await pullLayer("sites");

        expect(titles(await IndexedDB.getLayerFeatureCollection("sites"))).toEqual(["B10", "B11"]);
    });

    test("🛑 une couche que seul B a tirée se lit, sous A, comme jamais tirée — le réseau prend le relais", async () => {
        activate(profileB);
        await pullLayer("sites");

        activate(profileA);
        expect(await IndexedDB.getLayerFeatureCollection("sites")).toBeNull();
    });

    test("deux profils sur la MÊME source partagent le cache, comme avant", async () => {
        profileB.layer = sitesLayer(SOURCE_A);
        await pullLayer("sites");

        activate(profileB);
        expect(titles(await IndexedDB.getLayerFeatureCollection("sites"))).toEqual(["A1", "A2"]);
        const second = await pullLayer("sites");
        expect(second.written).toBe(0);
        expect(second.unchanged).toBe(2);
    });

    test("une copie écrasée par l'autre source efface la marque : le delta suivant de A est complet", async () => {
        profileA.layer.offline.source.delta = {
            freshness: "datetime",
            deletedProperty: "deleted_at",
        };
        profileB.layer.offline.source.delta = {
            freshness: "datetime",
            deletedProperty: "deleted_at",
        };
        // Both sources serve an entity of id 1: the same store key, `srv:1`.
        sources.get(SOURCE_B)!.set(1, row(1, "B1"));
        await pullLayer("sites");
        activate(profileB);
        await pullLayer("sites");
        // Same marker on both sides: B's copy must still replace A's, or B's layer misses it.
        expect(titles(await IndexedDB.getLayerFeatureCollection("sites"))).toEqual([
            "B1",
            "B10",
            "B11",
        ]);

        activate(profileA);
        const again = await pullLayer("sites");
        expect(again.mode).toBe("full");
        expect(requests.at(-1)?.searchParams.get("datetime")).toBeNull();
        expect(titles(await IndexedDB.getLayerFeatureCollection("sites"))).toEqual(["A1", "A2"]);
    });

    test("une suppression servie par B ne retire pas la copie que A a tirée sous la même clé", async () => {
        profileB.layer.offline.source.delta = {
            freshness: "datetime",
            deletedProperty: "deleted_at",
        };
        await pullLayer("sites");
        // B's source serves its own entity 1 as deleted: the same store key as A's, `srv:1`.
        const gone = row(1, "B1");
        sources
            .get(SOURCE_B)!
            .set(1, { ...gone, properties: { ...gone.properties, deleted_at: T1 } });
        activate(profileB);
        await pullLayer("sites");

        activate(profileA);
        expect(titles(await IndexedDB.getLayerFeatureCollection("sites"))).toEqual(["A1", "A2"]);
    });

    test("le jumeau d'identité se cherche dans la même source : B n'écrit pas dans la clé de A", async () => {
        // A's server echoes the client identity of its entity 1; B's serves a row of id 1 too.
        const echoed = row(1, "A1");
        sources
            .get(SOURCE_A)!
            .set(1, { ...echoed, properties: { ...echoed.properties, local_id: "loc-1" } });
        await pullLayer("sites");
        sources.get(SOURCE_B)!.set(1, row(1, "B1"));
        activate(profileB);
        await pullLayer("sites");

        activate(profileA);
        expect(titles(await IndexedDB.getLayerFeatureCollection("sites"))).toEqual(["A1", "A2"]);
    });
});
