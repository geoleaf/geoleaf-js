/**
 * The TWO exits from quarantine.
 *
 * 🛑 What this suite guards, and nothing else did: that a set-aside entry can
 * **get out**. Before this it had no exit — not the drain, not the purge, no
 * interface gesture —, so it accumulated on the field device, visible,
 * counted, unresolvable.
 *
 * The two exits are NOT interchangeable, and that is the design's core:
 *
 *  1. **Requeue** — reserved for reasons whose cause can be observed lifted.
 *     Replaying a `deletedOnServer` would recreate what the server deleted; a
 *     `rejectedByServer` would get refused identically. An undifferentiated
 *     "retry" would be wrong for half the cases, and wrong in the costly direction.
 *  2. **Confirmed destruction** — and the confirmation is not a boolean. The
 *     caller must return the entry's `localId`, which it can only know by
 *     having LISTED it. A `{confirmed: true}` can be set from any code with
 *     nothing having been shown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StorageContract } from "../../../src/kernel/shared/index.js";
import {
    requeueQuarantined,
    discardQuarantined,
} from "../../../src/capabilities/offline/write/quarantine-api.js";

vi.mock("../../../src/capabilities/offline/config-seam.js", () => ({
    coreProfileLayerConfig: (layerId: string) =>
        layerId === "couche-ecrivable"
            ? { write: { enabled: true } }
            : { write: { enabled: false } },
}));

interface Entry {
    id: string;
    layerId?: string;
    localId?: string;
    state?: string;
    quarantine?: string;
    attempts?: number;
}

let entries: Entry[];
let updates: Array<[string, string, unknown]>;
let removals: string[];

/** Mounts a fake queue store, or no store at all. */
function mountOutbox(list: Entry[] | null): void {
    entries = list ?? [];
    updates = [];
    removals = [];
    // ⚠️ `StorageContract.DB` is a read-only ACCESSOR — `init()` is its only
    // write point, and that is what `push-engine.test.js` does. Writing the
    // property directly throws "Cannot set property DB".
    const db =
        list === null
            ? null
            : {
                  _ensureModule: (name: string) =>
                      name === "Outbox"
                          ? {
                                list: async () => entries,
                                updateState: async (id: string, state: string, patch: unknown) => {
                                    updates.push([id, state, patch]);
                                },
                                remove: async (id: string) => {
                                    removals.push(id);
                                },
                            }
                          : null,
              };
    (StorageContract as unknown as { init: (m: unknown) => void }).init({
        get DB() {
            return db;
        },
        isAvailable: () => db !== null,
    });
}

const quarantined = (over: Partial<Entry> = {}): Entry => ({
    id: "create:sites:loc:abc:1",
    layerId: "sites",
    localId: "loc:abc",
    state: "quarantined",
    quarantine: "retryBudgetExhausted",
    attempts: 3,
    ...over,
});

beforeEach(() => {
    mountOutbox([quarantined()]);
});

afterEach(() => {
    // 🛑 `StorageContract.init()` writes a module SINGLETON: without this
    // reset, this suite's fake store outlives its file and gets read by the
    // next ones. Found by getting it wrong — `offline-engine-entry.test.js`
    // passed in isolation and broke under the full suite, which looked
    // exactly like a regression of my code.
    (StorageContract as unknown as { init: (m: unknown) => void }).init({
        get DB() {
            return null;
        },
        isAvailable: () => false,
    });
});

describe("requeueQuarantined — la cause levée, et seulement elle", () => {
    it("`retryBudgetExhausted` repasse en `pending`, budget REMIS À ZÉRO", async () => {
        const out = await requeueQuarantined("create:sites:loc:abc:1");
        expect(out).toEqual({ ok: true });
        // 🛑 Without the reset, the entry would fall back into quarantine at
        // the first failure: its budget is already spent, precisely what put it there.
        expect(updates).toEqual([
            [
                "create:sites:loc:abc:1",
                "pending",
                // ⚠️ `quarantineStatus` clears WITH the reason. A requeued
                // entry keeping "403" would carry a stale diagnosis about a
                // replay that has not happened yet — more misleading than an
                // absence, since it looks like a measurement.
                { attempts: 0, quarantine: null, quarantineStatus: null },
            ],
        ]);
    });

    it("`layerNoLongerWritable` est remise en file SI la couche écrit de nouveau", async () => {
        mountOutbox([
            quarantined({ quarantine: "layerNoLongerWritable", layerId: "couche-ecrivable" }),
        ]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({ ok: true });
    });

    it("`layerNoLongerWritable` est REFUSÉE tant que la couche n'écrit pas", async () => {
        // The cause is VERIFIABLE: we observe it lifted rather than hope it
        // is. Requeueing a layer that still does not write would send it back
        // to quarantine at the first drain, spending its budget for nothing.
        mountOutbox([quarantined({ quarantine: "layerNoLongerWritable", layerId: "sites" })]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
            ok: false,
            refused: "causeStillPresent",
        });
        expect(updates).toEqual([]);
    });

    it("`notImplementedByServer` est rejouable — le serveur peut avoir été mis à jour", async () => {
        // The cause lifts when a verb-aware version deploys: nothing here can
        // observe it — the only way would be to redo the call, i.e. the
        // replay itself. So we believe the operator, exactly as for a spent
        // budget. ⚠️ The budget is also reset: the entry got there through
        // IMMEDIATE quarantine, at `attempts: 1` — without the reset it would
        // leave again with a budget dented for a cause not its own.
        mountOutbox([quarantined({ quarantine: "notImplementedByServer", attempts: 1 })]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({ ok: true });
        expect(updates).toEqual([
            [
                "create:sites:loc:abc:1",
                "pending",
                // ⚠️ `quarantineStatus` clears WITH the reason. A requeued
                // entry keeping "403" would carry a stale diagnosis about a
                // replay that has not happened yet — more misleading than an
                // absence, since it looks like a measurement.
                { attempts: 0, quarantine: null, quarantineStatus: null },
            ],
        ]);
    });

    it.each(["deletedOnServer", "rejectedByServer"])(
        "%s N'EST PAS rejouable — sa cause ne se lève pas",
        async (reason) => {
            mountOutbox([quarantined({ quarantine: reason })]);
            expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
                ok: false,
                refused: "causeNotLiftable",
            });
            expect(updates, "rejouer recréerait une entité supprimée côté serveur").toEqual([]);
        }
    );

    it("une entrée qui n'est PAS en quarantaine est refusée", async () => {
        mountOutbox([quarantined({ state: "failed" })]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
            ok: false,
            refused: "notQuarantined",
        });
    });

    it("une entrée inconnue est refusée, sans jeter", async () => {
        expect(await requeueQuarantined("inexistante")).toEqual({ ok: false, refused: "notFound" });
    });

    it("sans moteur câblé, la sortie est refusée plutôt que silencieuse", async () => {
        mountOutbox(null);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
            ok: false,
            refused: "engineUnavailable",
        });
    });
});

describe("discardQuarantined — la confirmation n'est PAS un booléen", () => {
    it("détruit quand le `localId` rendu correspond", async () => {
        const out = await discardQuarantined("create:sites:loc:abc:1", "loc:abc");
        expect(out).toEqual({ ok: true });
        expect(removals).toEqual(["create:sites:loc:abc:1"]);
    });

    it("🛑 REFUSE quand la confirmation ne correspond pas", async () => {
        // What makes "the operator saw what they discard" structurally true:
        // the `localId` is only known by having listed the entry. A
        // `{confirmed: true}` can be set from any code with nothing shown.
        expect(await discardQuarantined("create:sites:loc:abc:1", "loc:autre")).toEqual({
            ok: false,
            refused: "confirmationMismatch",
        });
        expect(removals, "aucune saisie ne doit partir sans confirmation juste").toEqual([]);
    });

    it("REFUSE une confirmation vide", async () => {
        expect(await discardQuarantined("create:sites:loc:abc:1", "")).toEqual({
            ok: false,
            refused: "confirmationMismatch",
        });
        expect(removals).toEqual([]);
    });

    it("ne détruit QUE ce qui est en quarantaine", async () => {
        // A `pending` or `failed` entry already has an exit: the drain.
        // Destroying it here would be a loss nothing justifies.
        mountOutbox([quarantined({ state: "pending" })]);
        expect(await discardQuarantined("create:sites:loc:abc:1", "loc:abc")).toEqual({
            ok: false,
            refused: "notQuarantined",
        });
        expect(removals).toEqual([]);
    });
});
