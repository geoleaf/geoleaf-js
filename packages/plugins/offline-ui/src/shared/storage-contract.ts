/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Typed adapter over the core's `GeoLeaf.Storage` facade.
 *
 * `@geoleaf/core` deliberately types its Storage facade loosely (`DB: any`,
 * `CacheManager`/`Cache`: `unknown`) so the kernel never couples to the optional
 * plugin. The **plugin is the source of truth** for the concrete shape of its own
 * facade: it exposes it here through the `StorageContractShape` declared below.
 *
 * All plugin consumers import `StorageContract` from THIS file so member access / calls are
 * type-safe and the `no-unsafe-*` gate stays green.
 *
 * ## ⚠️ Public-API review — it no longer RE-EXPORTS, it ADAPTS
 *
 * This file did `import { StorageContract as _Core } from
 * "@core/shared/storage-contract.js"` then a cast. The comment asserted "runtime
 * object is unchanged (same core singleton)". **That was false in the published
 * package.**
 *
 * `StorageContract` is a singleton whose state (`_storageRef`) is a module-scoped
 * `let`, initialised by the CORE (`kernel/storage/facade.ts`). A plugin loaded as
 * `<script type="module">` has its OWN module graph: it cannot share that `let`.
 * The import therefore embedded a SECOND, never-initialised instance —
 * `isAvailable()` returned `false` forever and `whenReady()` never resolved. All
 * the offline UI going through `ensureEngineReady()` was dead at runtime in the
 * shipped bundle.
 *
 * The adapter reads `globalThis.GeoLeaf.Storage` — the core's facade, the only
 * instance by construction. The 8 consumer files do not change by a line: they
 * still import `StorageContract` from here, with the same shape.
 */

import { getGeoLeaf } from "@geoleaf/host-runtime";

/** The core namespace, or `undefined` before boot. */
function _gl(): Record<string, unknown> | undefined {
    // `@geoleaf/host-runtime`'s canonical accessor rather than a local
    // `globalThis as { GeoLeaf?: … }`: it is exactly what that package exists to
    // replace, and the local form is no longer convertible under
    // `exactOptionalPropertyTypes` (the namespace is declared PRESENT carrying
    // `undefined`, which a `GeoLeaf?:` does not accept).
    return getGeoLeaf() as Record<string, unknown> | undefined;
}

/** The `GeoLeaf.Storage` facade, or `undefined` when the core is not there. */
function _storage(): Record<string, unknown> | undefined {
    return _gl()?.["Storage"] as Record<string, unknown> | undefined;
}

/** An edit still owed to the server, as `listPendingEdits()` returns it. */
export interface PendingEdit {
    entryId: string;
    kind: string;
    layerId: string;
    localId: string;
    state: string;
    createdAt: number;
    /** The edited entity, or `null` when the store no longer carries it. */
    feature: unknown;
}

/**
 * IndexedDB layer surface (`Storage.DB`) reached through the contract.
 *
 * 🛑 **The four `sync_queue` members and `getBackups` are REMOVED.** The previous
 * version of this sentence said they "STAY", because `addpoi`'s backup module
 * still restored its backups through that queue — true on the morning of 04/08.
 * It is deleted with the whole chain, and **none of the five members was called
 * from this package**: they declared a surface nobody took, which is precisely
 * the "fiction of the global" root cause no. 1 describes.
 */
export interface StorageContractDB {
    /**
     * A database sub-module, by its registry name — `"Routes"`, `"Outbox"`…
     *
     * ⚠️ **Declared here rather than cast at the caller.** The facade injects the
     * ENTIRE engine (`db: IndexedDB`), so this member really exists; omitting it
     * from the contract forced every consumer into a double cast — which the
     * non-null-assertion ratchet refuses, rightly: a repeated `as unknown as` is
     * a declaration written N times instead of once, diverging N times.
     *
     * ⚠️ The `_` prefix comes from the core and is not adopted by convention:
     * `editor` reads the `outbox` this way. It is the only route the facade
     * offers to a sub-module.
     *
     * @param name The module's registry name.
     * @returns Its API, or `null` when the engine is not ready or the name unknown.
     */
    _ensureModule?(name: string): Record<string, unknown> | null;
    /** The captures still owed to the server, joined to their entity. */
    listPendingEdits(): Promise<PendingEdit[]>;
    /** Removes the `synced` entities (the cache), never the outbox. */
    purgeCachedFeatures(): Promise<{ removed: number; preserved: number }>;
}

/** CacheAPI manager surface (`Storage.CacheManager`). */
export interface StorageContractCacheManager {
    cacheProfile(profileId: string, opts?: unknown): Promise<unknown>;
    clearCache(profileId: string): Promise<number>;
    getCacheStatus(profileId: string): Promise<unknown>;
    getStorageQuota(): Promise<{ usage: number; quota: number; percentage: number }>;
    cancelDownload(): void;
}

/** Layer-selection persistence surface (`Storage.Cache.Storage`). */
export interface StorageContractCacheStorage {
    loadLayerSelection(profileId: string): Promise<Record<string, unknown> | null>;
    saveLayerSelection(profileId: string, selection: unknown): Promise<void>;
}

/** Cache-icon / selection refresher surface (`Storage.Cache.LayerSelector`). */
export interface StorageContractLayerSelector {
    refreshCacheIcons(): Promise<void>;
    saveSelection?(): Promise<void>;
    updateWarning?(): Promise<void>;
}

/** Cache namespace (`Storage.Cache`). */
export interface StorageContractCache {
    Storage: StorageContractCacheStorage;
    LayerSelector: StorageContractLayerSelector;
}

/**
 * Rich, plugin-owned view of the Storage contract singleton. `DB` / `CacheManager`
 * / `Cache` are typed non-nullable: consumers guard availability at runtime via
 * `isAvailable()` / `isPluginLoaded()` before dereferencing.
 */
export interface StorageContractShape {
    init(storage: unknown): void;
    isAvailable(): boolean;
    isPluginLoaded(): boolean;
    /**
     * Resolves once the in-core offline engine is loaded and initialised (IndexedDB
     * open). UI actions await this so they defer until the engine is ready; it stays
     * pending while `modules.offline` is disabled (the engine never loads).
     */
    whenReady(): Promise<void>;
    /**
     * The facade's aggregated tallies.
     *
     * ⚠️ `features` and `outbox` were not filled originally: the facade counted
     * only the v3 stores, so after a pull of 27 entities it reported 0 — and this
     * panel displayed that zero.
     *
     * 🛑 The `sync: { pending, failed }` block is removed: its only source was
     * the v3 store's counter, so it was 0 in all circumstances. Declaring it here
     * would be exactly the fiction this file exists to remove.
     */
    getStats(): Promise<{
        features?: { count: number };
        outbox?: { count: number };
        layers?: { count: number };
    }>;
    readonly DB: StorageContractDB;
    readonly CacheManager: StorageContractCacheManager;
    readonly Cache: StorageContractCache;
}

/**
 * The core's Storage facade, seen through the plugin's types.
 *
 * ⚠️ Accesses are ACCESSORS, not captured values: `GeoLeaf.Storage` does not
 * exist yet when this module evaluates (the plugin loads before `boot()`), and
 * its `DB` / `CacheManager` / `Cache` members are themselves getters on the core
 * side, changing when the engine initialises. Freezing one at import would give
 * `undefined` forever.
 */
export const StorageContract = {
    get DB() {
        return _storage()?.["DB"];
    },
    get CacheManager() {
        return _storage()?.["CacheManager"];
    },
    get Cache() {
        return _storage()?.["Cache"];
    },
    isAvailable(): boolean {
        return (_storage()?.["isAvailable"] as (() => boolean) | undefined)?.() === true;
    },
    isPluginLoaded(): boolean {
        return (_storage()?.["isPluginLoaded"] as (() => boolean) | undefined)?.() === true;
    },
    getStats(): Promise<Record<string, unknown>> {
        const fn = _storage()?.["getStats"] as (() => Promise<Record<string, unknown>>) | undefined;
        // A panel that cannot count displays zero rather than refusing to open;
        // the facade itself never throws, we keep the same promise here.
        return fn ? fn.call(_storage()) : Promise.resolve({});
    },
    whenReady(): Promise<void> {
        const fn = _storage()?.["whenReady"] as (() => Promise<void>) | undefined;
        // Without the core, we never resolve — same semantics as the contract,
        // which does not resolve until the engine announced itself ready.
        // Resolving here would make the UI believe itself ready on an absent
        // engine.
        return fn ? fn() : new Promise<void>(() => {});
    },
} as unknown as StorageContractShape;
