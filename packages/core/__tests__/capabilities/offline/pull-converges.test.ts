/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * A pull CONVERGES on its source — the second one rewrites what changed, and only that.
 *
 * The freshness marker (`version`, read from the layer's `versionProperty`) was stored on every
 * record from the very first pull, to make a conflict detectable — and never read back by the
 * pull itself: every `synced` record was rewritten on every pull, and counted `written`, whether
 * the server had touched it or not.
 *
 * Every case below is a TARGET (`🛑`), seen red on the assertion of the defect before the fix,
 * or a plain title: a PREMISE — the scenario really reaches the point under test — or a GUARD,
 * green before the fix as after it, whose bite was seen by mutating the fix (the mutations are
 * named in the commits that brought them).
 *
 * Runs against `fake-indexeddb` with the real store and the real pull, and a SOURCE WITH STATE:
 * the test changes what the server holds between two pulls, the way a second download meets a
 * collection someone else edited in between.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const DB_NAME = "geoleaf-pull-converges";
const OGC = "https://backend.test/ogc";
const T1 = "2026-09-01T08:00:00+00:00";
const T2 = "2026-09-01T09:30:00+00:00";

// ⚠️ Loaded DYNAMICALLY, after `fake-indexeddb/auto` has installed `indexedDB`.
let IndexedDB: any;
let StorageContract: any;
let pullLayer: any;

let layer: any;
/** Every URL the source was asked for, in order. */
let requests: URL[];

const request = <T>(req: IDBRequest<T>) =>
    new Promise<T>((done, fail) => {
        req.onsuccess = () => done(req.result);
        req.onerror = () => fail(req.error);
    });

const readAll = (store: string): Promise<any[]> =>
    request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

/** An entity as an OGC API Features server returns it: `id` on top AND in the properties. */
function row(id: number, updatedAt: string | null = T1, title = `Site ${id}`) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [-60.64 + id / 1000, -32.94] },
        properties: {
            id,
            local_id: null,
            title,
            ...(updatedAt === null ? {} : { updated_at: updatedAt }),
        },
    };
}

/**
 * A collection whose content the test edits between two pulls, paginated by `offset` and
 * linked by `rel: "next"` — the shape the loader walks.
 */
function serveSource(initial: ReturnType<typeof row>[], pageSize = 10) {
    const rows = new Map<number, ReturnType<typeof row>>(initial.map((f) => [f.id, f]));
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown) => {
            const url = new URL(String(input));
            requests.push(url);
            // `bbox` as OGC API Features reads it: `west,south,east,north`, intersecting. The
            // rows are points, so intersecting is containing.
            const bbox = url.searchParams.get("bbox")?.split(",").map(Number);
            // `datetime` as OGC API Features Part 1 reads it: an interval, here `<start>/..`
            // (open end) — the rows whose temporal property, the freshness marker, falls in it.
            const since = url.searchParams.get("datetime")?.split("/")[0];
            const all = [...rows.values()].filter((f) => {
                if (since) {
                    const at = Date.parse(String((f.properties as any).updated_at));
                    if (!(at >= Date.parse(since))) return false;
                }
                if (!bbox) return true;
                // A missing ordinate reads NaN, and NaN compares false: a malformed `bbox`
                // matches nothing rather than everything.
                const [west = NaN, south = NaN, east = NaN, north = NaN] = bbox;
                const [x = NaN, y = NaN] = f.geometry.coordinates;
                return x >= west && y >= south && x <= east && y <= north;
            });
            const offset = Number(url.searchParams.get("offset") ?? 0);
            const page = all.slice(offset, offset + pageSize);
            const next = new URL(url);
            next.searchParams.set("offset", String(offset + pageSize));
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    type: "FeatureCollection",
                    numberMatched: all.length,
                    numberReturned: page.length,
                    features: page,
                    links:
                        offset + pageSize < all.length
                            ? [{ rel: "next", href: next.toString() }]
                            : [{ rel: "self", href: url.toString() }],
                }),
            };
        })
    );
    return rows;
}

/** The stored record of one entity, by its server identity. */
async function storedRow(id: number): Promise<any> {
    return (await readAll("features")).find((r) => r.serverId === String(id));
}

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ pullLayer } = await import("../../../src/capabilities/offline/pull/layer-pull.js"));
});

beforeEach(async () => {
    requests = [];
    layer = {
        id: "sites",
        offline: { enabled: true, maxFeatures: 1000, source: { url: OGC } },
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

describe("le second rapatriement ne réécrit que ce qui a changé", () => {
    test("prémisse : le premier rapatriement écrit tout, marqueur compris", async () => {
        serveSource([row(1), row(2), row(3)]);
        const report = await pullLayer("sites");
        expect(report.written).toBe(3);
        expect((await storedRow(2)).version).toEqual({ kind: "timestamp", value: T1 });
    });

    test("🛑 rien n'a changé côté serveur : rien n'est réécrit", async () => {
        serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        const second = await pullLayer("sites");
        expect(second.written).toBe(0);
        expect(second.unchanged).toBe(3);
    });

    test("🛑 une entité modifiée : elle seule est réécrite, avec son marqueur neuf", async () => {
        const rows = serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");
        const untouchedBefore = await storedRow(1);

        rows.set(2, row(2, T2, "Renommé côté serveur"));
        const second = await pullLayer("sites");

        expect(second.written).toBe(1);
        expect(second.unchanged).toBe(2);
        const changed = await storedRow(2);
        expect(changed.version).toEqual({ kind: "timestamp", value: T2 });
        expect(changed.feature.properties.title).toBe("Renommé côté serveur");
        // The untouched one was not even rewritten: its local write stamp did not move.
        expect((await storedRow(1)).updatedAt).toBe(untouchedBefore.updatedAt);
    });

    test("🛑 sans marqueur, rien ne dit qu'une entité n'a pas changé : elle est réécrite", async () => {
        serveSource([row(1), row(2, null), row(3)]);
        await pullLayer("sites");

        const second = await pullLayer("sites");
        expect(second.written).toBe(1);
        expect(second.unchanged).toBe(2);
    });

    test("une saisie locale reste préservée, et n'est comptée ni écrite ni inchangée", async () => {
        serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");
        const record = await storedRow(2);
        await IndexedDB._ensureModule("Features").put({ ...record, syncState: "pending" });

        const second = await pullLayer("sites");
        expect(second.preserved).toBe(1);
        expect(second.written + (second.unchanged ?? 0)).toBe(2);
    });
});

describe("une entité supprimée côté serveur quitte l'appareil", () => {
    /** Seeds records the way other paths leave them, beside what the pull writes. */
    async function seed(record: Record<string, unknown>): Promise<void> {
        await IndexedDB._ensureModule("Features").put({
            layerId: "sites",
            updatedAt: 1,
            version: null,
            feature: row(99),
            ...record,
        });
    }

    test("🛑 un rapatriement complet retire ce que la source ne rend plus", async () => {
        const rows = serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        rows.delete(2);
        const second = await pullLayer("sites");

        expect(second.removed).toBe(1);
        expect((await readAll("features")).map((r) => r.serverId).sort()).toEqual(["1", "3"]);
    });

    test("🛑 la zone REMPLACE : ce que la réponse bornée ne rend pas quitte l'appareil, hors zone compris", async () => {
        // Rows sit at x = -60.639, -60.638, -60.637: the zone keeps the first two.
        serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        const bounded = await pullLayer("sites", { bbox: [-60.6395, -33, -60.6375, -32] });

        expect(requests.at(-1)?.searchParams.get("bbox")).toBe("-60.6395,-33,-60.6375,-32");
        expect(bounded.removed).toBe(1);
        expect((await readAll("features")).map((r) => r.serverId).sort()).toEqual(["1", "2"]);
    });

    test("un rapatriement COUPÉ par le plafond ne retire rien : sa réponse est un sous-ensemble", async () => {
        const rows = serveSource([row(1), row(2), row(3), row(4), row(5)], 2);
        await pullLayer("sites");

        rows.delete(5);
        layer.offline.maxFeatures = 2;
        const capped = await pullLayer("sites");

        expect(capped.capped).toBe(true);
        expect(capped.removed ?? 0).toBe(0);
        expect(await readAll("features")).toHaveLength(5);
    });

    test("un rapatriement ABANDONNÉ ne retire rien : sa réponse est incomplète", async () => {
        const rows = serveSource([row(1), row(2), row(3), row(4), row(5)], 2);
        await pullLayer("sites");

        rows.delete(5);
        const controller = new AbortController();
        const fetchOnce = globalThis.fetch as unknown as (u: unknown) => Promise<unknown>;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: unknown) => {
                const answer = await fetchOnce(input);
                controller.abort(); // after the first page
                return answer;
            })
        );
        const aborted = await pullLayer("sites", { signal: controller.signal });

        expect(aborted.aborted).toBe(true);
        expect(aborted.removed ?? 0).toBe(0);
        expect(await readAll("features")).toHaveLength(5);
    });

    test("un rapatriement EN ÉCHEC ne retire rien", async () => {
        serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("network down");
            })
        );
        const failed = await pullLayer("sites");

        expect(failed.refused).toBe("sourceUnreachable");
        expect(await readAll("features")).toHaveLength(3);
    });

    test("le travail local n'est jamais retiré, ni ce qui n'a pas d'identité serveur", async () => {
        const rows = serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");
        const pulled = await storedRow(2);
        // An edited entity the server deleted meanwhile: the drain will meet the deletion and
        // set the capture aside (`deletedOnServer`) — the pull does not decide for it.
        await IndexedDB._ensureModule("Features").put({ ...pulled, syncState: "pending" });
        // A capture created here, still queued.
        await seed({ localId: "loc:new", serverId: null, syncState: "pending" });
        // A record with no server identity, whatever its state says.
        await seed({ localId: "loc:orphan", serverId: null, syncState: "synced" });
        // The extra record an older identity defect left behind, set aside by the drain.
        await seed({ localId: "3", serverId: null, syncState: "quarantined" });

        rows.delete(2);
        const second = await pullLayer("sites");

        expect(second.removed ?? 0).toBe(0);
        const kept = (await readAll("features")).map((r) => r.localId).sort();
        expect(kept).toEqual(["3", "loc:new", "loc:orphan", "srv:1", "srv:2", "srv:3"]);
    });
});

describe("fraîcheur et suppressions DÉCLARÉES par couche — le delta", () => {
    const T3 = "2026-09-01T11:00:00+00:00";

    /** A tombstone as the declared contract serves it: the row, with its deletion property set. */
    function tombstone(id: number, at: string) {
        const base = row(id, at);
        return { ...base, properties: { ...base.properties, deleted_at: at } };
    }

    beforeEach(() => {
        layer.offline.source.delta = { freshness: "datetime", deletedProperty: "deleted_at" };
    });

    test("prémisse : le premier rapatriement d'une couche déclarée est COMPLET", async () => {
        serveSource([row(1), row(2), row(3)]);
        const first = await pullLayer("sites");
        expect(requests[0]?.searchParams.get("datetime")).toBeNull();
        expect(first.written).toBe(3);
    });

    test("🛑 le second ne demande que ce qui a changé depuis la marque — `datetime=<marque>/..`", async () => {
        // Distinct markers: the mark is the greatest one served (row 3, T1). The interval is
        // CLOSED at its start, so row 3 comes back — unchanged — and row 1 does not.
        const T0 = "2026-09-01T07:00:00+00:00";
        const rows = serveSource([row(1, T0), row(2, T0), row(3, T1)]);
        await pullLayer("sites");

        rows.set(2, row(2, T2, "Renommé"));
        const second = await pullLayer("sites");

        expect(requests.at(-1)?.searchParams.get("datetime")).toBe(`${T1}/..`);
        expect(second.mode).toBe("delta");
        expect(second.fetched).toBe(2);
        expect(second.written).toBe(1);
        expect(second.unchanged).toBe(1);
        expect((await storedRow(2)).feature.properties.title).toBe("Renommé");
    });

    test("🛑 une pierre tombale quitte l'appareil, et n'y est jamais écrite", async () => {
        const rows = serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        rows.set(3, tombstone(3, T3));
        const second = await pullLayer("sites");

        expect(second.removed).toBe(1);
        expect((await readAll("features")).map((r) => r.serverId).sort()).toEqual(["1", "2"]);
    });

    test("🛑 une pierre tombale servie au rapatriement COMPLET n'est pas écrite non plus", async () => {
        serveSource([row(1), row(2), tombstone(3, T3)]);
        const first = await pullLayer("sites");

        expect(first.written).toBe(2);
        expect((await readAll("features")).map((r) => r.serverId).sort()).toEqual(["1", "2"]);
    });

    test("🛑 la marque suit le plus grand marqueur servi — le troisième part de T3", async () => {
        const rows = serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");
        rows.set(2, row(2, T2));
        rows.set(3, tombstone(3, T3));
        await pullLayer("sites");

        await pullLayer("sites");
        expect(requests.at(-1)?.searchParams.get("datetime")).toBe(`${T3}/..`);
    });

    test("un delta ne balaie pas : ce qu'il ne rend pas n'a simplement pas changé", async () => {
        // The delta answers row 3 alone (the mark, T1): rows 1 and 2 are absent from it only
        // because nothing changed them — a sweep here would empty the layer of them.
        const T0 = "2026-09-01T07:00:00+00:00";
        serveSource([row(1, T0), row(2, T0), row(3, T1)]);
        await pullLayer("sites");

        const second = await pullLayer("sites");
        expect(second.mode).toBe("delta");
        expect(second.fetched).toBe(1);
        expect(second.removed).toBe(0);
        expect(await readAll("features")).toHaveLength(3);
    });

    test("🛑 une autre zone efface la marque : le rapatriement suivant est complet", async () => {
        serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        const zoned = await pullLayer("sites", { bbox: [-61, -33, -60, -32] });
        expect(requests.at(-1)?.searchParams.get("datetime")).toBeNull();
        expect(zoned.mode).toBe("full");
    });

    test("une autre source efface la marque", async () => {
        serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        layer.offline.source.collectionId = "sites_v2";
        await pullLayer("sites");
        expect(requests.at(-1)?.searchParams.get("datetime")).toBeNull();
    });

    test("une purge du magasin efface la marque — un delta n'y retrouverait rien", async () => {
        serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        await IndexedDB.purgeCachedFeatures();
        const refilled = await pullLayer("sites");

        expect(requests.at(-1)?.searchParams.get("datetime")).toBeNull();
        expect(refilled.written).toBe(3);
    });

    test("un delta coupé par le plafond efface la marque : le suivant est complet", async () => {
        const rows = serveSource([row(1), row(2), row(3), row(4)], 2);
        await pullLayer("sites");

        rows.set(1, row(1, T2));
        rows.set(2, row(2, T2));
        rows.set(3, row(3, T2));
        layer.offline.maxFeatures = 2;
        const cut = await pullLayer("sites");
        expect(cut.capped).toBe(true);

        layer.offline.maxFeatures = 1000;
        await pullLayer("sites");
        expect(requests.at(-1)?.searchParams.get("datetime")).toBeNull();
    });

    test("🛑 un marqueur illisible ne fonde pas de marque : le suivant est complet", async () => {
        serveSource([row(1), row(2, "hier soir"), row(3)]);
        await pullLayer("sites");

        const second = await pullLayer("sites");
        expect(requests.at(-1)?.searchParams.get("datetime")).toBeNull();
        expect(second.mode).toBe("full");
    });

    test("une couche SANS déclaration reste au rapatriement complet", async () => {
        delete layer.offline.source.delta;
        serveSource([row(1), row(2), row(3)]);
        await pullLayer("sites");

        const second = await pullLayer("sites");
        expect(requests.at(-1)?.searchParams.get("datetime")).toBeNull();
        expect(second.mode).toBe("full");
    });
});
