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
    requeueAll,
    discardQuarantined,
} from "../../../src/capabilities/offline/write/quarantine-api.js";

vi.mock("../../../src/capabilities/offline/config-seam.js", () => ({
    coreProfileLayerConfig: (layerId: string) => {
        if (layerId === "couche-ecrivable") return { write: { enabled: true } };
        // The dialect the core does not speak: its quarantine lifts when the declaration
        // changes, and that is observable here.
        if (layerId === "couche-rest") return { write: { enabled: true, dialect: "rest" } };
        return { write: { enabled: false } };
    },
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

/** A local entity record, as the `features` store holds it. */
interface LocalRecord {
    layerId: string;
    localId: string;
    serverId: string | null;
    syncState: string;
    feature: unknown;
    quarantine?: string;
}

/** The fake `features` store, keyed `layerId|localId`; absent when the test mounts none. */
let records: Map<string, LocalRecord> | null;

/**
 * Mounts a fake queue store, or no store at all — and, when given, a `features` store
 * holding these local records.
 */
function mountOutbox(list: Entry[] | null, localRecords?: LocalRecord[]): void {
    entries = list ?? [];
    updates = [];
    removals = [];
    records = localRecords
        ? new Map(localRecords.map((r) => [`${r.layerId}|${r.localId}`, { ...r }]))
        : null;
    const features = records && {
        get: async (layerId: string, localId: string) =>
            records!.get(`${layerId}|${localId}`) ?? null,
        put: async (record: LocalRecord) => {
            records!.set(`${record.layerId}|${record.localId}`, record);
        },
        remove: async (layerId: string, localId: string) => {
            records!.delete(`${layerId}|${localId}`);
        },
    };
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
                                    entries = entries.filter((e) => e.id !== id);
                                },
                            }
                          : name === "Features"
                            ? features
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
                // ⚠️ And `nextAttemptAt` clears with the budget it belonged to: a
                // "Retry" that silently waits out a delay computed for the failure the
                // operator just declared over is, for them, a Retry that does not work.
                { attempts: 0, quarantine: null, quarantineStatus: null, nextAttemptAt: 0 },
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

    it("🛑 `dialectNotSupported` est REFUSÉE tant que la couche déclare ce dialecte", async () => {
        // Same verifiable shape as `layerNoLongerWritable`: the declaration is readable here,
        // so we observe the cause lifted instead of spending the entry's budget to learn it.
        mountOutbox([quarantined({ quarantine: "dialectNotSupported", layerId: "couche-rest" })]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
            ok: false,
            refused: "causeStillPresent",
        });
        expect(updates).toEqual([]);
    });

    it("🛑 `dialectNotSupported` repart quand la couche ne déclare plus ce dialecte", async () => {
        mountOutbox([
            quarantined({ quarantine: "dialectNotSupported", layerId: "couche-ecrivable" }),
        ]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({ ok: true });
    });

    it("🛑 `authRequired` est rejouable — une session revient, c'est même tout ce qu'elle fait", async () => {
        // The cause lifts when the operator signs back in — unobservable from the core,
        // which knows nothing of the connector: the gesture IS the observation, exactly
        // as for a spent budget. What matters is that it is not `rejectedByServer`,
        // whose only exit is destruction.
        mountOutbox([quarantined({ quarantine: "authRequired", attempts: 1 })]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({ ok: true });
        expect(updates.map((u) => u[1])).toEqual(["pending"]);
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
                // ⚠️ And `nextAttemptAt` clears with the budget it belonged to: a
                // "Retry" that silently waits out a delay computed for the failure the
                // operator just declared over is, for them, a Retry that does not work.
                { attempts: 0, quarantine: null, quarantineStatus: null, nextAttemptAt: 0 },
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

describe("requeueAll — le geste qu'un opérateur peut réellement faire", () => {
    // 🛑 The single-entry exit had NO caller, and its shape is why: it takes a contract
    // id, a value nothing displays. Meanwhile what produces quarantines is never one
    // entry — an expired token, a maintenance window or a radio hole sets aside a whole
    // tour at once. An exit that must be repeated forty times is an exit nobody takes.

    it("remet en file toutes les entrées rejouables, et LAISSE les autres", async () => {
        mountOutbox([
            quarantined({ id: "a", quarantine: "retryBudgetExhausted" }),
            quarantined({ id: "b", quarantine: "notImplementedByServer" }),
            // Not requeueable: replaying would recreate what the server deleted.
            quarantined({ id: "c", quarantine: "deletedOnServer" }),
            // Not quarantined at all — the drain already holds it.
            quarantined({ id: "d", state: "failed", quarantine: "retryBudgetExhausted" }),
        ]);

        expect(await requeueAll()).toEqual({ ok: true, requeued: 2, skipped: 0 });
        expect(updates.map((u) => u[0])).toEqual(["a", "b"]);
    });

    it("restreinte à un motif, elle ne touche que lui", async () => {
        mountOutbox([
            quarantined({ id: "a", quarantine: "retryBudgetExhausted" }),
            quarantined({ id: "b", quarantine: "notImplementedByServer" }),
        ]);

        expect(await requeueAll("retryBudgetExhausted")).toEqual({
            ok: true,
            requeued: 1,
            skipped: 0,
        });
        expect(updates.map((u) => u[0])).toEqual(["a"]);
    });

    it("🛑 ce que la règle refuse est COMPTÉ, jamais avalé", async () => {
        // The batch delegates to `requeueQuarantined`, so the verifiable cause — does
        // the layer write again? — still decides, one entry at a time. A batch that
        // decided for itself would be a second authority, free to diverge on exactly
        // the point the 07/08/2026 arbitration settled.
        mountOutbox([
            quarantined({ id: "a", quarantine: "retryBudgetExhausted" }),
            quarantined({ id: "b", quarantine: "layerNoLongerWritable", layerId: "sites" }),
        ]);

        expect(await requeueAll()).toEqual({ ok: true, requeued: 1, skipped: 1 });
        expect(
            updates.map((u) => u[0]),
            "la couche muette n'est pas remise en file"
        ).toEqual(["a"]);
    });

    it("une file sans quarantaine rend un compte nul plutôt qu'un refus", async () => {
        mountOutbox([]);
        expect(await requeueAll()).toEqual({ ok: true, requeued: 0, skipped: 0 });
    });

    it("sans moteur câblé, elle refuse plutôt que de rendre un zéro muet", async () => {
        mountOutbox(null);
        expect(await requeueAll()).toEqual({
            ok: false,
            requeued: 0,
            skipped: 0,
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

// ─────────────────────────────────────────────────────────────────────────────
// Destroying a capture returns its entity to the server's truth.
//
// The quarantine is written on the queue entry only: the entity's local record keeps its
// `pending` state. Destroying the capture used to remove the entry and nothing else, which left
// a record claiming local work that no queue entry would ever push — and that the pull never
// replaces, since it preserves everything not `synced`. A layer that reads the device before the
// network drew it on every load, online too: the entity the server deleted, the creation it
// refused, or the edit it refused, in place of its own version.
// ─────────────────────────────────────────────────────────────────────────────
describe("discardQuarantined — l'entité revient à la vérité du serveur", () => {
    const record = (over: Partial<LocalRecord> = {}): LocalRecord => ({
        layerId: "sites",
        localId: "loc:abc",
        serverId: "42",
        syncState: "pending",
        feature: { type: "Feature", properties: { name: "édité localement" } },
        ...over,
    });

    it("`deletedOnServer` : l'enregistrement part — le serveur n'a plus rien à rendre", async () => {
        mountOutbox(
            [quarantined({ id: "update:sites:loc:abc:1", quarantine: "deletedOnServer" })],
            [record()]
        );
        expect(await discardQuarantined("update:sites:loc:abc:1", "loc:abc")).toEqual({ ok: true });
        expect(records!.has("sites|loc:abc")).toBe(false);
    });

    it("une création jamais arrivée (sans identité serveur) : l'enregistrement part", async () => {
        mountOutbox(
            [quarantined({ quarantine: "rejectedByServer" })],
            [record({ serverId: null })]
        );
        expect(await discardQuarantined("create:sites:loc:abc:1", "loc:abc")).toEqual({ ok: true });
        expect(records!.has("sites|loc:abc")).toBe(false);
    });

    it("une entité que le serveur a encore : l'enregistrement repasse `synced`", async () => {
        // The next pull replaces a `synced` record with the server's version, and a complete
        // pull that no longer serves it sweeps it: the device converges without a gesture.
        mountOutbox(
            [quarantined({ id: "update:sites:loc:abc:1", quarantine: "rejectedByServer" })],
            [record({ quarantine: "rejectedByServer" })]
        );
        expect(await discardQuarantined("update:sites:loc:abc:1", "loc:abc")).toEqual({ ok: true });
        const after = records!.get("sites|loc:abc");
        expect(after?.syncState).toBe("synced");
        expect(after?.serverId).toBe("42");
        expect(after && "quarantine" in after).toBe(false);
    });

    it("🛑 une autre saisie de la même entité reste en file : l'enregistrement n'est pas touché", async () => {
        mountOutbox(
            [
                quarantined({ id: "update:sites:loc:abc:1", quarantine: "rejectedByServer" }),
                // A live entry of the same entity: no motive, it is still in the drain's hands.
                {
                    id: "update:sites:loc:abc:2",
                    layerId: "sites",
                    localId: "loc:abc",
                    state: "pending",
                },
            ],
            [record()]
        );
        expect(await discardQuarantined("update:sites:loc:abc:1", "loc:abc")).toEqual({ ok: true });
        expect(records!.get("sites|loc:abc")).toEqual(record());
    });
});
