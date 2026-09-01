/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description In-core public facade for the offline storage engine (S14 Phase B).
 * Exposes {@link Storage} which orchestrates IndexedDB (`DB`), the CacheAPI
 * cache manager (`CacheManager`) and the offline detector (`OfflineDetector`).
 *
 * @remarks
 * The facade is **decoupled from the engine**: it holds no engine code, only
 * references injected via {@link Storage.wireModules}. It self-mounts on
 * `globalThis.GeoLeaf.Storage` at import time (pulled into the boot graph by
 * `globals.storage`, which re-exports this via the thin `geoleaf.storage` facade)
 * so it is present at boot (getters return `null` until wired).
 *
 * The engine is wired by the `offline` capability's dynamic
 * `offline-engine-entry.ts` — the composition root and the **sole** caller of
 * {@link Storage.wireModules} — loaded on demand via
 * `CapabilityRegistry.ensureLoaded("offline")`, off the boot path.
 *
 * `Storage.init(options)` initialises every available sub-module and emits
 * `geoleaf:storage:initialized`. Service Worker registration lives in the `pwa`
 * capability (unified `sw-core.js`) — not here.
 *
 * @see {@link Storage}
 * @version 3.0.0
 */

import { Log } from "../../utils/log/index.js";
import { StorageContract } from "../shared/storage-contract.js";
import { mayEditLayer } from "../shared/edition-permissions.js";
import type { LayerSyncReport } from "../../contracts/sync.contract.js";

interface GeoLeafStorageGlobal {
    GeoLeaf?: {
        _OfflineDetector?: unknown;
        Storage?: unknown;
    };
}

interface StorageInitOptions {
    indexedDB?: { name?: string; version?: number };
    cache?: Record<string, unknown>;
    offline?: Record<string, unknown>;
    enableOfflineDetector?: boolean;
}

/**
 * Optimistic-edit module, injected by the offline capability (tâche 4.4).
 *
 * Structural, like {@link PullLike}: the facade lives in the boot graph, editing in
 * the deferred chunk.
 */
interface EditLike {
    pushOutbox: () => Promise<StoragePushReport>;
    /** Sorties de quarantaine — voir `write/quarantine-api.ts`. */
    requeueQuarantined: (id: string) => Promise<StorageQuarantineOutcome>;
    discardQuarantined: (id: string, confirmedLocalId: string) => Promise<StorageQuarantineOutcome>;
    applyEdit: (input: {
        layerId: string;
        kind: "create" | "update" | "delete";
        localId?: string;
        feature?: unknown;
        baseVersion?: { kind: "etag" | "timestamp"; value: string } | null;
    }) => Promise<StorageEditReport>;
}

/**
 * Report of a quarantine exit — mirror of `write/quarantine-api.ts`.
 *
 * `refused` says WHY the exit did not happen, rather than returning a mute `false`:
 * "the cause is not liftable" and "the cause is still there" call for two different
 * operator gestures.
 */
interface StorageQuarantineOutcome {
    readonly ok: boolean;
    readonly refused?: string;
}

/** Report returned by {@link Storage.pushOutbox} — mirrors `capabilities/offline/write/push-engine.ts`. */
interface StoragePushReport {
    readonly attempted: number;
    readonly pushed: number;
    readonly failed: number;
    readonly alreadyPresent: number;
    readonly conflicts: number;
    readonly refused: string | null;
}

/** Report returned by {@link Storage.applyEdit} — mirrors `capabilities/offline/write/local-edit-api.ts`. */
interface StorageEditReport {
    readonly layerId: string;
    readonly localId: string;
    readonly kind: "create" | "update" | "delete";
    readonly entryId: string | null;
    readonly queued: boolean;
    readonly coalescedInto: string | null;
    readonly annulled: boolean;
    readonly refused: string | null;
}

/**
 * Bounded-pull module, injected by the offline capability (tâche 4.1).
 *
 * Structural rather than imported: the façade lives in the boot graph, the pull lives in the
 * deferred offline chunk. A type-only import would be free at runtime, but naming the chunk
 * here is what makes the next reader believe the façade owns it — it does not.
 */
interface PullLike {
    pullLayer: (
        layerId: string,
        options?: {
            bbox?: [number, number, number, number];
            signal?: AbortSignal;
        }
    ) => Promise<StorageLayerPullReport>;
}

/**
 * The report module, injected by the deferred chunk.
 *
 * ⚠️ **`LayerSyncReport` is IMPORTED from the contract, not re-described here**,
 * unlike {@link StorageLayerPullReport} above. The import is `type`-only hence
 * erased at build: it costs the boot graph nothing, and it avoids opening a second
 * copy of a shape the contract already declares. The duplication lesson — two
 * declarations of one contract do not diverge loudly, they agree and go wrong
 * together.
 */
interface ReportLike {
    buildSyncReport: (now?: number) => Promise<readonly LayerSyncReport[]>;
}

/** Report returned by {@link Storage.pullLayer} — mirrors `capabilities/offline/pull/layer-pull.ts`. */
interface StorageLayerPullReport {
    readonly layerId: string;
    readonly fetched: number;
    readonly written: number;
    readonly preserved: number;
    readonly skipped: number;
    readonly capped: boolean;
    readonly aborted: boolean;
    readonly refused: string | null;
}

/**
 * Cap on the engine wait in {@link Storage.pullLayer}.
 *
 * Same value and same motive as `OFFLINE_ENGINE_WAIT_MS` in
 * `kernel/geojson/loader/single-layer.ts`: the chunk wires in ~85 ms at measured
 * boot, and `whenReady()` never resolves without `modules.offline`.
 */
const PULL_ENGINE_WAIT_MS = 3000;

interface DBLike {
    _db?: IDBDatabase | null;
    _dbName?: string;
    _dbVersion?: number;
    init: () => Promise<unknown>;
    close?: () => void;
    getStorageStats?: () => Promise<{
        used: number;
        quota: number;
        percentage: number;
        layersCount?: number;
        featuresCount?: number;
        outboxCount?: number;
    }>;
    getLayersByProfile?: (profileId: string) => Promise<unknown[]>;
}

interface CacheManagerLike {
    init: (config: Record<string, unknown>) => void;
    listCachedProfiles: () => Promise<string[]>;
    clearProfile: (profileId: string) => Promise<number>;
    estimateProfileSize: (
        profileId: string
    ) => Promise<{ totalSize: number; totalSizeFormatted?: string }>;
    getStorageQuota: () => Promise<{ available?: number }>;
    cacheProfile: (profileId: string) => Promise<unknown>;
    isProfileCached: (profileId: string) => Promise<boolean>;
}

interface OfflineDetectorLike {
    init: (opts: Record<string, unknown>) => void;
    isOnline: () => boolean;
    destroy?: () => void;
}

const _g: GeoLeafStorageGlobal =
    typeof globalThis !== "undefined"
        ? (globalThis as unknown as GeoLeafStorageGlobal)
        : typeof window !== "undefined"
          ? (window as unknown as GeoLeafStorageGlobal)
          : {};
_g.GeoLeaf = _g.GeoLeaf || {};

const Storage = {
    /** Implementation modules injected by `entry.ts` (composition root) at boot. */
    _modules: {} as {
        db?: DBLike;
        cacheManager?: CacheManagerLike;
        cache?: unknown;
        pull?: PullLike;
        report?: ReportLike;
        edit?: EditLike;
    },

    /**
     * Wire the assembled implementation modules into the facade. Called once by
     * `entry.ts` after every sub-module has been imported and assembled.
     */
    wireModules(modules: {
        db?: unknown;
        cacheManager?: unknown;
        cache?: unknown;
        pull?: unknown;
        report?: unknown;
        edit?: unknown;
    }): void {
        this._modules = modules as {
            db?: DBLike;
            cacheManager?: CacheManagerLike;
            cache?: unknown;
            pull?: PullLike;
            report?: ReportLike;
            edit?: EditLike;
        };
    },

    /**
     * IndexedDB layer accessor — read by `StorageContract.DB`.
     * @returns the IndexedDB module, or `undefined` if the plugin is not loaded.
     */
    get DB(): DBLike | undefined {
        return this._modules.db;
    },

    /**
     * CacheAPI cache manager accessor — read by `StorageContract.CacheManager`.
     * @returns the CacheManager module, or `undefined` if unavailable.
     */
    get CacheManager(): CacheManagerLike | undefined {
        return this._modules.cacheManager;
    },

    /**
     * Network state detector resolved lazily from `globalThis.GeoLeaf`.
     * @returns the OfflineDetector module, or `undefined` if disabled/unavailable.
     */
    get OfflineDetector(): OfflineDetectorLike | undefined {
        return _g.GeoLeaf?._OfflineDetector as OfflineDetectorLike | undefined;
    },

    /**
     * Cache namespace (`{ Storage, LayerSelector }`) — read by `StorageContract.Cache`
     * (download-handler, selection-cache, cache-control-zone).
     */
    get Cache(): unknown {
        return this._modules.cache;
    },

    /**
     * Plugin Contract v1 accessor for the IndexedDB layer.
     * @returns the IndexedDB module, or `undefined` if the plugin is not loaded.
     */
    get db(): DBLike | undefined {
        return this.DB;
    },

    /**
     * Plugin Contract v1 accessor for the CacheAPI cache manager.
     * @returns the CacheManager module, or `undefined` if unavailable.
     */
    get cacheManager(): CacheManagerLike | undefined {
        return this.CacheManager;
    },

    /**
     * Plugin Contract v1 accessor for the cache namespace (`{ Storage, LayerSelector }`).
     */
    get cache(): unknown {
        return this.Cache;
    },

    /**
     * Initialise every available storage sub-module (IndexedDB, CacheManager,
     * optionally the offline detector and the Storage plugin's Service Worker).
     * @param options - per-module options; `enableOfflineDetector` and
     * `enableServiceWorker` are opt-in (default `false`).
     * @returns `true` once all available modules are initialised.
     * @throws if a sub-module initialisation fails.
     * @remarks Emits `geoleaf:storage:initialized` on success.
     */
    async init(options: StorageInitOptions = {}): Promise<boolean> {
        Log.info("[Storage] Initializing storage modules...");

        const { indexedDB = {}, cache = {}, offline = {}, enableOfflineDetector = false } = options;

        try {
            if (this.DB) {
                if (indexedDB.name) this.DB._dbName = indexedDB.name;
                if (indexedDB.version) this.DB._dbVersion = indexedDB.version;

                await this.DB.init();
                Log.info("[Storage] IndexedDB initialized");
            } else {
                Log.warn("[Storage] IndexedDB module not available");
            }

            if (this.CacheManager) {
                this.CacheManager.init(cache);
                Log.info("[Storage] Cache Manager initialized");
            } else {
                Log.warn("[Storage] Cache Manager module not available");
            }

            if (enableOfflineDetector && this.OfflineDetector) {
                this.OfflineDetector.init(offline);
                Log.info("[Storage] Offline Detector enabled and initialized");
            } else if (!enableOfflineDetector) {
                Log.info("[Storage] Offline Detector disabled (enableOfflineDetector: false)");
            } else {
                Log.warn("[Storage] Offline Detector module not available");
            }

            // Service Worker registration is owned by the core PWA capability now
            // (unified sw-core.js, gated by `modules.pwa.enabled` — S14 Phase A). The
            // storage plugin no longer registers its own SW; the unified SW serves
            // tiles from the IndexedDB `layers` store that this engine fills.

            Log.info("[Storage] All storage modules initialized successfully");

            document.dispatchEvent(new CustomEvent("geoleaf:storage:initialized"));

            return true;
        } catch (error) {
            const errorMsg = `[Storage] Initialization failed: ${(error as Error).message}`;
            Log.error(errorMsg);
            throw new Error(errorMsg, { cause: error });
        }
    },

    /**
     * @returns `true` when the IndexedDB connection is open (plugin ready).
     */
    isAvailable(): boolean {
        return !!(this.DB && this.DB._db !== null && this.DB._db !== undefined);
    },

    /**
     * `true` as soon as the offline engine registered — independently of IndexedDB
     * opening, which {@link isAvailable} tests.
     *
     * ⚠️ Delegation added so `@geoleaf-plugins/offline-ui` stops importing
     * `StorageContract`. The contract is a SINGLETON whose state is a module-scoped
     * `let`: a plugin loaded as `<script type="module">` has its own graph and
     * cannot share it. The copy it embedded was never initialised — this member
     * gives it the real one, through the namespace.
     */
    isPluginLoaded(): boolean {
        return StorageContract.isPluginLoaded();
    },

    /**
     * Resolves when the offline engine is ready to drive.
     *
     * ⚠️ NEVER resolves while `modules.offline` is disabled — the engine does not
     * load, and UI actions awaiting it defer indefinitely. That is the contract's
     * behaviour, taken as-is. Same delegation motive as {@link isPluginLoaded}.
     */
    whenReady(): Promise<void> {
        return StorageContract.whenReady();
    },

    /**
     * Pulls a declared layer's entities into the local `features` store (tâche 4.1).
     *
     * Bounded by the layer's `offline.maxFeatures` and, optionally, by a bounding box.
     * Downloading NEVER grants write access: the records land as `synced` and no queue entry
     * is created (invariant S6 of the sync contract).
     *
     * ⏱ **Waits for the engine, but not indefinitely.** The implementation lives in
     * the offline chunk, loaded via `import()` **after** boot — calling it at the
     * first frame would find it absent. The race is bounded by
     * {@link PULL_ENGINE_WAIT_MS} because `StorageContract.whenReady()` **never
     * resolves** when `modules.offline` is disabled: unbounded, the call would hang
     * forever on an engine-less variant.
     *
     * ⚠️ Unlike the layer read, there is **no network fallback** here. A pull
     * without an engine must SAY SO — `refused: "engineUnavailable"` — and not
     * return a zero nothing distinguishes from an empty layer.
     *
     * @param layerId - Identifier of the layer to pull.
     * @param options - `bbox` extent and abort signal.
     * @returns The pull report; `refused` is non-null when nothing was written.
     * @example
     * const report = await GeoLeaf?.Storage?.pullLayer?.("sites_rosario");
     * console.info(report?.written, report?.preserved, report?.capped);
     */
    async pullLayer(
        layerId: string,
        options?: { bbox?: [number, number, number, number]; signal?: AbortSignal }
    ): Promise<StorageLayerPullReport> {
        if (!this._modules.pull) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timedOut = new Promise<void>((resolve) => {
                timer = setTimeout(resolve, PULL_ENGINE_WAIT_MS);
            });
            await Promise.race([StorageContract.whenReady(), timedOut]);
            if (timer) clearTimeout(timer);
        }

        const pull = this._modules.pull;
        if (!pull) {
            Log.warn(
                `[GeoLeaf.Storage] pullLayer("${layerId}") — moteur hors-ligne non câblé après ${PULL_ENGINE_WAIT_MS} ms.`
            );
            return {
                layerId,
                fetched: 0,
                written: 0,
                preserved: 0,
                skipped: 0,
                capped: false,
                aborted: false,
                refused: "engineUnavailable",
            };
        }
        return pull.pullLayer(layerId, options);
    },

    /**
     * Applies an edit locally AND queues it for the server — the optimistic write (tâche 4.4).
     *
     * The entity goes into the `features` store and the operation into the
     * `outbox`, **in a single transaction**: a field capture has no other copy, and
     * a half-done write would be undetectable after the fact.
     *
     * ⚠️ **Nothing written here confers editability** — on the contrary, the call is
     * REFUSED, with its motive, when the layer is not modifiable online. Downloading
     * a layer never made a layer modifiable.
     *
     * Bounded engine wait, same motive as {@link Storage.pullLayer}: the offline
     * chunk is deferred, and `whenReady()` never resolves without
     * `modules.offline`.
     *
     * @param input - The layer, operation kind, local identity and entity.
     * @returns The report: entry created, merged, or cancelled; `refused` carries the motive.
     * @example
     * const report = await GeoLeaf?.Storage?.applyEdit?.({
     *     layerId: "sites_rosario", kind: "update", localId: "loc:abc", feature
     * });
     * console.info(report?.queued, report?.coalescedInto);
     */
    async applyEdit(input: {
        layerId: string;
        kind: "create" | "update" | "delete";
        localId?: string;
        feature?: unknown;
        baseVersion?: { kind: "etag" | "timestamp"; value: string } | null;
    }): Promise<StorageEditReport> {
        if (!this._modules.edit) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timedOut = new Promise<void>((resolve) => {
                timer = setTimeout(resolve, PULL_ENGINE_WAIT_MS);
            });
            await Promise.race([StorageContract.whenReady(), timedOut]);
            if (timer) clearTimeout(timer);
        }

        const edit = this._modules.edit;
        if (!edit) {
            Log.warn(
                `[GeoLeaf.Storage] applyEdit("${input.layerId}") — moteur hors-ligne non câblé après ${PULL_ENGINE_WAIT_MS} ms.`
            );
            return {
                layerId: input.layerId,
                localId: input.localId ?? "",
                kind: input.kind,
                entryId: null,
                queued: false,
                coalescedInto: null,
                annulled: false,
                refused: "engineUnavailable",
            };
        }
        return edit.applyEdit(input);
    },

    /**
     * Does the layer grant this operation? — to consult BEFORE writing.
     *
     * 🛑 **It is SYNCHRONOUS AND ENGINE-LESS, deliberately.**
     * The permission is read from the active profile, not IndexedDB: routing it
     * through the `edit` bag (like {@link Storage.applyEdit}) would have made it
     * unavailable when the offline chunk is not loaded — i.e. **exactly** the case
     * that carried the hole, `@geoleaf-plugins/editor` declaring `requires: []` and
     * running in `persistence.mode: "online"` without this engine.
     *
     * ⚠️ **Does not replace `applyEdit`'s guard, it precedes it.** `applyEdit`
     * keeps refusing on its own account: a caller not consulting this predicate
     * bypasses nothing. Both apply `grantsEdition`, the same function.
     *
     * ⚠️ An unknown layer yields `false` — refuse the unknown, otherwise a typo in
     * an identifier would amount to authorisation.
     *
     * @param layerId - The layer identifier from the active profile.
     * @param kind - The submitted operation.
     * @returns `true` only when the layer literally grants this operation.
     * @example
     * if (GeoLeaf?.Storage?.mayEdit?.("reference-points", "delete")) {
     *     console.info("la couche accorde la suppression");
     * }
     */
    mayEdit(layerId: string, kind: "create" | "update" | "delete"): boolean {
        return mayEditLayer(layerId, kind);
    },

    /**
     * Drains the outbox: pushes every queued edit and reconciles server identities (4.5).
     *
     * ⚠️ **Runs in the PAGE, never in the Service Worker** — contract point 5. The
     * connector's `fetch` patch lives in the page; a replay from the worker does not
     * see it and would leave without a token. That is the motive that removed the
     * Background Sync path.
     *
     * Does not throw: a failing entry stays queued, `failed` not being terminal.
     *
     * @returns The drain tally; `refused` is non-null when the engine is not wired.
     * @example
     * const report = await GeoLeaf?.Storage?.pushOutbox?.();
     * console.info(report?.pushed, report?.failed);
     */
    async pushOutbox(): Promise<StoragePushReport> {
        const edit = this._modules.edit;
        if (!edit) {
            Log.warn("[GeoLeaf.Storage] pushOutbox — moteur hors-ligne non câblé.");
            return {
                attempted: 0,
                pushed: 0,
                failed: 0,
                alreadyPresent: 0,
                conflicts: 0,
                refused: "engineUnavailable",
            };
        }
        return edit.pushOutbox();
    },

    /**
     * Requeues a quarantined entry, when its cause is LIFTED.
     *
     * Reserved for motives whose cause can be observed as lifted —
     * `retryBudgetExhausted`, `layerNoLongerWritable` and `notImplementedByServer`.
     * The other two name a server fact no local gesture undoes: their exit is
     * {@link Storage.discardQuarantined}.
     *
     * @param id - The entry's contract identifier.
     * @returns `{ok}` and, on refusal, its motive.
     * @example
     * const out = await GeoLeaf?.Storage?.requeueQuarantined?.("create:sites:loc:abc:1");
     * if (!out?.ok) console.warn(out?.refused);
     */
    async requeueQuarantined(id: string): Promise<StorageQuarantineOutcome> {
        const edit = this._modules.edit;
        if (!edit) {
            Log.warn("[GeoLeaf.Storage] requeueQuarantined — moteur hors-ligne non câblé.");
            return { ok: false, refused: "engineUnavailable" };
        }
        return edit.requeueQuarantined(id);
    },

    /**
     * Destroys a quarantined entry, on EXPLICIT confirmation.
     *
     * 🛑 `confirmedLocalId` must be the entry's `localId` — a value the caller only
     * knows by having LISTED it. That is what makes it structurally true that the
     * capture was enumerated before being discarded, as `ServerDeletionPolicy`
     * requires since its amendment: what the contract forbids is the loss the
     * operator did not SEE.
     *
     * @param id - The entry's contract identifier.
     * @param confirmedLocalId - This entry's `localId`, as the caller read it.
     * @returns `{ok}` and, on refusal, its motive.
     * @example
     * const [e] = (await GeoLeaf?.Storage?.listPendingEdits?.()) ?? [];
     * if (e) await GeoLeaf?.Storage?.discardQuarantined?.(e.id, e.localId);
     */
    async discardQuarantined(
        id: string,
        confirmedLocalId: string
    ): Promise<StorageQuarantineOutcome> {
        const edit = this._modules.edit;
        if (!edit) {
            Log.warn("[GeoLeaf.Storage] discardQuarantined — moteur hors-ligne non câblé.");
            return { ok: false, refused: "engineUnavailable" };
        }
        return edit.discardQuarantined(id, confirmedLocalId);
    },

    /**
     * Reports, layer by layer, what offline really has at hand.
     *
     * 🛑 **The case it exists to make visible**: a layer declared offline but never
     * pulled. The contract describes it as "the case with no observable until the
     * outage" — everything works, until the field. It shows up here as
     * `declaredNeverPulled`.
     *
     * Never throws. With no engine wired, returns an **empty** array rather than a
     * reassuring report: a report saying "all is well" having read nothing would be
     * worse than no report, since it would believe itself complete.
     *
     * @returns One report per active-profile layer; empty when the engine is not wired.
     * @example
     * const report = await GeoLeaf?.Storage?.getSyncReport?.();
     * const jamais = report?.filter((r) => r.status === "declaredNeverPulled") ?? [];
     * if (jamais.length) console.warn("déclarées hors-ligne, jamais rapatriées :", jamais);
     */
    async getSyncReport(): Promise<readonly LayerSyncReport[]> {
        const report = this._modules.report;
        if (!report) {
            Log.warn("[GeoLeaf.Storage] getSyncReport — moteur hors-ligne non câblé.");
            return [];
        }
        return report.buildSyncReport();
    },

    /**
     * @returns `true` when offline — uses the OfflineDetector if present,
     * otherwise falls back to `navigator.onLine`.
     */
    isOffline(): boolean {
        return this.OfflineDetector ? !this.OfflineDetector.isOnline() : !navigator.onLine;
    },

    /**
     * Aggregate storage usage across IndexedDB and the cache manager.
     *
     * ⚠️ **`features` and `outbox` are counted since 03/08/2026.** This method read
     * only `layersCount` and `syncQueueCount` — the two v3 stores — so after a pull
     * of 27 entities it still reported 0, and `offline-ui` displayed that zero. Not
     * observable while `features` had no writer: the zero was TRUE. It became false
     * the day the pull landed.
     *
     * 🛑 **The `sync: { pending, failed }` block is REMOVED.** Its only source was
     * `syncQueueCount`, i.e. the v3 store nobody wrote any more: it reported `0` in
     * all circumstances, and `failed` was never assigned at all. The real tally of
     * owed writes is `outbox.count` above, and the per-state breakdown is
     * {@link StorageDB.getSyncCounts}, which yields `pendingCount` and
     * `quarantinedCount` per layer.
     *
     * @returns storage quota/usage, layer counts (total + per profile), entity/outbox counts,
     * cached profile ids and the online flag.
     * @remarks Never throws — errors are logged and partial stats returned.
     */
    async getStats(): Promise<{
        storage: { used: number; quota: number; percentage: number };
        layers: { count: number; byProfile: Record<string, number> };
        features: { count: number };
        outbox: { count: number };
        cache: { profiles: string[] };
        online: boolean;
    }> {
        const stats = {
            storage: { used: 0, quota: 0, percentage: 0 },
            layers: { count: 0, byProfile: {} as Record<string, number> },
            features: { count: 0 },
            outbox: { count: 0 },
            cache: { profiles: [] as string[] },
            online: true,
        };

        try {
            if (this.DB && this.DB.getStorageStats) {
                const dbStats = await this.DB.getStorageStats();
                stats.storage.used = dbStats.used;
                stats.storage.quota = dbStats.quota;
                stats.storage.percentage = dbStats.percentage;
                stats.layers.count = dbStats.layersCount ?? 0;
                stats.features.count = dbStats.featuresCount ?? 0;
                stats.outbox.count = dbStats.outboxCount ?? 0;
            }

            if (this.CacheManager) {
                const cachedProfiles = await this.CacheManager.listCachedProfiles();
                stats.cache.profiles = cachedProfiles;

                if (this.DB?.getLayersByProfile) {
                    for (const profileId of cachedProfiles) {
                        const layers = await this.DB.getLayersByProfile(profileId);
                        stats.layers.byProfile[profileId] = Array.isArray(layers)
                            ? layers.length
                            : 0;
                    }
                }
            }

            if (this.OfflineDetector?.isOnline) {
                stats.online = this.OfflineDetector.isOnline();
            }
        } catch (error) {
            Log.error(`[Storage] Failed to get stats: ${(error as Error).message}`);
        }

        return stats;
    },

    /**
     * Wipe every cached profile plus the `sync_queue`, `preferences` and
     * `metadata` IndexedDB stores.
     * @throws if the IndexedDB transaction fails.
     * @remarks Emits `geoleaf:storage:cleared` on success.
     */
    async clearAll(): Promise<void> {
        Log.warn("[Storage] Clearing all storage data...");

        try {
            if (this.CacheManager) {
                const profiles = await this.CacheManager.listCachedProfiles();
                for (const profileId of profiles) {
                    await this.CacheManager.clearProfile(profileId);
                }
            }

            const db = this.DB;
            if (db?._db && typeof db._db.transaction === "function") {
                // ⚠️ `sync_queue` used to be listed here; the store is removed, and
                // naming it in the transaction would make it THROW on a fresh
                // database. `features` and `outbox` stay deliberately absent: this
                // method's rule is to never destroy a field capture.
                const transaction = db._db.transaction(["preferences", "metadata"], "readwrite");

                transaction.objectStore("preferences").clear();
                transaction.objectStore("metadata").clear();

                await new Promise<void>((resolve, reject) => {
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                });
            }

            Log.info("[Storage] All storage data cleared");

            document.dispatchEvent(new CustomEvent("geoleaf:storage:cleared"));
        } catch (error) {
            Log.error(`[Storage] Failed to clear all: ${(error as Error).message}`);
            throw error;
        }
    },

    /**
     * Close the IndexedDB connection and tear down the offline detector.
     */
    close(): void {
        if (this.DB?.close) {
            this.DB.close();
        }

        if (this.OfflineDetector?.destroy) {
            this.OfflineDetector.destroy();
        }

        Log.info("[Storage] All connections closed");
    },

    /**
     * @param profileId - the profile to check.
     * @returns `true` if the profile is fully cached for offline use.
     */
    async isProfileAvailableOffline(profileId: string): Promise<boolean> {
        if (!this.isAvailable()) {
            return false;
        }

        return await this.CacheManager!.isProfileCached(profileId);
    },

    /**
     * @returns the ids of every profile currently available offline.
     */
    async getOfflineProfiles(): Promise<string[]> {
        if (!this.isAvailable()) {
            return [];
        }

        return await this.CacheManager!.listCachedProfiles();
    },
};

if (Log?.debug) {
    Log.debug("[Storage] Module loaded and ready");
}

// Mount the canonical public facade: GeoLeaf.Storage = { db, cache, cacheManager, init, … }.
// Single owner of this assignment; entry.ts injects the implementation modules via
// Storage.wireModules(). INV-FACADE: the facade is separate from the implementation modules.
_g.GeoLeaf.Storage = Storage;

StorageContract.init(Storage as unknown as Parameters<typeof StorageContract.init>[0]);

export { Storage };
