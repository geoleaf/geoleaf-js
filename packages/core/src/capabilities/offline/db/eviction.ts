/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description LRU + size-budget eviction for the IndexedDB "layers" store.
 *
 * The persistent offline cache keeps vector tiles, glyphs, sprite images and
 * GeoJSON layers in the same "layers" object store. This module caps that store
 * at a configurable byte budget: when the total stored size exceeds the budget,
 * the least-recently-cached records are removed first (LRU approximated by the
 * `timestamp` written at `cacheLayer` time). Binary tile records are covered
 * exactly like any other record — they live in the same store.
 *
 * Runs OUT of the critical offline read path: it is invoked once after a profile
 * download completes (see CacheManager), never while the Service Worker serves a
 * tile. It only reads `{ id, timestamp, size }` per record (via a cursor, one
 * record materialized at a time) and deletes by primary key.
 */

import { Log } from "../../../utils/log/index.js";

/** Object store name mirrored from the IndexedDB schema. */
const STORE = "layers";

/** Minimal projection of a layer record needed to decide eviction. */
interface EvictionEntry {
    id: IDBValidKey;
    timestamp: number;
    size: number;
}

/** Summary returned by {@link evictToQuota}. */
interface EvictionResult {
    /** Number of records removed. */
    evicted: number;
    /** Bytes reclaimed (sum of removed records' stored size). */
    freedBytes: number;
    /** Total stored size before eviction. */
    totalBefore: number;
    /** Total stored size after eviction. */
    totalAfter: number;
}

const EMPTY_RESULT: EvictionResult = {
    evicted: 0,
    freedBytes: 0,
    totalBefore: 0,
    totalAfter: 0,
};

/**
 * Collects `{ id, timestamp, size }` for every record in the "layers" store.
 * Iterates the STORE itself with a cursor, so only one record is materialized at a
 * time — the whole cache is never loaded into memory at once.
 *
 * ⚠️ Deliberately NOT the `profileId` index. An IndexedDB index only holds records
 * whose indexed key is a valid key, and `null`/`undefined` are not: a record written
 * without a profile lands in the store but never in the index. Walking the index
 * therefore under-counted the budget and left those records un-evictable — silent,
 * unreclaimable growth. `themes/theme-cache.ts` writes exactly such records
 * (`cacheLayer(id, data, profileId || null, …)`), so this was a live leak, not a
 * theoretical one. Walking the store is also cheaper: no index lookup.
 *
 * @param db - The open IndexedDB database.
 * @returns One entry per stored record, profile-less ones included.
 */
function _collectEntries(db: IDBDatabase): Promise<EvictionEntry[]> {
    return new Promise((resolve, reject) => {
        const entries: EvictionEntry[] = [];
        let cursorReq: IDBRequest;

        try {
            const tx = db.transaction([STORE], "readonly");
            cursorReq = tx.objectStore(STORE).openCursor();
        } catch (error) {
            reject(error);
            return;
        }

        cursorReq.onsuccess = (event: Event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
            if (cursor) {
                const value = cursor.value as {
                    id: IDBValidKey;
                    timestamp?: number;
                    size?: number;
                };
                entries.push({
                    id: value.id,
                    timestamp: value.timestamp || 0,
                    size: value.size || 0,
                });
                cursor.continue();
            } else {
                resolve(entries);
            }
        };

        cursorReq.onerror = () => reject(cursorReq.error);
    });
}

/**
 * Deletes the given primary keys from the "layers" store in a single read-write
 * transaction. Resolves once the transaction completes.
 *
 * @param db - The open IndexedDB database.
 * @param keys - Primary keys to delete.
 */
function _deleteKeys(db: IDBDatabase, keys: IDBValidKey[]): Promise<void> {
    if (keys.length === 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
        let tx: IDBTransaction;
        try {
            tx = db.transaction([STORE], "readwrite");
        } catch (error) {
            reject(error);
            return;
        }

        const store = tx.objectStore(STORE);
        keys.forEach((key) => store.delete(key));

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Evicts the least-recently-cached records until the "layers" store fits within
 * `maxBytes`. No-op (returns a zeroed result) when `db` is missing, `maxBytes` is
 * not a positive finite number, or the cache already fits the budget.
 *
 * LRU is approximated by the `timestamp` set at cache time (least recent =
 * oldest), so the most recently downloaded tiles survive an over-budget pass.
 *
 * @param db - The open IndexedDB database (e.g. `IndexedDB._db`).
 * @param maxBytes - Byte budget for the persistent layer/tile cache.
 * @returns Eviction summary (counts + reclaimed/total bytes).
 *
 * @example
 * const { evicted, freedBytes } = await evictToQuota(IndexedDB._db, 250 * 1024 * 1024);
 */
export async function evictToQuota(
    db: IDBDatabase | null | undefined,
    maxBytes: number
): Promise<EvictionResult> {
    if (!db || !Number.isFinite(maxBytes) || maxBytes <= 0) {
        return { ...EMPTY_RESULT };
    }

    const entries = await _collectEntries(db);
    const totalBefore = entries.reduce((sum, entry) => sum + entry.size, 0);

    if (totalBefore <= maxBytes) {
        return { ...EMPTY_RESULT, totalBefore, totalAfter: totalBefore };
    }

    // Oldest cached first (LRU by cache timestamp).
    entries.sort((a, b) => a.timestamp - b.timestamp);

    let runningTotal = totalBefore;
    const toDelete: IDBValidKey[] = [];
    for (const entry of entries) {
        if (runningTotal <= maxBytes) break;
        toDelete.push(entry.id);
        runningTotal -= entry.size;
    }

    await _deleteKeys(db, toDelete);

    const result: EvictionResult = {
        evicted: toDelete.length,
        freedBytes: totalBefore - runningTotal,
        totalBefore,
        totalAfter: runningTotal,
    };

    Log.info(
        `[Eviction] Capped layer cache: removed ${result.evicted} record(s), ` +
            `freed ${(result.freedBytes / 1024).toFixed(1)} KB ` +
            `(${(totalBefore / 1024).toFixed(0)} → ${(runningTotal / 1024).toFixed(0)} KB, ` +
            `budget ${(maxBytes / 1024).toFixed(0)} KB)`
    );

    return result;
}
