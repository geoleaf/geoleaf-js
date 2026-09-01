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
import { _getLabel, _notify } from "../internal.js";
import { type EditorPersistenceAdapter } from "./adapter-interface.js";
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
}

/** Collaborators injected by entry.ts. */
interface SyncReplayDeps {
    /** Online adapter used to replay queued ops (REST or collection). */
    rest: EditorPersistenceAdapter;
    /** Called after a flush so the UI (pending badge) can refresh. */
    onChange?: () => void;
}

let _deps: SyncReplayDeps | null = null;
let _onlineListener: (() => void) | null = null;
let _flushing = false;

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
    if (!_deps) return;
    await drainOutbox();
}

/** The tally the core's drain returns, as consumers read it. */
export interface DrainReport {
    attempted: number;
    pushed: number;
    failed: number;
    conflicts: number;
}

/**
 * Drains the outbox and RETURNS the tally.
 *
 * 🛑 **This body was extracted from {@link flushNow}, and the motive is the
 * lock.** The `Sync` seam's `"poi"` handler must drain too, for `offline-ui`'s
 * replay button. If it called `pushOutbox` on its own side, two drains could
 * overlap: `_flushing` only guards what goes **through here**. One entry
 * point, one lock.
 *
 * ⚠️ **The receiver is mandatory.** `pushOutbox` reads `this._modules` on the
 * core's facade; calling it detached throws `TypeError … reading '_modules'`.
 * The same defect lived in `storage-queue-adapter.ts`, where it made the
 * offline save mute. No typecheck catches it: this plugin redeclares the
 * surface it expects, and a redeclared method loses the `this` constraint the
 * core expresses. `facade.pushOutbox()` is a METHOD call — the receiver is
 * bound there by construction, and it must stay so.
 *
 * @returns the tally, or `null` when the drain did not happen (off-network,
 *   drain already running, or storage facade absent). ⚠️ `null` is NOT
 *   `{pushed: 0}`: the first says "nothing was attempted", the second
 *   "attempted, nothing left".
 */
export async function drainOutbox(): Promise<DrainReport | null> {
    if (_flushing) return null;
    // Replaying off-network would fail every entry; we wait for reconnection.
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    const facade = storageFacade();
    if (!facade?.pushOutbox) return null;

    _flushing = true;
    try {
        const report = await facade.pushOutbox();
        if (report.pushed > 0 || report.failed > 0) {
            _dispatchFlushed(report);
            _deps?.onChange?.();
        }
        return report;
    } finally {
        _flushing = false;
    }
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

/**
 * Registers the `online` listener and attempts an initial flush. Idempotent: a
 * second call replaces the stored deps without stacking listeners.
 */
export function initSyncReplay(deps: SyncReplayDeps): void {
    _deps = deps;
    if (typeof window === "undefined") return;
    if (!_onlineListener) {
        _onlineListener = () => {
            void flushNow();
        };
        window.addEventListener("online", _onlineListener);
    }
    // Opportunistic flush at init when already online (e.g. queue left from a prior session).
    if (typeof navigator === "undefined" || navigator.onLine) {
        void flushNow();
    }
}

/** Removes the `online` listener and resets module state. */
export function destroySyncReplay(): void {
    if (_onlineListener && typeof window !== "undefined") {
        window.removeEventListener("online", _onlineListener);
    }
    _onlineListener = null;
    _deps = null;
    _flushing = false;
}
