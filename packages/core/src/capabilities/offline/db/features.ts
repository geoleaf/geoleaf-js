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
import type { FeatureRecord, VersionMarker } from "../../../contracts/sync.contract.js";

/** What one bulk pull actually did to the store. */
export interface PreservingPutTally {
    /** Records inserted, or rewritten because the source changed them. */
    readonly written: number;
    /** Records left untouched because they hold unsynchronised local work. */
    readonly preserved: number;
    /** Records left untouched because the source serves them under the marker already stored. */
    readonly unchanged: number;
    /** Synchronised records removed because the source served them as tombstones. */
    readonly removed: number;
    /**
     * The key of every record this batch named, once its identity was resolved — written,
     * unchanged or preserved alike. What a complete pull never named is what `sweepSynced`
     * may remove.
     */
    readonly seen: readonly string[];
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
     * A record is skipped when it already exists with `syncState !== "synced"` (`preserved`),
     * or when it is `synced` and the source serves it under the very marker already stored
     * (`unchanged`). Everything else is inserted or rewritten.
     *
     * `tombstones` are entities the source served as DELETED: never written, their stored copy
     * is removed when it is `synced` (`removed`) and kept when it holds local work
     * (`preserved`) — in the same transaction, under the same identity resolution.
     */
    putManyPreservingLocal(
        records: readonly FeatureRecord[],
        tombstones?: readonly FeatureRecord[]
    ): Promise<PreservingPutTally>;
    /**
     * Removes, in ONE transaction, every record of `layerId` that `keep` does not name, is
     * `synced`, and carries a server identity — what a complete pull did not return.
     *
     * 🛑 **Local work is never removed, and neither is what has no server identity.** A record
     * holding an unsynchronised capture is not `synced`; an entity created here has no row to
     * be absent from. The state is read in the same transaction as the removal, for the reason
     * `putManyPreservingLocal` gives: an optimistic write must not slip between the two.
     *
     * @returns How many records were removed.
     */
    sweepSynced(layerId: string, keep: ReadonlySet<string>): Promise<number>;
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

        putManyPreservingLocal: (records, tombstones) => putPreserving(db, records, tombstones),

        sweepSynced: (layerId, keep) => sweepSynced(db, layerId, keep),
    };
}

/**
 * True when two freshness markers name the same version — same kind, same value, neither absent.
 *
 * ⚠️ **An absent marker never equals anything, itself included.** A row served without its
 * marker says nothing about whether it changed; comparing `null` to `null` as equal would
 * freeze such a row at its first pull forever.
 *
 * @param stored - The marker the record holds.
 * @param served - The marker the source just served.
 * @returns Whether the source serves the version already stored.
 */
function sameVersion(
    stored: VersionMarker | null | undefined,
    served: VersionMarker | null | undefined
): boolean {
    return !!stored && !!served && stored.kind === served.kind && stored.value === served.value;
}

/**
 * Writes a batch while preserving local captures — the contract's rule, in ONE
 * transaction. A record served under the marker already stored is not rewritten, and a
 * tombstone removes its synchronised copy.
 *
 * Outside `init` to stay under the function-length ceiling, and because it captures
 * nothing from the closure beyond the connection: it receives it as a parameter.
 *
 * @param db - Open IndexedDB connection.
 * @param records - The pulled batch, in the order the source returned it.
 * @param tombstones - What the same page served as deleted. Never written: the synchronised
 *   copy is removed, a copy holding local work is kept.
 * @returns The real tally — never estimated from the batch size.
 */
function putPreserving(
    db: IDBDatabase,
    records: readonly FeatureRecord[],
    tombstones: readonly FeatureRecord[] = []
): Promise<PreservingPutTally> {
    // One walk over both lists: what to write, then what the source served as deleted.
    const items = [
        ...records.map((record) => ({ record, tombstone: false })),
        ...tombstones.map((record) => ({ record, tombstone: true })),
    ];
    if (items.length === 0) {
        return Promise.resolve({ written: 0, preserved: 0, unchanged: 0, removed: 0, seen: [] });
    }

    return new Promise<PreservingPutTally>((resolve, reject) => {
        const tx = db.transaction([STORE], "readwrite");
        const store = tx.objectStore(STORE);
        const byServerId = store.index("serverId");
        let written = 0;
        let preserved = 0;
        let unchanged = 0;
        let removed = 0;
        let index = 0;
        const seen: string[] = [];

        tx.oncomplete = () => resolve({ written, preserved, unchanged, removed, seen });
        tx.onerror = () => reject(new Error(`[DB.Features] bulk write failed: ${tx.error}`));
        tx.onabort = () => reject(new Error(`[DB.Features] bulk write aborted: ${tx.error}`));

        // A tombstone is never written: its synchronised copy goes, local work stays.
        const bury = (current: FeatureRecord | undefined, key: [string, string]): void => {
            if (!current) {
                step();
                return;
            }
            if (current.syncState !== "synced") {
                preserved += 1;
                step();
                return;
            }
            store.delete(key).onsuccess = () => {
                removed += 1;
                step();
            };
        };

        // Decide, then write, under the localId settled by `resolveIdentity`.
        const applyTo = (item: (typeof items)[number], localId: string): void => {
            const { record } = item;
            const existing = store.get([record.layerId, localId]);
            existing.onsuccess = () => {
                const current = existing.result as FeatureRecord | undefined;
                if (item.tombstone) {
                    bury(current, [record.layerId, localId]);
                    return;
                }
                seen.push(localId);
                if (current && current.syncState !== "synced") {
                    preserved += 1;
                    step();
                    return;
                }
                // 🛑 THE MARKER IS READ BACK, and it is what makes a second pull cheap. It was
                // stored from the first pull on — for the conflict filter — and never compared
                // here: every `synced` record was rewritten on every pull. A record the source
                // serves under the marker already stored is left as it is.
                if (
                    current?.feature !== undefined &&
                    sameVersion(current.version, record.version)
                ) {
                    unchanged += 1;
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
        const resolveIdentity = (item: (typeof items)[number]): void => {
            const { record } = item;
            if (record.serverId === null) {
                applyTo(item, record.localId);
                return;
            }
            const twins = byServerId.getAll(record.serverId);
            twins.onsuccess = () => {
                const rows = (twins.result as FeatureRecord[] | undefined) ?? [];
                const twin = rows.find(
                    (r) => r.layerId === record.layerId && r.localId !== record.localId
                );
                applyTo(item, twin ? twin.localId : record.localId);
            };
        };

        // Sequential on purpose: each request is issued from the previous request's
        // callback, which is what keeps the transaction alive across the whole batch.
        // Any request error goes unhandled and aborts it — a half-written store is the
        // one outcome that cannot be detected afterwards.
        const step = (): void => {
            const next = items[index++];
            if (!next) return;
            resolveIdentity(next);
        };

        step();
    });
}

/**
 * Removes what a complete pull did not return — the store-side half of the convergence.
 *
 * Outside `init` for the reason `putPreserving` is. The keys are listed first (keys only, no
 * record read), then each candidate the pull did not name is read and removed only if it is
 * still `synced` and carries a server identity — all in one transaction, each request issued
 * from the previous one's callback so the transaction stays alive.
 *
 * @param db - Open IndexedDB connection.
 * @param layerId - The layer the pull covered.
 * @param keep - The keys the pull named (`PreservingPutTally.seen`, over every page).
 * @returns How many records were removed.
 */
function sweepSynced(db: IDBDatabase, layerId: string, keep: ReadonlySet<string>): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const tx = db.transaction([STORE], "readwrite");
        const store = tx.objectStore(STORE);
        let removed = 0;

        tx.oncomplete = () => resolve(removed);
        tx.onerror = () => reject(new Error(`[DB.Features] sweep failed: ${tx.error}`));
        tx.onabort = () => reject(new Error(`[DB.Features] sweep aborted: ${tx.error}`));

        const keys = store.getAllKeys(layerRange(layerId));
        keys.onsuccess = () => {
            const candidates = ((keys.result as IDBValidKey[] | undefined) ?? []).filter(
                (key) => !keep.has(String((key as [string, string])[1]))
            );
            let index = 0;
            const step = (): void => {
                const key = candidates[index++];
                if (key === undefined) return;
                const read = store.get(key);
                read.onsuccess = () => {
                    const record = read.result as FeatureRecord | undefined;
                    if (record && record.syncState === "synced" && record.serverId !== null) {
                        store.delete(key).onsuccess = () => {
                            removed += 1;
                            step();
                        };
                        return;
                    }
                    step();
                };
            };
            step();
        };
    });
}

Log.debug("[DB.Features] Module loaded");

/** Registry entry consumed by `db-modules-registry.ts`. */
export const DBFeatures = { init };
