/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * API Controller
 * Main orchestrator for GeoLeaf API operations.
 */

import { Log } from "../../utils/log/index.js";
import { ensureGeoLeaf, getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import type {
    IModuleAccessFn,
    IControllerHealthStatus,
    IAPIManagerRecord,
} from "../../contracts/api.contract.ts";

// Guarantee the global GeoLeaf namespace exists at import (used below to mount the
// `_APIController` accessor); runtime reads go through getGeoLeaf() for a fresh view.
const gl = ensureGeoLeaf();

/**
 * Main orchestrator for GeoLeaf API operations.
 * Manages the lifecycle of the module, initialisation, and factory managers.
 */
class APIController {
    isInitialized: boolean;
    managers: IAPIManagerRecord;
    moduleAccessFn: IModuleAccessFn | null;
    healthStatus: IControllerHealthStatus;

    constructor() {
        this.isInitialized = false;
        this.managers = {} as IAPIManagerRecord;
        this.moduleAccessFn = null;

        // Controller health state
        this.healthStatus = {
            managers: 0,
            errors: [],
            lastUpdate: null,
        };
    }

    /**
     * Initialises the controller and all its managers.
     * @returns Initialisation success flag
     */
    init(): boolean {
        try {
            if (this.isInitialized) {
                if (Log) Log.debug("[APIController] Already initialized");
                return true;
            }

            if (Log) Log.info("[APIController] Initializing API controller (Sprint 4.3 - Robust)");

            // Initialise the managers in order
            this._initializeManagers();

            // Configure module access
            const success = this._setupModuleAccess();
            if (!success) {
                throw new Error("Module access setup failed");
            }

            // Hand module access to the factory. It has to happen HERE and not in
            // `_initializeManagers()`: `moduleAccessFn` does not exist until
            // `_setupModuleAccess()` has run. Without this call the factory keeps
            // `getModule === null` — which is what it did until S6.3, so its accessors
            // now read `Core` through a function nobody had ever given it.
            //
            // Guarded, and not out of politeness: the manager classes are resolved by
            // NAME off `GeoLeaf.API` (`_getManagerClass`), so what lands here is
            // whatever the namespace holds. A factory predating this call must not take
            // the whole controller — hence the whole public API — down with it.
            const access = this.moduleAccessFn;
            if (access && typeof this.managers.factory?.init === "function") {
                this.managers.factory.init(access);
            } else if (this.managers.factory) {
                if (Log)
                    Log.warn(
                        "[APIController] factory manager has no init() — it will run without " +
                            "module access, and GeoLeaf.getMap/getAllMaps will read nothing"
                    );
            }

            // Validate the final state
            this._validateInitialization();

            this.isInitialized = true;
            this.healthStatus.lastUpdate = new Date().toISOString();

            if (Log) Log.info("[APIController] API controller initialized successfully");
            return true;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.healthStatus.errors.push({
                message: err.message,
                timestamp: new Date().toISOString(),
                ...(err.stack !== undefined && { stack: err.stack }),
            });

            if (Log) Log.error("[APIController] Initialization failed:", error);
            return false;
        }
    }

    /** Instantiates all configured managers from the GeoLeaf.API namespace. */
    private _initializeManagers(): void {
        const managerTypes: Array<keyof IAPIManagerRecord> = [
            "module",
            "initialization",
            "factory",
        ];

        managerTypes.forEach((type) => {
            const ManagerClass = this._getManagerClass(type);
            if (ManagerClass) {
                try {
                    // Dynamic-key write: the indexed target widens to the intersection of
                    // all manager shapes, so write through a permissive record view. The
                    // concrete class matches `type` by construction (see `_getManagerClass`).
                    (this.managers as Record<string, unknown>)[type] = new ManagerClass();
                    this.healthStatus.managers++;
                    if (Log) Log.debug(`[APIController] ${type} manager loaded`);
                } catch (error) {
                    if (Log) Log.warn(`[APIController] Failed to load ${type} manager:`, error);
                    this.healthStatus.errors.push({
                        manager: type,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        });

        if (Log) Log.info(`[APIController] Loaded ${this.healthStatus.managers} managers`);
    }

    /**
     * Resolves a manager constructor by type key.
     * @private
     */

    private _getManagerClass(type: keyof IAPIManagerRecord): (new () => unknown) | null {
        const classNames: Record<keyof IAPIManagerRecord, string> = {
            module: "APIModuleManager",
            initialization: "APIInitializationManager",
            factory: "APIFactoryManager",
        };

        const className = classNames[type];
        const api = getGeoLeaf()?.API as
            Record<string, (new () => unknown) | undefined> | undefined;
        return api && api[className] ? (api[className] as new () => unknown) : null;
    }

    /** Configures the module access function using the module manager. */
    private _setupModuleAccess(): boolean {
        // The module manager must be initialised first
        if (!this.managers.module) {
            if (Log) Log.error("[APIController] Module manager not available");
            return false;
        }

        // Initialise the module manager with existing modules
        const initSuccess = this.managers.module.init ? this.managers.module.init() : true;
        if (!initSuccess) {
            if (Log) Log.error("[APIController] Module manager initialization failed");
            return false;
        }

        // Build the validated module access function
        this.moduleAccessFn = (name) => {
            try {
                if (!name || typeof name !== "string") {
                    if (Log) Log.warn("[APIController] Invalid module name:", name);
                    return null;
                }

                if (this.managers.module && typeof this.managers.module.getModule === "function") {
                    return this.managers.module.getModule(name);
                }

                // Fallback to global access
                // Recherche par nom calculé — cf. B-13 : `GeoLeafGlobal` n'a plus de traîne.
                const nsp = getGeoLeaf() as unknown as Record<string, unknown> | null;
                if (nsp && nsp[name]) {
                    return nsp[name];
                }

                return null;
            } catch (error) {
                if (Log) Log.warn(`[APIController] Error accessing module ${name}:`, error);
                return null;
            }
        };

        if (Log) Log.info("[APIController] Module access configured");
        return true;
    }

    /** Validates the controller is fully initialised before it is marked ready. */
    private _validateInitialization(): void {
        const checks = [
            { name: "moduleAccessFn", value: this.moduleAccessFn, type: "function" },
            { name: "managers", value: this.managers, type: "object" },
            { name: "moduleManager", value: this.managers.module, type: "object" },
        ];

        const failures = checks.filter((check) => {
            return !check.value || typeof check.value !== check.type;
        });

        if (failures.length > 0) {
            const failureNames = failures.map((f) => f.name).join(", ");
            throw new Error(`Validation failed for: ${failureNames}`);
        }

        if (Log) Log.debug("[APIController] Validation passed");
    }

    /**
     * Delegates `GeoLeaf.init()` to the initialisation manager.
     * @param options - Raw init options
     */
    geoleafInit(options: Record<string, unknown>): unknown {
        if (!this._ensureInitialized()) return null;

        try {
            if (!this.managers.initialization) {
                throw new Error("Initialization manager not available");
            }

            return this.managers.initialization.init(options, this.moduleAccessFn!);
        } catch (error) {
            if (Log) Log.error("[APIController] geoleafInit failed:", error);
            return null;
        }
    }

    /**
     * Delegates `GeoLeaf.loadConfig()` to the initialisation manager.
     * @param input - URL string or config object
     */
    geoleafLoadConfig(input: string | Record<string, unknown>): Promise<unknown> {
        if (!this._ensureInitialized()) return Promise.resolve(null);

        try {
            if (!this.managers.initialization) {
                throw new Error("Initialization manager not available");
            }

            return this.managers.initialization.loadConfig(input, this.moduleAccessFn!);
        } catch (error) {
            if (Log) Log.error("[APIController] geoleafLoadConfig failed:", error);
            return Promise.resolve(null);
        }
    }

    /**
     * Delegates `GeoLeaf.setTheme()` to the initialisation manager.
     * @param theme - Theme identifier
     */
    geoleafSetTheme(theme: string): boolean {
        if (!this._ensureInitialized()) return false;

        try {
            if (!this.managers.initialization) {
                throw new Error("Initialization manager not available");
            }

            return Boolean(this.managers.initialization.setTheme(theme, this.moduleAccessFn!));
        } catch (error) {
            if (Log) Log.error("[APIController] geoleafSetTheme failed:", error);
            return false;
        }
    }

    /**
     * Delegates `GeoLeaf.createMap()` to the factory manager.
     * @param targetId - DOM element id for the new map
     * @param options - Map creation options
     */
    geoleafCreateMap(targetId: string, options?: Record<string, unknown>): unknown {
        if (!this._ensureInitialized()) return null;

        try {
            if (!this.managers.factory) {
                throw new Error("Factory manager not available");
            }

            return this.managers.factory.createMap(targetId, options ?? {}, this.moduleAccessFn!);
        } catch (error) {
            if (Log) Log.error("[APIController] geoleafCreateMap failed:", error);
            return null;
        }
    }

    /** Returns `false` and logs an error if the controller has not been initialised. */
    private _ensureInitialized(): boolean {
        if (!this.isInitialized) {
            if (Log) Log.error("[APIController] Controller not initialized");
            return false;
        }
        return true;
    }

    /** Returns the current health status of the controller. */
    getHealthStatus(): IControllerHealthStatus & {
        isInitialized: boolean;
        managersCount: number;
        hasModuleAccess: boolean;
    } {
        return {
            ...this.healthStatus,
            isInitialized: this.isInitialized,
            managersCount: Object.keys(this.managers).length,
            hasModuleAccess: !!this.moduleAccessFn,
        };
    }

    /** Resets the controller to its initial uninitialised state. */
    reset(): void {
        this.isInitialized = false;
        this.managers = {} as IAPIManagerRecord;
        this.moduleAccessFn = null;
        this.healthStatus = {
            managers: 0,
            errors: [],
            lastUpdate: null,
        };

        if (Log) Log.info("[APIController] Controller reset");
    }
}

// perf 5.9 : Lazy instantiation — created on first access via getter
// (avoids costly synchronous _initializeManagers on import)
let _apiControllerInstance: APIController | null = null;

function _getAPIController(): APIController {
    if (_apiControllerInstance) return _apiControllerInstance;

    // S6 Lot 3 — the rustine is gone.
    //
    // This used to run `runModuleSetup("security"/"config"/"api")` before building the
    // controller: a local compensation for S1.3 (micro-core), which had made those setups
    // lazy while `boot-core.ts` still calls `loadConfig()` — which needs `GeoLeaf.Config.init`
    // and the `GeoLeaf.API.*` manager classes — BEFORE `registry.init()`. Phase A (Lot 2) posts
    // every kernel facade at import, so by the time anything reads this accessor the chain it
    // used to force is already in place. Re-running it here would be dead weight.
    const instance = new APIController();

    // Park the instance BEFORE init() — this is a RE-ENTRANCY GUARD, not sloppy ordering.
    //
    // `init()` → `_setupModuleAccess()` → `APIModuleManager.init()` → `_scanExistingModules()`,
    // which USED TO do `Object.keys(gl).forEach(k => k.startsWith("_") && gl[k])`.
    // `_APIController` starts with `_` and is `enumerable: true`, so that scan READ this very
    // accessor while we were still inside init(). With the slot still null, the read re-entered
    // here and built another controller — recursively, until the stack blew. (Verified:
    // removing this ordering produced an infinite recursion through `_scanExistingModules` in
    // the browser, caught by `scripts/probe-boot-contract.mjs`.)
    //
    // ⚠️ API publique S4.3f — le balayage de préfixe a été remplacé par un catalogue
    // déclaratif (`kernel/api/module-catalog.ts`) qui applique une POLITIQUE D'ACCESSEUR :
    // il lit `getOwnPropertyDescriptor` et saute toute entrée porteuse d'un getter, sans
    // jamais toucher `.value`. La chaîne de ré-entrance décrite ci-dessus n'existe donc plus,
    // et ce parking est devenu une CEINTURE plutôt que le seul frein. Il reste : `getModule`
    // et `hasModule` lisent encore `gl[name]` en repli, hors construction — c'est sûr, mais
    // c'est ce parking qui le rend sûr. Ne pas le retirer sous prétexte que le scan a changé.
    // (Le commentaire citait `module-manager.ts:107-112`, une plage périmée — les lignes
    // avaient glissé en 103-108 avant que le code ne disparaisse. Une citation de ligne dans
    // un commentaire porteur vieillit sans bruit : celle-ci renvoie désormais au fichier.)
    _apiControllerInstance = instance;

    // …but do not KEEP a dead controller. `init()` catches and returns false (`:75-85`) instead
    // of throwing, so leaving a failed instance parked would hide the failure FOREVER: every
    // later consumer — `loadConfig()` included — would read `isInitialized: false`,
    // `geoleafLoadConfig()` would resolve null, and the boot promise would never settle.
    // Releasing the slot lets a later access retry instead of inheriting a permanent corpse.
    // The caller still gets this instance, so behaviour is unchanged for them: the validated
    // accessor raises its usual explicit "failed state" error.
    //
    // ⚠️ That accessor is `requireController()` in `globals/globals.api.ts`. This comment named
    // `geoleaf-api.ts` until socle-init 7.7, which removed that module's duplicate assignment of
    // the eleven top-level methods — and PORTED the validation here first, precisely because this
    // paragraph names it as what keeps the hang above from being silent. Its only witnesses are
    // the two refusal tests of `__tests__/api/top-level-api.test.ts`.
    if (!instance.init()) _apiControllerInstance = null;

    return instance;
}

if (
    !Object.getOwnPropertyDescriptor(gl, "_APIController") ||
    !Object.getOwnPropertyDescriptor(gl, "_APIController")!.get
) {
    Object.defineProperty(gl, "_APIController", {
        get: _getAPIController,
        configurable: true,
        enumerable: true,
    });
}

export { APIController };
