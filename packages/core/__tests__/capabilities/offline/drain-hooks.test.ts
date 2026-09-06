/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * PRE-DRAIN STEPS — the sequence that keeps a photo from leaving as an unresolvable token.
 *
 * 🛑 **THIS ORDER USED TO BELONG TO A PLUGIN, HENCE TO ONE CALLER.** The editor uploads
 * the photos it holds locally before the queue is pushed, so that the reconciling `update`
 * it writes is COALESCED into the still-pending `create` — the server then never sees an
 * image token it cannot resolve. That sequencing lived in the plugin's own drain wrapper,
 * so every other path to the drain (the console, the E2E suite, `offline-ui`'s replay
 * button, and now the core's own triggers) pushed the token as it stood.
 *
 * The registry is `kernel/shared/drain-hooks-seam.ts`, the runner is inside `pushOutbox`
 * — before the queue is READ, which is what makes the coalescence possible at all.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

// ⚠️ The modules under test are loaded DYNAMICALLY: their types are unknown at write time.
// `any` is the honest form here — pretending to type an import whose evaluation ORDER is the
// test's subject would give false assurance. Same arbitration as `routes-store.test.ts`.

const DB_NAME = "geoleaf-drain-hooks-test";

describe("4.5 — les étapes pré-drain", () => {
    let IndexedDB: any;
    let StorageContract: any;
    let DrainHooksContract: any;
    let applyEdit: any;
    let pushOutbox: any;
    let open: any[];
    let fetchSpy: any;

    const request = (req: any) =>
        new Promise<any>((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

    const readAll = (store: string): Promise<any[]> =>
        request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ DrainHooksContract } = await import("../../../src/kernel/shared/drain-hooks-seam.js"));
        ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
        ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
    });

    beforeEach(async () => {
        open = [];
        DrainHooksContract._reset();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Config: {
                getActiveProfile: () => ({
                    layers: [
                        {
                            id: "sites",
                            edition: { create: true, update: true, delete: true },
                            write: {
                                enabled: true,
                                endpoint: "https://backend.test/sites",
                                dialect: "collection",
                                geometryProperty: "geom",
                                properties: ["title"],
                            },
                        },
                    ],
                }),
            },
        };
        IndexedDB.close();
        IndexedDB._dbName = DB_NAME;
        await IndexedDB.init();
        open.push(IndexedDB._db);
        StorageContract.init({
            get DB() {
                return IndexedDB;
            },
            isAvailable: () => true,
        });
        fetchSpy = vi.fn(async () => ({ ok: true, status: 201, json: async () => [{ id: 3 }] }));
        globalThis.fetch = fetchSpy;
    });

    afterEach(async () => {
        DrainHooksContract._reset();
        for (const db of open) db.close();
        IndexedDB.close();
        delete (globalThis as Record<string, unknown>).GeoLeaf;
        delete (globalThis as Record<string, unknown>).fetch;
        await new Promise<void>((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    async function queueOne(title = "Saisie"): Promise<any> {
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

    // ── T12 — the ordering, which is the whole point ─────────────────────────────────
    test("🛑 une étape tourne AVANT la première requête réseau", async () => {
        await queueOne();
        const order: string[] = [];
        fetchSpy.mockImplementation(async () => {
            order.push("push");
            return { ok: true, status: 201, json: async () => [{ id: 3 }] };
        });
        DrainHooksContract.register("images", async () => {
            order.push("étape");
        });

        await pushOutbox();

        expect(order).toEqual(["étape", "push"]);
    });

    // ── T12bis — and BEFORE the queue is read, which is what allows coalescing ────────
    test("🛑 une étape qui ÉCRIT dans la file est vue par la passe en cours", async () => {
        // This is the real shape of the image retry: it writes a reconciling `update`
        // that coalesces into the pending `create`. If the step ran after `outbox.list()`,
        // its write would wait for the NEXT drain — and the create would meanwhile leave
        // carrying a token the server cannot resolve.
        DrainHooksContract.register("late-capture", async () => {
            await queueOne("écrite par l'étape");
        });

        const report = await pushOutbox();

        expect(report.attempted).toBe(1);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // ── T13 — a failing step is a photo still waiting, not a hostage-taking ──────────
    test("une étape qui jette n'arrête PAS le drain", async () => {
        await queueOne();
        DrainHooksContract.register("images", () => Promise.reject(new Error("upload")));

        const report = await pushOutbox();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(report.pushed).toBe(1);
    });

    // ── T14 — order of registration, not of iteration luck ──────────────────────────
    test("deux étapes tournent dans l'ordre d'enregistrement", async () => {
        const order: string[] = [];
        DrainHooksContract.register("a", () => void order.push("a"));
        DrainHooksContract.register("b", () => void order.push("b"));

        await pushOutbox();

        expect(order).toEqual(["a", "b"]);
    });

    // ── T15 — the exit a destroyed plugin owes ──────────────────────────────────────
    test("🛑 `register(id, null)` désenregistre — sinon un plugin détruit tient le drain", async () => {
        const step = vi.fn();
        DrainHooksContract.register("images", step);
        await pushOutbox();
        expect(step).toHaveBeenCalledTimes(1);

        DrainHooksContract.register("images", null);
        await pushOutbox();

        expect(step).toHaveBeenCalledTimes(1);
    });

    // ── The step runs UNDER the lock ────────────────────────────────────────────────
    test("un drain demandé pendant l'étape ne la double pas", async () => {
        await queueOne();
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const step = vi.fn(() => gate);
        DrainHooksContract.register("images", step);

        const first = pushOutbox();
        const second = pushOutbox();
        release!();
        await Promise.all([first, second]);

        // One pass, therefore one step and one request — a second drain slipping in while
        // the photos are going up is precisely what would overtake them.
        expect(step).toHaveBeenCalledTimes(1);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(await readAll("outbox")).toEqual([]);
    });
});
