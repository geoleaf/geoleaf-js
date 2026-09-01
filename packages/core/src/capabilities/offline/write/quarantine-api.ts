/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The TWO exits from quarantine.
 *
 * 🛑 **A quarantined entry had NONE.** Neither the drain (`REPLAYABLE_STATUSES` =
 * `failed` + `pending`), nor the purge, nor any UI gesture could get it out. It was
 * counted (`getSyncCounts().quarantinedCount`), listed (`listPendingEdits`) and
 * exportable — but the field operator watched it accumulate with nothing to do about
 * it. "Never destroyed" protected the capture and condemned the operator to carry it
 * indefinitely.
 *
 * Two exits, arbitrated by Mattieu on 07/08/2026, and **each covers the half that
 * matches it** — because the five motives are not of the same nature:
 *
 * | Motive | Can the cause be observed as lifted? |
 * | --- | --- |
 * | `retryBudgetExhausted` | **yes** — the server never answered, the network can return |
 * | `layerNoLongerWritable` | **yes** — and it is VERIFIABLE: does the layer have a `write`? |
 * | `notImplementedByServer` | **yes** — the server can be upgraded |
 * | `deletedOnServer` | no — replaying would recreate what the server deleted |
 * | `rejectedByServer` | no — the contract defines it as "replay cannot fix" |
 *
 * ⚠️ An undifferentiated "retry" would therefore have been wrong for part of the
 * cases, and wrong in the direction that costs: it would have recreated entities
 * deleted server-side.
 *
 * ⚠️ **This table counted FOUR motives until 09/08/2026, and its last row was broader
 * than what it believed it said.** `rejectedByServer` then named every non-409/non-404
 * failure — a maintenance 503 included. The row "no — replay cannot fix" was thus
 * exact on the motive and false on the entries carrying it: a transient server outage
 * had, in practice, only the destruction exit. The fix is upstream, in
 * `push-engine.ts`'s classification; this module gained only one row.
 *
 * 🛑 **What stays forbidden**: a retention cap, a purge sweep, or any path that
 * removes an entry without a human having seen exactly what is removed. That is what
 * `ServerDeletionPolicy` defends, and its amendment did not widen it — it NAMED it:
 * what the contract forbids is the loss the operator did not see.
 *
 * @version 3.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { coreProfileLayerConfig } from "../config-seam.js";
import type { QuarantineReason } from "../../../contracts/sync.contract.js";

/** A queue entry, reduced to what this module reads. */
interface QuarantinedEntry {
    id: string;
    layerId?: string;
    localId?: string;
    state?: string;
    quarantine?: QuarantineReason;
    attempts?: number;
}

/** The queue module, reduced to what this module reads and writes. */
interface OutboxModule {
    list(): Promise<QuarantinedEntry[]>;
    updateState(
        id: string,
        state: string,
        patch?: {
            attempts?: number;
            quarantine?: QuarantineReason | null;
            quarantineStatus?: number | null;
        }
    ): Promise<void>;
    remove(id: string): Promise<void>;
}

interface QuarantineStore {
    _ensureModule?: (name: string) => unknown;
}

/**
 * The motives whose cause can be OBSERVED as lifted.
 *
 * ⚠️ Derived from each motive's meaning, not from convenience: the other two name a
 * server fact no local gesture undoes.
 */
const REQUEUEABLE: readonly QuarantineReason[] = [
    "retryBudgetExhausted",
    "layerNoLongerWritable",
    "notImplementedByServer",
];

/**
 * What refusing an exit returns, so the caller knows WHY.
 *
 * ⚠️ NOT exported, these two types: they are named nowhere else — the facade declares
 * its own structural shape (`StorageQuarantineOutcome`), because it lives in the boot
 * graph and editing lives in the deferred chunk. Exporting them would have added two
 * public names nobody calls, and `check-orphan-exports` reported them as two
 * regressions when first added. Same arbitration as `AttributeCaptureWidget` and the
 * ten event-payload shapes.
 */
type QuarantineRefusal =
    | "engineUnavailable"
    | "notFound"
    | "notQuarantined"
    | "causeNotLiftable"
    | "causeStillPresent"
    | "confirmationMismatch";

/** The report of an exit attempt. Not exported — see {@link QuarantineRefusal}. */
interface QuarantineOutcome {
    ok: boolean;
    refused?: QuarantineRefusal;
}

/** Resolves the queue module, or `null` when the engine is not wired. */
function _outbox(): OutboxModule | null {
    const db = StorageContract.DB as QuarantineStore | null;
    const mod = db?._ensureModule?.("Outbox") as Partial<OutboxModule> | null | undefined;
    // ⚠️ `typeof … === "function"` and not the member's truthiness: under a
    // non-optional type, `mod?.list && …` is always true for `tsc`, which flags it
    // (TS2774). The module comes from a string-keyed registry — it CAN be missing, and
    // that is the case being guarded.
    return typeof mod?.list === "function" && typeof mod?.updateState === "function"
        ? (mod as OutboxModule)
        : null;
}

/** Finds a QUARANTINED entry by its identifier. */
async function _findQuarantined(
    outbox: OutboxModule,
    id: string
): Promise<QuarantinedEntry | QuarantineRefusal> {
    const entry = (await outbox.list()).find((e) => e.id === id);
    if (!entry) return "notFound";
    if (entry.state !== "quarantined") return "notQuarantined";
    return entry;
}

/**
 * Is a quarantine's cause lifted?
 *
 * `layerNoLongerWritable` is the only motive whose lifting is OBSERVABLE here: has the
 * layer found a write target again? We verify it rather than believe it — requeueing
 * an entry whose layer still does not write would send it back to quarantine at the
 * first drain, spending its budget for nothing.
 *
 * `retryBudgetExhausted` names no locally verifiable fact: the server never answered.
 * The operator's gesture IS the observation — they are the one who knows the network
 * is back. We believe them, and reset their budget to zero.
 *
 * `notImplementedByServer` is on the same side since the 09/08/2026 narrowing, for
 * the same reason: the lifting of the cause is the deployment of a server version
 * that knows the verb. Nothing here can observe that — the only way would be to
 * remake the call, i.e. the replay itself.
 *
 * @param entry - The quarantined entry.
 * @returns `true` when the cause is lifted (or unverifiable, hence entrusted to the operator).
 */
function _causeIsLifted(entry: QuarantinedEntry): boolean {
    if (entry.quarantine !== "layerNoLongerWritable") return true;
    const cfg = coreProfileLayerConfig(entry.layerId ?? "") as { write?: { enabled?: boolean } };
    return cfg?.write?.enabled === true;
}

/**
 * Puts a quarantined entry back in the queue, when its cause is lifted.
 *
 * The entry goes back to `pending` and its attempt counter is **reset to zero**:
 * without that, it would fall back into quarantine at the first failure, since its
 * budget is already spent — which is precisely what put it there.
 *
 * @param id - The entry's contract identifier.
 * @returns The report; `refused` says why when the exit did not happen.
 *
 * @example
 * ```ts
 * const out = await requeueQuarantined("create:sites:loc:abc:1");
 * if (!out.ok) console.warn(out.refused); // "causeStillPresent", for example
 * ```
 */
export async function requeueQuarantined(id: string): Promise<QuarantineOutcome> {
    const outbox = _outbox();
    if (!outbox) return { ok: false, refused: "engineUnavailable" };

    const found = await _findQuarantined(outbox, id);
    if (typeof found === "string") return { ok: false, refused: found };

    const reason = found.quarantine;
    if (!reason || !REQUEUEABLE.includes(reason)) {
        // `deletedOnServer` and `rejectedByServer`: replaying would recreate a deleted
        // entity, or get refused identically. Their exit is `discardQuarantined`.
        // ⚠️ This refusal only holds because `rejectedByServer` names ONLY definitive
        // refusals since 09/08/2026 — while it also carried the 5xx, it condemned
        // passing outages.
        return { ok: false, refused: "causeNotLiftable" };
    }
    if (!_causeIsLifted(found)) return { ok: false, refused: "causeStillPresent" };

    // 🛑 `quarantineStatus` is erased WITH the motive, never after. A requeued entry
    // keeping "403" would carry a stale diagnosis about a replay that has not yet
    // happened — exactly the kind of false fact this line exists to prevent, and more
    // misleading than an absence since it looks like a measurement.
    await outbox.updateState(id, "pending", {
        attempts: 0,
        quarantine: null,
        quarantineStatus: null,
    });
    Log.info(`[Offline.Quarantine] ${id} — remise en file (cause « ${reason} » levée).`);
    return { ok: true };
}

/**
 * Destroys a quarantined entry, on the operator's EXPLICIT confirmation.
 *
 * 🛑 **The confirmation is not a boolean, and that is the heart of the gesture.** The
 * caller must provide the entry's `localId` — a value it can only know by having
 * LISTED it. A `{ confirmed: true }` can be set from any code with nothing having
 * been shown; this shape makes it structurally true that the capture was enumerated
 * before being discarded. That is what `ServerDeletionPolicy` requires since its
 * amendment: what the contract forbids is the loss the operator did not SEE, not
 * destruction in itself.
 *
 * @param id - The entry's contract identifier.
 * @param confirmedLocalId - This entry's `localId`, as the caller read it.
 * @returns The report; `confirmationMismatch` when the confirmation does not match.
 *
 * @example
 * ```ts
 * const [entry] = (await GeoLeaf?.Storage?.listPendingEdits?.()) ?? [];
 * // The guards are not decorative: the facade may not be mounted and the queue may
 * // be empty. This example is COMPILED — the `typecheck-docs-examples` gate said so.
 * if (entry) await discardQuarantined(entry.id, entry.localId); // it saw what it discards
 * ```
 */
export async function discardQuarantined(
    id: string,
    confirmedLocalId: string
): Promise<QuarantineOutcome> {
    const outbox = _outbox();
    if (!outbox?.remove) return { ok: false, refused: "engineUnavailable" };

    const found = await _findQuarantined(outbox, id);
    if (typeof found === "string") return { ok: false, refused: found };

    if (!confirmedLocalId || confirmedLocalId !== found.localId) {
        return { ok: false, refused: "confirmationMismatch" };
    }

    await outbox.remove(id);
    Log.warn(
        `[Offline.Quarantine] ${id} — DÉTRUITE sur confirmation (motif « ${found.quarantine} »). ` +
            "La saisie a été énumérée avant d'être jetée ; elle n'est pas récupérable."
    );
    return { ok: true };
}
