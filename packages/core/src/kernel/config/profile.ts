/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { ConfigLoader } from "./loader.js";
import { ProfileLoader as ModularProfileLoader } from "./profile-loader.js";
import { mergeModulesBag } from "./geoleaf-config/module-config.js";
import { registerLifecycleTeardown } from "../shared/lifecycle.js";
import type { GeoLeafConfig } from "./geoleaf-config/config-types.js";
import type { LoadUrlOptions } from "./geoleaf-config/config-types.js";

/**
 * Validates critical profile fields at boot. Throws a descriptive error on
 * any structural mismatch so the developer gets an actionable message instead
 * of a silent undefined somewhere downstream.
 * @internal
 */
function _validateProfileStructure(profile: unknown, profileId: string): void {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        throw new Error(
            `[GeoLeaf] Profile "${profileId}" must be a JSON object — got ${Array.isArray(profile) ? "array" : typeof profile}`
        );
    }
    const p = profile as Record<string, unknown>;
    const errors: string[] = [];

    _validateProfileScalars(p, errors);
    _validateProfileMapSection(p, errors);

    if (errors.length > 0) {
        throw new Error(
            `[GeoLeaf] Profile "${profileId}" validation failed:\n` +
                errors.map((e) => `  ✗ ${e}`).join("\n")
        );
    }
}

/** Validates top-level scalar profile fields (id, version), accumulating errors. */
function _validateProfileScalars(p: Record<string, unknown>, errors: string[]): void {
    if (p["id"] !== undefined && typeof p["id"] !== "string") {
        errors.push('"id" must be a string');
    }
    if (p["version"] !== undefined && typeof p["version"] !== "string") {
        errors.push('"version" must be a string');
    }
}

/** Validates the optional `map` section (object shape + numeric zoom bounds), accumulating errors. */
function _validateProfileMapSection(p: Record<string, unknown>, errors: string[]): void {
    if (p["map"] === undefined) return;
    if (typeof p["map"] !== "object" || Array.isArray(p["map"])) {
        errors.push('"map" must be an object');
        return;
    }
    const map = p["map"] as Record<string, unknown>;
    if (map["zoom"] !== undefined && typeof map["zoom"] !== "number") {
        errors.push(`"map.zoom" must be a number, got ${typeof map["zoom"]}`);
    }
    if (map["minZoom"] !== undefined && typeof map["minZoom"] !== "number") {
        errors.push(`"map.minZoom" must be a number, got ${typeof map["minZoom"]}`);
    }
    if (map["maxZoom"] !== undefined && typeof map["maxZoom"] !== "number") {
        errors.push(`"map.maxZoom" must be a number, got ${typeof map["maxZoom"]}`);
    }
}

interface ProfileDataPayload {
    profile: Record<string, unknown> | null;
    poi: unknown[];
    routes: unknown[];
    mapping: Record<string, unknown> | null;
}

function _ensureProfilesMap(config: GeoLeafConfig): void {
    if (!config.profiles || typeof config.profiles !== "object" || Array.isArray(config.profiles)) {
        (config as Record<string, unknown>).profiles = {};
    }
}

function _buildFetchOptions(options: {
    headers?: Record<string, string>;
    strictContentType?: boolean;
}): LoadUrlOptions {
    return {
        headers: options.headers ?? {},
        strictContentType:
            typeof options.strictContentType === "boolean" ? options.strictContentType : true,
    };
}

type ProfileFetchResult =
    | GeoLeafConfig
    | [Record<string, unknown> | null, Record<string, unknown> | null];

function _resolveProfileStep1(
    profile: Record<string, unknown> | null,
    isPoiMappingEnabled: boolean,
    Loader: typeof ConfigLoader,
    baseUrl: string,
    timestamp: number,
    fetchOptions: LoadUrlOptions,
    self: typeof ProfileModule
): Promise<ProfileFetchResult> {
    const isModular = ModularProfileLoader && ModularProfileLoader.isModularProfile(profile);
    if (isModular) {
        Log.info("[GeoLeaf.Config.Profile] Modular profile detected - modular loading");
        return self._loadModularProfile(
            profile as Record<string, unknown>,
            baseUrl,
            timestamp,
            fetchOptions
        );
    }
    let requiresMapping = false;
    if (profile && Array.isArray((profile as Record<string, unknown>).layers)) {
        requiresMapping = (
            (profile as Record<string, unknown>).layers as { normalized?: boolean }[]
        ).some((layer) => layer.normalized === false);
    }
    const mappingPromise =
        isPoiMappingEnabled && requiresMapping
            ? Loader.fetchJson(`${baseUrl}/mapping.json?t=${timestamp}`, fetchOptions).catch(
                  (err: Error) => {
                      Log.error(
                          "[GeoLeaf.Config.Profile] mapping.json required (normalized:false) but not found or invalid.",
                          err
                      );
                      return null;
                  }
              )
            : Promise.resolve(null);
    return Promise.all([Promise.resolve(profile), mappingPromise]);
}

function _resolveProfileStep2(
    result: ProfileFetchResult,
    profileId: string,
    self: typeof ProfileModule
): GeoLeafConfig {
    if (result && !Array.isArray(result)) return result as GeoLeafConfig;
    const [profile, mapping] = result as unknown as [
        Record<string, unknown>,
        Record<string, unknown> | null,
    ];
    self._activeProfileId = profileId;
    self._activeProfile = profile ?? null;
    Log.info("[GeoLeaf.Config.Profile] Profile loaded (layers-only)", {
        profileId,
        profileLoaded: !!profile,
        profileKeys: profile ? Object.keys(profile) : [],
    });
    self._activeProfileData = {
        // Guard kept inline: `result` is destructured through an `as unknown as`
        // cast above, so `mapping` is not guaranteed to be an object at runtime
        // (a malformed mapping.json can yield a string or a number).
        mapping: mapping && typeof mapping === "object" ? mapping : null,
    };
    _ensureProfilesMap(self._config!);
    const profiles = (self._config as Record<string, unknown>).profiles as Record<
        string,
        ProfileDataPayload
    >;
    profiles[profileId] = {
        profile: self._activeProfile,
        poi: [],
        routes: [],
        mapping: self._activeProfileData.mapping,
    };
    self._fireProfileLoadedEvent(profileId, {
        profile: self._activeProfile,
        poi: [],
        routes: [],
        mapping: self._activeProfileData.mapping,
    });
    return self._config!;
}

function _fetchAndResolveProfile(
    Loader: typeof ConfigLoader,
    baseUrl: string,
    timestamp: number,
    fetchOptions: LoadUrlOptions,
    isPoiMappingEnabled: boolean,
    self: typeof ProfileModule
): Promise<GeoLeafConfig> {
    const profileId = self._config!.data?.activeProfile as string;
    return Loader.fetchJson(`${baseUrl}/profile.json?t=${timestamp}`, fetchOptions)
        .then((profile) => {
            _validateProfileStructure(profile, profileId);
            return _resolveProfileStep1(
                profile,
                isPoiMappingEnabled,
                Loader,
                baseUrl,
                timestamp,
                fetchOptions,
                self
            );
        })
        .then((result) => _resolveProfileStep2(result as ProfileFetchResult, profileId, self))
        .catch((err) => {
            Log.error("[GeoLeaf.Config.Profile] Error loading active profile resources:", err);
            return self._config!;
        });
}

function _applyModularEnrichedProfile(
    enrichedProfile: Record<string, unknown>,
    profileId: string,
    self: typeof ProfileModule
): GeoLeafConfig {
    self._activeProfileId = profileId;
    self._activeProfile = enrichedProfile;
    Log.info("[GeoLeaf.Config.Profile] Modular profile loaded successfully", {
        profileId,
        hasThemes: !!(enrichedProfile as Record<string, unknown>).themes,
        layersCount: (enrichedProfile.layers as unknown[] | undefined)?.length ?? 0,
    });
    self._activeProfileData = {
        mapping: (enrichedProfile.mapping as Record<string, unknown>) ?? null,
    };
    Object.keys(enrichedProfile).forEach((key) => {
        if (key === "layers" || key === "themes" || key === "mapping") return;
        if (key === "modules") {
            // Per-module merge — a wholesale assignment would drop bag
            // entries declared elsewhere (e.g. boot config) for plugins the
            // profile does not configure.
            mergeModulesBag(self._config as Record<string, unknown>, enrichedProfile.modules);
            return;
        }
        (self._config as Record<string, unknown>)[key] = enrichedProfile[key];
    });
    _ensureProfilesMap(self._config!);
    const profiles = self._config!.profiles as Record<string, ProfileDataPayload>;
    profiles[profileId] = {
        profile: self._activeProfile,
        poi: [],
        routes: [],
        mapping: self._activeProfileData.mapping,
    };
    self._fireProfileLoadedEvent(profileId, {
        profile: self._activeProfile,
        poi: [],
        routes: [],
        mapping: self._activeProfileData.mapping,
    });
    // ⚠️ The MERGED config, never `enrichedProfile`. This is what `boot-core` hands to
    // `registry.init()` as `effectiveCfg`, i.e. what every module's `init(adapter, config)`
    // reads — and the profile object is NOT that config: it carries only the profile's own
    // `modules` entries, so every app-global block declared solely in `geoleaf.config.json`
    // (`modules.pwa`, `modules.branding`) was absent from it. The merge loop above is
    // careful to fold those in entry by entry, and returning the profile threw that away.
    // Cost of the bug: `SharedModule` #8 gates the offline engine on `modules.pwa.enabled`,
    // read a `modules` bag without `pwa`, and never called `ensureLoaded("offline")` — on
    // EVERY shipped profile, all of which are modular. Symmetric with the layers-only path
    // (`_resolveProfileStep2`), which already returns `self._config`.
    return self._config!;
}

function _buildProfileDispatchArgs(
    dataCfg: Record<string, unknown>,
    options: { headers?: Record<string, string>; strictContentType?: boolean }
) {
    const profileId = dataCfg.activeProfile as string;
    const basePath = (dataCfg.profilesBasePath as string) ?? "data/profiles";
    const baseUrl = `${basePath}/${profileId}`;
    Log.info("[GeoLeaf.Config.Profile] Starting profile load:", {
        profileId,
        baseUrl,
        configData: dataCfg,
    });
    return { profileId, baseUrl, fetchOptions: _buildFetchOptions(options) };
}

const ProfileModule = {
    _config: null as GeoLeafConfig | null,
    _activeProfileId: null as string | null,
    _activeProfile: null as Record<string, unknown> | null,
    _activeProfileData: {
        mapping: null as Record<string, unknown> | null,
    },

    init(config: GeoLeafConfig): void {
        this._config = config;
    },

    /**
     * Resets the active-profile state to its initial values. Called on map
     * teardown (lifecycle seam + `ConfigModule.destroy()`) so a destroy →
     * recreate cycle does not keep a stale active profile or its POIs/routes.
     *
     * `_config` (the Config singleton wiring) is intentionally preserved — it is
     * a foundation reference, not per-map business state.
     */
    reset(): void {
        this._activeProfileId = null;
        this._activeProfile = null;
        this._activeProfileData = { mapping: null };
    },

    isProfilePoiMappingEnabled(): boolean {
        const dataCfg = this._config?.data;
        if (!dataCfg || typeof dataCfg !== "object") return true;
        if (typeof (dataCfg as Record<string, unknown>).enableProfilePoiMapping === "boolean") {
            return (dataCfg as Record<string, unknown>).enableProfilePoiMapping as boolean;
        }
        if (typeof (dataCfg as Record<string, unknown>).useProfilePoiMapping === "boolean") {
            return (dataCfg as Record<string, unknown>).useProfilePoiMapping as boolean;
        }
        if (typeof (dataCfg as Record<string, unknown>).useMapping === "boolean") {
            return (dataCfg as Record<string, unknown>).useMapping as boolean;
        }
        return true;
    },

    loadActiveProfileResources(
        options: { headers?: Record<string, string>; strictContentType?: boolean } = {}
    ): Promise<GeoLeafConfig> {
        const dataCfg = this._config?.data as Record<string, unknown> | undefined;
        if (!dataCfg || !dataCfg.activeProfile) {
            Log.info(
                "[GeoLeaf.Config.Profile] No active profile defined in config.data.activeProfile; no profile loading performed."
            );
            return Promise.resolve(this._config!);
        }
        const { profileId, baseUrl, fetchOptions } = _buildProfileDispatchArgs(dataCfg, options);
        const Loader = ConfigLoader;
        if (!Loader) {
            Log.error("[GeoLeaf.Config.Profile] Loader module not available.");
            return Promise.reject(new Error("Required modules not available"));
        }
        const isPoiMappingEnabled = this.isProfilePoiMappingEnabled();
        if (!isPoiMappingEnabled)
            Log.info(
                "[GeoLeaf.Config.Profile] POI mapping disabled via global configuration; profile POIs will be considered already normalized."
            );
        Log.info("[GeoLeaf.Config.Profile] Loading active profile resources:", {
            profileId,
            baseUrl,
        });
        const isDebug = !!(this._config as Record<string, unknown>)?.debug;
        const timestamp = isDebug ? Date.now() : 0;
        return _fetchAndResolveProfile(
            Loader,
            baseUrl,
            timestamp,
            fetchOptions,
            isPoiMappingEnabled,
            this
        );
    },

    _loadModularProfile(
        profile: Record<string, unknown>,
        baseUrl: string,
        timestamp: number,
        fetchOptions: LoadUrlOptions
    ): Promise<GeoLeafConfig> {
        const profileId = this._config!.data?.activeProfile as string;
        if (!ModularProfileLoader) {
            Log.error("[GeoLeaf.Config.Profile] ProfileLoader not available");
            return Promise.reject(new Error("ProfileLoader non disponible"));
        }
        // Debug mode bypasses the pre-built bundle: section files edited in a
        // deployed profile are then picked up without regenerating the bundle.
        const skipBundle = !!(this._config as Record<string, unknown> | null)?.debug;
        return ModularProfileLoader.loadModularProfile(
            profile,
            baseUrl,
            profileId,
            timestamp,
            fetchOptions,
            skipBundle
        ).then((enrichedProfile) => _applyModularEnrichedProfile(enrichedProfile, profileId, this));
    },

    getActiveProfileId(): string | null {
        return this._activeProfileId;
    },

    getActiveProfile(): Record<string, unknown> | null {
        return this._activeProfile;
    },

    getActiveProfileMapping(): Record<string, unknown> | null {
        return this._activeProfileData?.mapping ?? null;
    },

    getActiveProfileLayersConfig(): unknown[] | null {
        const p = this._activeProfile as { layers?: unknown[] } | null;
        return p?.layers ?? null;
    },

    _fireProfileLoadedEvent(profileId: string, payload: ProfileDataPayload): void {
        if (typeof document === "undefined" || typeof document.dispatchEvent !== "function") return;

        try {
            const event = new CustomEvent("geoleaf:profile:loaded", {
                detail: { profileId, data: payload },
            });
            document.dispatchEvent(event);
        } catch {
            try {
                const legacyEvent = document.createEvent("CustomEvent");
                (
                    legacyEvent as unknown as {
                        initCustomEvent: (a: string, b: boolean, c: boolean, d: unknown) => void;
                    }
                ).initCustomEvent("geoleaf:profile:loaded", false, false, {
                    profileId,
                    data: payload,
                });
                document.dispatchEvent(legacyEvent);
            } catch {
                Log.warn(
                    "[GeoLeaf.Config.Profile] Unable to dispatch geoleaf:profile:loaded event."
                );
            }
        }
    },
};

const ProfileManager = ProfileModule;

// Self-register the teardown so Core.destroy() clears the active profile state.
registerLifecycleTeardown(() => ProfileManager.reset());

export { ProfileManager };
