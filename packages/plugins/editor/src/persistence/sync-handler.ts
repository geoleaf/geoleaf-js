/*!
 * @geoleaf-plugins/editor — Offline sync handler for the core `Sync` seam
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The handler the editor registers on `GeoLeaf.Sync` so `offline-ui` can drive its replay
 * button. Task 5.1-b.
 *
 * 🛑 **THIS IS NOT A PORT OF `addpoi`'S 689 LINES, and measurement turned the
 * line around.** The pre-flight found that `offline-ui` consumes only **two
 * methods** of the seam — `getSyncSummary()` and `processSyncQueue()` — and
 * that in `addpoi` both are **pure delegations to the core**: the first reads
 * `Storage.DB.listPendingEdits`, the second calls `Storage.pushOutbox`. Neither
 * carries anything POI-specific. The rest of `addpoi`'s file
 * (`queueOperation`, `syncDirect`, `_runOperation`, `autoSync`, `isSyncing`)
 * has **zero consumers outside its package** and dies with it — it does not
 * transfer.
 *
 * ⚠️ **TWO `addpoi` BEHAVIOURS ARE DELIBERATELY NOT REPRODUCED HERE.**
 *
 *   1. **The notification.** `addpoi.processSyncQueue` emits a success/failure
 *      toast, and `offline-ui/sync-manager.ts` emits one TOO after the call: on
 *      the button path, the user receives **two**. `offline-ui` owns the
 *      message of the button it drives; this handler stays silent. The
 *      "network return" path belongs to `editor-sync-replay.ts`, which has its
 *      own signal.
 *   2. **The `geoleaf:poi:sync-completed` event.** Measured: its only
 *      production listener is `addpoi/src/entry.ts`, its own badge. It
 *      dies with the plugin. The editor has its own,
 *      `geoleaf:editor:feature-sync-flushed`, emitted by the drain.
 *
 * ⚠️ **Reproducing a defect is not "preserving the surface".** The surface
 * consumers read is the return value, and it is identical.
 */
import { Log } from "@geoleaf/host-runtime";
import { storageDb } from "./storage-seam.js";
import { drainOutbox } from "./editor-sync-replay.js";

/** The identifier under which `offline-ui` reads the handler (`sync-seam.ts`). */
export const SYNC_HANDLER_ID = "poi";

/** Tally of captures owed to the server, in the shape the core's contract freezes. */
export interface SyncSummary {
    total: number;
    add: number;
    update: number;
    delete: number;
}

/** A replay's tally, in the shape `offline-ui` already reads. */
export interface SyncResults {
    success: boolean;
    total: number;
    synced: number;
    failed: number;
    skipped: number;
}

/** The `GeoLeaf.Sync` facade, read at call time — the core mounts it at boot. */
interface SyncSeam {
    registerHandler?(id: string, handler: unknown): void;
    getHandler?(id: string): unknown;
}

function _syncSeam(): SyncSeam | null {
    return (Reflect.get(globalThis, "GeoLeaf") as { Sync?: SyncSeam } | undefined)?.Sync ?? null;
}

/**
 * The handler registered on `GeoLeaf.Sync`.
 *
 * @example
 * ```ts
 * const summary = await EditorSyncHandler.getSyncSummary();
 * if (summary.total > 0) await EditorSyncHandler.processSyncQueue();
 * ```
 */
export const EditorSyncHandler = {
    /**
     * Counts never-pushed captures, broken down by operation vocabulary.
     *
     * ⚠️ The source is `Storage.DB.listPendingEdits` — **exactly the one
     * `addpoi` read**. Counting otherwise (e.g. a filtered `outbox.list()`, as
     * the editor's pending modal does) would give a neighbouring but not
     * identical total: the core discards entries without `layerId` or `localId`
     * there. `offline-ui`'s button activates on `total > 0`; a gap there would
     * be an invisible behaviour change.
     *
     * @returns the tally, or zeros when the storage engine is absent.
     */
    async getSyncSummary(): Promise<SyncSummary> {
        const db = storageDb();
        const listPendingEdits = db?.listPendingEdits;
        if (!listPendingEdits) return { total: 0, add: 0, update: 0, delete: 0 };

        // METHOD call: the receiver stays bound.
        const entries = await listPendingEdits.call(db);
        const summary: SyncSummary = { total: entries.length, add: 0, update: 0, delete: 0 };
        for (const entry of entries) {
            // Vocabulary frozen by the contract (`SyncOperationKind`) and
            // written by `applyEdit`. An unknown value counts in `total` without
            // being broken down: better a right total and an incomplete
            // breakdown than the reverse.
            if (entry.kind === "create") summary.add += 1;
            else if (entry.kind === "update") summary.update += 1;
            else if (entry.kind === "delete") summary.delete += 1;
        }
        return summary;
    },

    /**
     * Replays the queue to the server, for `offline-ui`'s button.
     *
     * Delegates to the shared drain (`editor-sync-replay.drainOutbox`) to avoid
     * opening a second drain path next to the network-return one — both share a
     * lock.
     *
     * @returns the replay's tally.
     * @throws when the network is absent or a drain is already running —
     *   `offline-ui` expects an exception to display its message, a mute return
     *   would make it announce "0 synchronised" on a replay that never
     *   happened.
     */
    async processSyncQueue(): Promise<SyncResults> {
        const report = await drainOutbox();
        if (!report) {
            // `null` covers three cases indistinguishable here, and ALL are
            // non-events: off-network, drain already running, engine absent.
            // Returning them as a zero success would make the UI say "up to
            // date" while nothing was attempted.
            Log?.warn?.("[editor/sync-handler] Drain not run (offline, busy, or no storage)");
            throw new Error("Synchronisation indisponible");
        }
        return {
            success: report.failed === 0,
            total: report.attempted,
            synced: report.pushed,
            failed: report.failed,
            // The core's drain skips nothing: it attempts, succeeds, fails or
            // quarantines. The field is kept because `offline-ui` reads it.
            skipped: 0,
        };
    },
};

/**
 * Registers the `Sync` seam's `"poi"` handler, **unconditionally**.
 *
 * 🛑 **THIS FUNCTION USED TO YIELD, AND NO LONGER DOES.**
 * `SyncHandlerContract.registerHandler` does `_handlers.set(id, handler)`: it
 * registers **or replaces, silently**. While `addpoi` lived, registering
 * unconditionally would have let the **`<script>` tag load order** decide. The
 * workaround was to yield (`getHandler` non-empty ⟹ abstain), then take over
 * explicitly from the bridge.
 *
 * 🛑 **The bridge left with `addpoi`, and it carried the takeover's ONLY
 * caller.** Keeping the yield would have left a `return false` no successor
 * catches: `GeoLeaf.Sync.getHandler("poi")` would stay empty as soon as a third
 * party took the spot, and `offline-ui`'s replay button would die **without a
 * word**. There is no second implementer left in the repo; the yield has no
 * beneficiary any more, only a risk.
 *
 * ✅ What the earlier measurement established still holds: `deploy-full` had
 * **no** `"poi"` handler before this registration — it closes a live hole.
 *
 * @returns `true` — registration has no failure case left other than the seam's absence.
 */
export function registerSyncHandler(): boolean {
    const seam = _syncSeam();
    if (!seam?.registerHandler) {
        Log?.debug?.("[editor/sync-handler] GeoLeaf.Sync absent — registration skipped");
        return false;
    }
    seam.registerHandler(SYNC_HANDLER_ID, EditorSyncHandler);
    Log?.debug?.(`[editor/sync-handler] registered "${SYNC_HANDLER_ID}"`);
    return true;
}
