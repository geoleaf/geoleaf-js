/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Modular profile loader for GeoLeaf
 */

import { Log } from "../../utils/log/index.js";
import { ConfigLoader } from "./loader.js";
import { isUnsafeKey } from "../../utils/general/object-path-guard.js";
import { layerDataPath } from "../../utils/general/layer-data-path.js";
import {
    validateFiles as _validateFiles,
    validateBasemaps as _validateBasemaps,
    validateMapCenter as _validateMapCenter,
    mergeModuleBags as _mergeModuleBags,
    extractRawLayers as _extractRawLayers,
    expandLayerTemplates as _expandLayerTemplates,
} from "./profile-loader-helpers.js";
import type {
    ProfileWithFiles,
    LayerRef,
    LayerConfigResult,
    EnrichedProfileParams,
} from "./profile-loader-helpers.js";
import type { LoadUrlOptions } from "./geoleaf-config/config-types.js";

/**
 * Resolves layer configs for a bundled profile using the bundle's pre-fetched
 * config map: inline template configs win; static layers read the map by id.
 */
function _resolveBundledLayerConfigs(
    expandedLayers: LayerRef[],
    layerConfigsMap: Record<string, Record<string, unknown>>
): LayerConfigResult[] {
    return expandedLayers.map((layerRef) => {
        if (layerRef.inlineConfig) {
            return {
                id: layerRef.id,
                config: layerRef.inlineConfig,
                layerDirectory: `layers/${layerRef.id}`,
                layerManagerId: layerRef.layerManagerId ?? null,
            };
        }
        const layerDirectory = layerRef.configFile
            ? layerRef.configFile.replace(/\/[^/]+$/, "")
            : `layers/${layerRef.id}`;
        return {
            id: layerRef.id,
            config: layerConfigsMap[layerRef.id] ?? null,
            layerDirectory,
            layerManagerId: layerRef.layerManagerId ?? null,
        };
    });
}

const ProfileLoader = {
    /**
     * Loads and hydrates a modular GeoLeaf profile by fetching the themes, layers, basemaps,
     * ui, features and mapping files, the per-module files, and the individual layer configs.
     *
     * ⚠️ Taxonomy is NOT one of them: it is a module since the Lot 2 removal (11/07/2026) and
     * travels through `Files.modules.taxonomy` like any other plugin block. The manifest has no
     * dedicated taxonomy path entry any more, and never had an icons one; icons live under the
     * taxonomy module's own `icons.spriteUrl`. The retired manifest key is a banned token in
     * `extracted-features.guard.test.js` — deliberately not spelled out here.
     *
     * @param profile - The base profile object (Files manifest, or inline themes/layers properties).
     * @param baseUrl - Base URL for resolving relative file paths.
     * @param profileId - Identifier used for logging and the enriched profile metadata.
     * @param timestamp - Cache-busting timestamp appended to fetch URLs. Defaults to `Date.now()`.
     * @param fetchOptions - Optional fetch configuration (headers, strictContentType).
     * @param skipBundle - When true (debug mode), ignores `profile.bundleFile` and loads the
     *   modular cascade — section edits in a deployed profile are picked up without a rebuild.
     * @returns The enriched profile record with resolved themes, mapping, and layer configs.
     */
    async loadModularProfile(
        profile: ProfileWithFiles,
        baseUrl: string,
        profileId: string,
        timestamp: number = Date.now(),
        fetchOptions: LoadUrlOptions = {},
        skipBundle: boolean = false
    ): Promise<Record<string, unknown>> {
        if (!ConfigLoader) throw new Error("GeoLeaf._ConfigLoader not available");
        Log.info(`[ProfileLoader] ${profileId}`);
        // B.1 — If a pre-built bundle is declared, use it instead of the request cascade
        const bundleFile = (profile as ProfileWithFiles & { bundleFile?: string }).bundleFile;
        if (bundleFile && skipBundle) {
            Log.info(`[ProfileLoader] ${profileId} — debug mode, bundle ignored (cascade)`);
        }
        if (bundleFile && !skipBundle) {
            return this._loadBundledProfile(profile, baseUrl, profileId, bundleFile, fetchOptions);
        }
        try {
            return await this._loadModularProfileCascade(
                profile,
                baseUrl,
                profileId,
                timestamp,
                fetchOptions
            );
        } catch (error) {
            Log.error("[ProfileLoader] Error loading modular profile:", error);
            throw error;
        }
    },

    /**
     * Fetches the themes file or returns the inline themes from the profile.
     * @param profile - The profile object.
     * @param baseUrl - Base URL for resolving the themes file path.
     * @param timestamp - Cache-busting timestamp.
     * @param fetchOptions - Optional fetch configuration.
     * @returns The themes record, or null if unavailable.
     */
    async _loadThemes(
        profile: ProfileWithFiles,
        baseUrl: string,
        timestamp: number,
        fetchOptions: LoadUrlOptions
    ): Promise<Record<string, unknown> | null> {
        const Loader = ConfigLoader;
        const themesFile = profile.Files?.themesFile;
        if (themesFile) {
            try {
                return (
                    (await Loader.fetchJson(
                        `${baseUrl}/${themesFile}?t=${timestamp}`,
                        fetchOptions
                    )) ?? null
                );
            } catch (err) {
                Log.warn("[ProfileLoader] Error loading themes.json:", err);
                return null;
            }
        }
        return (profile.themes as Record<string, unknown>) ?? null;
    },

    /**
     * Fetches the layers index file defined in `profile.Files.layersFile`.
     * @param profile - The profile object.
     * @param baseUrl - Base URL for resolving the layers file path.
     * @param timestamp - Cache-busting timestamp.
     * @param fetchOptions - Optional fetch configuration.
     * @returns The layers file record, or null if no `layersFile` is defined.
     */
    async _loadLayersFile(
        profile: ProfileWithFiles,
        baseUrl: string,
        timestamp: number,
        fetchOptions: LoadUrlOptions
    ): Promise<Record<string, unknown> | null> {
        const Loader = ConfigLoader;
        const layersFile = profile.Files?.layersFile;
        if (layersFile) {
            try {
                return (
                    (await Loader.fetchJson(
                        `${baseUrl}/${layersFile}?t=${timestamp}`,
                        fetchOptions
                    )) ?? null
                );
            } catch (err) {
                Log.warn("[ProfileLoader] Error loading layers.json:", err);
                return null;
            }
        }
        return null;
    },

    /**
     * Fetches an optional section file referenced in `profile.Files` (e.g. basemapsFile, uiFile).
     * Returns null silently if the file is not declared or fails to load.
     * @param profile - The profile object.
     * @param fileKey - Key in `profile.Files` pointing to the section file name.
     * @param baseUrl - Base URL for resolving the file path.
     * @param timestamp - Cache-busting timestamp.
     * @param fetchOptions - Optional fetch configuration.
     * @returns The section record, or null if unavailable.
     */
    async _loadSectionFile(
        profile: ProfileWithFiles,
        fileKey: keyof NonNullable<ProfileWithFiles["Files"]>,
        baseUrl: string,
        timestamp: number,
        fetchOptions: LoadUrlOptions
    ): Promise<Record<string, unknown> | null> {
        const Loader = ConfigLoader;
        const fileName = profile.Files?.[fileKey];
        if (!fileName) return null;
        try {
            return (
                (await Loader.fetchJson(`${baseUrl}/${fileName}?t=${timestamp}`, fetchOptions)) ??
                null
            );
        } catch (err) {
            Log.warn(`[ProfileLoader] Error loading ${String(fileKey)} (${fileName}):`, err);
            return null;
        }
    },

    /**
     * Fetches every plugin config file declared in `Files.modules` (profile
     * layout v2) and returns the resulting bag `{ moduleId: config }`.
     * Files are fetched in parallel; a missing or invalid file logs a warning
     * and is skipped (the module simply has no file-based config).
     * @param profile - The profile object.
     * @param baseUrl - Base URL for resolving plugin config file paths.
     * @param timestamp - Cache-busting timestamp.
     * @param fetchOptions - Optional fetch configuration.
     * @returns The module config bag, or null when `Files.modules` is absent/empty.
     */
    async _loadModuleFiles(
        profile: ProfileWithFiles,
        baseUrl: string,
        timestamp: number,
        fetchOptions: LoadUrlOptions
    ): Promise<Record<string, unknown> | null> {
        const Loader = ConfigLoader;
        const modulesMap = profile.Files?.modules;
        if (!modulesMap || typeof modulesMap !== "object") return null;
        const entries = Object.entries(modulesMap).filter(
            ([, filePath]) => typeof filePath === "string" && filePath.length > 0
        );
        if (entries.length === 0) return null;
        const results = await Promise.all(
            entries.map(async ([moduleId, filePath]) => {
                try {
                    const config = await Loader.fetchJson(
                        `${baseUrl}/${filePath}?t=${timestamp}`,
                        fetchOptions
                    );
                    return [moduleId, config ?? null] as const;
                } catch (err) {
                    Log.warn(`[ProfileLoader] Error loading Files.modules.${moduleId}:`, err);
                    return [moduleId, null] as const;
                }
            })
        );
        const bag: Record<string, unknown> = {};
        for (const [moduleId, config] of results) {
            // @security `moduleId` comes from the keys of the profile's `Files.modules`
            // block — untrusted JSON, so it can be `__proto__` and would re-parent the
            // bag through the inherited setter. Same guard as `mergeModulesBag`.
            if (isUnsafeKey(moduleId)) continue;
            if (config && typeof config === "object") bag[moduleId] = config;
        }
        return Object.keys(bag).length > 0 ? bag : null;
    },

    /**
     * Fetches individual layer configuration files for each layer reference.
     * Supports inline configs generated from template expansion (no HTTP fetch).
     * @param layersSource - Array of layer references with optional `configFile` or `inlineConfig`.
     * @param baseUrl - Base URL for resolving layer config file paths.
     * @param timestamp - Cache-busting timestamp.
     * @param fetchOptions - Optional fetch configuration.
     * @returns Array of layer config results with resolved config objects and layer directories.
     */
    async _loadLayerConfigs(
        layersSource: LayerRef[],
        baseUrl: string,
        timestamp: number,
        fetchOptions: LoadUrlOptions
    ): Promise<LayerConfigResult[]> {
        const Loader = ConfigLoader;
        if (!Array.isArray(layersSource) || layersSource.length === 0) return [];
        const promises = layersSource.map(async (layerRef) => {
            // Inline config from template expansion — no HTTP fetch needed
            if (layerRef.inlineConfig) {
                return {
                    id: layerRef.id,
                    config: layerRef.inlineConfig,
                    layerDirectory: `layers/${layerRef.id}`,
                    layerManagerId: layerRef.layerManagerId ?? null,
                };
            }
            if (!layerRef.configFile) {
                return {
                    id: layerRef.id,
                    config: null,
                    layerDirectory: null,
                    layerManagerId: layerRef.layerManagerId ?? null,
                };
            }
            const layerDirectory = layerRef.configFile.replace(/\/[^/]+$/, "");
            try {
                const layerConfig = await Loader.fetchJson(
                    `${baseUrl}/${layerRef.configFile}?t=${timestamp}`,
                    fetchOptions
                );
                return {
                    id: layerRef.id,
                    config: layerConfig,
                    layerDirectory,
                    layerManagerId: layerRef.layerManagerId ?? null,
                };
            } catch (err) {
                Log.error(`[ProfileLoader] Error loading ${layerRef.configFile}:`, err);
                return {
                    id: layerRef.id,
                    config: null,
                    layerDirectory,
                    layerManagerId: layerRef.layerManagerId ?? null,
                };
            }
        });
        return Promise.all(promises);
    },

    /**
     * Loads and hydrates a profile from a pre-built bundle file, replacing the
     * ~19-request cascade with a single HTTP fetch.
     *
     * Called automatically by `loadModularProfile()` when `profile.bundleFile` is set.
     * The bundle must have been generated at build time by `scripts/bundle-profiles.cjs`.
     *
     * @param profile     - The base profile object (already loaded from profile.json).
     * @param baseUrl     - Base URL for resolving the bundle file path.
     * @param profileId   - Identifier used for logging and metadata.
     * @param bundleFile  - Filename of the bundle (e.g. `"profile-bundle.json"`).
     * @param fetchOptions - Optional fetch configuration.
     * @returns The enriched profile record, equivalent to the result of `loadModularProfile()`.
     */
    async _loadBundledProfile(
        profile: ProfileWithFiles,
        baseUrl: string,
        profileId: string,
        bundleFile: string,
        fetchOptions: LoadUrlOptions
    ): Promise<Record<string, unknown>> {
        if (!ConfigLoader) throw new Error("GeoLeaf._ConfigLoader not available");
        Log.info(`[ProfileLoader] ${profileId} — loading bundle: ${bundleFile}`);
        try {
            const bundle = (await ConfigLoader.fetchJson(
                `${baseUrl}/${bundleFile}`,
                fetchOptions
            )) as Record<string, unknown>;
            return this._processBundle(bundle, profile, baseUrl, profileId);
        } catch (error) {
            Log.error("[ProfileLoader] Error loading bundle, falling back to cascade:", error);
            // Fall back to cascade on bundle load failure
            return this._loadModularProfileCascade(
                profile,
                baseUrl,
                profileId,
                Date.now(),
                fetchOptions
            );
        }
    },

    /** Assembles the enriched profile from an already-fetched bundle payload. */
    _processBundle(
        bundle: Record<string, unknown>,
        profile: ProfileWithFiles,
        baseUrl: string,
        profileId: string
    ): Record<string, unknown> {
        const layersFileData = (bundle.layersFile as Record<string, unknown>) ?? null;
        const layerConfigsMap =
            (bundle.layerConfigs as Record<string, Record<string, unknown>>) ?? {};

        // Mirror the same merge/expand logic as the cascade (basemaps/ui/features + modules).
        // Insertion conditionnelle sur les quatre sections : elles alimentent le MERGE de
        // profil. Une section présente valant `undefined` y écraserait la valeur en cascade,
        // là où une section absente la laisse intacte — c'est précisément la distinction que
        // `exactOptionalPropertyTypes` rend visible, et le seul endroit du kernel où elle
        // porte sur la configuration livrée à l'intégrateur.
        const { mergedProfile, expandedLayers } = this._mergeAndExpand(profile, profileId, {
            ...(bundle.basemaps !== undefined && {
                basemaps: bundle.basemaps as Record<string, unknown>,
            }),
            ...(bundle.ui !== undefined && { ui: bundle.ui as Record<string, unknown> }),
            ...(bundle.features !== undefined && {
                features: bundle.features as Record<string, unknown>,
            }),
            ...(bundle.modules !== undefined && {
                modulesBag: bundle.modules as Record<string, unknown>,
            }),
            layersFileData,
        });

        // Resolve configs: bundled map for static layers, inlineConfig for templates
        const layersConfigs = _resolveBundledLayerConfigs(expandedLayers, layerConfigsMap);

        const enrichedProfile = this._buildEnrichedProfile({
            profile: mergedProfile,
            baseUrl,
            profileId,
            themes: (bundle.themes as Record<string, unknown>) ?? null,
            mapping: (bundle.mapping as Record<string, unknown>) ?? null,
            layersSource: expandedLayers,
            layersConfigs,
        });
        Log.info("[ProfileLoader] bundle loaded", {
            profileId,
            hasThemes: !!enrichedProfile.themes,
            layersCount: (enrichedProfile.layers as unknown[] | undefined)?.length ?? 0,
        });
        return enrichedProfile;
    },

    /**
     * Core cascade implementation of `loadModularProfile` — used as fallback when bundle loading fails.
     * @internal
     */
    async _loadModularProfileCascade(
        profile: ProfileWithFiles,
        baseUrl: string,
        profileId: string,
        timestamp: number,
        fetchOptions: LoadUrlOptions
    ): Promise<Record<string, unknown>> {
        const [
            themesData,
            layersFileData,
            basemapsData,
            uiData,
            featuresData,
            mappingData,
            moduleFilesBag,
        ] = await Promise.all([
            this._loadThemes(profile, baseUrl, timestamp, fetchOptions),
            this._loadLayersFile(profile, baseUrl, timestamp, fetchOptions),
            this._loadSectionFile(profile, "basemapsFile", baseUrl, timestamp, fetchOptions),
            this._loadSectionFile(profile, "uiFile", baseUrl, timestamp, fetchOptions),
            this._loadSectionFile(profile, "featuresFile", baseUrl, timestamp, fetchOptions),
            this._loadSectionFile(profile, "mappingFile", baseUrl, timestamp, fetchOptions),
            this._loadModuleFiles(profile, baseUrl, timestamp, fetchOptions),
        ]);
        const { mergedProfile, expandedLayers } = this._mergeAndExpand(profile, profileId, {
            basemaps: basemapsData,
            ui: uiData,
            features: featuresData,
            modulesBag: moduleFilesBag,
            layersFileData,
        });
        const layersConfigs = await this._loadLayerConfigs(
            expandedLayers,
            baseUrl,
            timestamp,
            fetchOptions
        );
        return this._buildEnrichedProfile({
            profile: mergedProfile,
            baseUrl,
            profileId,
            themes: themesData,
            mapping: mappingData,
            layersSource: expandedLayers,
            layersConfigs,
        });
    },

    /**
     * Shared assembly tail for both load paths: spreads section-file data into the
     * profile, merges the plugin-config bag, validates, then expands layer templates.
     */
    _mergeAndExpand(
        profile: ProfileWithFiles,
        profileId: string,
        parts: {
            basemaps?: Record<string, unknown> | null;
            ui?: Record<string, unknown> | null;
            features?: Record<string, unknown> | null;
            modulesBag?: Record<string, unknown> | null;
            layersFileData: Record<string, unknown> | null;
        }
    ): { mergedProfile: ProfileWithFiles; expandedLayers: LayerRef[] } {
        const mergedProfile: ProfileWithFiles = {
            ...profile,
            ...(parts.basemaps ?? undefined),
            ...(parts.ui ?? undefined),
            ...(parts.features ?? undefined),
        };
        // Plugin config bag: files first, inline modules block overrides per module.
        const mergedModules = _mergeModuleBags(parts.modulesBag, profile.modules);
        if (mergedModules) mergedProfile.modules = mergedModules;
        this._validateProfile(mergedProfile as Record<string, unknown>, profileId);
        const layersSource = _extractRawLayers(parts.layersFileData) || mergedProfile.layers || [];
        const expandedLayers = _expandLayerTemplates(layersSource, parts.layersFileData);
        return { mergedProfile, expandedLayers };
    },

    /**
     * Assembles the final enriched profile from all fetched sub-resources.
     *
     * ⚠️ The keys it sets are exactly: `basePath`, `_profileId`, `themes`, `mapping`, `layers`
     * (plus the spread of the base profile). Notably NOT `taxonomy` and NOT `icons` — readers
     * expecting either on the active profile get `undefined`, silently. That was bug C-8
     * (AddPOI category lists, fixed 16/07): consume the capability
     * (`GeoLeaf.Taxonomy.getLayerCategories`) or the offline seam
     * (`CacheStorage.loadProfileConfig`, which hydrates `icons` from `Files.modules.taxonomy`).
     * Adding a key here means feeding it too — declaring one the loader never populates is
     * precisely how the sprite went uncached for months (C-7).
     *
     * @param params - Object containing the base profile, themes, mapping, layersSource, and layersConfigs.
     * @returns The enriched profile record with resolved layers, themes, mapping, and metadata.
     */
    _buildEnrichedProfile(params: EnrichedProfileParams): Record<string, unknown> {
        const { profile, baseUrl, profileId, themes, mapping, layersSource, layersConfigs } =
            params;
        const enrichedProfile: Record<string, unknown> = { ...profile };
        enrichedProfile.basePath = baseUrl;
        enrichedProfile._profileId = profileId;
        if (themes) enrichedProfile.themes = themes;
        if (mapping) enrichedProfile.mapping = mapping;
        if (layersConfigs?.length > 0) {
            enrichedProfile.layers = layersConfigs.map((layerData) => {
                if (layerData.config) {
                    const normalized = {
                        ...layerData.config,
                        _layerDirectory: layerData.layerDirectory,
                        _profileId: profileId,
                        layerManagerId:
                            layerData.layerManagerId ||
                            (layerData.config.layerManagerId as string) ||
                            "geojson-default",
                    } as Record<string, unknown>;
                    // ⚠️ La dérivation vit dans `layerDataPath` depuis la tâche 4.2, et non
                    // plus ici : le chemin de cache hors-ligne en avait besoin AUSSI, la
                    // refaire là-bas aurait fait deux endroits libres de diverger. Le helper
                    // rend `dataFile` tel quel quand il est déjà posé, donc l'ancien garde
                    // `!normalized.dataFile` est porté par lui.
                    const derived = layerDataPath(
                        normalized as { dataFile?: unknown; data?: unknown }
                    );
                    if (derived) normalized.dataFile = derived;
                    return normalized;
                }
                const original = (layersSource as LayerRef[]).find((l) => l.id === layerData.id);
                return original ?? { id: layerData.id, error: "Failed to load config" };
            });
        }
        return enrichedProfile;
    },

    /**
     * Validates a loaded profile object against minimum structural requirements.
     * Logs warnings for each violation — non-blocking, does not throw.
     *
     * Checks: required `id`, `map.bounds` recommended, `Files` keys are strings,
     * `layers` is an array if present.
     *
     * @param profile - The raw profile object to validate.
     * @param profileId - Identifier used in warning messages.
     */
    _validateProfile(profile: Record<string, unknown>, profileId: string): void {
        const warn = (msg: string) =>
            Log.warn(`[ProfileLoader] Schema warning (${profileId}): ${msg}`);

        if (!profile.id) warn('"id" is required in profile.json');

        const map = profile.map as Record<string, unknown> | undefined;
        if (map && !map.bounds && !map.center) {
            warn('"map.bounds" or "map.center" is recommended');
        }
        if (map) _validateMapCenter(map, warn);

        const files = profile.Files as Record<string, unknown> | undefined;
        if (files) _validateFiles(files, warn);

        if (profile.layers !== undefined && !Array.isArray(profile.layers)) {
            warn('"layers" must be an array');
        }

        const basemaps = profile.basemaps as Record<string, unknown> | undefined;
        if (basemaps) _validateBasemaps(basemaps, warn);
    },

    /**
     * Determines whether a profile uses the modular format (has `Files` object or version ≥ 1.2).
     * @param profile - The profile object to inspect.
     * @returns `true` if the profile is modular, `false` otherwise.
     */
    isModularProfile(profile: unknown): boolean {
        if (!profile || typeof profile !== "object") return false;
        const p = profile as ProfileWithFiles;
        if (p.Files && typeof p.Files === "object") return true;
        if (p.version) {
            const versionMatch = /^(\d+)\.(\d+)/.exec(String(p.version));
            if (versionMatch) {
                const major = Number.parseInt(versionMatch[1] ?? "", 10);
                const minor = Number.parseInt(versionMatch[2] ?? "", 10);
                return major > 1 || (major === 1 && minor >= 2);
            }
        }
        return false;
    },
};

export { ProfileLoader };
