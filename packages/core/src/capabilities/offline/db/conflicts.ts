/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Conflicts Module — what a settled conflict LEAVES BEHIND, one record per entity (v6).
 *
 * Implements {@link ConflictRecord} of `contracts/sync.contract.ts`.
 *
 * 🛑 WHY THE STORE EXISTS. `lastWriteWins` became OBSERVABLE on 17/09/2026 — the drain
 * detects the conflict, logs it, then settles it with an unfiltered re-send. What no part of
 * the cycle did was LOOK at the row it was about to crush. After an overwritten update the
 * server still holds a row; after an overwritten DELETE it holds nothing, and neither did
 * anything else: that is the only irrecoverable loss of the whole write cycle.
 *
 * 🛑 THE KEY IS THE BOUND, and it is derived rather than invented. `db/eviction.ts` names a
 * single store (`layers`), so this one is UNREACHABLE by eviction exactly as `features` is —
 * nothing will ever purge it. Keying by entity caps the store at one row per entity, so its
 * size is bounded by the layer it describes. A journal would have needed a ceiling, and a
 * ceiling here would be a number posted in the noise band. The cost is stated rather than
 * hidden: an entity that conflicts twice keeps only the most recently crushed version.
 *
 * ⚠️ NO INDEX, AND NOT EVEN A ZONE ONE (decision of 17/09/2026): per-layer traversal comes
 * from the composed key, exactly as in `db/features.ts` — an array sorts after any string, so
 * `[layerId, []]` is an upper bound past every `[layerId, <string>]`. A companion index would
 * be a second truth for the same question.
 *
 * ⚠️ NOTHING HERE WRITES INTO `features`. The server's row is evidence, never a source:
 * writing it back would overwrite what the operator captured — the sixth defect closed on
 * 17/09/2026, reappearing in a new place.
 */

import { Log } from "../../../utils/log/index.js";
import type { ConflictRecord } from "../../../contracts/sync.contract.js";

/** Public API of the conflicts store. */
export interface ConflictsDBInstance {
    /** Writes one settled conflict, replacing the entity's previous one. */
    put(record: ConflictRecord): Promise<void>;
    /** The conflict kept for one entity, or `null` when none was archived for it. */
    get(layerId: string, localId: string): Promise<ConflictRecord | null>;
    /** Every conflict of one layer, via the composed key — no secondary index needed. */
    listByLayer(layerId: string): Promise<ConflictRecord[]>;
    /** Every conflict, across every layer, in key order. */
    list(): Promise<ConflictRecord[]>;
    /** Drops one entity's conflict — a no-op when it holds none. */
    remove(layerId: string, localId: string): Promise<void>;
    /** Drops one layer's conflicts, or all of them when `layerId` is omitted. */
    clear(layerId?: string): Promise<void>;
}

const STORE = "conflicts";

/**
 * Key range covering every record of one layer.
 *
 * An array sorts AFTER any string in IndexedDB's key ordering, so `[layerId, []]` is an upper
 * bound past every `[layerId, <string>]`. This is why the composed key needs no companion
 * `layerId` index — one would be a second source of truth for the same question.
 */
function layerRange(layerId: string): IDBKeyRange {
    return IDBKeyRange.bound([layerId], [layerId, []]);
}

/**
 * Initialises the conflicts module.
 *
 * @param db - An open IndexedDB connection.
 * @returns The module's public API.
 * @throws When `db` is missing.
 * @example
 * const conflicts = DBConflicts.init(db);
 * const crushed = await conflicts.listByLayer("sites");
 */
function init(db: IDBDatabase): ConflictsDBInstance {
    if (!db) {
        throw new Error("[DB.Conflicts] Database instance is required");
    }

    const read = <T>(fn: (store: IDBObjectStore) => IDBRequest, map: (r: unknown) => T) =>
        new Promise<T>((resolve, reject) => {
            const tx = db.transaction([STORE], "readonly");
            const req = fn(tx.objectStore(STORE));
            req.onsuccess = () => resolve(map(req.result));
            req.onerror = () => reject(new Error(`[DB.Conflicts] read failed: ${req.error}`));
        });

    const write = (fn: (store: IDBObjectStore) => IDBRequest) =>
        new Promise<void>((resolve, reject) => {
            const tx = db.transaction([STORE], "readwrite");
            fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(new Error(`[DB.Conflicts] write failed: ${tx.error}`));
            tx.onabort = () => reject(new Error(`[DB.Conflicts] write aborted: ${tx.error}`));
        });

    return {
        put(record) {
            return write((store) => store.put(record));
        },

        get(layerId, localId) {
            return read(
                (store) => store.get([layerId, localId]),
                (r) => (r === undefined ? null : (r as ConflictRecord))
            );
        },

        listByLayer(layerId) {
            return read(
                (store) => store.getAll(layerRange(layerId)),
                (r) => (r as ConflictRecord[]) ?? []
            );
        },

        list() {
            return read(
                (store) => store.getAll(),
                (r) => (r as ConflictRecord[]) ?? []
            );
        },

        remove(layerId, localId) {
            return write((store) => store.delete([layerId, localId]));
        },

        clear(layerId) {
            // ⚠️ `delete(range)` and not a cursor: the range IS the layer, so the whole
            // purge is one request inside one transaction. A cursor would read every
            // record into the page to delete it.
            return write((store) =>
                layerId === undefined ? store.clear() : store.delete(layerRange(layerId))
            );
        },
    };
}

Log.debug("[DB.Conflicts] Module loaded");

/** Registry entry consumed by `db-modules-registry.ts`. */
export const DBConflicts = { init };
