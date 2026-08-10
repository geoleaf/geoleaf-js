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
"use strict";

import { Log } from "../../utils/log/index.js";
import type { IModuleAccessFn } from "../../contracts/api.contract.ts";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";

ensureGeoLeaf();

/**
 * Factory manager for multi-map support.
 */
class APIFactoryManager {
    isReady: boolean;
    mapInstances: Map<string, unknown>;
    stats: { mapsCreated: number; errors: number };
    getModule: IModuleAccessFn | null;

    constructor() {
        this.isReady = true;
        this.mapInstances = new Map();
        this.stats = {
            mapsCreated: 0,
            errors: 0,
        };
        this.getModule = null;
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

            const mapInstance = Core.init(mapOptions);

            if (mapInstance) {
                this.mapInstances.set(targetId, mapInstance);
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
     * Returns a map instance by id.
     * @param {string} targetId - Target element id
     * @returns {*} Map instance, or null
     */
    getMapInstance(targetId: string) {
        return this.mapInstances.get(targetId) || null;
    }

    /**
     * Returns all map instances.
     * @returns {Array} List of instances
     */
    getAllMapInstances() {
        return Array.from(this.mapInstances.values());
    }

    /**
     * Removes a map instance by id.
     * @param {string} targetId - Target element id
     * @returns {boolean} Removal success flag
     */
    removeMapInstance(targetId: string) {
        if (!this.mapInstances.has(targetId)) {
            if (Log) Log.warn(`[APIFactoryManager] No map instance found for: ${targetId}`);
            return false;
        }
        this.mapInstances.delete(targetId);
        if (Log) Log.info(`[APIFactoryManager] Map instance removed for: ${targetId}`);
        return true;
    }

    /**
     * Returns the manager statistics.
     */
    getStats() {
        return {
            ...this.stats,
            activeInstances: this.mapInstances.size,
            isReady: this.isReady,
        };
    }

    /**
     * Resets the manager.
     */
    reset() {
        this.mapInstances.clear();
        this.getModule = null;
        this.stats = {
            mapsCreated: 0,
            errors: 0,
        };

        if (Log) Log.info("[APIFactoryManager] Manager reset");
    }
}

export { APIFactoryManager };
