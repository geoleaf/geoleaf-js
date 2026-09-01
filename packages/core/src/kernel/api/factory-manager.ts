/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * API Factory Manager
 * Manager for multi-map instance creation.
 */

import { Log } from "../../utils/log/index.js";
import type { IModuleAccessFn } from "../../contracts/api.contract.ts";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";

ensureGeoLeaf();

/**
 * The map registry, as this manager reaches it — `GeoLeaf.Core`, and nothing else.
 *
 * Deliberately structural and reached through `getModule`, never imported: the
 * `kernel/api → kernel/map` edge is INVERTED on purpose, and an import here would
 * quietly re-establish it.
 */
interface CoreRegistryLike {
    getMap(mapId?: string): unknown;
    listMaps(): string[];
    hasMap(mapId: string): boolean;
    destroy(mapId: string): boolean;
}

/**
 * Factory manager for multi-map support.
 *
 * ⚠️ It holds NO registry of its own, and that is the point. It used to keep a
 * `mapInstances` map alongside the one `Core` already owns, filled only by its own
 * `createMap()` with the very `IMapAdapter` that `Core.getMap()` returns — a mirror,
 * not a second source of truth. `Core.destroy()` purged one of the two, so
 * `GeoLeaf.getMap()` and `GeoLeaf.Core.getMap()` could disagree — measured once.
 *
 * The fix is subtraction: every accessor delegates, so there is nothing left to keep
 * in sync. Measured before removing it — no production caller ever reached
 * `GeoLeaf.createMap()` (boot uses its own local `createMap` in
 * `app/boot-modules/core-map-lifecycle.ts`), so the mirror was never even populated:
 * `GeoLeaf.getMap()` returned `null` for every live map. This is a simplification
 * that happens to restore two published members, not a leak being patched.
 */
class APIFactoryManager {
    isReady: boolean;
    stats: { mapsCreated: number; errors: number };
    getModule: IModuleAccessFn | null;

    constructor() {
        this.isReady = true;
        this.stats = {
            mapsCreated: 0,
            errors: 0,
        };
        this.getModule = null;
    }

    /**
     * The `Core` registry, or `null` before {@link APIFactoryManager.init} has run.
     *
     * @returns The `Core` façade, or `null` when no module access is wired yet.
     */
    private _registry(): CoreRegistryLike | null {
        if (!this.getModule) return null;
        const Core = this.getModule("Core") as CoreRegistryLike | null;
        return Core && typeof Core.getMap === "function" ? Core : null;
    }

    /**
     * Initialises the manager with the module access function.
     * @param {Function} getModule - Module access function
     * @returns {boolean} Success flag
     */
    init(getModule: IModuleAccessFn) {
        try {
            if (!getModule || typeof getModule !== "function") {
                throw new Error("getModule function is required");
            }

            this.getModule = getModule;

            if (Log) Log.info("[APIFactoryManager] Factory manager initialized");
            return true;
        } catch (error) {
            this.stats.errors++;
            if (Log) Log.error("[APIFactoryManager] Initialization failed:", error);
            return false;
        }
    }

    /**
     * Creates a new map instance.
     * @param {string} targetId - Target element id
     * @param {Object} options - Configuration options
     * @param {Function} getModule - Module access function
     * @returns {*} Map instance, or null
     */
    createMap(targetId: string, options: Record<string, unknown>, getModule: IModuleAccessFn) {
        try {
            this.stats.mapsCreated++;

            if (!targetId) {
                throw new Error("Target ID is required");
            }

            const Core = getModule("Core") as {
                init?: (opts: Record<string, unknown>) => unknown;
            } | null;
            if (!Core || typeof Core.init !== "function") {
                throw new Error("Core module not available for map creation");
            }

            // Create the map with the provided options
            const mapOptions = {
                target: targetId,
                ...options,
            };

            // `Core.init()` registers the adapter in the one registry there is. Nothing
            // to mirror here — see the class docblock.
            const mapInstance = Core.init(mapOptions);

            if (mapInstance) {
                if (Log) Log.info(`[APIFactoryManager] Map created for target: ${targetId}`);
            }

            return mapInstance;
        } catch (error) {
            this.stats.errors++;
            if (Log) Log.error(`[APIFactoryManager] Failed to create map for ${targetId}:`, error);
            return null;
        }
    }

    /**
     * Returns a map instance by id, read from the `Core` registry.
     *
     * @param targetId - Target element id.
     * @returns The registered `IMapAdapter`, or `null` when there is none (or when
     *   the manager has not been initialised yet).
     */
    getMapInstance(targetId: string) {
        return this._registry()?.getMap(targetId) ?? null;
    }

    /**
     * Returns every live map instance, read from the `Core` registry.
     *
     * @returns The registered adapters, in registration order; `[]` when there is
     *   none (or when the manager has not been initialised yet).
     */
    getAllMapInstances() {
        const registry = this._registry();
        if (!registry) return [];
        return registry
            .listMaps()
            .map((id) => registry.getMap(id))
            .filter((m) => m != null);
    }

    /**
     * Destroys a map instance by id.
     *
     * ⚠️ It now DESTROYS, where it used to drop a mirror entry and leave the real map
     * running — that discrepancy was half of the measured disagreement. No production caller reached it
     * (measured 14/08/2026: definition and unit tests only), so nothing depended on
     * the old, weaker meaning.
     *
     * @param targetId - Target element id.
     * @returns `true` when an instance was found and destroyed, `false` otherwise.
     */
    removeMapInstance(targetId: string) {
        const registry = this._registry();
        if (!registry || !registry.hasMap(targetId)) {
            if (Log) Log.warn(`[APIFactoryManager] No map instance found for: ${targetId}`);
            return false;
        }
        const removed = registry.destroy(targetId);
        if (removed && Log) Log.info(`[APIFactoryManager] Map instance removed for: ${targetId}`);
        return removed;
    }

    /**
     * Returns the manager statistics.
     *
     * `activeInstances` counts what `Core` holds — this manager counts nothing of its
     * own. ⚠️ It is NOT on the `GeoLeaf.getHealth()` path: that one reads
     * `APIController.healthStatus` and never calls in here (measured 14/08/2026, against
     * a roadmap note claiming the opposite).
     */
    getStats() {
        return {
            ...this.stats,
            activeInstances: this._registry()?.listMaps().length ?? 0,
            isReady: this.isReady,
        };
    }

    /**
     * Resets the manager.
     *
     * Resets ITS OWN state only — counters and module access. It does not destroy live
     * maps, and never did: it used to clear a mirror, which left every real map running.
     */
    reset() {
        this.getModule = null;
        this.stats = {
            mapsCreated: 0,
            errors: 0,
        };

        if (Log) Log.info("[APIFactoryManager] Manager reset");
    }
}

export { APIFactoryManager };
