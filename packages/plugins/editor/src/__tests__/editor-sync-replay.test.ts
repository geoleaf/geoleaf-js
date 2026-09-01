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
 * `collection-rest-adapter.test.ts`) plus its live online path
 * (`auto-adapter`). Nothing is left uncovered.
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
    initSyncReplay,
    destroySyncReplay,
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
        destroySyncReplay();
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
        destroySyncReplay();
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("flushNow appelle pushOutbox et prévient l'interface", async () => {
        const pushOutbox = mountStorage([], { attempted: 2, pushed: 2, failed: 0 });
        const onChange = vi.fn();
        const flushed = vi.fn();
        document.addEventListener("geoleaf:editor:feature-sync-flushed", flushed);

        initSyncReplay({ rest: {} as never, onChange });
        await flushNow();

        expect(pushOutbox).toHaveBeenCalled();
        expect(onChange).toHaveBeenCalled();
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
        initSyncReplay({ rest: {} as never });
        await flushNow();
        expect(pushOutbox).not.toHaveBeenCalled();
    });

    it("ne draine pas sans dépendances injectées", async () => {
        const pushOutbox = mountStorage([]);
        await flushNow();
        expect(pushOutbox).not.toHaveBeenCalled();
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
        destroySyncReplay();
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

    it("🛑 DEUX drains concurrents ne poussent QU'UNE FOIS — le verrou tient", async () => {
        let release!: (v: unknown) => void;
        const gate = new Promise((r) => {
            release = r;
        });
        const pushOutbox = vi.fn(async () => {
            await gate;
            return { attempted: 1, pushed: 1, failed: 0, conflicts: 0, refused: null };
        });
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: {
                DB: { _ensureModule: () => ({ list: () => Promise.resolve([]) }) },
                pushOutbox,
            },
        };

        const first = drainOutbox();
        const second = drainOutbox(); // while the first is in flight
        release(null);
        const [a, b] = await Promise.all([first, second]);

        expect(pushOutbox).toHaveBeenCalledTimes(1);
        // The second is refused, and says so — it does not return a fake success.
        expect([a, b].filter((r) => r === null)).toHaveLength(1);
    });

    it("🛑 le drain relâche son verrou même si pushOutbox JETTE", async () => {
        // Without the `finally`, a network failure would block any later replay
        // until the page reloads — a field capture would sit queued with no recourse.
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
