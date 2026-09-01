/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - IndexedDB Module
 *
 * Local persistent storage management with IndexedDB.
 * Enables layer caching, user preferences, and offline synchronization queue.
 *
 * @version 3.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { isUnsafeKey } from "../../../utils/general/object-path-guard.js";
import { StorageHelperModule as StorageHelper } from "./storage-helper.js";
import { DBModulesRegistry } from "./db-modules-registry.js";
import type { PreservingPutTally } from "./features.js";
import type { LocalEditInput, LocalEditTally } from "./local-edit.js";
import type { FeatureRecord } from "../../../contracts/sync.contract.js";

type StorageDBInstance = IDBDatabase | { _isStub: boolean };

/** Module API returned by DB init() — methods vary by module */
interface DBModuleAPI {
    [key: string]: ((...args: unknown[]) => unknown) | undefined;
}

/**
 * The storage report as `DB.Preferences` returns it — three stores counted.
 *
 * `featuresCount` and `outboxCount` exist since 03/08/2026: without them, a pull of
 * 27 entities left `getStats()` reporting 0.
 */
interface StorageStatsReport {
    used: number;
    quota: number;
    percentage: number;
    layersCount: number;
    featuresCount: number;
    outboxCount: number;
}

/**
 * IndexedDB management module
 *
 * Object Stores :
 * - layers : GeoJSON layer cache (id, profileId, data, timestamp, size)
 * - preferences : User preferences (key, value)
 * - metadata : Cache metadata (key, value, timestamp)
 * - features : one record per entity, keyed `[layerId, localId]` (v4)
 * - outbox : write queue, `seq` autoIncrement (v4)
 * - local_images : images held for deferred upload
 *
 * ⚠️ This list used to cite `sync_queue` and omit `features`, `outbox` and
 * `local_images` — it described the v2 schema. `sync_queue` has since been removed from
 * the schema, `sync_backups` goes with the backup chain.
 */
const StorageDB = {
    /**
     * Database name
     * @private
     */
    _dbName: "geoleaf-db",

    /**
     * Initialized sub-modules
     * @private
     */
    _modules: {} as Record<string, DBModuleAPI>,

    /**
     * Lazy initialize a specific module
     * @private
     */
    _ensureModule(moduleName: string): DBModuleAPI | null {
        if (this._modules[moduleName]) {
            return this._modules[moduleName];
        }

        const moduleConfig = DBModulesRegistry[moduleName as keyof typeof DBModulesRegistry];
        if (
            moduleConfig &&
            typeof moduleConfig.init === "function" &&
            this._db &&
            !("_isStub" in this._db)
        ) {
            const api = moduleConfig.init(this._db) as unknown as DBModuleAPI;
            this._modules[moduleName] = api;
            Log.debug(`[StorageDB] ${moduleName} module lazily initialized`);
            return api;
        }

        return null;
    },

    /**
     * Database version.
     *
     * ⚠️ The Service Worker does NOT read it and must not: it opens `geoleaf-db` with NO
     * version. That is what makes desynchronisation inexpressible — there is only one
     * place left where this number exists, this one.
     *
     * v4 adds `features` and `outbox`. No data migration — decided while the app had no
     * users (see the v4 block below).
     * @private
     */
    // ⚠️ 4 → 5: the `routes` store. The bump is ADDITIVE — every creation in
    // `_upgradeDatabase` is guarded by `objectStoreNames.contains(...)`, so an existing
    // database gains the store and keeps the rest.
    //
    // 🛑 The service worker does NOT have to track this number, and that is what makes
    // the bump safe: it opens `geoleaf-db` with NO second argument, and
    // `sw-core.test.js` refuses any call carrying one, witness included. A versioned
    // worker would refuse to open a database the engine upgraded — that named risk is
    // ruled out by construction rather than by discipline.
    _dbVersion: 5,

    /**
     * Database instance
     * @private
     */
    _db: null as StorageDBInstance | null,

    /**
     * Initialises the IndexedDB connection
     *
     * @returns {Promise<IDBDatabase>}
     * @example
     * await GeoLeaf.Storage.DB.init();
     */
    init() {
        if (this._db) {
            Log.debug("[StorageDB] Already initialized");
            return Promise.resolve(this._db);
        }

        // Use StorageHelper.openDatabase with timeout and unified error handling
        return StorageHelper.openDatabase(
            this._dbName,
            this._dbVersion,
            (event: IDBVersionChangeEvent) => this._upgradeDatabase(event),
            15000 // 15 second timeout for IndexedDB
        )
            .then((db) => {
                this._db = db;
                this._initializeModules();

                // YIELD ON `versionchange` — without this, WE are the blocker.
                //
                // Fires when another context (a second tab, or the same app after a deploy)
                // asks to upgrade the schema. A connection that does not close makes that
                // upgrade hang until it times out, and the other side then falls back to
                // `_isStub` — no storage, silently, on a device that may hold unsynced field
                // captures. Holding a connection open is the ONLY thing that can block a
                // migration, so every holder must let go on request.
                //
                // ⚠️ This becomes load-bearing the moment the schema moves (task 3.4). Until
                // then it costs nothing and is invisible — which is exactly why it has to be
                // posted BEFORE the migration, not with it.
                db.onversionchange = () => {
                    Log.warn(
                        "[StorageDB] Another connection requested a version change — closing ours"
                    );
                    this.close();
                };

                // ⚠️ `geoleaf:storage:ready` WAS REMOVED HERE (03/08/2026). It fired on
                // EVERY database open — hence every startup — **with no payload**, and
                // had no listener anywhere. The repo's rule is that an emitter without a
                // listener gets removed **or** consumed; dedicating a listener to it
                // would have closed the counter to the letter while bringing nothing,
                // and one notification per boot is noise that teaches people to stop
                // reading them.
                //
                // ⚠️ And it did not say what matters: on iOS the state to observe is not
                // "the database opens" but "the database was PURGED" after 7 days of
                // inactivity. The day that need arrives, it will be a new signal with
                // its payload, not this one rewired.

                return db;
            })
            .catch((error: unknown) => {
                // Fallback: if IndexedDB fails, continue without persistence.
                Log.warn(
                    "[StorageDB] IndexedDB initialization failed, continuing without storage:",
                    (error as Error).message
                );
                // Remember the failure (B.47b). The stub used to be returned WITHOUT being
                // stored, so the `if (this._db)` short-circuit above never fired and every
                // later façade call paid another full open attempt — up to the 15 s timeout
                // each time. On a database that is durably unopenable (quota exceeded,
                // private browsing, IDB disabled) that is not an edge case, it is the
                // steady state.
                //
                // `_db` is typed `IDBDatabase | { _isStub: boolean }` and the three guards
                // that read it (`_ensureModule`, `_initializeModules`, `close`) already test
                // `"_isStub" in this._db` — the stub was always meant to live here.
                // `close()` clears it, which is the recovery path for a database that
                // becomes available again.
                this._db = { _isStub: true };
                return this._db;
            });
    },

    /**
     * Initialize database modules using DBModulesRegistry
     * @private
     */
    _initializeModules() {
        for (const [name, module] of Object.entries(DBModulesRegistry)) {
            if (
                module &&
                typeof module.init === "function" &&
                this._db &&
                !("_isStub" in this._db)
            ) {
                this._modules[name] = module.init(this._db) as unknown as DBModuleAPI;
                Log.debug(`[StorageDB] ${name} module initialized`);
            }
        }
    },

    /**
     * Upgrade database schema
     * @private
     */
    _upgradeDatabase(event: IDBVersionChangeEvent) {
        const db = (event.target as IDBOpenDBRequest).result;
        Log.info(
            `[StorageDB] Upgrading database from version ${event.oldVersion} to ${event.newVersion}`
        );

        // Store 'layers' : GeoJSON layer cache
        if (!db.objectStoreNames.contains("layers")) {
            const layersStore = db.createObjectStore("layers", { keyPath: "id" });
            layersStore.createIndex("profileId", "profileId", { unique: false });
            layersStore.createIndex("timestamp", "timestamp", { unique: false });
            Log.info("[StorageDB] Created 'layers' object store");
        }

        // Store 'preferences': User preferences
        if (!db.objectStoreNames.contains("preferences")) {
            db.createObjectStore("preferences", { keyPath: "key" });
            Log.info("[StorageDB] Created 'preferences' object store");
        }

        // Store 'routes': persisted itineraries — the route, its DECODED line, and the
        // identity of the downloaded corridor.
        //
        // ⚠️ The decoded line is stored, not just the polyline: decoding it takes a
        // codec that lives in a plugin, and a core store keeping only the encoded form
        // would force every reader to own a decoder — something this repo already has a
        // gate and a scar for.
        if (!db.objectStoreNames.contains("routes")) {
            const routes = db.createObjectStore("routes", { keyPath: "id" });
            // Sorted at read time to serve "what I prepared last"; the index makes that
            // sort possible without loading the whole store once it grows.
            routes.createIndex("timestamp", "timestamp", { unique: false });
            Log.info("[StorageDB] Created 'routes' object store");
        }

        // 🛑 The 'sync_queue' store is NO LONGER CREATED. Announced since 02/08 — "it
        // does not survive into v4" — and the `outbox` replaces it entirely.
        //
        // ⚠️ An existing database keeps its store: the no-migration decision rules out
        // deleting it in flight. It becomes an orphan, never opened, and goes with the
        // database.

        // Store 'metadata': General metadata
        if (!db.objectStoreNames.contains("metadata")) {
            db.createObjectStore("metadata", { keyPath: "key" });
            Log.info("[StorageDB] Created 'metadata' object store");
        }

        // 🛑 The 'sync_backups' store is NO LONGER CREATED. The whole backup chain is
        // removed: it had no writer left, and its motive — surviving an origin purge —
        // was false, since it lived in THIS very database.
        //
        // ⚠️ An existing database keeps its store: the no-migration decision (no field
        // device carries data) rules out deleting it in flight. It becomes an orphan
        // store, never opened, and will disappear with the database.

        // Store 'local_images': Images stored locally for deferred upload (v2)
        if (!db.objectStoreNames.contains("local_images")) {
            const imagesStore = db.createObjectStore("local_images", { keyPath: "id" });
            imagesStore.createIndex("uploaded", "uploaded", { unique: false });
            imagesStore.createIndex("timestamp", "timestamp", { unique: false });
            Log.info("[StorageDB] Created 'local_images' object store");
        }

        // ── v4 — the per-ENTITY foundation, and the queue that replaced `sync_queue` ──
        //
        // Two new stores, created EMPTY. No data migration, by decision: the application
        // had no users, so no device carried a v3 to convert. That decision expires at
        // the first field deployment; it is to be reread then, not before.
        //
        // 🛑 `sync_queue` SURVIVED into v4, and NOT as legacy. Its replacement by
        // `outbox` has since been completed.
        //
        // ⚠️ **THIS LINE ANNOUNCED its removal UNTIL 04/08/2026, AND THE REMOVAL HAD NOT
        // HAPPENED.** The targeted batch had indeed settled its three deposits — the two
        // vocabularies, `POI_KINDS`, the duplicated seams — but the roadmap line did not
        // carry the store's removal, and nobody confronted the two statements.
        //
        // What changed, measured at closure: `addpoi` and `editor` **no longer wrote to
        // it**, `poi-restore` **reads the outbox**, and the rescue export was repointed.
        // **The one remaining production writer was `addpoi/sync-handler-backup.ts`**,
        // for BACKUP RESTORATION — a live feature whose move to the `outbox` was costed
        // nowhere.
        //
        // Deleting it here would therefore still have broken the application. The
        // removal has since been executed at the schema, with what it really required.

        // Store 'features': one ENTITY per record (`FeatureRecord` contract).
        //
        // ⚠️ It is NOT "protected from eviction", it is UNREACHABLE by it:
        // `db/eviction.ts` knows a single store name (`layers`). That is the hardest
        // possible form of the contract's rule — "what carries unsynchronised work is
        // never evicted" — because it depends on no correctly-written field.
        if (!db.objectStoreNames.contains("features")) {
            // Composite key: it gives per-layer traversal for free, via
            // `IDBKeyRange.bound([layerId], [layerId, []])` — an array sorts after any
            // string. An extra `layerId` index would be a second truth for nothing.
            const features = db.createObjectStore("features", {
                keyPath: ["layerId", "localId"],
            });
            // ⚠️ `null` is not a valid IndexedDB key: an entity created offline
            // (`serverId: null`) does NOT enter this index. Not a defect as long as the
            // index only serves to find an entity by its server id — but counting
            // entities through it would UNDER-COUNT. Same mechanism as the
            // boolean-`uploaded` bug below, where booleans stayed out of an index.
            features.createIndex("serverId", "serverId", { unique: false });
            features.createIndex("syncState", "syncState", { unique: false });
            features.createIndex("updatedAt", "updatedAt", { unique: false });
            Log.info("[StorageDB] Created 'features' object store (v4)");
        }

        // Store 'outbox': the write queue, `OutboxEntry` contract.
        //
        // 🛑 THE KEY-COLLISION FIX IS IN THE KEY, which is why it sits here and not
        // later: adding it afterwards would cost a v5.
        //
        // `sync_queue` minted `sync_<ms>_<random>` as its primary key. At equal
        // milliseconds it is therefore CHANCE that orders, and the timestamp sort —
        // stable since ES2019 — merely TRANSPORTS that order instead of fixing it.
        // Three writes within the same millisecond read back in reverse order
        // (reproduced: `e2e/fixtures/offline/db-v3-dump.json`).
        //
        // `autoIncrement` puts the generator IN the database: its monotonicity is that
        // of transaction commit order — the only clock two tabs share. A JS counter
        // does not have it, a timestamp does not at the millisecond, a random suffix
        // never did. Consequence: there is no longer a sort to fix, there is a sort to
        // DELETE.
        if (!db.objectStoreNames.contains("outbox")) {
            const outbox = db.createObjectStore("outbox", {
                keyPath: "seq",
                autoIncrement: true,
            });
            // `id` stays the contract's address (`OutboxEntry.id`) but no longer
            // carries the order. UNIQUE deliberately: on a `keyPath: "id"`, two entries
            // with the same id overwrote each other silently — a capture vanished. Here
            // the collision THROWS.
            outbox.createIndex("id", "id", { unique: true });
            outbox.createIndex("state", "state", { unique: false });
            // Composite: serves coalescing and the join towards `features`.
            outbox.createIndex("localId", ["layerId", "localId"], { unique: false });
            Log.info("[StorageDB] Created 'outbox' object store (v4)");
        }

        // v3 — rewrite `local_images.uploaded` from boolean to 0/1.
        //
        // Booleans are not valid IndexedDB keys, so every record written by v2 stayed OUT
        // of the `uploaded` index and `getPendingImages()` rejected with DataError: queued
        // images were unreachable, never uploaded, and never cleaned (backlog B.6).
        // Rewriting the value is what puts the records into the index — the index itself
        // is unchanged and needs no rebuild.
        //
        // Guarded on oldVersion so a fresh database (created just above, already 0/1) does
        // not pay for a pointless cursor pass.
        if (event.oldVersion > 0 && event.oldVersion < 3) {
            const tx = (event.target as IDBOpenDBRequest).transaction;
            if (tx && db.objectStoreNames.contains("local_images")) {
                let migrated = 0;
                const cursorRequest = tx.objectStore("local_images").openCursor();
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) {
                        if (migrated > 0) {
                            Log.info(
                                `[StorageDB] v3 migration: ${migrated} local image(s) re-flagged 0/1 and indexed`
                            );
                        }
                        return;
                    }
                    const record = cursor.value as { uploaded?: unknown };
                    if (typeof record.uploaded !== "number") {
                        record.uploaded = record.uploaded ? 1 : 0;
                        cursor.update(record);
                        migrated++;
                    }
                    cursor.continue();
                };
                // Never fail the upgrade over the migration: a rejected versionchange
                // leaves the whole database unopenable, which is far worse than images
                // that stay invisible until the next write.
                cursorRequest.onerror = () => {
                    Log.warn(
                        `[StorageDB] v3 migration could not read local_images: ${cursorRequest.error}`
                    );
                };
            }
        }
    },

    // ========================================
    // LAYER METHODS (Delegated to DB.Layers)
    // ========================================

    async cacheLayer(
        id: string,
        data: unknown,
        profileId: string,
        metadata: Record<string, unknown> = {}
    ): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.cacheLayer?.(id, data, profileId, metadata);
        }
        return undefined;
    },

    async getLayer(id: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.getLayer?.(id);
        }
        return undefined;
    },

    /**
     * Reads a layer's offline entities back as a GeoJSON FeatureCollection.
     *
     * 🛑 FIRST READER OF THE `features` STORE. The store existed with **neither
     * producer nor consumer**: `DBFeatures` was referenced only by
     * `db-modules-registry.ts`. Its writer came later — see
     * {@link IndexedDB.putLayerFeatures} just below.
     *
     * ⚠️ Returns a **FeatureCollection** and not the raw records, because the caller is
     * the kernel's layer loader: it expects the same shape a `fetch` would have handed
     * it, and diverging would force the seam to distinguish two shapes — the very
     * distinction this read exists to remove.
     *
     * ⚠️ Returns `null` — not an EMPTY collection — when nothing is stored. An empty
     * collection is indistinguishable from a genuinely empty layer, and the caller must
     * be able to fall back to the network rather than display zero entities believing
     * it has read.
     *
     * @param layerId - Layer identifier.
     * @returns The collection, or `null` when the layer has no stored entity.
     */
    async getLayerFeatureCollection(
        layerId: string
    ): Promise<{ type: "FeatureCollection"; features: unknown[] } | null> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Features");
        if (!module?.listByLayer) return null;
        const records = (await module.listByLayer(layerId)) as Array<{
            feature?: unknown;
            localId?: string;
        }> | null;
        if (!Array.isArray(records) || records.length === 0) return null;

        // 🛑 A LOCAL DELETION MUST DISAPPEAR FROM THE MAP.
        //
        // The record of an entity deleted offline SURVIVES deliberately: it is the only
        // place its `serverId` lives, and the push needs to know WHAT to delete — the
        // outbox entry carries only the `localId`. So it must not be destroyed, but it
        // must not be RENDERED either: a user deleting off-network would see their
        // entity stay on screen, and "the edit applies locally" would be half false.
        // The only place that knows the difference is the queue, hence this join.
        const edits = this._ensureModule("LocalEdit");
        const deleted = edits?.pendingDeletions
            ? ((await edits.pendingDeletions(layerId)) as Set<string>)
            : new Set<string>();

        const visible = records.filter(
            (r) => r.feature !== undefined && !deleted.has(String(r.localId))
        );
        // Every entity of the layer is locally deleted: that is an EMPTY layer, not an
        // unstored one. Returning `null` here would re-trigger the network and make
        // what the user just deleted reappear.
        return { type: "FeatureCollection", features: visible.map((r) => r.feature) };
    },

    /**
     * Applies a local edit — the entity AND its enqueueing, in ONE transaction.
     *
     * Write mirror of {@link IndexedDB.getLayerFeatureCollection}: the facade delegates,
     * it does not arbitrate. Coalescing and cancellation live in `db/local-edit.ts`,
     * the only place where both stores fit in a single transaction.
     *
     * ⚠️ **Checks NO edit right.** The standing invariant — pulling never confers
     * editability — is held one layer up, where the layer's declaration is readable.
     * Putting it here would make it a storage rule, hence bypassable by any caller
     * speaking to the database directly.
     *
     * @param input - The edit to apply.
     * @returns What was done (merge, cancellation, new entry), or `null` without the module.
     */
    async applyLocalEdit(input: LocalEditInput): Promise<LocalEditTally | null> {
        if (!this._db) await this.init();
        const module = this._ensureModule("LocalEdit");
        if (!module?.applyLocalEdit) return null;
        return (await module.applyLocalEdit(input)) as LocalEditTally;
    },

    /**
     * Writes a pulled batch into the `features` store — the store's FIRST writer.
     *
     * Mirror of {@link IndexedDB.getLayerFeatureCollection}: the facade delegates, it
     * does not arbitrate. The rule "never overwrite an unsynchronised capture" lives in
     * `db/features.ts`, the only place where read and write fit in **one** transaction.
     *
     * ⚠️ Every record must carry a defined `feature`. `getLayerFeatureCollection`
     * decides its `null` on `records.length === 0`, **before** filtering undefined
     * `feature`s: a batch written without geometry would make it return a collection
     * that is **empty rather than null**, and the loader would display zero entities
     * believing it has read.
     *
     * @param records - Complete records, `feature` included.
     * @returns The real tally `{ written, preserved }`, or `null` when the module is absent.
     */
    async putLayerFeatures(records: readonly FeatureRecord[]): Promise<PreservingPutTally | null> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Features");
        if (!module?.putManyPreservingLocal) return null;
        return (await module.putManyPreservingLocal(records)) as PreservingPutTally;
    },

    /**
     * Counts what the sync report needs, per layer, in one pass (tâche 4.8).
     *
     * 🛑 **ONE method rather than four.** Composing the report needs three per-layer
     * tallies; exposing them one by one (`countByLayer`, `listByState`…) would widen the
     * facade by four members for a single consumer, and move knowledge of the stores
     * out of the layer that owns them. The facade delegates, it does not arbitrate —
     * but what it delegates is the tally, not the stores.
     *
     * ⚠️ **`pendingCount` aggregates `pending` + `inFlight` + `failed`.** It is "what is
     * still owed to the server", and `failed` belongs there: it was explicitly put back
     * into the replayable set, precisely because a failed entry is a field capture with
     * no other copy. `quarantined` is counted apart — the contract describes it as
     * "kept, visible, but not replayable as-is", so it is not the same debt.
     *
     * @param layerIds - Layers to count. A layer with no entity yields zeros, never nothing.
     * @returns The tallies per layer identifier, or `null` when the modules are absent.
     * @example
     * const counts = await GeoLeaf.Storage.DB.getSyncCounts(["sites_rosario"]);
     * console.info(counts?.["sites_rosario"]?.featureCount);
     */
    async getSyncCounts(
        layerIds: readonly string[]
    ): Promise<Record<
        string,
        { featureCount: number; pendingCount: number; quarantinedCount: number }
    > | null> {
        if (!this._db) await this.init();
        const features = this._ensureModule("Features");
        const outbox = this._ensureModule("Outbox");
        // Captured as locals: the type narrowing on `features?.countByLayer` is lost at
        // the first closure boundary (the loop below), and `strict` says so.
        const countByLayer = features?.countByLayer;
        const listByState = outbox?.listByState;
        if (!countByLayer || !listByState) return null;

        const out: Record<
            string,
            { featureCount: number; pendingCount: number; quarantinedCount: number }
        > = {};
        for (const layerId of layerIds) {
            // The identifiers come from the profile, that is from a `JSON.parse`: a
            // layer named `__proto__` is an OWN property there, and `out[k] = …` would
            // route it onto the prototype setter. A layer so named is simply not
            // reported.
            if (isUnsafeKey(layerId)) continue;
            // The bucket is held LOCALLY then re-read through this reference:
            // `out[layerId]!` would silence `noUncheckedIndexedAccess` with an
            // assertion, i.e. make the probe come out green BECAUSE the assertion is
            // there (rule NNA-04, no baseline).
            const bucket = { featureCount: 0, pendingCount: 0, quarantinedCount: 0 };
            out[layerId] = bucket;
            bucket.featureCount = (await countByLayer.call(features, layerId)) as number;
        }

        const tally = async (states: readonly string[], field: "pending" | "quarantined") => {
            for (const state of states) {
                const entries = ((await listByState.call(outbox, state)) ?? []) as ReadonlyArray<{
                    layerId?: string;
                }>;
                for (const entry of entries) {
                    const bucket = entry.layerId ? out[entry.layerId] : undefined;
                    if (!bucket) continue;
                    if (field === "pending") bucket.pendingCount += 1;
                    else bucket.quarantinedCount += 1;
                }
            }
        };
        await tally(["pending", "inFlight", "failed"], "pending");
        await tally(["quarantined"], "quarantined");

        return out;
    },

    /**
     * Lists the edits still owed to the server, each joined to the entity it edits (4.10).
     *
     * This is what the "local POIs" panel exports: the WORK, not the cache. An outbox
     * entry does not carry the payload — it references `[layerId, localId]` — so the
     * join towards `features` happens here, where both stores are open.
     *
     * ⚠️ An entry whose entity has vanished from the store is returned with
     * `feature: null` rather than discarded. A capture we can no longer describe is
     * still a capture owed to the server; silencing it in an export whose very role is
     * to get everything out would be losing it.
     *
     * @returns One entry per pending edit, oldest first; `[]` without the module.
     * @example
     * const pending = await GeoLeaf.Storage.DB.listPendingEdits();
     * console.info(`${pending.length} saisie(s) jamais poussée(s)`);
     */
    async listPendingEdits(): Promise<
        Array<{
            entryId: string;
            kind: string;
            layerId: string;
            localId: string;
            state: string;
            createdAt: number;
            feature: unknown;
        }>
    > {
        if (!this._db) await this.init();
        const features = this._ensureModule("Features");
        const outbox = this._ensureModule("Outbox");
        const listByState = outbox?.listByState;
        const get = features?.get;
        if (!listByState || !get) return [];

        const out = [];
        for (const state of ["pending", "inFlight", "failed", "quarantined"]) {
            const entries = ((await listByState.call(outbox, state)) ?? []) as ReadonlyArray<{
                id?: string;
                kind?: string;
                layerId?: string;
                localId?: string;
                createdAt?: number;
            }>;
            for (const entry of entries) {
                if (!entry.layerId || !entry.localId) continue;
                const record = (await get.call(features, entry.layerId, entry.localId)) as {
                    feature?: unknown;
                } | null;
                out.push({
                    entryId: String(entry.id ?? ""),
                    kind: String(entry.kind ?? ""),
                    layerId: entry.layerId,
                    localId: entry.localId,
                    state,
                    createdAt: Number(entry.createdAt ?? 0),
                    feature: record?.feature ?? null,
                });
            }
        }
        return out.sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * Removes the entities that are pure CACHE — synchronised, and re-pullable (4.10).
     *
     * 🛑 **WHAT MAKES THE BUTTON'S NAME TRUE.** The `features` store IS the cache: its
     * `synced` records re-pull through `pullLayer()`. The outbox, by contrast, carries
     * field work that exists nowhere else. A purge announcing "clear the cache" must
     * therefore touch only the former — cache vocabulary, re-downloadable data, and
     * nothing else.
     *
     * ⚠️ **The outbox guard is here although the single-transaction invariant makes it
     * theoretically useless**: `applyEdit` writes the entity as `pending` together with
     * the entry, so a `synced` record should have no pending entry. "Should not"
     * guards nothing — and the stake here is an irreversible destruction of capture.
     *
     * @returns `{ removed, preserved }` — `preserved` counts the entities spared
     *   because an outbox entry still claims them. Both are displayable.
     * @example
     * const { removed, preserved } = await GeoLeaf.Storage.DB.purgeCachedFeatures();
     * console.info(`${removed} supprimée(s), ${preserved} conservée(s)`);
     */
    async purgeCachedFeatures(): Promise<{ removed: number; preserved: number }> {
        if (!this._db) await this.init();
        const features = this._ensureModule("Features");
        const outbox = this._ensureModule("Outbox");
        const listByState = features?.listByState;
        const removeOne = features?.remove;
        if (!listByState || !removeOne) return { removed: 0, preserved: 0 };

        // The entities still claimed by an outbox entry, as `layerId\u0000localId`.
        // ⚠️ `Set` and not an object: the key is composed from data, and an object
        // would expose `__proto__` (cf. `check-dynamic-key-writes`).
        const owed = new Set<string>();
        if (outbox?.listByState) {
            for (const state of ["pending", "inFlight", "failed", "quarantined"]) {
                const entries = ((await outbox.listByState(state)) ?? []) as ReadonlyArray<{
                    layerId?: string;
                    localId?: string;
                }>;
                for (const e of entries) {
                    if (e.layerId && e.localId) owed.add(`${e.layerId}\u0000${e.localId}`);
                }
            }
        }

        const synced = ((await listByState.call(features, "synced")) ?? []) as ReadonlyArray<{
            layerId: string;
            localId: string;
        }>;
        let removed = 0;
        let preserved = 0;
        for (const record of synced) {
            if (owed.has(`${record.layerId}\u0000${record.localId}`)) {
                preserved += 1;
                continue;
            }
            await removeOne.call(features, record.layerId, record.localId);
            removed += 1;
        }
        return { removed, preserved };
    },

    async removeLayer(id: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.removeLayer?.(id);
        }
        return undefined;
    },

    async getLayersByProfile(profileId: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.getLayersByProfile?.(profileId);
        }
        return undefined;
    },

    async clearProfile(profileId: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.clearProfile?.(profileId);
        }
        return undefined;
    },

    // ========================================
    // 🛑 THE SEVEN `sync_queue` RELAYS ARE REMOVED
    // ========================================
    //
    // `addToSyncQueue`, `getAllFromSyncQueue`, `getPendingSyncQueue`,
    // `updateSyncQueueStatus`, `getSyncQueueEntry`, `getSyncQueueSummary` and
    // `removeSyncQueueEntry` delegated to the `DB.Sync` module (`db/sync.ts`), deleted
    // with the `sync_queue` store.
    //
    // The decision had said since 02/08 that the store "does not survive into v4". The
    // schema comment attributed its removal to a batch that never carried it — two
    // documents, two truths, no common reader. The gap was established by measurement,
    // then the removal executed.
    //
    // What had already moved: `addpoi` then `editor` write through
    // `Storage.applyEdit` → outbox, `poi-restore` reads the outbox, `offline-ui` reads
    // `features` + outbox. The one remaining use was backup restoration, removed with
    // its chain just above.
    //
    // ⚠️ **What goes with it, and must be known**: `MAX_REPLAY_ATTEMPTS = 3` was
    // enforced HERE, at write time, and it was the repo's only replay cap. The outbox
    // does carry an `attempts` field, but `write/push-engine.ts` neither incremented
    // nor capped it — the budget was therefore ALREADY absent from the v4 path, and
    // this removal reveals it instead of causing it.

    // ========================================
    // PREFERENCES & STATS (Delegated to DB.Preferences)
    // ========================================

    /**
     * Relays the storage report of `DB.Preferences`.
     *
     * ⚠️ **This relay declared LESS than what the module returns, and declared it
     * wrong.** Its shape was `{ used, quota, percentage, layersCount, syncQueueCount }`:
     * it named a counter of the v3 store — since removed — and **omitted
     * `featuresCount` and `outboxCount`**, which `preferences.ts` fills. A caller on
     * the degraded path thus received an object with two fields missing without the
     * type saying so.
     *
     * @returns Quota, usage, and the tallies of the three data-bearing stores.
     */
    async getStorageStats(): Promise<StorageStatsReport> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Preferences");
        const empty: StorageStatsReport = {
            used: 0,
            quota: 0,
            percentage: 0,
            layersCount: 0,
            featuresCount: 0,
            outboxCount: 0,
        };
        if (module) {
            return (module?.getStorageStats?.() as StorageStatsReport | undefined) ?? empty;
        }
        return empty;
    },

    async setPreference(key: string, value: unknown): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Preferences");
        if (!module) {
            throw new Error(
                "[StorageDB] Preferences module not available. Ensure storage/db/preferences.js is loaded."
            );
        }
        return module?.setPreference?.(key, value);
    },

    async getPreference(key: string, defaultValue: unknown = null): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Preferences");
        if (!module) {
            throw new Error(
                "[StorageDB] Preferences module not available. Ensure storage/db/preferences.js is loaded."
            );
        }
        return module?.getPreference?.(key, defaultValue);
    },

    // ========================================
    // 🛑 THE FOUR BACKUP RELAYS ARE REMOVED
    // ========================================
    //
    // `createBackup`, `getBackups`, `getBackup` and `cleanOldBackups` delegated to the
    // `DB.Backups` module, itself deleted with the `sync_backups` store. The removal
    // rests not on "it's dead code" but on three measurements:
    //
    //   1. **No writer.** The only caller of `createBackup` was
    //      `addpoi/sync-handler-backup.ts`, reachable from `_createBackup()`, which
    //      itself had NO production caller since `processSyncQueue` was rewritten to
    //      delegate to `pushOutbox`. The store received nothing any more, and the
    //      `offline-ui` panel displayed "no backup" by construction.
    //   2. **The motive was false on the mechanism.** The chain was justified as "the
    //      last rampart after an origin purge" — the iOS case, WebKit purging after 7
    //      days. But `sync_backups` was a store of THIS database: the purge it was
    //      meant to cover destroyed it with the rest.
    //   3. **The role is covered twice elsewhere.** The outbox contractually forbids
    //      destroying an entry, and `offline-ui`'s JSON export leaves the browser — it
    //      genuinely survives an origin purge.
    //
    // ⚠️ The note below said `cleanOldBackups` "is still called at the sync manager's
    // init()", and that was true. Purging a store nobody feeds preserves nothing: it
    // goes with what it purged.

    // ========================================
    // IMAGE STORAGE METHODS (Delegated to DB.Images)
    // ========================================

    async storeImageLocally(imageData: unknown): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.storeImageLocally?.(imageData);
        }
        return undefined;
    },

    // ⚠️ `getLocalImage()` removed from the facade: its sole consumer was
    // `addpoi/image-upload.ts` → `getLocalImageUrl()`, redundant with the base64
    // data-URL the same module writes into the POI's data. Both leave together.
    //
    // ⚠️ `getPendingImages` and `updateImageUploadStatus` STAY, and it is no longer a
    // reservation: they are WIRED by `editor/persistence/image-store.ts`
    // (`retryPendingImages`), itself armed by `initImageUpload()`. This line said "they
    // serve `retryPendingUploads()`" until 08/08/2026: nothing had wired it then, and a
    // later batch is what made the chain live — under another name, in another
    // package.
    async getPendingImages(): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.getPendingImages?.();
        }
        return undefined;
    },

    async updateImageUploadStatus(id: string, status: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.updateImageUploadStatus?.(id, status);
        }
        return undefined;
    },

    async deleteLocalImage(id: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.deleteLocalImage?.(id);
        }
        return undefined;
    },

    // 🛑 RELAY ADDED ON 08/08/2026 — the purge existed and was REACHABLE BY NOBODY.
    // `cleanUploadedImages` lived in the `Images` module with no relay here, hence
    // absent from `GeoLeaf.Storage.DB` and the namespace: 0 possible callers, while
    // `storeImageLocally` was writing field photos. The store had a writer and no purge
    // — exactly the damage the header of `db/images.ts` said it wanted to avoid,
    // realised from the other end.
    async cleanUploadedImages(): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.cleanUploadedImages?.();
        }
        return undefined;
    },

    /**
     * Closes the database connection
     */
    close() {
        if (this._db && !("_isStub" in this._db)) {
            this._db.close();
        }
        this._db = null;
        this._modules = {};
        Log.info("[StorageDB] Database connection closed");
    },
};

// The `if (Log)` guard was dead (Log is a Proxy, always truthy) and it
// wrapped a module-load introspection dump: key counts, the first ten keys, sample
// `typeof` probes. Its arguments were built on EVERY load whatever the log level, since
// `Log.debug` only tests the level once called. Removed; what remains is the one line
// its five sibling `db/` modules also emit.
Log.debug("[StorageDB] Module loaded");

/**
 * Public name of the {@link StorageDB} façade: opens the offline database, wires the
 * `db/` modules through {@link DBModulesRegistry}, and forwards the layer/sync/image/
 * backup/preference operations to whichever module owns each object store.
 *
 * This is the handle `offline-engine-entry.ts` passes to `GeoLeaf.Storage.wireModules()`.
 */
const IndexedDB = StorageDB;

export { IndexedDB };
