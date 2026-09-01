/*!
 * @geoleaf-plugins/editor — Storage façade seam
 * © 2026 Mattieu Pottier — MIT License
 *
 * Single reader of `globalThis.GeoLeaf.Storage` for the persistence layer.
 *
 * ⚠️ The late binding is deliberate, not an accident to be tidied away. The
 * editor must build and run without `@geoleaf-plugins/offline-ui` installed: a
 * static import would make an optional plugin a hard dependency and pull it into
 * the bundle. So the façade is resolved at CALL time and every consumer copes
 * with `null`. PLUGINS S4 merged the two identical readers that had grown in
 * `storage-queue-adapter` and `editor-sync-replay`; it did NOT dissolve the seam.
 * https://geoleaf.dev
 */

/**
 * Access to the database sub-modules — the `outbox` is read by the pending modal.
 *
 * 🛑 **`StorageQueueDb` WAS REMOVED HERE, and its death dated back a while.** It
 * declared the v3 queue's four `sync_queue` methods — `addToSyncQueue`,
 * `getPendingSyncQueue`, `updateSyncQueueStatus`, `removeSyncQueueEntry` — plus
 * a comment explaining why the queue carried TWO payload slots (`poiData` for
 * `addpoi`, `payload` for the editor). That sharing vanished when the editor
 * moved to `applyEdit`: the four declarations had **no caller left**, and
 * `storageDb()`'s only consumer reads only `_ensureModule`.
 *
 * ⚠️ **Two apparent "callers" remained — they were PROSE, not code** (the
 * header of `storage-queue-adapter.ts` and a comment in
 * `editor-sync-replay.ts`). A grep that does not distinguish the two counts a
 * dead surface as live; that is what made these four lines survive a sprint
 * closure.
 */
export interface OutboxAccess {
    _ensureModule?: (name: string) => { list?: () => Promise<OutboxRow[]> } | null;
    /**
     * The never-pushed captures, all non-`synced` states together (`pending`,
     * `inFlight`, `failed`, `quarantined`).
     *
     * ⚠️ **It is the source `addpoi` used for `getSyncSummary`, and the
     * editor's handler must read THE SAME.** It is not interchangeable with a
     * filtered `_ensureModule("Outbox").list()`: the core **discards** any
     * entry without `layerId` or `localId` there, and it joins the `features`
     * store. Counting from another side would make `offline-ui`'s sync button
     * diverge from one total to the other with no gate seeing it.
     */
    listPendingEdits?: () => Promise<PendingEdit[]>;
}

/** A pending capture, as `listPendingEdits` returns it. */
export interface PendingEdit {
    entryId: string;
    kind: string;
    layerId: string;
    localId: string;
    state: string;
    createdAt: number;
    feature: unknown;
}

/** An `outbox` entry, reduced to what the pending modal reads from it. */
export interface OutboxRow {
    id: string;
    kind: string;
    layerId: string;
    localId: string;
    state?: string;
    createdAt?: number;
}

/** The core's write cycle, the queue's only writer. */
export interface StorageWriteFacade {
    /**
     * Does the layer grant this operation?
     *
     * 🛑 **SYNCHRONOUS, and available WITHOUT the offline engine.** The
     * permission is read from the profile, not IndexedDB, and `GeoLeaf.Storage`
     * self-mounts at boot (`globals.storage.ts`): the predicate therefore
     * answers even in `persistence.mode: "online"`, where this plugin runs
     * without `offline-ui`. That was the condition for the guard to cover the
     * CONNECTED path, the only one carrying the hole.
     *
     * ⚠️ Optional in this interface because **everything** is here: this plugin
     * redeclares the global surface it expects (INV-NS forbids it to import the
     * core's sources). This member's absence is therefore not a permission —
     * see `permission-gate.ts`, which REFUSES when it cannot query.
     */
    mayEdit?(layerId: string, kind: "create" | "update" | "delete"): boolean;
    applyEdit?(input: {
        layerId: string;
        kind: "create" | "update" | "delete";
        localId?: string;
        feature?: unknown;
    }): Promise<{ entryId: string | null; refused: string | null }>;
    pushOutbox?(): Promise<{
        attempted: number;
        pushed: number;
        failed: number;
        conflicts: number;
        refused: string | null;
    }>;
}

const _g = globalThis as unknown as {
    GeoLeaf?: {
        Storage?: {
            DB?: OutboxAccess;
        } & StorageWriteFacade;
        Config?: { getActiveProfile?: () => { id?: string } | null };
    };
};

/** Resolves the Storage DB façade at call time, or null when unavailable. */
export function storageDb(): OutboxAccess | null {
    return _g?.GeoLeaf?.Storage?.DB ?? null;
}

/**
 * Resolves the Storage write façade at call time, or null when unavailable.
 *
 * ⚠️ Distinct from {@link storageDb}: that one returns the DATABASE, this one
 * the write cycle. The editor used to write the queue through the database; it
 * now goes through the cycle, the only place holding entity + entry atomicity,
 * coalescing and the editability invariant.
 */
export function storageFacade(): StorageWriteFacade | null {
    return _g?.GeoLeaf?.Storage ?? null;
}
