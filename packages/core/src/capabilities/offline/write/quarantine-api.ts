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
 * matches it** — because the motives are not of the same nature. There were five then;
 * `authRequired` (03/09/2026) and `dialectNotSupported` (17/09/2026) joined the liftable half:
 *
 * | Motive | Can the cause be observed as lifted? |
 * | --- | --- |
 * | `retryBudgetExhausted` | **yes** — the server never answered, the network can return |
 * | `layerNoLongerWritable` | **yes** — and it is VERIFIABLE: does the layer have a `write`? |
 * | `notImplementedByServer` | **yes** — the server can be upgraded |
 * | `authRequired` | **yes** — the operator signs back in; that gesture is the observation |
 * | `dialectNotSupported` | **yes** — and it is VERIFIABLE: has the layer's declaration changed? |
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
            nextAttemptAt?: number | null;
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
    // A session comes back — that is the whole of what a session does. The core cannot
    // observe it (it knows nothing of the connector), so the operator's gesture is the
    // observation, exactly as for a spent budget.
    "authRequired",
    // A layer's declaration changes, and that IS observable here — verified below.
    "dialectNotSupported",
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
/** A local entity record, as far as this module reads and writes it. */
interface LocalRecord {
    layerId: string;
    localId: string;
    serverId: string | null;
    syncState: string;
    quarantine?: QuarantineReason;
    quarantineStatus?: number;
    [key: string]: unknown;
}

interface FeaturesModule {
    get(layerId: string, localId: string): Promise<LocalRecord | null>;
    put(record: LocalRecord): Promise<void>;
    remove(layerId: string, localId: string): Promise<void>;
}

function _features(): FeaturesModule | null {
    const db = StorageContract.DB as QuarantineStore | null;
    const mod = db?._ensureModule?.("Features") as Partial<FeaturesModule> | null | undefined;
    return typeof mod?.get === "function" &&
        typeof mod?.put === "function" &&
        typeof mod?.remove === "function"
        ? (mod as FeaturesModule)
        : null;
}

/**
 * Returns an entity's local record to the server's truth once its capture is destroyed.
 *
 * 🛑 **The quarantine lives on the queue entry, not on the record.** The record keeps the
 * `pending` state the edit gave it, so removing the entry alone left a record claiming local
 * work that no entry would ever push — and that the pull never replaces, since it preserves
 * everything not `synced`. A layer that reads the device before the network drew it on every
 * load: the entity the server deleted, the creation it refused, the edit it refused in place of
 * its own version.
 *
 * - Another queue entry still names the entity: the record is live work, left untouched.
 * - No server identity (a creation that never landed), or `deletedOnServer`: there is nothing
 *   on the server to go back to, so the record is removed.
 * - Otherwise the server still holds the entity: the record becomes `synced`, so the next pull
 *   replaces it with the server's version, and a complete pull that no longer serves it sweeps
 *   it. Until then the local content stays displayed.
 *
 * @param outbox - The queue, the entry already removed from it.
 * @param found - The destroyed entry.
 */
async function _releaseLocalRecord(outbox: OutboxModule, found: QuarantinedEntry): Promise<void> {
    const { layerId, localId } = found;
    if (!layerId || !localId) return;
    const stillQueued = (await outbox.list()).some(
        (e) => e.id !== found.id && e.layerId === layerId && e.localId === localId
    );
    if (stillQueued) return;
    const features = _features();
    const record = features ? await features.get(layerId, localId) : null;
    if (!features || !record) return;
    if (!record.serverId || found.quarantine === "deletedOnServer") {
        await features.remove(layerId, localId);
        return;
    }
    const { quarantine: _reason, quarantineStatus: _status, ...rest } = record;
    await features.put({ ...rest, syncState: "synced" });
}

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
 * Two motives have a lifting that is OBSERVABLE here, and both are read in the layer's
 * declaration: `layerNoLongerWritable` — has the layer found a write target again? — and
 * `dialectNotSupported` — does it still declare a dialect the core does not speak? We verify
 * them rather than believe them: requeueing an entry whose layer has not changed would send
 * it back to quarantine at the first drain, spending its budget for nothing.
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
    const verifiable =
        entry.quarantine === "layerNoLongerWritable" || entry.quarantine === "dialectNotSupported";
    if (!verifiable) return true;
    const write = (
        coreProfileLayerConfig(entry.layerId ?? "") as {
            write?: { enabled?: boolean; dialect?: string };
        } | null
    )?.write;
    if (entry.quarantine === "dialectNotSupported") return write?.dialect !== "rest";
    return write?.enabled === true;
}

/**
 * The motives an operator's gesture can lift — {@link REQUEUEABLE}, as a copy.
 *
 * 🛑 **IT EXISTS SO THE RULE KEEPS ONE AUTHOR.** An interface offering "retry all" per motive
 * has to know which motives that sentence is true for, BEFORE the click: a button that does
 * nothing when pressed teaches the user to stop pressing it, which is the argument
 * `offline-ui`'s status block already states in its own words. Without this read, every
 * surface would hard-code the list — and a plugin cannot import the core (`INV-NS`), so its
 * copy would be free to diverge on the exact point the arbitration of 07/08/2026 settled, and
 * no gate could see it.
 *
 * ⚠️ **A COPY, and frozen**: `REQUEUEABLE` is this module's decision, not a shared mutable.
 *
 * ⚠️ It does NOT say an entry will come back — {@link requeueQuarantined} still verifies that
 * the cause is OBSERVED as lifted for the two motives where that is checkable. It says which
 * motives have an exit at all.
 *
 * @returns The requeueable motives, in the order this module declares them.
 * @example
 * const exits = GeoLeaf?.Storage?.requeueableReasons?.() ?? [];
 * if (exits.includes(entry.quarantine)) showRetryButton(entry);
 */
export function requeueableReasons(): readonly QuarantineReason[] {
    return Object.freeze([...REQUEUEABLE]);
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
        // 🛑 The deferral is erased WITH the budget it belonged to. Keeping it would
        // make the operator's gesture wait out a delay computed for the failure they
        // just declared over — a "Retry" that does nothing for eight minutes is
        // indistinguishable, for them, from one that does not work.
        nextAttemptAt: 0,
    });
    Log.info(`[Offline.Quarantine] ${id} — remise en file (cause « ${reason} » levée).`);
    return { ok: true };
}

/**
 * Puts EVERY requeueable quarantined entry back in the queue, in one gesture.
 *
 * 🛑 **THE SINGLE-ENTRY EXIT HAD NO CALLER, AND THE SHAPE IS WHY.** `requeueQuarantined`
 * takes one contract id — a value nothing displays — so the only way to use it was to
 * list the queue in a console and paste an identifier. Meanwhile the case that produces
 * quarantines is never a lone entry: an expired token, a maintenance window or a radio
 * hole sets aside a whole tour's captures at once. An exit that must be repeated forty
 * times is an exit nobody takes.
 *
 * ⚠️ **It DELEGATES to {@link requeueQuarantined} rather than reimplementing it**, so
 * the rule that decides — motive requeueable, cause observed as lifted — has exactly one
 * author. A batch that decided for itself would be a second authority, free to diverge
 * on the very point the arbitration of 07/08/2026 settled: an undifferentiated "retry"
 * recreates entities the server deleted.
 *
 * @param reason - Restrict to this motive. Omitted, every requeueable entry is taken.
 * @returns How many came back and how many were left, or the refusal when the engine
 *   is not wired. `skipped` counts what the rule refused — never a silent difference.
 *
 * @example
 * ```ts
 * // "Retry everything the network held up", once the network is back.
 * const out = await requeueAll("retryBudgetExhausted");
 * if (out.ok) console.info(`${out.requeued} saisie(s) remise(s) en file`);
 * ```
 */
export async function requeueAll(
    reason?: QuarantineReason
): Promise<{ ok: boolean; requeued: number; skipped: number; refused?: QuarantineRefusal }> {
    const outbox = _outbox();
    if (!outbox) return { ok: false, requeued: 0, skipped: 0, refused: "engineUnavailable" };

    const targets = (await outbox.list()).filter(
        (entry) =>
            entry.state === "quarantined" &&
            !!entry.quarantine &&
            (reason ? entry.quarantine === reason : REQUEUEABLE.includes(entry.quarantine))
    );

    let requeued = 0;
    let skipped = 0;
    for (const entry of targets) {
        const outcome = await requeueQuarantined(entry.id);
        if (outcome.ok) requeued += 1;
        else skipped += 1;
    }
    Log.info(
        `[Offline.Quarantine] remise en file groupée : ${requeued} rejouée(s), ${skipped} laissée(s)` +
            (reason ? ` (motif « ${reason} »).` : ".")
    );
    return { ok: true, requeued, skipped };
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
 * The entity's local record then returns to the server's truth, unless another queue entry
 * still names it: removed when the server has nothing to give back (a creation that never
 * landed, `deletedOnServer`), marked `synced` otherwise, so the next pull replaces it.
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
    // The destruction is done and stays done: a record that cannot be released is SAID, it
    // does not turn the operator's confirmed gesture into a failure.
    try {
        await _releaseLocalRecord(outbox, found);
    } catch (err) {
        Log.warn(
            `[Offline.Quarantine] ${id} — l'enregistrement local n'a pas pu revenir à l'état du serveur :`,
            err instanceof Error ? err.message : String(err)
        );
    }
    return { ok: true };
}
