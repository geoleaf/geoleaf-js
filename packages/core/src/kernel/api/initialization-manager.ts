/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * API Initialization Manager
 * Manager for GeoLeaf initialization operations.
 */

import { Log } from "../../utils/log/index.js";
import { ensureGeoLeaf, getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import type {
    IModuleAccessFn,
    INormalizedInitOptions,
    INormalizedConfigOptions,
} from "../../contracts/api.contract.ts";

// Guarantee the global GeoLeaf namespace exists at import; read it fresh via getGeoLeaf().
ensureGeoLeaf();

interface IInitManagerStats {
    initCalls: number;
    configLoads: number;
    errors: number;
}

type MapAndUiOpts = {
    mapOpts: Record<string, unknown>;
    uiOpts: Record<string, unknown>;
};

function _normalizeMapAndUiOpts(options: Record<string, unknown>): MapAndUiOpts {
    if (options.map) {
        return {
            mapOpts: (options.map as Record<string, unknown>) ?? {},
            uiOpts: (options.ui as Record<string, unknown>) ?? {},
        };
    }
    return {
        mapOpts: {
            target: options.target ?? options.mapId,
            center: options.center,
            zoom: options.zoom,
        },
        uiOpts: { theme: options.theme },
    };
}

function _resolveCenter(
    mapOpts: Record<string, unknown>,
    CONSTANTS: Record<string, unknown>
): [number, number] {
    return Array.isArray(mapOpts.center)
        ? (mapOpts.center as [number, number])
        : ((CONSTANTS.DEFAULT_CENTER as [number, number]) ?? [0, 0]);
}

function _resolveZoom(
    mapOpts: Record<string, unknown>,
    CONSTANTS: Record<string, unknown>
): number {
    return Number.isFinite(mapOpts.zoom)
        ? (mapOpts.zoom as number)
        : ((CONSTANTS.DEFAULT_ZOOM as number) ?? 12);
}

function _applyUITheme(UI: Record<string, unknown>, theme: string): unknown {
    if (typeof UI.applyTheme === "function")
        return (UI.applyTheme as (t: string) => unknown)(theme);
    if (typeof UI.setTheme === "function") return (UI.setTheme as (t: string) => unknown)(theme);
    if (typeof UI.theme === "function") return (UI.theme as (t: string) => unknown)(theme);
    throw new Error("UI module does not provide applyTheme, setTheme or theme method");
}
class APIInitializationManager {
    isReady: boolean;
    pendingPromise: Promise<unknown> | null;
    cancelled: boolean;
    stats: IInitManagerStats;

    constructor() {
        this.isReady = true; // Manager ready without separate init
        this.pendingPromise = null;
        this.cancelled = false;
        this.stats = {
            initCalls: 0,
            configLoads: 0,
            errors: 0,
        };
    }

    /**
     * Initialises GeoLeaf with the provided options.
     * @param options - Initialisation options
     * @param getModule - Module access function
     * @returns Initialisation result from Core
     */
    init(options: Record<string, unknown>, getModule: IModuleAccessFn): unknown {
        try {
            this.stats.initCalls++;

            if (Log) Log.info("[APIInitializationManager] Initializing GeoLeaf");

            // Parameter validation
            const validationResult = this._validateInitParams(options, getModule);
            if (!validationResult.valid) {
                throw new Error(validationResult.error);
            }

            // Get the Core module
            const Core = getModule("Core") as Record<string, unknown> | null;
            if (!Core || typeof Core.init !== "function") {
                throw new Error(
                    "[GeoLeaf.init] GeoLeaf.Core.init() is not available. Core module must be loaded before API."
                );
            }

            // Normalise the options
            const normalizedOptions = this._normalizeInitOptions(options);
            if (Log)
                Log.info(
                    "[APIInitializationManager] Initializing with options:",
                    normalizedOptions
                );

            // Call Core initialisation
            const result = (Core.init as (o: unknown) => unknown)(normalizedOptions);

            if (Log) Log.info("[APIInitializationManager] Initialization completed successfully");
            return result;
        } catch (error) {
            this.stats.errors++;
            if (Log) Log.error("[APIInitializationManager] Initialization failed:", error);
            throw error;
        }
    }

    /**
     * Loads configuration from a URL or a data object.
     * @param input - URL string or config object
     * @param getModule - Module access function
     * @returns Resolved configuration data
     */
    async loadConfig(
        input: string | Record<string, unknown>,
        getModule: IModuleAccessFn
    ): Promise<unknown> {
        try {
            this.stats.configLoads++;
            Log?.info("[APIInitializationManager] Loading configuration");
            if (!input) {
                throw new Error("Configuration input is required");
            }
            if (!getModule || typeof getModule !== "function") {
                throw new Error("getModule function is required");
            }
            const Config = getModule("Config") as Record<string, unknown> | null;
            if (!Config || typeof Config.init !== "function") {
                throw new Error(
                    "[GeoLeaf.loadConfig] GeoLeaf.Config.init() is not available. Config module must be loaded."
                );
            }
            const options = this._normalizeConfigOptions(input);
            if (this.pendingPromise) {
                this.cancelled = true;
                Log?.info("[APIInitializationManager] Cancelling previous config load request");
            }
            this.cancelled = false;
            this.pendingPromise = (Config.init as (o: unknown) => Promise<unknown>)(options);
            const result = await this.pendingPromise;
            this.pendingPromise = null;
            if (this.cancelled) {
                Log?.info("[APIInitializationManager] Config load was cancelled");
                return null;
            }
            Log?.info("[APIInitializationManager] Configuration loaded successfully");
            return result;
        } catch (error) {
            this.stats.errors++;
            this.pendingPromise = null;
            Log?.error("[APIInitializationManager] Config loading failed:", error);
            throw error;
        }
    }
    /**
     * Applies a named theme to the UI module.
     * @param theme - Theme identifier
     * @param getModule - Module access function
     * @returns `true` on success, `false` on error
     */
    setTheme(theme: string, getModule: IModuleAccessFn): boolean {
        try {
            Log?.info(`[APIInitializationManager] Setting theme: ${theme}`);
            if (!theme || typeof theme !== "string") {
                throw new Error("Theme name must be a non-empty string");
            }
            if (!getModule || typeof getModule !== "function") {
                throw new Error("getModule function is required");
            }
            const UI = getModule("UI") as Record<string, unknown> | null;
            if (!UI) {
                throw new Error(
                    "[GeoLeaf.setTheme] GeoLeaf.UI is not available. UI module must be loaded."
                );
            }
            const result = _applyUITheme(UI, theme);
            Log?.info(`[APIInitializationManager] Theme '${theme}' applied successfully`);
            return Boolean(result);
        } catch (error) {
            this.stats.errors++;
            Log?.error(`[APIInitializationManager] Failed to set theme '${theme}':`, error);
            return false;
        }
    }
    /** Validates raw initialisation parameters before normalisation. */
    private _validateInitParams(
        options: unknown,
        getModule: unknown
    ): { valid: boolean; error?: string } {
        if (!options || typeof options !== "object") {
            return { valid: false, error: "[GeoLeaf.init] An options object is required." };
        }

        if (!getModule || typeof getModule !== "function") {
            return { valid: false, error: "getModule function is required" };
        }

        return { valid: true };
    }

    /** Normalises raw init options into the canonical `INormalizedInitOptions` shape. */
    private _normalizeInitOptions(options: Record<string, unknown>): INormalizedInitOptions {
        const { mapOpts, uiOpts } = _normalizeMapAndUiOpts(options);
        const target = mapOpts.target || mapOpts.mapId;
        if (!target) {
            throw new Error(
                "[GeoLeaf.init] The 'map.target' (or 'target'/'mapId') option is required."
            );
        }
        const CONSTANTS: Record<string, unknown> =
            (getGeoLeaf()?.CONSTANTS as Record<string, unknown>) ?? {};
        const center = _resolveCenter(mapOpts, CONSTANTS);
        const zoom = _resolveZoom(mapOpts, CONSTANTS);
        const theme = (uiOpts.theme ?? mapOpts.theme ?? "light") as string;
        return {
            mapId: String(target),
            center,
            zoom,
            theme,
            mapOptions: (mapOpts.mapOptions as Record<string, unknown>) ?? {},
            // Carry the internal boot-injected adapter (if any) through to Core.init/_createInstance.
            _adapter: options._adapter,
        };
    }

    /** Normalises a URL string or config object into `INormalizedConfigOptions`. */
    private _normalizeConfigOptions(
        input: string | Record<string, unknown>
    ): INormalizedConfigOptions {
        if (typeof input === "string") {
            // URL string
            return {
                source: "url",
                url: input,
                autoEvent: true,
            };
        } else if (input && typeof input === "object") {
            // Configuration object
            return {
                source: (input.url ? "url" : "data") as "url" | "data",
                // Insertion conditionnelle : cet objet NORMALISÉ est lui-même étalé plus bas
                // (`...input`) et relu par ses consommateurs — une clé `url` présente valant
                // `undefined` n'y est pas équivalente à son absence.
                ...(input.url !== undefined && { url: input.url as string }),
                data: input.data,
                profileId: input.profileId,
                autoEvent: input.autoEvent !== false, // true by default
                ...input,
            };
        } else {
            throw new Error("Configuration input must be a URL string or options object");
        }
    }

    /** Returns statistics for this manager. */
    getStats(): IInitManagerStats & { isReady: boolean; hasPendingRequest: boolean } {
        return {
            ...this.stats,
            isReady: this.isReady,
            hasPendingRequest: !!this.pendingPromise,
        };
    }

    /** Resets the manager, cancelling any pending config load. */
    reset(): void {
        if (this.pendingPromise) {
            this.cancelled = true;
        }

        this.pendingPromise = null;
        this.cancelled = false;
        this.stats = {
            initCalls: 0,
            configLoads: 0,
            errors: 0,
        };

        if (Log) Log.info("[APIInitializationManager] Manager reset");
    }
}

export { APIInitializationManager };
