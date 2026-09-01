/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Features Module — one record PER ENTITY, the v4 substrate of offline field work.
 *
 * Implements {@link FeatureRecord} of `contracts/sync.contract.ts`, which had been frozen on
 * 02/08/2026 with ZERO implementation. This is that implementation (task 3.4).
 *
 * 🛑 WHY A STORE OF ITS OWN, AND NOT A CORNER OF `layers`. `layers` holds one GeoJSON BLOB
 * per layer, keyed by URL, shared with tiles, glyphs and sprites — and `db/eviction.ts`
 * evicts it LRU under quota pressure. A field capture living there is, by construction,
 * evictable to make room for a re-downloadable tile.
 *
 * ⚠️ A record here is not "protected from eviction": it is UNREACHABLE by it. `eviction.ts`
 * names exactly one store (`const STORE = "layers"`), so the hard rule of the contract —
 * "anything holding unsynchronised local work is `never`" — holds without depending on any
 * field being written correctly. That is the strongest available form of the guarantee, and
 * the store-name assertion of `schema-v4.test.js` is what keeps it true.
 *
 * ⚠️ That last sentence named `features-eviction.guard.test.js` until task 4.1. **No such file
 * has ever existed** — a citation that pointed at nothing, in the paragraph explaining why the
 * guarantee is checkable. The real guard reads `eviction.ts` as `?raw` and asserts it names
 * exactly one store.
 *
 * @version 3.1.0
 */

import { Log } from "../../../utils/log/index.js";
import type { FeatureRecord } from "../../../contracts/sync.contract.js";

/** What one bulk pull actually did to the store. */
export interface PreservingPutTally {
    /** Records inserted or refreshed. */
    readonly written: number;
    /** Records left untouched because they hold unsynchronised local work. */
    readonly preserved: number;
}

/** Public API of the features store. */
export interface FeaturesDBInstance {
    put(record: FeatureRecord): Promise<void>;
    get(layerId: string, localId: string): Promise<FeatureRecord | null>;
    /** Every record of one layer, via the composed key — no secondary index needed. */
    listByLayer(layerId: string): Promise<FeatureRecord[]>;
    /** Records in a given sync state, across every layer. */
    listByState(state: string): Promise<FeatureRecord[]>;
    countByLayer(layerId: string): Promise<number>;
    remove(layerId: string, localId: string): Promise<void>;
    /**
     * Writes a pulled batch in ONE transaction, skipping every record that holds
     * unsynchronised local work.
     *
     * 🛑 The rule lives here, and not in the caller, because `get` and `put` above open
     * SEPARATE transactions: reading the state in the orchestrator and writing after it
     * would leave a window in which the optimistic write of task 4.4 lands between the two
     * — and property 1 of the sync contract ("a capture never silently disappears") would
     * hold only by timing.
     *
     * A record is skipped when it already exists with `syncState !== "synced"`. Everything
     * else is inserted or refreshed.
     */
    putManyPreservingLocal(records: readonly FeatureRecord[]): Promise<PreservingPutTally>;
}

const STORE = "features";

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
 * Initialises the features module.
 * @param db - An open IndexedDB connection.
 * @returns The module's public API.
 * @throws When `db` is missing.
 * @example
 * const features = DBFeatures.init(db);
 * await features.put({ layerId: "poi", localId: "l1", serverId: null, syncState: "pending",
 *                      updatedAt: Date.now(), version: null, feature: geojson });
 */
function init(db: IDBDatabase): FeaturesDBInstance {
    if (!db) {
        throw new Error("[DB.Features] Database instance is required");
    }

    const read = <T>(fn: (store: IDBObjectStore) => IDBRequest, map: (r: unknown) => T) =>
        new Promise<T>((resolve, reject) => {
            const tx = db.transaction([STORE], "readonly");
            const req = fn(tx.objectStore(STORE));
            req.onsuccess = () => resolve(map(req.result));
            req.onerror = () => reject(new Error(`[DB.Features] read failed: ${req.error}`));
        });

    const write = (fn: (store: IDBObjectStore) => IDBRequest) =>
        new Promise<void>((resolve, reject) => {
            const tx = db.transaction([STORE], "readwrite");
            fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(new Error(`[DB.Features] write failed: ${tx.error}`));
            tx.onabort = () => reject(new Error(`[DB.Features] write aborted: ${tx.error}`));
        });

    return {
        put(record) {
            return write((store) => store.put(record));
        },

        get(layerId, localId) {
            return read(
                (store) => store.get([layerId, localId]),
                (r) => (r === undefined ? null : (r as FeatureRecord))
            );
        },

        listByLayer(layerId) {
            return read(
                (store) => store.getAll(layerRange(layerId)),
                (r) => (r as FeatureRecord[]) ?? []
            );
        },

        listByState(state) {
            return read(
                (store) => store.index("syncState").getAll(state),
                (r) => (r as FeatureRecord[]) ?? []
            );
        },

        countByLayer(layerId) {
            return read(
                (store) => store.count(layerRange(layerId)),
                (r) => (r as number) ?? 0
            );
        },

        remove(layerId, localId) {
            return write((store) => store.delete([layerId, localId]));
        },

        putManyPreservingLocal: (records) => putPreserving(db, records),
    };
}

/**
 * Writes a batch while preserving local captures — the contract's rule, in ONE
 * transaction.
 *
 * Outside `init` to stay under the function-length ceiling, and because it captures
 * nothing from the closure beyond the connection: it receives it as a parameter.
 *
 * @param db - Open IndexedDB connection.
 * @param records - The pulled batch, in the order the source returned it.
 * @returns The real tally — never estimated from the batch size.
 */
function putPreserving(
    db: IDBDatabase,
    records: readonly FeatureRecord[]
): Promise<PreservingPutTally> {
    if (records.length === 0) return Promise.resolve({ written: 0, preserved: 0 });

    return new Promise<PreservingPutTally>((resolve, reject) => {
        const tx = db.transaction([STORE], "readwrite");
        const store = tx.objectStore(STORE);
        const byServerId = store.index("serverId");
        let written = 0;
        let preserved = 0;
        let index = 0;

        tx.oncomplete = () => resolve({ written, preserved });
        tx.onerror = () => reject(new Error(`[DB.Features] bulk write failed: ${tx.error}`));
        tx.onabort = () => reject(new Error(`[DB.Features] bulk write aborted: ${tx.error}`));

        // Decide, then write, under the localId settled by `resolveIdentity`.
        const applyTo = (record: FeatureRecord, localId: string): void => {
            const existing = store.get([record.layerId, localId]);
            existing.onsuccess = () => {
                const current = existing.result as FeatureRecord | undefined;
                if (current && current.syncState !== "synced") {
                    preserved += 1;
                    step();
                    return;
                }
                const put = store.put(localId === record.localId ? record : { ...record, localId });
                put.onsuccess = () => {
                    written += 1;
                    step();
                };
            };
        };

        // A pulled entity may already live here under ANOTHER localId: the seeded rows
        // carry `local_id: null` and are stored under a serverId-derived key, but once
        // 4.5 has pushed a client identity the server echoes it back. Keying on the
        // fresh derivation would then insert a SECOND record for the same entity. The
        // established localId wins — it is the one the outbox references.
        const resolveIdentity = (record: FeatureRecord): void => {
            if (record.serverId === null) {
                applyTo(record, record.localId);
                return;
            }
            const twins = byServerId.getAll(record.serverId);
            twins.onsuccess = () => {
                const rows = (twins.result as FeatureRecord[] | undefined) ?? [];
                const twin = rows.find(
                    (r) => r.layerId === record.layerId && r.localId !== record.localId
                );
                applyTo(record, twin ? twin.localId : record.localId);
            };
        };

        // Sequential on purpose: each request is issued from the previous request's
        // callback, which is what keeps the transaction alive across the whole batch.
        // Any request error goes unhandled and aborts it — a half-written store is the
        // one outcome that cannot be detected afterwards.
        const step = (): void => {
            const next = records[index++];
            if (!next) return;
            resolveIdentity(next);
        };

        step();
    });
}

Log.debug("[DB.Features] Module loaded");

/** Registry entry consumed by `db-modules-registry.ts`. */
export const DBFeatures = { init };
