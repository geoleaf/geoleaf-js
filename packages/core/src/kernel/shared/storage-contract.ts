/*!
 * GeoLeaf Core – Shared / Storage Contract
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Optional interface giving non-Storage modules (POI, LayerManager…)
 * access to the Storage module without importing the Storage plugin directly
 * (that plugin is optional).
 *
 * Phase 10-C — Pattern E: replaces the runtime coupling with the pure ESM
 * interface contract `StorageContract.*`.
 *
 * CYCLE BROKEN:
 *   POI → StorageContract (no-dep ESM singleton)
 *   StorageContract.init() ← called by geoleaf.storage.js when the plugin loads
 *
 * USAGE in consumer modules:
 *   import { StorageContract } from './storage-contract.js';
 *
 *   if (StorageContract.isAvailable()) {
 *       const items = await StorageContract.DB.getAllFromSyncQueue();
 *   }
 *
 *   // Image upload (POI):
 *   if (StorageContract.isAvailable() && StorageContract.DB?.storeImageLocally) {
 *       await StorageContract.DB.storeImageLocally(imageData);
 *   }
 *
 * INITIALISATION:
 *   // In geoleaf.storage.js (or the Storage plugin), once assembled:
 *   StorageContract.init(Storage);
 *
 * ## Layer data precedence — two stores, one screen, and which one wins
 *
 * A layer's offline data can exist in TWO stores at once, written by different flows:
 *
 *   - `layers` holds SNAPSHOTS — an HTTP response body with freshness metadata, written by
 *     the offline downloader (profile caching) and by the theme cache. One row per layer.
 *   - `features` holds ENTITY RECORDS — one row per feature, carrying sync state, written by
 *     the bounded pull and by local edits (via the outbox flow).
 *
 * These are not competing copies: they are different REPRESENTATIONS with different readers,
 * and neither can replace the other (a snapshot has no per-feature sync state; records have
 * no notion of "the whole layer as the server last served it").
 *
 * **The precedence rule, when both hold data for the same layer:**
 *
 *   1. The SNAPSHOT is the BASE. Offline, the layer renders from it (or from the network
 *      when reachable) — it is authoritative for every feature it contains that no entity
 *      record references.
 *   2. ENTITY RECORDS OVERLAY the base, per feature id. The entity-restore pass runs after
 *      the host layer has loaded and upserts visible-state records onto it
 *      (`mergeFeatures`, id-keyed) and removes net-deleted ids. For any feature id present
 *      in `features`, the RECORD is authoritative — it carries the newest local edit and its
 *      sync state, which a snapshot can never reflect.
 *
 * The rule is enforced by ORDER, not by comparison: the restore pass merges after layer
 * load, so the record's version is simply the last write onto the map source. Nothing
 * reconciles the two stores at rest — and nothing should: reconciling would mean editing a
 * cached HTTP response to mimic a server that never sent it.
 */

/**
 * Structural view of the optional Storage plugin facade (`geoleaf.storage.js`).
 * Only the members read by this contract are declared; everything else is
 * tolerated via the index signature. Members are `unknown` because their
 * concrete shapes live in the (external, optional) Storage plugin package —
 * core must not depend on them.
 */
interface StorageFacade {
    DB?: unknown;
    CacheManager?: unknown;
    Cache?: unknown;
    isAvailable?(): boolean;
    [key: string]: unknown;
}

/** Reference to the Storage facade (geoleaf.storage.js). */
let _storageRef: StorageFacade | null = null;

/**
 * Deferred signalling that the offline engine is ready to drive: resolved once
 * `Storage.init()` has completed (IndexedDB open). The optional plugin UI awaits
 * this before touching the engine. While `modules.offline` is disabled the engine
 * is never loaded, so this promise stays pending and UI actions defer (CDC §4).
 */
let _readyResolve: (() => void) | null = null;
let _readyPromise: Promise<void> = new Promise<void>((resolve) => {
    _readyResolve = resolve;
});

/**
 * Optional interface contract for the Storage module.
 *
 * Exposes the DB and CacheManager sub-modules read-only through lazy getters.
 * `init(storage)` is the only write method — called exactly once when the
 * Storage plugin boots.
 *
 * @namespace StorageContract
 */
const StorageContract = {
    /**
     * Initialises the contract with the Storage facade.
     * Called by `geoleaf.storage.js` when the Storage plugin is loaded.
     *
     * @param {Object} storageModule - The Storage facade (export of geoleaf.storage.js)
     */
    init(storageModule: StorageFacade) {
        _storageRef = storageModule;
    },

    /**
     * Returns true when the Storage plugin is loaded AND IndexedDB is open.
     * @returns {boolean}
     */
    isAvailable() {
        if (!_storageRef) return false;
        return typeof _storageRef.isAvailable === "function"
            ? _storageRef.isAvailable()
            : !!_storageRef.DB;
    },

    /**
     * Access to the IndexedDB module (Storage.DB).
     * @returns {Object|null}
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Storage.DB shape is defined in the external, optional Storage plugin; core must not couple to it. The single in-core consumer (capabilities/offline/poi-restore) narrows it locally.
    get DB(): any {
        return _storageRef?.DB ?? null;
    },

    /**
     * Access to the CacheManager module (Storage.CacheManager).
     * @returns {Object|null}
     */
    get CacheManager() {
        return _storageRef?.CacheManager ?? null;
    },

    /**
     * Access to the Cache namespace (Storage.Cache).
     * Holds CacheStorage, LayerSelector, etc.
     * @returns {Object|null}
     */
    get Cache() {
        return _storageRef?.Cache ?? null;
    },

    /**
     * Checks whether a Storage plugin is registered — even when it is not yet
     * initialised or its DB is closed.
     * Different from isAvailable() which also checks that DB is open.
     * @returns {boolean}
     */
    isPluginLoaded() {
        return _storageRef !== null;
    },

    /**
     * Resolves once the offline engine has been loaded and initialised
     * (`Storage.init()` complete, IndexedDB open). The optional plugin UI awaits
     * this before invoking engine actions. While `modules.offline` is disabled the
     * engine never loads and this never resolves — UI actions defer indefinitely.
     *
     * @returns {Promise<void>} resolved when the engine is ready to drive.
     */
    whenReady(): Promise<void> {
        return _readyPromise;
    },

    /**
     * Signals engine readiness — called by `OfflineLifecycle` after `Storage.init()`
     * resolves. Idempotent (resolving an already-settled promise is a no-op).
     * @internal
     */
    _markReady(): void {
        _readyResolve?.();
    },

    /**
     * Re-arms the readiness deferred. Test-only seam (there is no runtime recreate
     * path); invoked by `OfflineLifecycle._reset()` so specs that re-boot start pending.
     * @internal
     */
    _resetReady(): void {
        _readyPromise = new Promise<void>((resolve) => {
            _readyResolve = resolve;
        });
    },
};

export { StorageContract };
