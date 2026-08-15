/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Module Theme Loader
 * Loads et met en cache le file themes.json
 *
 * DEPENDENCIES:
 * - GeoLeaf.Log (optional)
 * - GeoLeaf.Config.getActiveProfile()
 *
 * EXPOSE:
 * - `ThemeLoader`, ESM export only — consumed through `kernel/themes/index.js`.
 *   ⚠️ NOT a namespace key. `GeoLeaf._ThemeLoader` was removed at API S4.3 (see
 *   `globals/globals.ui.ts`, the B7 block) and this header kept announcing it for a
 *   month: no gate reads an `EXPOSE:` block, so nothing could contradict it.
 * - `GeoLeaf.Config.clearThemesCache` — the single public entry point onto this
 *   module's cache, mounted by `setupUIKernel()` in `globals/globals.ui.ts`
 *   (Sprint 2, task 2.6). ⚠️ There is no geoleaf.config façade file under `api/`: unlike
 *   the other façades, `Config` is assigned directly by `globals/globals.config.ts`.
 *
 * @private
 */
"use strict";

import { Log } from "../../utils/log/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { FetchHelper } from "../../utils/general/fetch-helper.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { asObject } from "../../utils/general/type-guards.js";

/** A normalised theme entry produced by `_normalizeTheme`. */
export interface NormalizedTheme {
    id: string;
    label: string;
    type: string;
    description: string;
    icon: string;
    layers: unknown[];
}

/** Per-section UI config block of a validated themes configuration. */
interface ThemeConfigSection {
    enabled: boolean;
    position: string;
    placeholder?: string;
    showNavigationButtons?: boolean;
    compactThreshold?: number;
    [key: string]: unknown;
}

/** Validated themes configuration returned by `_validateConfig`. */
export interface ValidatedThemesConfig {
    config: {
        primaryThemes: ThemeConfigSection;
        secondaryThemes: ThemeConfigSection;
    };
    themes: NormalizedTheme[];
    defaultTheme: string | null;
}

/** Raw theme entry as read from a themes.json file (loose JSON). */
interface RawTheme {
    id?: string;
    label?: string;
    type?: string;
    description?: string;
    icon?: string;
    layers?: unknown;
}

/** Raw themes configuration as read from a themes.json file (loose JSON). */
interface RawThemesConfig {
    config?: {
        primaryThemes?: Partial<ThemeConfigSection>;
        secondaryThemes?: Partial<ThemeConfigSection>;
    };
    themes?: RawTheme[];
    defaultTheme?: string | null;
}

/**
 * Cache for thes configurations de themes
 * @type {Map<string, Object>}
 */
const _cache = new Map<string, ValidatedThemesConfig>();

/**
 * Promises en cours de loading
 * @type {Map<string, Promise>}
 */
const _loadingPromises = new Map<string, Promise<ValidatedThemesConfig>>();

function _normalizeTheme(theme: RawTheme): NormalizedTheme | null {
    if (!theme.id) {
        Log?.warn("[ThemeLoader] Theme without ID ignored");
        return null;
    }
    return {
        id: theme.id,
        label: theme.label || theme.id,
        type: theme.type || "secondary",
        description: theme.description || "",
        icon: theme.icon || "",
        layers: Array.isArray(theme.layers) ? theme.layers : [],
    };
}

function _resolveDefaultTheme(validatedConfig: ValidatedThemesConfig): void {
    const firstId = validatedConfig.themes[0]?.id;
    if (!firstId) return;
    if (!validatedConfig.defaultTheme) {
        validatedConfig.defaultTheme = firstId;
        return;
    }
    const defaultExists = validatedConfig.themes.some((t) => t.id === validatedConfig.defaultTheme);
    if (!defaultExists) {
        Log?.warn("[ThemeLoader] defaultTheme not found, using first theme");
        validatedConfig.defaultTheme = firstId;
    }
}

/**
 * Fetches and validates a themes.json file, then caches the result.
 *
 * @param themesPath - URL of the themes config file.
 * @param validateFn - Validator applied to the parsed payload.
 * @param profileId - Cache key for the owning profile.
 * @param Log - Logger facade.
 * @param _cache - Validated-config cache, populated on success.
 * @param _loadingPromises - In-flight request map, cleared on settle.
 * @returns The validated themes config.
 * @private
 */
function _doFetchThemesConfig(
    themesPath: string,
    validateFn: (d: unknown) => ValidatedThemesConfig,
    profileId: string,
    Log: typeof import("../../utils/log/index.js").Log,
    _cache: Map<string, ValidatedThemesConfig>,
    _loadingPromises: Map<string, Promise<ValidatedThemesConfig>>
): Promise<ValidatedThemesConfig> {
    // ⚠️ Do NOT "homogenise" this onto `Loader.fetchJson`. Backlog B.14 asked for exactly
    // that, on the premise that fetchJson adds URL validation — measured, the premise is
    // inverted. `FetchHelper` already validates through `Security.validateUrl`
    // (`validateUrl: true` by default) and adds a timeout, a retry and rate limiting;
    // `Loader._validateUrl` short-circuits RELATIVE urls (`if (isRelative) return url`),
    // which is all `themesPath` ever is, and `_doFetch` uses a bare `fetch` — no timeout,
    // no retry. Migrating would trade four protections for one.
    // The single thing fetchJson has and this path lacks is the strict content-type
    // assertion; `parseResponse: true` covers the practical case (a non-JSON body fails
    // to parse and rejects).
    return FetchHelper.get(themesPath, { timeout: 8000, retries: 1, parseResponse: true })
        .then((data: unknown) => {
            if (Log) Log.debug("[ThemeLoader] File loaded:", themesPath);
            const validated = validateFn(data);
            _cache.set(profileId, validated);
            _loadingPromises.delete(profileId);
            return validated;
        })
        .catch((err) => {
            if (Log) Log.warn("[ThemeLoader] Error loading themes.json:", (err as Error).message);
            _loadingPromises.delete(profileId);
            throw err;
        });
}

const _ThemeLoader = {
    /**
     * Loads the theme configuration of a profile.
     *
     * ## The no-fetch path is a CONTRACT, not an optimisation
     *
     * When the active profile already carries a `themes` object — which is what the modular
     * profile loader produces — this method resolves from it and **emits no HTTP request at
     * all**. An integrator who declares `themes` inline in the profile therefore never needs
     * to intercept `window.fetch` to serve `themes.json`, and never needs the loader's path
     * convention to match their asset layout.
     *
     * ⚠️ **This guarantee is promoted to a contract by Sprint 2 (task 2.7) and must not be
     * reverted silently.** Until then it was only an implementation comment, so it was
     * revocable by any refactor — and the host-side workaround it replaces (patching
     * `window.fetch`) is precisely the kind of coupling this project exists to remove.
     * A change that reintroduces a request on this path is a BREAKING change.
     *
     * The three branches, in order:
     * 1. cache hit → resolved value, no work;
     * 2. load already in flight → the same promise, never a second request;
     * 3. `Config.getActiveProfile().themes` present and matching `profileId` → **no fetch**;
     * 4. otherwise only — `themes.json` is fetched over HTTP.
     *
     * @param profileId - ID of the profile whose themes are wanted.
     * @returns The validated theme configuration.
     *
     * @see `GeoLeaf.Config.clearThemesCache` to drop what branch 1 returns.
     */
    loadThemesConfig(profileId: string): Promise<ValidatedThemesConfig> {
        if (Log) Log.debug("[ThemeLoader] loadThemesConfig called for:", profileId);

        if (_cache.has(profileId)) {
            if (Log) Log.debug("[ThemeLoader] Config cached for:", profileId);
            return Promise.resolve(_cache.get(profileId)!);
        }

        if (_loadingPromises.has(profileId)) {
            if (Log) Log.debug("[ThemeLoader] Loading already in progress for:", profileId);
            return _loadingPromises.get(profileId)!;
        }

        // Modular profiles: the loader already resolved themes.json into the
        // active profile — read it directly (no HTTP round-trip, no path
        // assumption on the profile layout).
        // 🛑 CONTRACT, not an optimisation — see this method's TSDoc and `CDC_kernel.md`
        // §K-07. Reintroducing a request here is a BREAKING change: an integrator relies on
        // this branch to avoid patching `window.fetch`.
        const activeProfile = asObject(getGeoLeaf()?.Config?.getActiveProfile?.()) as {
            id?: string;
            _profileId?: string;
            themes?: unknown;
        } | null;
        if (
            activeProfile &&
            (activeProfile.id === profileId || activeProfile._profileId === profileId) &&
            activeProfile.themes &&
            typeof activeProfile.themes === "object"
        ) {
            try {
                const validated = this._validateConfig(activeProfile.themes);
                _cache.set(profileId, validated);
                if (Log) Log.debug("[ThemeLoader] Themes read from active profile");
                return Promise.resolve(validated);
            } catch (err) {
                Log?.warn("[ThemeLoader] Active profile themes invalid:", (err as Error)?.message);
            }
        }

        // Legacy profiles only: themes.json lives at the profile root.
        const isInDemo = window.location.pathname.includes("/demo/");
        const basePath = isInDemo ? "../" : "";
        const themesPath = `${basePath}profiles/${profileId}/themes.json`;

        const loadPromise = _doFetchThemesConfig(
            themesPath,
            (d) => this._validateConfig(d),
            profileId,
            Log,
            _cache,
            _loadingPromises
        );
        _loadingPromises.set(profileId, loadPromise);
        return loadPromise;
    },

    /**
     * Valide et normalise la configuration des themes
     * @param {Object} config - Configuration brute
     * @returns {Object} Configuration validated
     * @private
     */
    _validateConfig(config: unknown): ValidatedThemesConfig {
        if (!config || typeof config !== "object") {
            throw new Error("Invalid theme configuration");
        }

        const rawConfig = config as RawThemesConfig;

        // Values by default pour config
        const primaryThemes: ThemeConfigSection = {
            enabled: true,
            position: "top-map",
            ...(rawConfig.config?.primaryThemes || {}),
        };
        const secondaryThemes: ThemeConfigSection = {
            enabled: true,
            placeholder: getLabel("ui.theme.select_placeholder"),
            showNavigationButtons: true,
            position: "top-layermanager",
            ...(rawConfig.config?.secondaryThemes || {}),
        };
        const validatedConfig: ValidatedThemesConfig = {
            config: {
                primaryThemes,
                secondaryThemes,
            },
            themes: [],
            defaultTheme: rawConfig.defaultTheme || null,
        };

        // Valider the themes
        if (!Array.isArray(rawConfig.themes)) {
            Log?.warn("[ThemeLoader] No theme defined in configuration");
            return validatedConfig;
        }

        // Normaliser chaque theme
        validatedConfig.themes = rawConfig.themes
            .map(_normalizeTheme)
            .filter((t): t is NormalizedTheme => Boolean(t));

        // Check qu'il y a au moins a theme
        if (validatedConfig.themes.length === 0) {
            throw new Error("Aucun theme valide found dans la configuration");
        }

        // Check que le defaultTheme existe
        _resolveDefaultTheme(validatedConfig);

        Log?.debug(
            "[ThemeLoader] Configuration validated:",
            validatedConfig.themes.length,
            "themes"
        );

        return validatedConfig;
    },

    /**
     * Empty le cache (pour tests ou reloading)
     * @param {string} [profileId] - Profile ID (optional, empties all if not specified)
     */
    clearCache(profileId?: string) {
        if (profileId) {
            _cache.delete(profileId);
            _loadingPromises.delete(profileId);
            if (Log) Log.debug("[ThemeLoader] Cache cleared for:", profileId);
        } else {
            _cache.clear();
            _loadingPromises.clear();
            if (Log) Log.debug("[ThemeLoader] Full cache cleared");
        }
    },
};

export { _ThemeLoader as ThemeLoader };
