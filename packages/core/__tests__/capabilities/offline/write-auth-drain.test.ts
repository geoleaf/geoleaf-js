/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * `write.auth` — what a layer says of how its writes are authenticated, and what the drain
 * does with it.
 *
 * The key was declarative: the schema and the published type accepted `bearer` and `none`, and
 * no code read either. A layer could say "this endpoint takes no token" and still have the
 * session's token attached by whoever intercepts the request; another could say "this
 * endpoint needs a token" and have its captures sent without one.
 *
 * Two effects, and a seam the core does not own:
 *
 *  - the declared value travels WITH THE REQUEST, as a member of its `init` — the core
 *    cannot import the plugin that holds the token, so it tells it there. `none` is the
 *    value that changes something for the receiver: no token, even under its base URL;
 *  - `bearer` HOLDS a capture while the session reader says there is no session: the
 *    capture stays queued, nothing leaves the device, and the drain says why it stopped.
 *
 * Runs against `fake-indexeddb` with a controlled `fetch`, like `push-engine.test.js`.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

const DB_NAME = "geoleaf-write-auth-test";

function feature(title: string) {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        properties: { title },
    };
}

describe("write.auth — la clé est lue par le drain", () => {
    // `any`: the engine is loaded by dynamic import AFTER `fake-indexeddb/auto`, as the
    // neighbouring drain suites do — its static types are not what is under test here.
    let IndexedDB: any;
    let StorageContract: any;
    let SessionReaderContract: any;
    let applyEdit: any;
    let pushOutbox: any;
    let layerConfigs: any[];
    let fetchSpy: any;
    // The name the request carries the declaration under. Written here as the connector
    // writes it: `write-auth-mark.guard.test.ts` holds the two sources equal.
    const WRITE_AUTH_MARK = "geoleafWriteAuth";

    const request = <T>(req: IDBRequest<T>): Promise<T> =>
        new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    const readAll = (store: string): Promise<Record<string, unknown>[]> =>
        request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

    /** A layer whose write target declares `auth` — or does not, when `auth` is `undefined`. */
    const layer = (id: string, auth?: string) => ({
        id,
        edition: { create: true, update: true, delete: true },
        write: {
            enabled: true,
            endpoint: `https://backend.test/${id}`,
            dialect: "collection",
            properties: ["title"],
            ...(auth !== undefined && { auth }),
        },
    });

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ SessionReaderContract } =
            await import("../../../src/kernel/shared/session-reader-seam.js"));
        ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
        ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
    });

    beforeEach(async () => {
        layerConfigs = [layer("open", "none"), layer("guarded", "bearer"), layer("silent")];
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Config: { getActiveProfile: () => ({ layers: layerConfigs }) },
        };
        fetchSpy = vi.fn(async () => ({ ok: true, status: 201, json: async () => [{ id: 1 }] }));
        globalThis.fetch = fetchSpy;
        SessionReaderContract._reset();
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
        SessionReaderContract._reset();
        IndexedDB.close();
        delete (globalThis as Record<string, unknown>).GeoLeaf;
        delete (globalThis as Record<string, unknown>).fetch;
        await new Promise<void>((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    const capture = (layerId: string) =>
        applyEdit({ layerId, kind: "create", feature: feature("A") });
    const sentInit = () => fetchSpy.mock.calls[0][1];

    // ── ① the declared value travels with the request ───────────────────────────────────
    test.each([
        ["open", "none"],
        ["guarded", "bearer"],
    ])("une couche `%s` envoie sa requête marquée `%s`", async (layerId: string, auth: string) => {
        SessionReaderContract.register(() => ({ state: "valid", expiresAt: null }));
        await capture(layerId);
        await pushOutbox();
        expect(sentInit()[WRITE_AUTH_MARK]).toBe(auth);
    });

    test("une couche qui ne déclare rien n'envoie aucune marque", async () => {
        await capture("silent");
        await pushOutbox();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(WRITE_AUTH_MARK in sentInit()).toBe(false);
    });

    test("une valeur que le contrat ne connaît pas n'est pas relayée", async () => {
        layerConfigs.push(layer("odd", "csrf"));
        await capture("odd");
        await pushOutbox();
        expect(WRITE_AUTH_MARK in sentInit()).toBe(false);
    });

    // ── ② `bearer` holds a capture while there is no session ────────────────────────────
    test("`bearer` sans session : rien ne part, la saisie reste en file, le drain dit pourquoi", async () => {
        SessionReaderContract.register(() => ({ state: "absent", expiresAt: null }));
        await capture("guarded");

        const report = await pushOutbox();

        expect(fetchSpy).not.toHaveBeenCalled();
        // Held, not halted: `haltedBy` is for a server that answered 401, and pauses the triggers.
        expect(report.heldForSession).toBe(1);
        expect(report.haltedBy).toBeNull();
        // Nothing was attempted: the capture never left the device, and it spent no budget.
        expect(report.attempted).toBe(0);
        expect(report.failed).toBe(0);
        const [entry] = await readAll("outbox");
        expect(entry?.state).toBe("pending");
        expect(entry?.attempts ?? 0).toBe(0);
    });

    test("la saisie retenue part dès que la session revient", async () => {
        let session = { state: "absent", expiresAt: null };
        SessionReaderContract.register(() => session);
        await capture("guarded");
        await pushOutbox();
        expect(fetchSpy).not.toHaveBeenCalled();

        session = { state: "valid", expiresAt: null };
        const report = await pushOutbox();
        expect(report.pushed).toBe(1);
        expect(report.heldForSession).toBe(0);
        expect(await readAll("outbox")).toHaveLength(0);
    });

    // ── ②bis the pass walks past a held capture, it does not stop on it ─────────────────
    test("🛑 une saisie `none` ne reste pas derrière une `bearer` retenue : elle part, les retenues restent", async () => {
        SessionReaderContract.register(() => ({ state: "absent", expiresAt: null }));
        await capture("guarded");
        await capture("open");
        await capture("guarded");

        const report = await pushOutbox();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(String(fetchSpy.mock.calls[0][0])).toContain("/open");
        expect(report).toMatchObject({
            attempted: 1,
            pushed: 1,
            heldForSession: 2,
            haltedBy: null,
        });
        const left = await readAll("outbox");
        expect(left.map((entry) => entry.layerId)).toEqual(["guarded", "guarded"]);
        expect(left.every((entry) => entry.state === "pending" && !entry.attempts)).toBe(true);
    });

    test("🛑 une session qui s'ouvre EN COURS de passe ne laisse pas partir la seconde saisie avant la première", async () => {
        // The reader says `absent` once, then `valid`: without the pass's memory the second
        // `bearer` capture would leave while the first one was walked past.
        const reader = vi
            .fn()
            .mockReturnValueOnce({ state: "absent", expiresAt: null })
            .mockReturnValue({ state: "valid", expiresAt: null });
        SessionReaderContract.register(reader);
        await capture("guarded");
        await capture("guarded");

        const first = await pushOutbox();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(first.heldForSession).toBe(2);
        expect(reader).toHaveBeenCalledTimes(1);

        const second = await pushOutbox();
        expect(second.pushed).toBe(2);
    });

    // An expired token may still be renewed — the server's call, made on the way. And a
    // page where nobody registered a reader cannot be told there is no session.
    test.each([
        ["une session expirée", () => ({ state: "expired", expiresAt: 1 })],
        ["un lecteur qui ne sait pas", () => null],
        ["un lecteur qui lève", () => Promise.reject(new Error("store unavailable"))],
    ])("`bearer` avec %s : la saisie part", async (_what: string, reader: () => unknown) => {
        SessionReaderContract.register(reader);
        await capture("guarded");
        const report = await pushOutbox();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(report.pushed).toBe(1);
    });

    test("`bearer` sans lecteur enregistré : la saisie part", async () => {
        await capture("guarded");
        const report = await pushOutbox();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(report.pushed).toBe(1);
    });

    test.each(["open", "silent"])(
        "une couche `%s` ne consulte pas la session : sa saisie part sans elle",
        async (layerId: string) => {
            const reader = vi.fn(() => ({ state: "absent", expiresAt: null }));
            SessionReaderContract.register(reader);
            await capture(layerId);
            const report = await pushOutbox();
            expect(report.pushed).toBe(1);
            expect(reader).not.toHaveBeenCalled();
        }
    );
});
