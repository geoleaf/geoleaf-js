/**
 * `editor-sync-replay` — AFTER the migration to the core's `outbox`.
 *
 * 🛑 THIS FILE CHANGED SUBJECT, AND THAT IS LEGITIMATE BECAUSE ITS SUBJECT MOVED.
 * It exercised the PER-ENTRY replay: reading the payload from `payload`,
 * dispatching on the `editor.*` vocabulary, lossless `failed` marking, parsing
 * errors. Those behaviours now live in the core's drain, where they are
 * covered by `packages/core/__tests__/capabilities/offline/push-engine.test.js`
 * — 14 tests, 8 mutations seen red, including "a 500 leaves the entry queued,
 * in `failed` — which is not terminal".
 *
 * ⚠️ The distinction with `addpoi` deserves writing down, because it decided
 * the treatment. There, the tests drove STILL-LIVE adapters via `syncDirect`:
 * they were re-pointed, not deleted. Here the `_replayEntry` function is gone,
 * and the REST adapter it used keeps its own tests (`rest-adapter.test.ts`,
 * `collection-rest-adapter.test.ts`) plus its live online path — which is now the
 * capability routing of `queue-first-adapter.ts`, `auto-adapter` having been removed
 * with its reachability rule (R7). Nothing is left uncovered.
 *
 * What is exercised here is what this module STILL does: read the outbox,
 * delegate the drain, and notify the interface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
    listPendingEditorEntries,
    getPendingCount,
    flushNow,
    drainOutbox,
} from "../persistence/editor-sync-replay.js";

/** Storage facade under test control: the outbox for reads, the drain for writes. */
function mountStorage(entries: unknown[], report = { attempted: 0, pushed: 0, failed: 0 }) {
    const pushOutbox = vi.fn().mockResolvedValue({ ...report, conflicts: 0, refused: null });
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Storage: {
            DB: { _ensureModule: () => ({ list: () => Promise.resolve(entries) }) },
            pushOutbox,
        },
    };
    return pushOutbox;
}

describe("editor-sync-replay — lecture de l'outbox", () => {
    beforeEach(() => {
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("liste TOUT ce qui est dû au serveur, sans filtrer par producteur", async () => {
        // 🛑 THE OPPOSITE OF WHAT THIS MODULE DID. It kept the `editor.*`
        // entries and discarded the rest — a plugin recognising only "its own"
        // in a queue two plugins wrote. The `outbox` speaks one vocabulary,
        // and a user asking "what has not left yet?" wants the complete answer.
        mountStorage([
            { id: "a", kind: "create", layerId: "l1", localId: "x", state: "pending" },
            { id: "b", kind: "update", layerId: "l2", localId: "y", state: "failed" },
        ]);
        const entries = await listPendingEditorEntries();
        expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
        expect(await getPendingCount()).toBe(2);
    });

    it("écarte ce qui est déjà `synced` — le serveur l'a, ce n'est plus dû", async () => {
        mountStorage([
            { id: "a", kind: "create", layerId: "l1", localId: "x", state: "pending" },
            { id: "b", kind: "create", layerId: "l1", localId: "z", state: "synced" },
        ]);
        expect((await listPendingEditorEntries()).map((e) => e.id)).toEqual(["a"]);
    });

    it("rend [] quand le moteur de stockage est absent — sans jeter", async () => {
        (globalThis as Record<string, unknown>).GeoLeaf = { Storage: {} };
        expect(await listPendingEditorEntries()).toEqual([]);
    });
});

describe("editor-sync-replay — le drain est délégué au core", () => {
    beforeEach(() => {
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("flushNow appelle pushOutbox et prévient l'interface", async () => {
        const pushOutbox = mountStorage([], { attempted: 2, pushed: 2, failed: 0 });
        const flushed = vi.fn();
        document.addEventListener("geoleaf:editor:feature-sync-flushed", flushed);

        await flushNow();

        expect(pushOutbox).toHaveBeenCalled();
        // ⚠️ This event has a LISTENER (`entry.ts` → `_onQueueChanged`, the
        // pending badge). A first draft deleted it asserting it had none — an
        // assertion made BEFORE the grep that disproved it. The badge would
        // have stayed frozen.
        expect(flushed).toHaveBeenCalled();
        document.removeEventListener("geoleaf:editor:feature-sync-flushed", flushed);
    });

    it("ne draine PAS hors réseau — chaque entrée échouerait pour rien", async () => {
        const pushOutbox = mountStorage([]);
        Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
        await flushNow();
        expect(pushOutbox).not.toHaveBeenCalled();
    });

    // 🛑 STRUCTURAL NEGATIVE CONTROL — this module arms NOTHING any more.
    // It carried the repo's ONLY automatic drain trigger: an `online` listener registered by
    // `initSyncReplay`. The core has taken it back, for every application and without
    // requiring this plugin to be loaded. Two armers of the same drain is exactly the
    // objection the `offline.md` sheet raised against the move — hence this control, which
    // goes red if anyone re-arms here "for compatibility".
    it("🛑 n'attache AUCUN écouteur `online` — le core arme, pas le plugin", async () => {
        const spy = vi.spyOn(window, "addEventListener");
        vi.resetModules();
        await import("../persistence/editor-sync-replay.js");
        const armed = spy.mock.calls.filter(([type]) => type === "online");
        spy.mockRestore();
        expect(armed).toEqual([]);
    });
});

/**
 * 🛑 `drainOutbox` was EXTRACTED from `flushNow`, and the motive is the LOCK.
 * The `Sync` seam's `"poi"` handler drains too, for `offline-ui`'s button. If
 * it called `pushOutbox` on its own side, `_flushing` — which only guards what
 * goes through here — would not see its calls, and two drains could overlap
 * on the same outbox.
 */
describe("drainOutbox — le point d'entrée unique du drain (5.1-b)", () => {
    beforeEach(() => {
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("REND le décompte du drain, là où flushNow ne rendait rien", async () => {
        mountStorage([], { attempted: 3, pushed: 2, failed: 1 });
        await expect(drainOutbox()).resolves.toMatchObject({
            attempted: 3,
            pushed: 2,
            failed: 1,
        });
    });

    it("🛑 rend null hors réseau — ce n'est PAS un drain à zéro", async () => {
        const pushOutbox = mountStorage([]);
        Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
        await expect(drainOutbox()).resolves.toBeNull();
        expect(pushOutbox).not.toHaveBeenCalled();
    });

    it("rend null quand la façade de stockage est absente", async () => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
        await expect(drainOutbox()).resolves.toBeNull();
    });

    // 🛑 THE LOCK IS NO LONGER HERE, AND THE TEST THAT ASSERTED IT WAS REQUALIFIED, NOT
    // DELETED.
    //
    // It checked that two concurrent `drainOutbox()` pushed once, and that the second
    // returned `null`. The property was true and too narrow: `_flushing` only guarded what
    // came through this function, while the console, the E2E suite and the core's own
    // triggers call `Storage.pushOutbox()` directly. The lock moved INTO the drain, where
    // everyone arrives — its proof is
    // `packages/core/__tests__/capabilities/offline/push-engine-lock.test.ts`, which asserts
    // what this one could not see: the REPLAY BUDGET spent exactly once.
    //
    // What is still tested here is what this module really does: delegate, every time it is
    // asked. And the second call's `null` has LEFT the contract — the core now returns the
    // running pass's tally.
    it("délègue à chaque appel — la coalescence appartient au core, pas à ce module", async () => {
        const pushOutbox = mountStorage([], { attempted: 1, pushed: 1, failed: 0 });

        const [a, b] = await Promise.all([drainOutbox(), drainOutbox()]);

        expect(pushOutbox).toHaveBeenCalledTimes(2);
        expect([a, b].filter((r) => r === null)).toHaveLength(0);
    });

    it("🛑 un rejet du core ne condamne pas les drains suivants", async () => {
        // ⚠️ THIS TEST WAS CALLED "the drain releases its lock", and that title would be
        // FALSE now that the lock moved into the core. The property itself is still owed and
        // still checkable here: this module must hold nothing back that would prevent a
        // second attempt. Otherwise a network outage would condemn every replay until the
        // page reloads, and a field capture would sit in the queue with no recourse.
        // The lock's own release is guarded core-side by `push-engine-lock.test.ts`
        // ("a rejection releases it too").
        const pushOutbox = vi
            .fn()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValue({ attempted: 1, pushed: 1, failed: 0, conflicts: 0, refused: null });
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: {
                DB: { _ensureModule: () => ({ list: () => Promise.resolve([]) }) },
                pushOutbox,
            },
        };

        await expect(drainOutbox()).rejects.toThrow("boom");
        await expect(drainOutbox()).resolves.toMatchObject({ pushed: 1 });
        expect(pushOutbox).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------
// Ordering — the photos go up BEFORE the queue is drained
// ---------------------------------------------------------------------------

/**
 * 🛑 THE DEFECT WAS AN ORDER, AND NOTHING IN THE CODE STATED IT. Two independent `online`
 * listeners existed — this replay's, registered first, and the image retry's. On
 * reconnection the outbox was therefore pushed while the photos were still held locally, so
 * the create left carrying an image TOKEN no server can resolve. Running the retry first is
 * what lets its reconciling `update` be coalesced into the still-pending create, so the
 * server never sees the token at all.
 */
describe("drainOutbox — l'étape préalable", () => {
    beforeEach(() => {
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    // 🛑 THE THREE `beforeDrain` CASES THAT STOOD HERE MOVED TO THE CORE, WITH THE
    // MECHANISM. They asserted the order (images then drain), the tolerance to a failing
    // step, and that a step was optional. All three were true — of ONE caller, the only
    // one that went through this wrapper. The step is now registered on
    // `GeoLeaf.Sync.registerBeforeDrain` and run inside `pushOutbox`, so the properties
    // belong to `__tests__/capabilities/offline/drain-hooks.test.ts`. Keeping shadows of
    // them here would assert a wrapper that no longer decides anything.
    it("ne séquence plus rien lui-même — le drain est une délégation nue", async () => {
        const pushOutbox = mountStorage([]);
        await drainOutbox();
        expect(pushOutbox).toHaveBeenCalledTimes(1);
    });
});
