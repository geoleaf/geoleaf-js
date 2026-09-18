/*!
 * @geoleaf-plugins/editor — Offline sync replay (autonomous)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Replays the editor's own `editor.*` entries from the shared Storage sync queue
 * when the browser comes back online. The plugin owns its full offline lifecycle:
 * plugin-storage exposes no generic replay dispatcher and addpoi's handler is
 * POI-only, so editor entries would otherwise never flush. Each queued op is
 * replayed through the online adapter (which already fires the conflict event on
 * a 409); successes are removed from the queue, failures stay `pending`/`failed`.
 *
 * The Storage façade is read at call time (`globalThis.GeoLeaf.Storage`).
 * https://geoleaf.dev
 */
import { storageDb, storageFacade } from "./storage-seam.js";
import { dispatchEditorEvent } from "../editor-events.js";

/** A pending editor queue entry as read back from Storage. */
/**
 * An `outbox` entry, as the pending modal reads it.
 *
 * ⚠️ `type` and `payload` vanished with the v3 vocabulary: the entry carries
 * `kind` and references only `[layerId, localId]` — the payload lives in the
 * `features` store.
 */
export interface EditorQueueEntry {
    id: string;
    kind: string;
    layerId: string;
    localId: string;
    state?: string;
    createdAt?: number;
    /**
     * Why the entry was set aside, when it was — a `QuarantineReason` of the core's contract.
     *
     * 🛑 **THE WINDOW LISTED SET-ASIDE ENTRIES WITHOUT SAYING SO.** It showed the operation
     * and the layer, and its single "Retry now" button called the drain — which replays
     * `pending` and `failed` only. The one gesture the window offered had, by construction,
     * no effect on the entries the user had opened it for.
     */
    quarantine?: string;
    /** Attempts already spent — `undefined` on an engine that predates the counter. */
    attempts?: number;
}

/**
 * 🛑 **THIS MODULE NO LONGER HOLDS ANY STATE, AND THAT IS THE POINT OF R7.**
 *
 * It used to own three things the core has taken back: the `online` listener (the repo's
 * ONLY automatic drain trigger — an application without this plugin never emptied its
 * queue, and the plugin being lazily loaded, a reopened session waited for the editor to
 * come back), the `_flushing` re-entrance lock (which, as its own comment said, "only
 * guards what goes through here" — three production callers do not), and the pre-drain
 * step that uploads held photos (which therefore applied to one caller out of four).
 *
 * What is left is the two things a PLUGIN legitimately owns: a manual gesture
 * ({@link flushNow}, the modal's "Retry"), and the reading of the queue its badge shows.
 */

/**
 * The pending entries, read from the core's `outbox`.
 *
 * 🛑 **THERE ARE NO "EDITOR ENTRIES" ANY MORE.** This function filtered on the
 * `editor.` prefix to keep only its own, in a queue two plugins wrote with two
 * vocabularies. The `outbox` speaks only one — and a plugin no longer has to
 * recognise "its own": these are the user's entities, not a producer's.
 *
 * ⚠️ **Assumed consequence: the pending modal now lists EVERYTHING owed to the
 * server**, including what comes from `addpoi`. Fairer than the old behaviour
 * — a user asking "what has not left yet?" wants the complete answer, not the
 * share of a plugin they cannot name.
 *
 * @returns The entries owed to the server, in insertion order.
 */
export async function listPendingEditorEntries(): Promise<EditorQueueEntry[]> {
    const outbox = storageDb()?._ensureModule?.("Outbox");
    if (!outbox?.list) return [];
    const all = await outbox.list();
    return all.filter((e) => e.state !== "synced");
}

/** Number of editor operations currently pending in the queue. */
export async function getPendingCount(): Promise<number> {
    return (await listPendingEditorEntries()).length;
}

/**
 * The quarantine motives an operator's gesture can lift, as the core declares them.
 *
 * 🛑 **READ FROM THE CORE, never declared here.** The rule has one author —
 * `write/quarantine-api.ts` — and `INV-NS` forbids this plugin from importing it: a copy on
 * this side would be free to diverge on the exact point the arbitration of 07/08/2026
 * settled, with no gate able to confront the two.
 *
 * @returns The motives, or an empty list when the engine is older or absent — in which case
 *   the window offers no quarantine gesture rather than one that silently does nothing.
 */
export function requeueableReasons(): readonly string[] {
    return storageFacade()?.requeueableReasons?.() ?? [];
}

/**
 * Puts every entry set aside under one motive back in the queue, then drains.
 *
 * ⚠️ **The drain comes after, and it is the point.** Requeueing writes `pending` back onto
 * the entries; nothing sends them until a pass runs, and the operator who pressed "retry all"
 * is asking for the send, not for a state change they cannot see.
 *
 * @param reason - The motive to lift; omitted, every requeueable one.
 * @returns How many came back, and how many the core's rule left where they were.
 * @example
 * const { requeued, skipped } = await requeueByReason("authRequired");
 */
export async function requeueByReason(
    reason?: string
): Promise<{ requeued: number; skipped: number }> {
    const facade = storageFacade();
    const out = await facade?.requeueAll?.(reason);
    if (out?.requeued) await drainOutbox();
    return { requeued: out?.requeued ?? 0, skipped: out?.skipped ?? 0 };
}

/**
 * Destroys one set-aside entry no replay can repair.
 *
 * 🛑 **`confirmedLocalId` IS THE GUARANTEE, not a formality.** The core demands the entry's
 * `localId` — a value the caller only knows by having LISTED it — so that it is structurally
 * true that the capture was enumerated before being lost. Passing the entry object here is
 * what keeps that property on this side too: nothing can discard an id it did not read.
 *
 * @param entry - The entry, as the window listed it.
 * @returns `true` when the core accepted the destruction.
 * @example
 * if (await discardEntry(entry)) refreshBadge();
 */
export async function discardEntry(entry: EditorQueueEntry): Promise<boolean> {
    const facade = storageFacade();
    const out = await facade?.discardQuarantined?.(entry.id, entry.localId);
    return out?.ok === true;
}

/**
 * Replays a single queued op through the online adapter.
 *
 * Throws `PersistenceError("parse")` on any entry it cannot replay — an unknown
 * `type`, a save/update with no `feature`, a delete with no `featureId`. This is
 * load-bearing: until PLUGINS S4 the uncovered branches fell through and returned
 * normally, so `_syncOneEntry` read them as a success and called
 * `removeSyncQueueEntry` — a malformed offline op was dropped from the queue and
 * reported to the user as synced. Throwing routes them to the `failed` path
 * instead, where they stay visible in the pending badge and can be inspected.
 */
/**
 * Drains the queue to the server.
 *
 * 🛑 **THIS BODY BECAME A DELEGATION.** It used to replay each entry itself
 * through the plugin's REST adapter: reading the payload from `payload`,
 * dispatching on the `editor.*` vocabulary, handling the 409. All three now
 * live in the core — the drain carries the client identity on the wire and
 * reconciles `localId → serverId`, and conflict detection is done by a filter
 * on the freshness marker, not an `X-Force-Update` header no server reads.
 *
 * ⚠️ **The surface is preserved**: `entry.ts` calls `flushNow` on network
 * return, and the pending modal uses it. Changing the signature would have
 * killed the replay silently.
 */
export async function flushNow(): Promise<void> {
    await drainOutbox();
}

/**
 * The tally the core's drain returns, as consumers read it.
 *
 * ⚠️ **Reduced to what is READ, and the two optional members say why.** This shape is
 * structural — `INV-NS` forbids importing the core — so it cannot be derived, only kept
 * in step. `deferred` and `haltedBy` are optional because an older core does not carry
 * them, and their absence genuinely means "none" / "not halted". They are declared
 * because a consumer now reads them: reporting a drain that stopped, or one that walked
 * past most of its queue, as a complete pass is the defect this fixes.
 */
export interface DrainReport {
    attempted: number;
    pushed: number;
    failed: number;
    conflicts: number;
    /** Entries walked past, their retry delay not yet elapsed. */
    deferred?: number;
    /** What stopped the drain before the end of the queue, or `null`. */
    haltedBy?: string | null;
}

/**
 * Drains the outbox and RETURNS the tally.
 *
 * 🛑 **THIS DOC USED TO SAY "one entry point, one lock", AND THE LOCK HAS MOVED.** It was
 * extracted from {@link flushNow} so that the `Sync` seam's `"poi"` handler — `offline-ui`'s
 * replay button — could not overlap with it. That reasoning was sound and too narrow: the
 * flag only guarded what came through this function, while the console, the E2E suite and
 * the core's own triggers reach `Storage.pushOutbox()` directly. The lock now lives in the
 * drain itself, where every caller meets it.
 *
 * What is left here is a plugin-side gesture: refuse to try off-network, delegate, and tell
 * the badge.
 *
 * ⚠️ **The receiver is mandatory.** `pushOutbox` reads `this._modules` on the
 * core's facade; calling it detached throws `TypeError … reading '_modules'`.
 * The same defect lived in `storage-queue-adapter.ts`, where it made the
 * offline save mute. No typecheck catches it: this plugin redeclares the
 * surface it expects, and a redeclared method loses the `this` constraint the
 * core expresses. `facade.pushOutbox()` is a METHOD call — the receiver is
 * bound there by construction, and it must stay so.
 *
 * @returns the tally, or `null` when the drain did not happen — off-network, or storage
 *   facade absent. ⚠️ **"A drain is already running" is no longer one of those cases**: the
 *   core coalesces, so a concurrent call now comes back with the running pass's tally
 *   rather than `null`. `null` is NOT `{pushed: 0}`: the first says "nothing was
 *   attempted", the second "attempted, nothing left".
 */
export async function drainOutbox(): Promise<DrainReport | null> {
    // Replaying off-network would fail every entry; we wait for reconnection.
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    const facade = storageFacade();
    if (!facade?.pushOutbox) return null;

    // 🛑 NEITHER THE LOCK NOR THE PRE-DRAIN STEP LIVE HERE ANY MORE — both are the core's.
    // The lock because `_flushing` only guarded what came through this function, and three
    // production callers do not; the step (uploading held photos so the reconciling
    // `update` coalesces into the pending `create`) for the same reason, one caller out of
    // four. `pushOutbox` serialises itself and runs the steps registered on
    // `GeoLeaf.Sync.registerBeforeDrain` inside its own lock.
    const report = await facade.pushOutbox();
    if (report.pushed > 0 || report.failed > 0) _dispatchFlushed(report);
    return report;
}

/**
 * Emits `geoleaf:editor:feature-sync-flushed` once per DRAIN, no longer once per entry.
 *
 * 🛑 **THIS EVENT HAS A LISTENER, AND I NEARLY DELETED IT ON A MEASUREMENT I
 * HAD NOT MADE.** A first draft removed it asserting "no listener in the repo,
 * measured". The grep, run AFTER, returned `entry.ts` — `_onQueueChanged`,
 * which refreshes the pending badge — and a test asserting it. Removing it
 * would have frozen the badge silently after every replay.
 *
 * The granularity does change: the core's drain returns a tally, not an entry
 * list. One event per drain suffices for what the listener does — it only
 * reads the fact that something happened.
 *
 * @param report - The tally the drain returned.
 */
function _dispatchFlushed(report: { pushed: number; failed: number }): void {
    dispatchEditorEvent("geoleaf:editor:feature-sync-flushed", {
        pushed: report.pushed,
        failed: report.failed,
    });
}

// 🛑 `initSyncReplay` AND `destroySyncReplay` ARE GONE, and their removal is the point
// of the lot rather than a side effect. The first registered a `window "online"` listener
// and fired an opportunistic flush at mount; the core does both now, for every
// application and without waiting for this plugin to be loaded
// (`capabilities/offline/write/outbox-drain-triggers.ts`). Keeping them would have left
// TWO armers of the same drain — precisely the objection the sheet
// `docs/specs/capacites/offline.md` raised against moving it in-core, which is why the
// move and this deletion belong to the same commit.
