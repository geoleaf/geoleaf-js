/*!
 * GeoLeaf Core – Config / Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../../utils/log/index.js";
import { ConfigStore } from "../storage.js";
import { ProfileManager } from "../profile.js";
import type {
    GeoLeafConfig,
    ConfigInitOptions,
    ConfigFacade,
    ConfigCoreShape,
} from "./config-types.js";

/**
 * Local alias kept for readability inside this module. The canonical, COMPLETE shape of
 * the singleton is `ConfigFacade` (config-types.ts) — see its docblock for the two-stage
 * assembly this file is the first half of.
 */
type ConfigInstance = ConfigFacade;

function _applyProfileId(
    cfg: GeoLeafConfig,
    profileId: string | undefined,
    configObj?: GeoLeafConfig
): void {
    if (typeof profileId === "string" && profileId.length > 0) {
        if (!cfg.data) cfg.data = {};
        cfg.data.activeProfile = profileId;
        if (configObj && configObj.data) configObj.data.activeProfile = profileId;
        Log.info("[GeoLeaf.Config] Active profile changed to:", profileId);
    }
}

function _resolveDebugFlag(
    cfg: Record<string, unknown> | null,
    mergedConfig: GeoLeafConfig
): boolean {
    if (cfg && typeof (cfg as GeoLeafConfig).debug !== "undefined") {
        return !!(cfg as GeoLeafConfig).debug;
    }
    if (mergedConfig && typeof mergedConfig.debug !== "undefined") {
        return !!mergedConfig.debug;
    }
    return false;
}

function _resolveLogLevel(
    cfg: Record<string, unknown> | null,
    mergedConfig: GeoLeafConfig
): string {
    const loggingCfg =
        (cfg && typeof cfg === "object" && (cfg as GeoLeafConfig).logging
            ? (cfg as GeoLeafConfig).logging
            : mergedConfig?.logging) ?? null;
    const level = loggingCfg?.level;
    const debugFlag = _resolveDebugFlag(cfg, mergedConfig);
    return level || (debugFlag ? "debug" : "info");
}

function _applyLoggingConfig(
    cfg: Record<string, unknown> | null,
    mergedConfig: GeoLeafConfig
): void {
    const level = _resolveLogLevel(cfg, mergedConfig);
    if (level && Log?.setLevel) {
        Log.setLevel(level);
        Log.info("[GeoLeaf.Config] Log level applied from configuration:", level);
    }
}

function _resolveLoadOptions(options: ConfigInitOptions) {
    return {
        // Conditional insertion, NOT `headers: options.headers`. These headers end
        // up iterated by key to build a request: there, an explicit `undefined`
        // does not vanish as in a `JSON.stringify`, it turns into the string
        // `"undefined"`.
        ...(options.headers !== undefined && { headers: options.headers }),
        strictContentType:
            typeof options.strictContentType === "boolean" ? options.strictContentType : true,
    };
}

function _callOnLoaded(options: ConfigInitOptions, cfg: GeoLeafConfig, context: string): void {
    if (typeof options.onLoaded === "function") {
        try {
            options.onLoaded(cfg);
        } catch (e) {
            Log.error(`[GeoLeaf.Config] Error in onLoaded (${context}):`, e);
        }
    }
}

function _initFromUrl(options: ConfigInitOptions, self: ConfigInstance): Promise<GeoLeafConfig> {
    const loadOptions = _resolveLoadOptions(options);
    // `loadUrl` is grafted by config-loaders.ts and declared on ConfigFacade, so no local
    // widening is needed any more.
    return self
        .loadUrl(options.url!, loadOptions)
        .then((cfg) => {
            _applyProfileId(cfg, options.profileId, self._config);
            return cfg;
        })
        .then((cfg) => {
            _callOnLoaded(options, cfg, "url");
            return cfg;
        })
        .catch((err: unknown) => {
            Log.error("[GeoLeaf.Config] Error in init() with url:", err);
            if (typeof options.onError === "function") {
                try {
                    options.onError(err as Error);
                } catch (e) {
                    Log.error("[GeoLeaf.Config] Error in onError:", e);
                }
            }
            throw err;
        });
}

// `ThisType<ConfigFacade>` is what makes the two-stage assembly type-safe: the literal only
// has to satisfy ConfigCoreShape (what it really implements), while `this` inside its methods
// is seen as the COMPLETE façade — so calling a grafted member such as `this.loadUrl()` below
// typechecks without a local cast.
const _configCore: ConfigCoreShape & ThisType<ConfigFacade> = {
    _config: {},
    _isLoaded: false,
    _subModulesInitialized: false,
    _source: null,
    _options: { autoEvent: true },

    init(options: ConfigInitOptions = {}): Promise<GeoLeafConfig> {
        this._options = {
            ...this._options,
            autoEvent:
                typeof options.autoEvent === "boolean"
                    ? options.autoEvent
                    : this._options.autoEvent,
        };
        if (options.config && typeof options.config === "object") {
            this._applyConfig(options.config as Record<string, unknown>, "inline");
            _applyProfileId(this._config, options.profileId);
            this._maybeFireLoadedEvent();
            _callOnLoaded(options, this._config, "inline");
            return Promise.resolve(this._config);
        }
        if (typeof options.url === "string" && options.url.length > 0) {
            return _initFromUrl(options, this);
        }
        this._applyConfig({}, "inline");
        _applyProfileId(this._config, options.profileId);
        this._maybeFireLoadedEvent();
        _callOnLoaded(options, this._config, "vide");
        return Promise.resolve(this._config);
    },

    _initSubModules(): void {
        if (this._subModulesInitialized) return;
        this._subModulesInitialized = true;

        const Storage = ConfigStore;
        const Profile = ProfileManager;

        if (Storage?.init) Storage.init(this._config);
        if (Profile?.init) Profile.init(this._config);
    },

    _applyConfig(cfg: Record<string, unknown> | null, source: string): void {
        if (typeof cfg !== "object" || cfg === null) {
            cfg = {};
        }

        this._validateConfig?.(cfg as GeoLeafConfig);

        const Storage = ConfigStore;
        if (Storage?.deepMerge) {
            this._config = Storage.deepMerge(
                this._config as Record<string, unknown>,
                cfg
            ) as GeoLeafConfig;
        } else {
            this._config = Object.assign({}, this._config, cfg) as GeoLeafConfig;
        }

        this._isLoaded = true;
        this._source = source || "inline";
        this._subModulesInitialized = false;
        this._initSubModules();

        try {
            _applyLoggingConfig(cfg, this._config);
        } catch (e) {
            Log.warn("[GeoLeaf.Config] Unable to apply log level from configuration:", e);
        }
    },

    isLoaded(): boolean {
        return this._isLoaded;
    },

    getSource(): string | null {
        return this._source;
    },

    _maybeFireLoadedEvent(): void {
        if (!this._options.autoEvent) return;
        if (typeof document === "undefined" || typeof document.dispatchEvent !== "function") return;

        try {
            const event = new CustomEvent("geoleaf:config:loaded", {
                detail: { config: this._config, source: this._source },
            });
            document.dispatchEvent(event);
        } catch {
            try {
                const legacyEvent = document.createEvent("CustomEvent");
                (
                    legacyEvent as unknown as {
                        initCustomEvent: (a: string, b: boolean, c: boolean, d: unknown) => void;
                    }
                ).initCustomEvent("geoleaf:config:loaded", false, false, {
                    config: this._config,
                    source: this._source,
                });
                document.dispatchEvent(legacyEvent);
            } catch {
                Log.warn("[GeoLeaf.Config] Unable to dispatch geoleaf:config:loaded event.");
            }
        }
    },
};

/**
 * The configuration singleton, seen through its complete contract.
 *
 * This is the **single** widening cast of the module — it stands exactly where the
 * two-stage assembly happens, and it is why the three grafting siblings need no cast of
 * their own. Widening here rather than at each call site also means a member added to
 * `ConfigFacade` but grafted by nobody now fails at its first use instead of silently
 * resolving to `undefined`.
 */
const Config = _configCore as unknown as ConfigFacade;

export { Config };
