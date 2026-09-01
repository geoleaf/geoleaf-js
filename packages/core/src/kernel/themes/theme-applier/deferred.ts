/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Theme Applier - Deferred
 * Deferred layer loading, profile resolution, cache management
 */

/**
 * @sideEffectGraft packages/core/src/globals/globals.ui.ts
 *
 * ✅ ASSUMED as a module-level state, decided 24-25/08/2026 — not a side effect awaiting
 * conversion. Converting the graft to plain exports would force the anchor to know every
 * member it re-exports, for nothing measurable: the graft is declared (this mark), anchored
 * (the bare import the mark names), and guarded (the graft gate reddens if either
 * disappears). What would REOPEN the decision is a second writer grafting onto the same
 * base — not a re-reading of this file.
 *
 * ⚠️ **SIDE-EFFECT module**: grafts 7 members onto `ThemeApplierCore` at import;
 * `core.ts` CALLS them without defining them. It exports nothing that is consumed, so
 * no dead-code instrument can see it live — ESLint, `check-orphan-exports` and a
 * human read all declared it dead **in concert, and all three were wrong**. A
 * side-effect module has no consumer, by definition.
 *
 * **Its only anchor is a BARE import in `globals.ui.ts`.** Removing it drops
 * this file from the graph **silently**: the test suite stays green, and the
 * symptom is a production `TypeError`. It happened (July 2026, caught within the
 * hour). `GRAFT-03` now guards that the anchor still imports it.
 */
import { ThemeApplierCore as _TA } from "./core.js";
import type { ActiveProfile, ProfileLayerConfig, ThemeApplierModule } from "./core.js";
import { Config } from "../../config/config-primitives.js";
import { GeoJSONShared } from "../../shared/geojson-state.js";
import { LoaderSingleLayer } from "../../geojson/loader/single-layer.js";
import { resolveClusteringNormalization } from "../../geojson/loader/clustering-normalize.js";
import { ThemeCache } from "../theme-cache.js";
import { Log } from "../../../utils/log/index.js";

const TA: ThemeApplierModule = _TA;

/** `Config` augmented at runtime with `get()` and `getActiveProfile()`. */
interface ConfigLike {
    get?(key: string): unknown;
    getActiveProfile?(): ActiveProfile | null | undefined;
}
const _Config = Config as unknown as ConfigLike;

/**
 * Schedules a layer configuration to be applied later
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - Desired visibility
 * @param {string} styleId - Style ID to apply
 * @returns {Promise<void>}
 * @private
 */
// NOTE (F1): reached via _applyLayerConfig's ADD branch (visibility.ts) as the fallback
// when a to-be-shown layer fails to (re)load on theme switch. NOT dead under F0's drop
// model — keep this pending cluster (_scheduleLayerConfig / _schedulePendingCheck /
// _checkPendingLayerConfigs). See CDC_capacite-theme-selector.md §8.1bis.
TA._scheduleLayerConfig = function (
    layerId: string,
    visible: boolean,
    styleId: string | undefined
) {
    if (!TA._pendingLayerConfigs) {
        TA._pendingLayerConfigs = new Map();
    }

    TA._pendingLayerConfigs.set(layerId, { visible, styleId });

    // Schedule a periodic check
    TA._schedulePendingCheck();

    return Promise.resolve();
};

/**
 * Schedules a check of the pending layers
 * @private
 */
TA._schedulePendingCheck = function () {
    if (TA._pendingCheckTimer) {
        return; // Already scheduled
    }

    TA._pendingCheckTimer = setTimeout(() => {
        TA._checkPendingLayerConfigs();
        TA._pendingCheckTimer = null;
    }, 1000);
};

/**
 * Checks and applies pending layer configurations
 * @private
 */
TA._checkPendingLayerConfigs = function () {
    if (!TA._pendingLayerConfigs || TA._pendingLayerConfigs.size === 0) {
        return;
    }

    const appliedLayers = [];

    for (const [layerId, config] of TA._pendingLayerConfigs) {
        const layerData = GeoJSONShared.state.layers?.get(layerId);
        if (layerData) {
            TA._setLayerVisibilityAndStyle(layerId, config.visible, config.styleId).catch(
                (e: unknown) =>
                    Log?.error(`[ThemeApplier] Deferred apply failed for "${layerId}":`, e)
            );
            appliedLayers.push(layerId);
        }
    }

    // Removes processed layers
    appliedLayers.forEach((layerId) => {
        TA._pendingLayerConfigs.delete(layerId);
    });

    // If layers are still pending, schedule another check
    if (TA._pendingLayerConfigs.size > 0) {
        TA._schedulePendingCheck();
    }
};

function _getProfileLayers(activeProfile: ActiveProfile): ProfileLayerConfig[] {
    if (Array.isArray(activeProfile.geojsonLayers)) return activeProfile.geojsonLayers;
    if (activeProfile.geojson && Array.isArray(activeProfile.geojson.layers))
        return activeProfile.geojson.layers;
    if (Array.isArray(activeProfile.layers)) return activeProfile.layers;
    if (Array.isArray(activeProfile.Layers)) return activeProfile.Layers;
    return [];
}

function _layerType(lc: ProfileLayerConfig): string {
    if (lc.geometryType) return lc.geometryType;
    if (lc.type) return lc.type;
    return "geojson";
}

/** Build-up layer definition: the source config plus normalisation-time fields. */
interface DeferredLayerDef extends Omit<ProfileLayerConfig, "clustering"> {
    url?: string;
    _profileId?: string | null;
    // Normalisation overwrites the source `clustering` object with a boolean flag.
    clustering?: ProfileLayerConfig["clustering"] | boolean;
    maxClusterRadius?: number;
    clusterRadius?: number;
    disableClusteringAtZoom?: number;
    _cachedData?: unknown;
}

function _normalizeDeferredLayerDef(
    layerDef: DeferredLayerDef,
    cachedData: unknown
): DeferredLayerDef {
    const normalizedDef: DeferredLayerDef = { ...layerDef };
    const clusteringPatch = resolveClusteringNormalization(layerDef.clustering);
    if (clusteringPatch) Object.assign(normalizedDef, clusteringPatch);
    if (cachedData) normalizedDef._cachedData = cachedData;
    return normalizedDef;
}

/** Loader signature: `LoaderSingleLayer._loadSingleLayer`. */
type SingleLayerLoader = (
    this: unknown,
    layerId: string,
    layerLabel: string,
    normalizedDef: DeferredLayerDef,
    options: Record<string, unknown>
) => Promise<unknown>;

async function _loadAndCache(
    loader: SingleLayerLoader,
    layerId: string,
    layerLabel: string,
    normalizedDef: DeferredLayerDef,
    profileId: string | null,
    cachedData: unknown
): Promise<unknown> {
    const layer = await loader.call(LoaderSingleLayer, layerId, layerLabel, normalizedDef, {});
    if (cachedData && ThemeCache && typeof ThemeCache.store === "function") {
        await ThemeCache.store(layerId, profileId, cachedData);
    }
    return layer;
}

async function _getCachedData(layerId: string, profileId: string | null): Promise<unknown> {
    if (ThemeCache && typeof ThemeCache.get === "function") {
        return await ThemeCache.get(layerId, profileId);
    }
    return null;
}

async function _buildAndLoadLayer(
    loader: SingleLayerLoader,
    layerId: string,
    layerConfig: ProfileLayerConfig,
    dataUrl: string,
    profileId: string | null
): Promise<unknown> {
    const layerLabel = layerConfig.label ? layerConfig.label : layerId;
    const cachedData = await _getCachedData(layerId, profileId);
    const layerDef: DeferredLayerDef = {
        ...layerConfig,
        url: dataUrl,
        type: _layerType(layerConfig),
        _profileId: profileId,
        // `_layerDirectory` was re-stated here although `...layerConfig` already carries it
        // (it is declared on `ProfileLayerConfig`). Inert today — same source both ways — but it
        // is literally the overwrite shape: an explicit key placed AFTER a spread. Removed.
    };
    const normalizedDef = _normalizeDeferredLayerDef(layerDef, cachedData);
    try {
        return await _loadAndCache(
            loader,
            layerId,
            layerLabel,
            normalizedDef,
            profileId,
            cachedData
        );
    } catch (err: unknown) {
        Log.warn(
            `[ThemeApplier._loadLayerFromProfile] Erreur loading layer "${layerId}":`,
            err ? (err as { message?: unknown }).message : err
        );
        return null;
    }
}

function _getActiveProfileAndLayers(
    layerId: string
): { layerConfig: ProfileLayerConfig; dataUrl: string; profileId: string | null } | null {
    const activeProfile = _Config.getActiveProfile?.();
    if (!activeProfile || typeof activeProfile !== "object") return null;
    const profileLayersConfig = _getProfileLayers(activeProfile);
    if (profileLayersConfig.length === 0) return null;
    const layerConfig = profileLayersConfig.find(
        (config: ProfileLayerConfig) => config.id === layerId
    );
    if (!layerConfig) return null;
    const dataUrl = TA._resolveDataFilePath(layerConfig);
    if (!dataUrl) return null;
    return { layerConfig, dataUrl, profileId: activeProfile.id ?? null };
}

/**
 * Loads a layer from the active profile (with error tolerance)
 * @param {string} layerId - ID de the layer to load
 * @returns {Promise<Object|null>} - Couche loadede ou null si error
 * @private
 */
TA._loadLayerFromProfile = async function (layerId: string) {
    if (!Config || typeof _Config.getActiveProfile !== "function") return null;
    try {
        const found = _getActiveProfileAndLayers(layerId);
        if (!found) return null;
        const loader = LoaderSingleLayer._loadSingleLayer as unknown as
            SingleLayerLoader | undefined;
        if (!loader) return null;
        return await _buildAndLoadLayer(
            loader,
            layerId,
            found.layerConfig,
            found.dataUrl,
            found.profileId
        );
    } catch (error: unknown) {
        Log.warn(
            `[ThemeApplier._loadLayerFromProfile] Erreur inexpectede pour "${layerId}":`,
            error ? (error as { message?: unknown }).message : error
        );
        return null;
    }
};

/**
 * Resolves a layer's data file path
 * @param {Object} layerConfig - Layer configuration
 * @returns {string|null} - Full data file URL
 * @private
 */
TA._resolveDataFilePath = function (layerConfig: ProfileLayerConfig) {
    // Plugin-backed layer (e.g. flatgeobuf): the URL lives in data.url and the plugin
    // renders it. Return a non-null value so the layer is not skipped here — the actual
    // dispatch happens in _loadSingleLayer (which delegates to the plugin loader).
    if (layerConfig.plugin && typeof layerConfig.data?.url === "string") {
        return layerConfig.data.url;
    }

    // Remote GeoJSON URL declared via data.dataUrl (WFS, opendata APIs, etc.)
    if (typeof layerConfig.data?.dataUrl === "string") {
        return layerConfig.data.dataUrl;
    }

    // Vector tiles — return the tilesUrl so the layer is not skipped.
    // shouldUseVectorTiles() detects def.data.vectorTiles in _loadSingleLayer.
    if (layerConfig.data?.vectorTiles && typeof layerConfig.data.vectorTiles === "object") {
        const vt = layerConfig.data.vectorTiles;
        const vtUrl = vt.tilesUrl;
        if (vtUrl) return vtUrl;
    }

    // Local data file referenced by dataFile + _layerDirectory
    if (!layerConfig.dataFile || !layerConfig._layerDirectory) {
        return null;
    }

    if (!Config || !_Config.getActiveProfile) {
        return null;
    }

    const activeProfile = _Config.getActiveProfile();
    if (!activeProfile) {
        return null;
    }

    const profileId = activeProfile.id;
    const profileBasePath = TA._getProfilesBasePath(activeProfile);

    return `${profileBasePath}/${profileId}/${layerConfig._layerDirectory}/${layerConfig.dataFile}`;
};

/**
 * Resolves the profiles base path
 * @private
 */
TA._getProfilesBasePath = function (activeProfile: ActiveProfile) {
    const configured = _Config?.get?.("data.profilesBasePath");

    if (typeof configured === "string" && configured.trim().length > 0) {
        return TA._normalizeBasePath(configured);
    }

    if (activeProfile && typeof activeProfile.profilesBasePath === "string") {
        return TA._normalizeBasePath(activeProfile.profilesBasePath);
    }

    return "profiles";
};

/**
 * Normalises a path (trim + strips the trailing /)
 * @private
 */
TA._normalizeBasePath = function (path: string) {
    const trimmed = path.trim();
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

export { TA as ThemeApplierDeferred };
