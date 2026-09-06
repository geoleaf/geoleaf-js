/// <reference path="../../types/fake-indexeddb-auto.d.ts" />
/**
 * ONE DRAIN AT A TIME — the lock, and what it actually protects.
 *
 * 🛑 The lock used to live in the editor plugin (`_flushing`, module-level), and that
 * module said so in its own words: it "only guards what goes through here". Three
 * production paths do not go through there — the console, this very suite, and
 * `offline-ui`'s replay button — and all three call `Storage.pushOutbox()` directly.
 *
 * ⚠️ What overlapping drains lose is NOT integrity: the second request earns a 409 on
 * `local_id` and `settleAlreadyPresent` resolves it, so no duplicate row is created.
 * What they lose is the REPLAY BUDGET — `attempts` spent twice means a capture
 * quarantined in half the drains it was owed — and the tally, which then describes
 * neither pass. These tests assert the budget, because asserting "no duplicate" would
 * pass with the lock removed.
 *
 * Runs against `fake-indexeddb` with a fetch the test releases by hand: a lock cannot be
 * observed without two calls genuinely overlapping.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

const DB_NAME = "geoleaf-push-lock-test";

describe("4.5 — le drain ne se chevauche pas", () => {
    let IndexedDB: any;
    let StorageContract: any;
    let applyEdit: any;
    let pushOutbox: any;
    let open: any[];
    let fetchSpy: any;
    /** Releases the pending request(s). */
    let release: (value?: unknown) => void;

    const request = (req: any) =>
        new Promise<any>((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

    const readAll = (store: string): Promise<any[]> =>
        request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

    /**
     * A server that answers only when the test says so.
     *
     * ⚠️ It refuses with a 500 rather than accepting: on success the entry is REMOVED
     * from the queue, and `attempts` — the thing the lock protects — would be gone with
     * it. A transient refusal is the only outcome that leaves the counter readable.
     */
    function serveOnRelease() {
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        fetchSpy = vi.fn(async () => {
            await gate;
            return { ok: false, status: 500, json: async () => null };
        });
        globalThis.fetch = fetchSpy;
    }

    /** Makes every deferred entry replayable again — "the delay has elapsed". */
    async function rewind() {
        const outbox = IndexedDB._ensureModule("Outbox");
        for (const row of await readAll("outbox")) {
            if (row.nextAttemptAt)
                await outbox.updateState(row.id, row.state, { nextAttemptAt: 0 });
        }
    }

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
        ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
    });

    beforeEach(async () => {
        open = [];
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
        await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: {
                type: "Feature",
                geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                properties: { title: "Saisie" },
            },
        });
    });

    afterEach(async () => {
        for (const db of open) db.close();
        IndexedDB.close();
        delete (globalThis as Record<string, unknown>).GeoLeaf;
        delete (globalThis as Record<string, unknown>).fetch;
        await new Promise<void>((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    // ── T9 — the budget, which is what the lock is for ───────────────────────────────
    test("🛑 deux drains concurrents ne dépensent le budget de rejeu QU'UNE fois", async () => {
        serveOnRelease();

        const first = pushOutbox();
        const second = pushOutbox();
        release();
        await Promise.all([first, second]);

        // One request, therefore one attempt spent. Without the lock both drains read the
        // queue before either wrote `inFlight`: two requests, `attempts` at 2, and a
        // capture three drains from quarantine reaches it in one and a half.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [entry] = await readAll("outbox");
        expect(entry.attempts).toBe(1);
        expect(entry.state).toBe("failed");
    });

    // ── T10 — the shape of the refusal ──────────────────────────────────────────────
    test("l'appel concurrent reçoit LE MÊME rapport, jamais `null`", async () => {
        serveOnRelease();

        const first = pushOutbox();
        const second = pushOutbox();
        release();
        const [a, b] = await Promise.all([first, second]);

        // 🛑 The same object, not an equal one: the second caller is served the RUNNING
        // promise. A sentinel (`null`, or a `refused: "drainInProgress"`) would widen a
        // published return type and force every consumer — `offline-ui`'s replay button
        // among them — to learn a case none has asked to tell apart.
        expect(b).toBe(a);
        expect(a.attempted).toBe(1);
        expect(a.refused).toBeNull();
    });

    // ── T11bis — and it releases on a REJECTION too ─────────────────────────────────
    test("🛑 un rejet relâche aussi le verrou — sinon une panne condamne la session", async () => {
        // A lock released only on the happy path is worse than none: the first engine fault
        // of the session would silently retire the drain until the page reloads, and every
        // capture taken afterwards would sit in the queue with no recourse.
        let fail = true;
        StorageContract.init({
            get DB() {
                return {
                    _ensureModule: (name: string) =>
                        name === "Outbox"
                            ? {
                                  list: async () => {
                                      if (fail) throw new Error("boom");
                                      return [];
                                  },
                                  updateState: async () => {},
                                  remove: async () => {},
                              }
                            : {
                                  put: async () => {},
                                  get: async () => null,
                                  remove: async () => {},
                              },
                };
            },
            isAvailable: () => true,
        });

        await expect(pushOutbox()).rejects.toThrow("boom");
        fail = false;
        await expect(pushOutbox()).resolves.toMatchObject({ attempted: 0, refused: null });
    });

    // ── T11 — the lock releases ─────────────────────────────────────────────────────
    test("une fois le drain réglé, l'appel suivant refait une VRAIE passe", async () => {
        serveOnRelease();
        const first = pushOutbox();
        release();
        await first;
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // A lock never released is indistinguishable from a lock that works, until the
        // second drain of the session silently does nothing.
        await rewind();
        serveOnRelease();
        const later = pushOutbox();
        release();
        const report = await later;

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(report.attempted).toBe(1);
        const [entry] = await readAll("outbox");
        expect(entry.attempts).toBe(2);
    });
});
