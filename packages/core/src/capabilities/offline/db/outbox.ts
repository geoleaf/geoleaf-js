/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Outbox Module — the write queue, with B-03 FIXED IN THE KEY.
 *
 * Implements {@link OutboxEntry} of `contracts/sync.contract.ts` (task 3.4). It **replaced**
 * `sync_queue`, which is gone: task 4.4b rewired both producers, and **4.11** removed the store
 * and its 691 LOC (B-124).
 *
 * ⚠️ This sentence read « which stays live until Sprint 4 rewires its producers (4.4/4.5) and
 * 4.9 retires it » until 08/08/2026 — a future tense over a finished fact, and it named the
 * wrong task twice: 4.9 was itself closed **by** 4.11. The prose below is kept in the past
 * tense on purpose; `sync_queue` is described here only because the key design below cannot be
 * justified without it.
 *
 * 🛑 WHY THE KEY IS `seq` AND NOT `id` — this is the whole point of doing it now.
 *
 * `sync_queue` mints `sync_<ms>_<random>` as its PRIMARY key. `getAll()` returns primary-key
 * order, so at equal millisecond it is `Math.random()` that decides the replay order. The
 * sort that was supposed to fix it — `results.sort((a,b) => a.timestamp - b.timestamp)` — is
 * STABLE since ES2019, so it faithfully TRANSPORTS that random order instead of correcting
 * it. Three writes in the same millisecond come back reversed; reproduced in
 * `e2e/fixtures/offline/db-v3-dump.json`, which asserts `[3,2,1]` for a `[1,2,3]` capture.
 *
 * `autoIncrement` puts the generator INSIDE the database. Its monotonicity is that of
 * transaction commit order — the only clock two tabs share. A JS counter does not have it; a
 * timestamp does not have it at millisecond resolution; a random suffix never had it.
 *
 * ⚠️ THE CONSEQUENCE IS THAT THERE IS NO SORT HERE. Not a better sort — none. `getAll()`
 * already returns insertion order, and `index("state").getAll(s)` returns insertion order
 * within a state. A sort would be a second ordering authority, i.e. the defect's own shape.
 *
 * ⚠️ AND A SECOND DEFECT DIES WITH IT. On `keyPath: "id"`, two entries sharing an id
 * OVERWROTE each other silently — a capture vanished. Here `id` is a UNIQUE index, so the
 * collision THROWS. A loud failure instead of a disappearance.
 *
 * ⚠️ `seq` is deliberately NOT in `OutboxEntry`: the contract describes the ENTRY, not the
 * key. It is a storage detail, and putting it in a public surface for the sake of persistence
 * would widen that surface for nothing.
 *
 * @version 3.0.0
 */

import { Log } from "../../../utils/log/index.js";
import type { OutboxEntry, QuarantineReason } from "../../../contracts/sync.contract.js";

/**
 * An {@link OutboxEntry} as stored, i.e. carrying the key the database minted.
 *
 * ⚠️ NON exporté délibérément : `seq` est un détail de persistance, et le seul consommateur
 * est `OutboxDBInstance` ci-dessous. L'exporter en ferait un orphelin de `check-orphan-exports`
 * — dont la baseline ne peut que RÉTRÉCIR — pour élargir une surface publique sans lecteur.
 */
interface StoredOutboxEntry extends OutboxEntry {
    /** Monotonic, database-minted. The replay order, and nothing else. */
    readonly seq: number;
}

/** Public API of the outbox store. */
export interface OutboxDBInstance {
    /** Appends an entry. `seq` is minted here; any `seq` on the argument is ignored. */
    append(entry: OutboxEntry): Promise<number>;
    /** Every entry, in INSERTION order. */
    list(): Promise<StoredOutboxEntry[]>;
    /** Entries in one state, in insertion order within that state. */
    listByState(state: string): Promise<StoredOutboxEntry[]>;
    /** Looks an entry up by its contract id (unique index). */
    getById(id: string): Promise<StoredOutboxEntry | null>;
    /** Entries touching one entity — coalescence (3.10) and join to `features`. */
    listByEntity(layerId: string, localId: string): Promise<StoredOutboxEntry[]>;
    /**
     * Change l'état d'une entrée, et — si `patch` est fourni — son compteur d'essais et son
     * motif de quarantaine, dans la MÊME transaction.
     *
     * ⚠️ **`patch` existe parce qu'un état de quarantaine sans motif ne dit rien** (B-125) :
     * le contrat déclare `quarantine?: QuarantineReason` sur l'entrée, et jusqu'ici aucun
     * chemin ne pouvait l'écrire. Écrire l'état d'abord puis le motif ensuite aurait ouvert
     * une fenêtre où l'entrée est mise de côté sans qu'on sache pourquoi.
     */
    updateState(
        id: string,
        state: string,
        patch?: {
            attempts?: number;
            quarantine?: QuarantineReason | null;
            /** B-200 — statut HTTP du refus. `null` l'efface au rejeu. */
            quarantineStatus?: number | null;
        }
    ): Promise<void>;
    remove(id: string): Promise<void>;
    count(): Promise<number>;
}

const STORE = "outbox";

/**
 * Initialises the outbox module.
 * @param db - An open IndexedDB connection.
 * @returns The module's public API.
 * @throws When `db` is missing.
 * @example
 * const outbox = DBOutbox.init(db);
 * await outbox.append({ id: "op-1", kind: "create", layerId: "poi", localId: "l1",
 *                       baseVersion: null, state: "pending", attempts: 0, createdAt: Date.now() });
 */
function init(db: IDBDatabase): OutboxDBInstance {
    if (!db) {
        throw new Error("[DB.Outbox] Database instance is required");
    }

    const read = <T>(fn: (store: IDBObjectStore) => IDBRequest, map: (r: unknown) => T) =>
        new Promise<T>((resolve, reject) => {
            const tx = db.transaction([STORE], "readonly");
            const req = fn(tx.objectStore(STORE));
            req.onsuccess = () => resolve(map(req.result));
            req.onerror = () => reject(new Error(`[DB.Outbox] read failed: ${req.error}`));
        });

    const byId = (store: IDBObjectStore, id: string) => store.index("id").get(id);

    return {
        append(entry) {
            return new Promise<number>((resolve, reject) => {
                const tx = db.transaction([STORE], "readwrite");
                // `seq` is stripped if a caller supplied one: the store is the sole minter,
                // exactly as `SyncDB` is the sole minter of a `sync_queue` id.
                const { ...rest } = entry as OutboxEntry & { seq?: number };
                delete (rest as { seq?: number }).seq;
                const req = tx.objectStore(STORE).add(rest);
                req.onsuccess = () => resolve(req.result as number);
                req.onerror = () =>
                    reject(new Error(`[DB.Outbox] append failed: ${req.error?.name}`));
            });
        },

        list() {
            return read(
                (store) => store.getAll(),
                (r) => (r as StoredOutboxEntry[]) ?? []
            );
        },

        listByState(state) {
            return read(
                (store) => store.index("state").getAll(state),
                (r) => (r as StoredOutboxEntry[]) ?? []
            );
        },

        getById(id) {
            return read(
                (store) => byId(store, id),
                (r) => (r === undefined ? null : (r as StoredOutboxEntry))
            );
        },

        listByEntity(layerId, localId) {
            return read(
                (store) => store.index("localId").getAll([layerId, localId]),
                (r) => (r as StoredOutboxEntry[]) ?? []
            );
        },

        updateState(id, state, patch) {
            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction([STORE], "readwrite");
                const store = tx.objectStore(STORE);
                const req = byId(store, id);
                req.onsuccess = () => {
                    const found = req.result as StoredOutboxEntry | undefined;
                    if (!found) {
                        reject(new Error(`[DB.Outbox] no entry with id "${id}"`));
                        return;
                    }
                    // `put` on the SAME `seq` — the replay order never moves because a state
                    // changed. A `failed` that is requeued keeps its place in the queue.
                    store.put({ ...found, state, ...(patch ?? {}) });
                };
                req.onerror = () => reject(new Error(`[DB.Outbox] lookup failed: ${req.error}`));
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(new Error(`[DB.Outbox] updateState failed: ${tx.error}`));
            });
        },

        remove(id) {
            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction([STORE], "readwrite");
                const store = tx.objectStore(STORE);
                const req = byId(store, id);
                req.onsuccess = () => {
                    const found = req.result as StoredOutboxEntry | undefined;
                    if (found) store.delete(found.seq);
                };
                req.onerror = () => reject(new Error(`[DB.Outbox] lookup failed: ${req.error}`));
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(new Error(`[DB.Outbox] remove failed: ${tx.error}`));
            });
        },

        count() {
            return read(
                (store) => store.count(),
                (r) => (r as number) ?? 0
            );
        },
    };
}

Log.debug("[DB.Outbox] Module loaded");

/** Registry entry consumed by `db-modules-registry.ts`. */
export const DBOutbox = { init };
