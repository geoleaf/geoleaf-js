/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * API Module Manager
 * Centralised access manager for GeoLeaf modules.
 */

import { Log } from "../../utils/log/index.js";
import { MODULE_CATALOG } from "./module-catalog.js";
import { ensureGeoLeaf, getGeoLeaf } from "../../utils/general/geoleaf-global.js";

// Guarantee the global GeoLeaf namespace exists at import; read it fresh via getGeoLeaf().
ensureGeoLeaf();

interface IModuleManagerStats {
    totalModules: number;
    accessCount: number;
    errors: number;
}

/**
 * Centralised access manager for GeoLeaf modules.
 */
class APIModuleManager {
    modules: Map<string, unknown>;
    aliases: Map<string, string>;
    isInitialized: boolean;
    stats: IModuleManagerStats;

    constructor() {
        this.modules = new Map();
        this.aliases = new Map();
        this.isInitialized = false;
        this.stats = {
            totalModules: 0,
            accessCount: 0,
            errors: 0,
        };
    }

    /**
     * Initialises the manager with existing modules.
     * @returns Initialisation success flag
     */
    init(): boolean {
        try {
            if (this.isInitialized) {
                if (Log) Log.debug("[APIModuleManager] Already initialized");
                return true;
            }

            if (Log) Log.info("[APIModuleManager] Initializing module manager");

            // Scan every module available in the GeoLeaf namespace
            this._scanExistingModules();

            // Set up compatibility aliases
            this._setupAliases();

            this.isInitialized = true;

            if (Log)
                Log.info(`[APIModuleManager] Initialized with ${this.stats.totalModules} modules`);
            return true;
        } catch (error) {
            this.stats.errors++;
            if (Log) Log.error("[APIModuleManager] Initialization failed:", error);
            return false;
        }
    }

    /** Scans the existing GeoLeaf namespace and populates the module cache. */
    private _scanExistingModules(): void {
        const gl = getGeoLeaf();
        if (!gl) return;

        // API publique S4.3f — catalogue DÉCLARATIF, plus un balayage de préfixe.
        //
        // L'ancien code faisait `Object.keys(gl).forEach(k => k.startsWith("_") && gl[k])` :
        // il ne découvrait pas des modules, il copiait tout ce qui commence par un underscore
        // — dont un accesseur qu'il DÉCLENCHAIT, `_APIController`, en pleine construction de
        // l'`APIController` qui l'appelle. Voir `controller.ts:331-340` pour le récit de la
        // récursion que ça produisait en navigateur.
        for (const name of MODULE_CATALOG) {
            // Politique d'accesseur : on enregistre le NOM, on ne lit JAMAIS la valeur.
            // `getOwnPropertyDescriptor` ne déclenche pas le getter — c'est tout l'intérêt.
            // Un accesseur reste atteignable par `getModule()`, dont le repli lira `gl[name]`
            // à un moment où l'objet est construit.
            const descriptor = Object.getOwnPropertyDescriptor(gl, name);
            if (!descriptor || typeof descriptor.get === "function") continue;

            // Garde de valeur falsy. ⚠️ Elle ne couvre PAS `POI`, `Route` ni `Constants` :
            // ces trois-là ne sont pas montés du tout, donc `getOwnPropertyDescriptor` rend
            // `undefined` et le `!descriptor` ci-dessus les a déjà écartés. (La première
            // rédaction de ce commentaire affirmait le contraire ; la sonde de rougissement
            // ne l'a pas confirmé, et c'est comme ça qu'on l'a su.)
            //
            // Ce qu'elle couvre réellement : une clé PRÉSENTE mais falsy — `_gl.X = undefined`
            // crée bien une propriété propre. C'est le comportement de l'ancien `if (gl[name])`
            // sur ce cas, conservé à l'identique : une façade qui s'est posée à `undefined`
            // n'est pas un module utilisable, et la mettre en cache la rendrait indiscernable
            // d'une façade réelle pour `hasModule`.
            if (!descriptor.value) continue;

            if (!this.modules.has(name)) {
                this.modules.set(name, descriptor.value);
                this.stats.totalModules++;
            }
        }
    }

    /** Sets up backwards-compatibility aliases between module names. */
    private _setupAliases(): void {
        const aliases = {
            Baselayers: "BaseLayers",
            BaseLayers: "Baselayers",
            Logger: "Log",
            Log: "Logger",
        };

        Object.entries(aliases).forEach(([alias, target]) => {
            if (this.modules.has(target)) {
                this.aliases.set(alias, target);
            }
        });
    }

    /**
     * Returns a module by name, or `null` if not found.
     * @param name - Module key (e.g. `'Core'`, `'POI'`)
     */
    getModule(name: string): unknown {
        try {
            this.stats.accessCount++;

            if (!name || typeof name !== "string") {
                Log?.warn(`[APIModuleManager] Invalid module name:`, name);
                this.stats.errors++;
                return null;
            }

            // Recherche directe
            if (this.modules.has(name)) {
                return this.modules.get(name);
            }

            // Alias lookup
            if (this.aliases.has(name)) {
                const targetName = this.aliases.get(name)!;
                return this.modules.get(targetName) ?? null;
            }

            // Fallback to direct global access
            // Recherche par nom calculé — cf. B-13 : `GeoLeafGlobal` n'a plus de traîne.
            const gl = getGeoLeaf() as unknown as Record<string, unknown> | null;
            if (gl && gl[name]) {
                // Cache it for subsequent lookups
                this.modules.set(name, gl[name]);
                this.stats.totalModules++;
                return gl[name];
            }

            // Module not found
            Log?.debug(`[APIModuleManager] Module '${name}' not found`);
            return null;
        } catch (error) {
            this.stats.errors++;
            Log?.error(`[APIModuleManager] Error accessing module '${name}':`, error);
            return null;
        }
    }

    /**
     * Manually registers a module in the cache.
     * @param name - Module key
     * @param module - Module instance
     */
    registerModule(name: string, module: unknown): boolean {
        try {
            if (!name || typeof name !== "string") {
                throw new Error("Module name must be a non-empty string");
            }

            if (!module) {
                throw new Error("Module cannot be null or undefined");
            }

            this.modules.set(name, module);
            this.stats.totalModules++;

            if (Log) Log.debug(`[APIModuleManager] Module '${name}' registered`);
            return true;
        } catch (error) {
            this.stats.errors++;
            if (Log) Log.error(`[APIModuleManager] Failed to register module '${name}':`, error);
            return false;
        }
    }

    /**
     * Returns `true` if a module is available by that name.
     * @param name - Module key
     */
    hasModule(name: string): boolean {
        try {
            // Recherche par nom calculé — cf. B-13 : `GeoLeafGlobal` n'a plus de traîne.
            const gl = getGeoLeaf() as unknown as Record<string, unknown> | null;
            return this.modules.has(name) || this.aliases.has(name) || !!gl?.[name];
        } catch (error) {
            if (Log) Log.error(`[APIModuleManager] Error checking module '${name}':`, error);
            return false;
        }
    }

    /** Returns a sorted list of all known module names. */
    getModuleList(): string[] {
        // Perf 6.3.2: O(n) via Set instead of O(n²) via Array.includes() in forEach loop
        const moduleNameSet = new Set(this.modules.keys());

        // Add namespace members not yet cached
        const gl = getGeoLeaf();
        if (gl) {
            Object.keys(gl).forEach((key) => {
                moduleNameSet.add(key);
            });
        }

        return Array.from(moduleNameSet).sort();
    }

    /** Returns usage statistics for this manager. */
    getStats(): IModuleManagerStats & {
        cachedModules: number;
        aliases: number;
        isInitialized: boolean;
    } {
        return {
            ...this.stats,
            cachedModules: this.modules.size,
            aliases: this.aliases.size,
            isInitialized: this.isInitialized,
        };
    }

    /** Clears and repopulates the module cache from the GeoLeaf namespace. */
    refresh(): void {
        if (Log) Log.info("[APIModuleManager] Refreshing module cache");

        this.modules.clear();
        this.aliases.clear();
        this.stats.totalModules = 0;

        this._scanExistingModules();
        this._setupAliases();
    }

    /** Resets the manager to its initial state. */
    reset(): void {
        this.modules.clear();
        this.aliases.clear();
        this.isInitialized = false;
        this.stats = {
            totalModules: 0,
            accessCount: 0,
            errors: 0,
        };

        if (Log) Log.info("[APIModuleManager] Manager reset");
    }
}

export { APIModuleManager };
