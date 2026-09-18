/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Local Edit Module — the optimistic write, and the `outbox`'s only writer.
 *
 * 🛑 **WHY A MODULE OF ITS OWN, AND NOT A METHOD OF `features.ts` OR `outbox.ts`.** The
 * invariant this exists to hold is **cross-store**: a capture must land in `features`
 * **and** in the `outbox`, or in neither. Written inside one of the two modules, the
 * operation would open two successive transactions — and a crash between them would
 * leave either a capture nothing will push, or a push that will find no entity. Both
 * are silent losses, the very class the contract's property 1 forbids. A cross-store
 * invariant can live in no store.
 *
 * ## Coalescing — and why it is trivial here
 *
 * ⚠️ **The outbox entry does NOT carry the payload.** It references `localId`, and
 * nothing else (contract: "It references `localId` and never `serverId`"). The payload
 * is **always** the current `features` record. Direct consequence: merging two
 * successive edits requires no data merge — it suffices not to stack a second entry.
 * That shape is what makes replay idempotent.
 *
 * | Already queued    | New edit         | Result                                               |
 * | ----------------- | ---------------- | ---------------------------------------------------- |
 * | `create`          | `update`         | stays `create` — it will push the freshest state     |
 * | `update`          | `update`         | stays `update`, a single entry                       |
 * | `create`          | `delete`         | **CANCELLATION** — both disappear                    |
 * | `update`          | `delete`         | becomes `delete`                                     |
 * | none              | any              | a new entry                                          |
 *
 * 🛑 **Cancellation ALSO erases the `features` record.** An entity created offline then
 * deleted offline never existed server-side: keeping its trace would produce a
 * `DELETE` on an identity the server never saw.
 *
 * ⚠️ **`inFlight` and `quarantined` NEVER coalesce.** The first is mid-push — merging
 * it would make what goes on the wire diverge from what the queue believes it sent.
 * The second is set aside deliberately and **stays visible**: merging it would erase
 * it. `pending` and `failed` coalesce, because `failed` is not terminal (contract).
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import type {
    FeatureRecord,
    OutboxEntry,
    SyncOperationKind,
    VersionMarker,
} from "../../../contracts/sync.contract.js";

const FEATURES = "features";
const OUTBOX = "outbox";

/** States an entry can still be merged from — see the header banner. */
const COALESCIBLE = new Set(["pending", "failed"]);

/** A local edit, as the seam receives it. */
export interface LocalEditInput {
    readonly layerId: string;
    /**
     * The entity's identity: a store key, or — for an existing entity — the server identity
     * the map shows. It is resolved to the key before anything is read (`resolveEntity`).
     */
    readonly localId: string;
    readonly kind: SyncOperationKind;
    /** The entity after the edit. Ignored for a `delete`, which keeps the stored version. */
    readonly feature?: unknown;
    /** Marker the edit is based on, forwarded to the push to make the conflict detectable. */
    readonly baseVersion?: VersionMarker | null;
}

/** What the optimistic write really did. */
export interface LocalEditTally {
    /** The key the edit landed on, once resolved — which the caller may not have named. */
    readonly localId: string;
    /** Identifier of the outbox entry carrying this edit, or `null` when cancelled. */
    readonly entryId: string | null;
    /** True when a NEW entry was stacked. False when the edit merged. */
    readonly queued: boolean;
    /** Identifier of the entry that absorbed this edit, if any. */
    readonly coalescedInto: string | null;
    /** True when a pending `create` and a `delete` cancelled each other. */
    readonly annulled: boolean;
}

/** Public surface of the module. */
export interface LocalEditDBInstance {
    /** Applies an edit locally AND enqueues it, in ONE transaction. */
    applyLocalEdit(input: LocalEditInput): Promise<LocalEditTally>;
    /** Identifiers of entities carrying a pending deletion, for one layer. */
    pendingDeletions(layerId: string): Promise<Set<string>>;
}

/**
 * Monotonic id-minting counter — the part the clock cannot provide.
 *
 * 🛑 **`Date.now()` ALONE IS NOT ENOUGH, and the UNIQUE index proved it.** The first
 * draft composed `kind:layerId:localId:now`, asserting that entity plus instant were
 * "already unique together for a single-threaded writer". False: `Date.now()` has
 * millisecond resolution, and two edits of the same entity within the same
 * millisecond mint the SAME identifier. The collision made the transaction THROW —
 * the intended behaviour (a collision throws instead of silently overwriting), but on
 * a perfectly legitimate case. The defect only appeared under the full suite, fast
 * enough for two calls to land in the same millisecond.
 */
let _mintCounter = 0;

/**
 * Outbox entry identifier — monotonic by construction, never random.
 *
 * ⚠️ No `Math.random()`: the `id` index is **unique**, so a collision throws. A
 * randomly-drawn identifier would make that guard probabilistic instead of making it
 * unnecessary. The counter, by contrast, cannot collide in a single-threaded context.
 *
 * @param input - The edit in progress.
 * @param now - Timestamp of the edit.
 * @returns A unique identifier, stable and readable in logs.
 */
function mintEntryId(input: LocalEditInput, now: number): string {
    _mintCounter += 1;
    return `${input.kind}:${input.layerId}:${input.localId}:${now}-${_mintCounter}`;
}

/**
 * Puts the absorbing entry back at the start of its budget.
 *
 * 🛑 **A NEW EDIT IS A NEW INTENTION, NOT A REPLAY.** The entry that absorbs a fresh
 * edit used to keep the `attempts` its previous failures had spent: an operator who
 * corrected their capture saw it set aside one attempt later, for failures that PREDATE
 * the correction — and that the correction may well have fixed. The deferral goes with
 * it, for the same reason: the delay belonged to the failure, not to the entry.
 *
 * ⚠️ **The SAME `seq` is rewritten** (the object comes from the index, key included), so
 * the replay order does not move because a state changed — the invariant `updateState`
 * holds. And `inFlight` never coalesces (`COALESCIBLE`), so this can never re-arm an
 * entry that is on the wire.
 *
 * @param outbox - The queue store, inside the caller's transaction.
 * @param absorber - The mergeable entry the edit lands on.
 */
function _rearmAbsorber(outbox: IDBObjectStore, absorber: OutboxEntry & { seq: number }): void {
    const spent = absorber.state !== "pending" || (absorber.attempts ?? 0) > 0;
    if (!spent && !absorber.nextAttemptAt) return;
    outbox.put({ ...absorber, state: "pending", attempts: 0, nextAttemptAt: 0 });
}

/** Key prefix the pull gives a record known only by its server identity (`pull/layer-pull.ts`). */
const SERVER_KEY_PREFIX = "srv:";

/** Key prefix of a client identity (`write/local-edit-api.ts`). */
const CLIENT_KEY_PREFIX = "loc:";

/**
 * Resolves the identity an edit names to the key the store holds the entity under.
 *
 * 🛑 **THE EDITOR NEVER KNEW THE STORE'S KEYS.** It names an existing entity by the id the
 * map shows — `properties.id`, the SERVER identity — while the pull keys a record under
 * `properties.local_id` or `srv:<id>`. An update addressed to `42` found nothing, a second
 * record was written with `serverId: null`, and the push went out as `?id=eq.null`. With
 * the offline engine present every write is queued, so this missed the row for EVERY
 * modification and deletion of an existing entity, pulled or not.
 *
 * Three answers, in order:
 *  1. a record under that very key — the identity already was a store key;
 *  2. a record of the SAME layer whose `serverId` is that identity — a pulled entity;
 *  3. nothing: the key is kept as it is for a client identity; any other identity is a
 *     server one this device never pulled, and the record goes under `srv:<id>`, the key
 *     the pull would give it.
 *
 * ⚠️ A `create` is never resolved: its identity is minted or given, not looked up.
 *
 * @param features - The entity store, inside the caller's transaction.
 * @param input - The edit in progress.
 * @param done - Receives the resolved key and the record already held under it.
 */
function resolveEntity(
    features: IDBObjectStore,
    input: LocalEditInput,
    done: (localId: string, current: FeatureRecord | undefined) => void
): void {
    const direct = features.get([input.layerId, input.localId]);
    direct.onsuccess = () => {
        const found = direct.result as FeatureRecord | undefined;
        if (found || input.kind === "create") {
            done(input.localId, found);
            return;
        }
        const twins = features.index("serverId").getAll(input.localId);
        twins.onsuccess = () => {
            const records = (twins.result as FeatureRecord[] | undefined) ?? [];
            const pulled = records.find((record) => record.layerId === input.layerId);
            if (pulled) done(pulled.localId, pulled);
            else if (isKeyed(input.localId)) done(input.localId, undefined);
            else done(`${SERVER_KEY_PREFIX}${input.localId}`, undefined);
        };
    };
}

/** True when an identity already carries one of the store's key prefixes. */
function isKeyed(localId: string): boolean {
    return localId.startsWith(CLIENT_KEY_PREFIX) || localId.startsWith(SERVER_KEY_PREFIX);
}

/**
 * The server identity a record carries after an edit.
 *
 * ⚠️ **Derived from the KEY only when nothing else can name the row.** A record already
 * identified keeps its identity; an entity whose `create` is still in the queue has no row
 * yet, whatever its key says; a client key never names a row. Past those, the key IS the
 * server identity: `srv:<id>`, or a bare id written by a queue that predates the resolution
 * above — such a record carried `serverId: null` and could never reach its row.
 *
 * @param localId - The resolved key.
 * @param current - The record already held under it.
 * @param createQueued - Whether a `create` for this entity is in the queue, in any state.
 * @returns The server identity, or `null` when there is none yet.
 */
function serverIdentity(
    localId: string,
    current: FeatureRecord | undefined,
    createQueued: boolean
): string | null {
    if (current?.serverId != null) return current.serverId;
    if (createQueued || localId.startsWith(CLIENT_KEY_PREFIX)) return null;
    return localId.startsWith(SERVER_KEY_PREFIX)
        ? localId.slice(SERVER_KEY_PREFIX.length)
        : localId;
}

/** The two stores an edit lands in, inside one transaction. */
interface EditStores {
    readonly features: IDBObjectStore;
    readonly outbox: IDBObjectStore;
}

/**
 * Writes the entity and its queue entry — the body of one optimistic write.
 *
 * Split from `applyLocalEdit` for the function-length ceiling, and the cut is where the
 * identity stops being a question: everything here works on the key `resolveEntity` settled
 * and on the entries already queued for it.
 *
 * @param stores - The two stores, inside the caller's transaction.
 * @param input - The edit, carrying the resolved key.
 * @param current - The record already held under that key, if any.
 * @param entries - Everything the queue holds for this entity, whatever its state.
 * @param now - One timestamp for the whole write.
 * @returns What the write really did.
 */
function landEdit(
    stores: EditStores,
    input: LocalEditInput,
    current: FeatureRecord | undefined,
    entries: readonly (OutboxEntry & { seq: number })[],
    now: number
): LocalEditTally {
    const { features, outbox } = stores;
    const tally: LocalEditTally = {
        localId: input.localId,
        entryId: null,
        queued: false,
        coalescedInto: null,
        annulled: false,
    };
    const mergeable = entries.filter((e) => COALESCIBLE.has(e.state));
    const pendingCreate = mergeable.find((e) => e.kind === "create");

    // CANCELLATION — created then deleted offline: the server never saw it.
    if (input.kind === "delete" && pendingCreate) {
        for (const entry of mergeable) outbox.delete(entry.seq);
        features.delete([input.layerId, input.localId]);
        return { ...tally, annulled: true };
    }

    // The entity record. A `delete` KEEPS its own: it is the only place the `serverId`
    // lives, and the push needs it to know WHAT to delete — the outbox entry carries only
    // the `localId`.
    const record: FeatureRecord = {
        layerId: input.layerId,
        localId: input.localId,
        serverId: serverIdentity(
            input.localId,
            current,
            entries.some((e) => e.kind === "create")
        ),
        syncState: "pending",
        updatedAt: now,
        version: input.baseVersion !== undefined ? input.baseVersion : (current?.version ?? null),
        // 🛑 A PARTIAL EDIT DOES NOT DESTROY WHAT IT DOES NOT BRING. An attribute
        // modification does not necessarily resend the geometry — measured:
        // `updateExistingPoi` logs "missing geometry" and enqueues anyway. Overwriting with
        // `undefined` would make the position of an entity the user only wanted to rename
        // disappear. The rule already held for deletions; it holds for every edit.
        feature: input.feature ?? current?.feature,
    };
    features.put(record);

    // A mergeable entry makes stacking unnecessary — the payload being the record, it is
    // already up to date.
    const absorber =
        input.kind === "delete" ? mergeable.find((e) => e.kind === "delete") : mergeable[0];
    if (absorber) {
        _rearmAbsorber(outbox, absorber);
        return { ...tally, entryId: absorber.id, coalescedInto: absorber.id };
    }

    // A `delete` following a pending `update` REPLACES that update: pushing a modification
    // then a deletion is work for nothing, and the modification can fail on an entity about
    // to vanish.
    if (input.kind === "delete") {
        for (const entry of mergeable) outbox.delete(entry.seq);
    }

    const entry: OutboxEntry = {
        id: mintEntryId(input, now),
        kind: input.kind,
        layerId: input.layerId,
        localId: input.localId,
        baseVersion: record.version,
        state: "pending",
        attempts: 0,
        createdAt: now,
    };
    outbox.add(entry);
    return { ...tally, entryId: entry.id, queued: true };
}

/**
 * Initialises the optimistic-write module.
 *
 * @param db - An open IndexedDB connection.
 * @returns The module's public surface.
 * @throws When `db` is absent.
 * @example
 * const edits = DBLocalEdit.init(db);
 * await edits.applyLocalEdit({ layerId: "sites", localId: "l1", kind: "update", feature });
 */
function init(db: IDBDatabase): LocalEditDBInstance {
    if (!db) {
        throw new Error("[DB.LocalEdit] Database instance is required");
    }

    return {
        applyLocalEdit(request) {
            return new Promise<LocalEditTally>((resolve, reject) => {
                const now = Date.now();
                const tx = db.transaction([FEATURES, OUTBOX], "readwrite");
                const features = tx.objectStore(FEATURES);
                const outbox = tx.objectStore(OUTBOX);

                let tally: LocalEditTally = {
                    localId: request.localId,
                    entryId: null,
                    queued: false,
                    coalescedInto: null,
                    annulled: false,
                };

                tx.oncomplete = () => resolve(tally);
                tx.onerror = () => reject(new Error(`[DB.LocalEdit] failed: ${tx.error}`));
                tx.onabort = () => reject(new Error(`[DB.LocalEdit] aborted: ${tx.error}`));

                // The key the entity is held under — settled BEFORE anything is read by key.
                resolveEntity(features, request, (localId, current) => {
                    const input: LocalEditInput = { ...request, localId };
                    // What is already queued for THIS entity — the composite index laid down
                    // for exactly this, and the reason coalescing could not live on
                    // `sync_queue` (there it would have required inferring identity from
                    // vocabulary).
                    const queued = outbox.index("localId").getAll([input.layerId, localId]);
                    queued.onsuccess = () => {
                        const entries = (queued.result as (OutboxEntry & { seq: number })[]) ?? [];
                        tally = landEdit({ features, outbox }, input, current, entries, now);
                    };
                });
            });
        },

        pendingDeletions(layerId) {
            return new Promise<Set<string>>((resolve, reject) => {
                const tx = db.transaction([OUTBOX], "readonly");
                const req = tx.objectStore(OUTBOX).getAll();
                req.onerror = () => reject(new Error(`[DB.LocalEdit] read failed: ${req.error}`));
                req.onsuccess = () => {
                    const entries = (req.result as OutboxEntry[]) ?? [];
                    resolve(
                        new Set(
                            entries
                                .filter(
                                    (e) =>
                                        e.layerId === layerId &&
                                        e.kind === "delete" &&
                                        e.state !== "quarantined"
                                )
                                .map((e) => e.localId)
                        )
                    );
                };
            });
        },
    };
}

Log.debug("[DB.LocalEdit] Module loaded");

/** Registry entry consumed by `db-modules-registry.ts`. */
export const DBLocalEdit = { init };
