/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * Five defects of the offline write cycle, read in the code on 13/09/2026 and PROVEN here
 * before any fix.
 *
 * Each chain was traced without a test to show it: an existing entity edited through the
 * queue, a deletion meeting a concurrent change, a dead session on a live network, a
 * freshness marker kept after a write, the `rest` dialect. Every group holds two kinds of
 * case:
 *
 *  - PREMISE (plain `test`, green): the scenario really reaches the defective point. It is
 *    what keeps the cases below honest — `test.fails` passes on ANY failure, a broken setup
 *    included, and a broken setup shows red HERE.
 *  - TARGET (`test.fails`): what the cycle MUST do. It fails today, which `.fails` turns into
 *    a pass; the day the defect is fixed it turns RED, and that is the signal to drop
 *    `.fails`. The failing assertion was read on the run that laid this file, and its
 *    message is quoted beside it. Same pattern as
 *    `app/lifecycle-create-destroy-recreate.test.js`.
 *
 * Runs against `fake-indexeddb` with the real engine — pull, local edit, drain and its
 * triggers — and a controlled `fetch`, like `push-engine.test.js`.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// offline → capabilities → __tests__ → core → packages → <root>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const DB_NAME = "geoleaf-write-cycle-defects";
const OGC = "https://backend.test/ogc";
const ENDPOINT = "https://backend.test/sites";
const DRAINED = "geoleaf:offline:outbox-drained";
const T1 = "2026-09-01T08:00:00+00:00";
const T2 = "2026-09-01T09:30:00+00:00";
const T3 = "2026-09-01T11:00:00+00:00";

// ⚠️ The engine is loaded DYNAMICALLY, after `fake-indexeddb/auto` has installed
// `indexedDB`: its modules must not evaluate before the global exists. Typed `any` for the
// reason `outbox-drain-triggers.test.ts` gives.
let IndexedDB: any;
let StorageContract: any;
let applyEdit: any;
let pushOutbox: any;
let pullLayer: any;
let armOutboxDrain: any;
let disarmOutboxDrain: any;
let requeueAll: any;

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

/**
 * A controlled server: the OGC source answers the pull, `handler` answers the writes — at
 * once, or when the promise it returns settles.
 */
function serve(
    handler: (url: string, init: RequestInit) => Reply | Promise<Reply>,
    pulled: unknown[] = []
): void {
    fetchSpy = vi.fn(async (input: unknown, init: RequestInit = {}) => {
        const url = String(input);
        const reply: Reply = url.startsWith(OGC)
            ? {
                  body: {
                      type: "FeatureCollection",
                      numberMatched: pulled.length,
                      numberReturned: pulled.length,
                      features: pulled,
                      links: [{ rel: "self", href: url }],
                  },
              }
            : await handler(url, init);
        const status = reply?.status ?? 200;
        return { ok: status < 400, status, json: async () => reply?.body ?? null };
    });
    vi.stubGlobal("fetch", fetchSpy);
}

const urlOf = (call: number): string => String(fetchSpy.mock.calls[call]?.[0]);

/** An entity as an OGC API Features server returns it: `id` on top AND in the properties. */
function ogcFeature(id: number, title = `Site ${id}`, updatedAt = T1) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        properties: { id, local_id: null, title, updated_at: updatedAt },
    };
}

/**
 * The identity the editor hands the core as `localId` for an entity it did not create.
 *
 * Mirrors `resolveFeatureId` (`packages/plugins/editor/src/feature-id.ts`): the picked
 * feature's `id`, else `properties.id` — and under `promoteId: "id"` MapLibre hands back
 * `properties.id`. `persistence/storage-queue-adapter.ts` then passes it to `applyEdit`
 * unchanged, for an update as for a delete.
 */
function editorIdentity(feature: any): string {
    const raw = feature?.id ?? feature?.properties?.id;
    return raw == null ? "" : String(raw);
}

/** The body the editor submits: no top-level `id`, the edited properties. */
const editorFeature = (shown: any, title: string) => ({
    type: "Feature",
    geometry: shown.geometry,
    properties: { ...shown.properties, title },
});

/** Seeds one entity the way a pull leaves it, with its freshness marker. */
async function stored(id: number, version: string | null = T1): Promise<string> {
    const localId = `srv:${id}`;
    await IndexedDB._ensureModule("Features").put({
        layerId: "sites",
        localId,
        serverId: String(id),
        syncState: "synced",
        updatedAt: 1,
        version: version ? { kind: "timestamp", value: version } : null,
        feature: ogcFeature(id),
    });
    return localId;
}

/**
 * Waits for the pass a trigger started — or gives up.
 *
 * ⚠️ BOUNDED on purpose: once a defect is fixed, a trigger may rightly decide NOT to drain.
 * An unbounded wait would then time the case out, and `.fails` would count that timeout as
 * the expected failure — the flip this file relies on would never show.
 */
function nextPass(ms = 500): Promise<boolean> {
    return new Promise((done) => {
        const onPass = () => {
            clearTimeout(timer);
            done(true);
        };
        const timer = setTimeout(() => {
            document.removeEventListener(DRAINED, onPass);
            done(false);
        }, ms);
        document.addEventListener(DRAINED, onPass, { once: true });
    });
}

beforeAll(async () => {
    await import("fake-indexeddb/auto");
    ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
    ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
    ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
    ({ pullLayer } = await import("../../../src/capabilities/offline/pull/layer-pull.js"));
    ({ armOutboxDrain, disarmOutboxDrain } =
        await import("../../../src/capabilities/offline/write/outbox-drain-triggers.js"));
    ({ requeueAll } = await import("../../../src/capabilities/offline/write/quarantine-api.js"));
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
    // `close()` and not `_db = null` — see `push-engine.test.js`: the facade caches its
    // sub-modules against the connection that created them.
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
    disarmOutboxDrain();
    IndexedDB.close();
    vi.unstubAllGlobals();
    // `StorageContract.init()` writes a module singleton: without this, the store outlives
    // the file (the trap `quarantine-api.test.ts` records).
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

describe("une entité RAPATRIÉE, modifiée ou supprimée par l'éditeur", () => {
    /** Pulls one entity for real, and returns it as the offline map shows it. */
    async function pulled(id: number): Promise<any> {
        serve(() => undefined, [ogcFeature(id)]);
        const report = await pullLayer("sites");
        expect(report.written).toBe(1);
        const shown = await IndexedDB.getLayerFeatureCollection("sites");
        return shown.features[0];
    }

    test("prémisse : rangée sous `srv:<id>`, elle s'affiche avec l'identifiant SERVEUR", async () => {
        const shown = await pulled(42);
        const [record] = await readAll("features");
        expect(record.localId).toBe("srv:42");
        expect(record.serverId).toBe("42");
        // What the editor will hand back — NOT the key the record is stored under.
        expect(editorIdentity(shown)).toBe("42");
    });

    // Red on 17/09/2026: expected 'https://backend.test/sites?id=eq.null' to contain 'id=eq.42'.
    test("🛑 la modification atteint SA ligne serveur, pas `id=eq.null`", async () => {
        const shown = await pulled(42);
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: editorIdentity(shown),
            feature: editorFeature(shown, "corrigé"),
        });
        serve(() => ({ body: [{ id: 42, updated_at: T2 }] }));
        await pushOutbox();
        expect(urlOf(0)).toContain("id=eq.42");
    });

    // Red on 17/09/2026: expected [ { type: 'Feature', …(2) }, …(1) ] to have a length of 1 but got 2
    test("🛑 modifiée, la carte hors ligne la montre UNE fois", async () => {
        const shown = await pulled(42);
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: editorIdentity(shown),
            feature: editorFeature(shown, "corrigé"),
        });
        const after = await IndexedDB.getLayerFeatureCollection("sites");
        const same = after.features.filter((f: any) => editorIdentity(f) === "42");
        expect(same).toHaveLength(1);
        expect(same[0].properties.title).toBe("corrigé");
    });

    // Red on 17/09/2026: expected 'https://backend.test/sites?id=eq.null' to contain 'id=eq.42'.
    test("🛑 la suppression atteint SA ligne serveur", async () => {
        const shown = await pulled(42);
        await applyEdit({ layerId: "sites", kind: "delete", localId: editorIdentity(shown) });
        serve(() => ({ body: [{ id: 42 }] }));
        await pushOutbox();
        expect(urlOf(0)).toContain("id=eq.42");
    });

    // Red on 17/09/2026: expected [ { type: 'Feature', id: 42, …(2) } ] to have a length of +0 but got 1
    test("🛑 supprimée, elle quitte la carte hors ligne", async () => {
        const shown = await pulled(42);
        await applyEdit({ layerId: "sites", kind: "delete", localId: editorIdentity(shown) });
        const after = await IndexedDB.getLayerFeatureCollection("sites");
        expect(after.features.filter((f: any) => editorIdentity(f) === "42")).toHaveLength(0);
    });

    // 🛑 THE WIDER CASE, and the common one: with the offline engine present the editor queues
    // EVERY write, so an entity shown from the network — never pulled — takes the same path.
    test("🛑 une entité JAMAIS rapatriée, modifiée par l'éditeur, atteint sa ligne serveur", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "57",
            feature: editorFeature(ogcFeature(57), "réseau"),
        });
        const [record] = await readAll("features");
        // The key the pull would have given it, and the server identity it names.
        expect(record.localId).toBe("srv:57");
        expect(record.serverId).toBe("57");
        serve(() => ({ body: [{ id: 57, updated_at: T2 }] }));
        await pushOutbox();
        expect(urlOf(0)).toContain("id=eq.57");
    });

    test("🛑 l'identité serveur se résout DANS la couche éditée", async () => {
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "autres",
            localId: "srv:42",
            serverId: "42",
            syncState: "synced",
            updatedAt: 1,
            version: null,
            feature: ogcFeature(42, "autre couche"),
        });
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "42",
            feature: editorFeature(ogcFeature(42), "couche éditée"),
        });
        const records = await readAll("features");
        const other = records.find((r) => r.layerId === "autres");
        expect(other.feature.properties.title).toBe("autre couche");
        const edited = records.find((r) => r.layerId === "sites");
        expect(edited.localId).toBe("srv:42");
    });

    // 🛑 THE GUARD THE REQUEST NEVER HAD: an update whose record knows no server row must not
    // leave as `id=eq.null`. A client identity the store no longer holds is exactly that.
    test("🛑 une modification sans identité serveur ne part pas sur `id=eq.null`", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "loc:perdue",
            feature: editorFeature(ogcFeature(0), "sans ligne"),
        });
        serve(() => ({ body: [] }));
        const report = await pushOutbox();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(report.pushed).toBe(0);
        expect(await readAll("outbox")).toHaveLength(1);
    });
});

describe("une modification faite pendant l'envoi de sa création", () => {
    // 🛑 The drain read the record BEFORE the request and wrote that copy back after it: an
    // edit made while the request was on the wire was overwritten, and marked `synced`.
    test("🛑 l'envoi ne réécrit pas l'entité modifiée pendant qu'il était en vol", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: ogcFeature(0, "avant"),
        });
        let release: (reply: Reply) => void = () => undefined;
        serve(() => new Promise<Reply>((done) => (release = done)));
        const pass = pushOutbox();
        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: created.localId,
            feature: ogcFeature(0, "pendant"),
        });
        release({ status: 201, body: [{ id: 88, updated_at: T2 }] });
        await pass;

        const [record] = await readAll("features");
        expect(record.serverId).toBe("88");
        expect(record.feature.properties.title).toBe("pendant");
        // Still owed: the stacked update has not left yet.
        expect(record.syncState).toBe("pending");
    });
});

describe("une suppression qui rencontre une modification concurrente", () => {
    /** The row changed on the server since T1: a filter on T1 matches nothing. */
    async function staleDelete(): Promise<void> {
        const localId = await stored(7);
        await applyEdit({ layerId: "sites", kind: "delete", localId });
        serve((url) => (url.includes("updated_at=eq.") ? { body: [] } : { body: [{ id: 7 }] }));
    }

    test("prémisse : le DELETE part filtré sur le marqueur de base", async () => {
        await staleDelete();
        await pushOutbox();
        expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
        expect(urlOf(0)).toContain("id=eq.7");
        expect(urlOf(0)).toContain("updated_at=eq.");
    });

    // Red on 17/09/2026: expected +0 to be 1
    test("🛑 zéro ligne supprimée est un CONFLIT détecté, pas un succès", async () => {
        await staleDelete();
        const report = await pushOutbox();
        expect(report.conflicts).toBe(1);
    });

    // Decided on 17/09/2026, the policy the modifications already follow: the operator is the
    // authority on what they observed on site. The conflict is counted and logged first.
    test("🛑 la suppression l'emporte : renvoyée SANS filtre, l'entité quitte le magasin", async () => {
        await staleDelete();
        const report = await pushOutbox();
        // Red on 17/09/2026 at the v6 store: expected "vi.fn()" to be called 2 times, but got
        // 3 times. A third request appeared between the two sends — the re-read that keeps
        // the row this deletion is about to destroy, which is the one case where nothing else
        // survives it.
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(urlOf(2)).not.toContain("updated_at=eq.");
        expect(report.pushed).toBe(1);
        expect(await readAll("features")).toHaveLength(0);
        expect(await readAll("outbox")).toHaveLength(0);
    });
});

describe("une session morte, réseau présent", () => {
    let ticks: Array<() => void>;

    /** Three captures, a server answering 401, and the drain armed with a hand-fired tick. */
    async function deadSessionTour(): Promise<void> {
        for (const title of ["un", "deux", "trois"]) {
            await applyEdit({ layerId: "sites", kind: "create", feature: ogcFeature(0, title) });
        }
        serve(() => ({ status: 401 }));
        ticks = [];
        const first = nextPass();
        armOutboxDrain({
            setInterval: (fn: () => void) => {
                ticks.push(fn);
                return fn;
            },
            clearInterval: () => undefined,
        });
        expect(await first).toBe(true);
    }

    const setAside = async () =>
        (await readAll("outbox")).filter((entry) => entry.state === "quarantined");

    test("prémisse : le premier passage s'arrête au 401 et met UNE saisie à l'écart", async () => {
        await deadSessionTour();
        const aside = await setAside();
        expect(aside).toHaveLength(1);
        expect(aside[0].quarantine).toBe("authRequired");
        expect(ticks).toHaveLength(1);
    });

    // Red on 17/09/2026: expected [ { …(12) }, { …(12) }, { …(12) } ] to have a length of 1 but got 3
    test("🛑 deux tics plus tard, la tournée n'a pas perdu d'autre saisie", async () => {
        await deadSessionTour();
        for (let i = 0; i < 2; i += 1) {
            const pass = nextPass();
            ticks[0]?.();
            await pass;
        }
        expect(await setAside()).toHaveLength(1);
    });

    // 🛑 THE WAY BACK, and the core owns only its half. Signing back in is the connector's
    // business (it calls these two public gestures); what the core must guarantee is that the
    // queue empties then, and that its own triggers start again afterwards.
    test("🛑 une reprise de session vide la file, et le tic repart", async () => {
        await deadSessionTour();
        serve(() => ({ status: 201, body: [{ id: 1 }] }));

        await requeueAll("authRequired");
        await pushOutbox();
        expect(await setAside()).toHaveLength(0);
        expect(await readAll("outbox")).toHaveLength(0);

        await applyEdit({ layerId: "sites", kind: "create", feature: ogcFeature(0, "après") });
        const pass = nextPass();
        ticks[0]?.();
        expect(await pass).toBe(true);
        expect(await readAll("outbox")).toHaveLength(0);
    });
});

describe("la version d'une entité après un envoi réussi", () => {
    /**
     * A server that bumps its marker on every write and returns it in the representation,
     * and that matches a filtered write only on its CURRENT marker.
     */
    function versionedServer(): void {
        let current = T1;
        serve((url) => {
            const filter = /updated_at=eq\.([^&]+)/.exec(url);
            if (filter && decodeURIComponent(filter[1] ?? "") !== current) return { body: [] };
            current = current === T1 ? T2 : T3;
            return { body: [{ id: 9, updated_at: current }] };
        });
    }

    async function editedOnce(): Promise<any> {
        const localId = await stored(9);
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId,
            feature: ogcFeature(9, "première"),
        });
        versionedServer();
        return pushOutbox();
    }

    test("prémisse : le premier envoi part filtré sur T1, et réussit sans conflit", async () => {
        const report = await editedOnce();
        expect(urlOf(0)).toContain(`updated_at=eq.${encodeURIComponent(T1)}`);
        expect(report.pushed).toBe(1);
        expect(report.conflicts).toBe(0);
    });

    // Red on 17/09/2026: expected '2026-09-01T08:00:00+00:00' to be '2026-09-01T09:30:00+00:00'
    test("🛑 l'enregistrement prend le marqueur que le serveur vient de rendre", async () => {
        await editedOnce();
        const [record] = await readAll("features");
        expect(record.version?.value).toBe(T2);
    });

    // Red on 17/09/2026: expected 1 to be +0
    test("🛑 la modification suivante ne se prend pas pour un conflit", async () => {
        await editedOnce();
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:9",
            feature: ogcFeature(9, "seconde"),
        });
        const report = await pushOutbox();
        expect(report.conflicts).toBe(0);
    });
    // 🛑 THE SAME DEFECT, CONCURRENT: an edit stacked while the previous one is on the wire is
    // based on what the device shows — that write included. Its filter must be the marker the
    // write returned, or the device takes its own write for someone else's.
    test("🛑 une modification faite PENDANT l'envoi de la précédente part sur le marqueur rendu", async () => {
        const localId = await stored(9);
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId,
            feature: ogcFeature(9, "première"),
        });
        let current = T1;
        let release: () => void = () => undefined;
        serve(async (url) => {
            const filter = /updated_at=eq\.([^&]+)/.exec(url);
            if (filter && decodeURIComponent(filter[1] ?? "") !== current) return { body: [] };
            if (current === T1) await new Promise<void>((done) => (release = done));
            current = current === T1 ? T2 : T3;
            return { body: [{ id: 9, updated_at: current }] };
        });
        const first = pushOutbox();
        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId,
            feature: ogcFeature(9, "seconde"),
        });
        release();
        await first;

        const second = await pushOutbox();
        expect(second.conflicts).toBe(0);
        expect(urlOf(1)).toContain(`updated_at=eq.${encodeURIComponent(T2)}`);
        expect(JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit).body)).title).toBe(
            "seconde"
        );
    });
});

describe("le dialecte `rest`", () => {
    async function restCapture(): Promise<void> {
        layer.write.dialect = "rest";
        await applyEdit({ layerId: "sites", kind: "create", feature: ogcFeature(0, "rest") });
        serve(() => ({ status: 201 }));
        await pushOutbox();
    }

    test("prémisse : le drain ne l'envoie pas", async () => {
        await restCapture();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(await readAll("outbox")).toHaveLength(1);
    });

    // Red on 17/09/2026: expected 'failed' to be 'quarantined'
    test("🛑 refusé par son nom dès le premier passage, sans user le budget", async () => {
        await restCapture();
        const [entry] = await readAll("outbox");
        expect(entry.state).toBe("quarantined");
        expect(entry.quarantine).toBe("dialectNotSupported");
        // The budget is short-circuited, not spent: replaying changes nothing the motive says.
        expect(entry.attempts).toBe(1);
    });

    // Red on 17/09/2026: expected 'rest' to be 'collection'
    test("🛑 le schéma annonce le défaut que le drain applique", () => {
        const schema = JSON.parse(
            readFileSync(resolve(ROOT, "profiles/schemas/layer-config.schema.json"), "utf8")
        );
        // An absent `dialect` is sent as `collection` (`resolveWriteTarget`).
        expect(schema.properties.write.properties.dialect.default).toBe("collection");
    });
});
