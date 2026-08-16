/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Theme Applier - Core
 * Module state, init/cleanup, applyTheme orchestration, getCurrentThemeId
 */

import { Config } from "../../config/config-primitives.js";
import { Legend } from "../../../api/geoleaf.legend.js";
import { LayerManager } from "../../../api/geoleaf.layer-manager.js";
import { GeoJSONCore } from "../../geojson/core.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import type { LayerAttributes } from "../../../contracts/attributes.contract.js";
import type { LayerWriteTarget } from "../../../contracts/sync.contract.js";

// ── Shared structural types (S2.2 — theme-applier) ──────────────────────────
// Loose JSON shapes for theme configuration, shared across the theme-applier
// files (deferred.ts / visibility.ts / ui-sync.ts import these). Only fields
// actually read across the cluster are declared — no index signature.

/** A single layer entry inside a theme's `layers[]`. */
export interface ThemeLayerConfig {
    id?: string;
    visible?: boolean;
    style?: string;
}

/** A theme descriptor (loose JSON read from the active profile). */
export interface ThemeConfig {
    id: string;
    name?: string;
    label?: string;
    layers?: ThemeLayerConfig[];
    config?: Record<string, unknown>;
}

/** Options accepted by `applyTheme`. */
interface ApplyThemeOptions {
    fitBounds?: boolean;
}

/** Bounds shape used by the fit-bounds path. */
export interface ThemeBounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

/** Pending per-layer config queued while a layer is not yet registered. */
interface PendingLayerConfig {
    visible: boolean;
    styleId: string | undefined;
}

/**
 * Full structural type of the `_ThemeApplier` module object. Members are
 * attached across four files (core/deferred/visibility/ui-sync); each file
 * casts the shared `ThemeApplierCore` binding to this interface.
 */
export interface ThemeApplierModule {
    // ── State ──
    _currentThemeId: string | null;
    _isFirstLoad: boolean;
    _pendingLayerConfigs: Map<string, PendingLayerConfig>;
    _pendingCheckTimer: ReturnType<typeof setTimeout> | null;

    // ── core.ts ──
    _init(): void;
    _cleanup(): void;
    applyTheme(theme: ThemeConfig, options?: ApplyThemeOptions): Promise<void>;
    _applyThemeLayers(theme: ThemeConfig, options: ApplyThemeOptions): Promise<void>;
    getCurrentThemeId(): string | null;

    // ── deferred.ts ──
    _scheduleLayerConfig(
        layerId: string,
        visible: boolean,
        styleId: string | undefined
    ): Promise<void>;
    _schedulePendingCheck(): void;
    _checkPendingLayerConfigs(): void;
    _loadLayerFromProfile(layerId: string): Promise<unknown>;
    _resolveDataFilePath(layerConfig: ProfileLayerConfig): string | null;
    _getProfilesBasePath(activeProfile: ActiveProfile): string;
    _normalizeBasePath(path: string): string;

    // ── visibility.ts ──
    _hideAllLayers(): void;
    _applyLayerConfig(layerConfig: ThemeLayerConfig): Promise<unknown>;
    _setLayerVisibilityAndStyle(
        layerId: string,
        visible: boolean,
        styleId: string | undefined
    ): Promise<unknown>;

    // ── ui-sync.ts ──
    _updateStyleSelector(layerId: string, styleId: string | undefined): void;
    _loadLegendForStyle(layerId: string, styleId: string | undefined): void;
    _fitBoundsOnAllLayers(): void;
    _syncLegendVisibility(): void;
}

/** Active profile descriptor (loose JSON, members read across the cluster). */
export interface ActiveProfile {
    id?: string;
    profilesBasePath?: string;
    geojsonLayers?: ProfileLayerConfig[];
    geojson?: { layers?: ProfileLayerConfig[] };
    layers?: ProfileLayerConfig[];
    Layers?: ProfileLayerConfig[];
    performance?: { themeBatchSize?: number };
}

/** Per-layer config as declared in a profile (loose JSON). */
export interface ProfileLayerConfig {
    id?: string;
    label?: string;
    style?: string;
    visible?: boolean;
    geometryType?: string;
    type?: string;
    dataFile?: string;
    _layerDirectory?: string;
    plugin?: unknown;
    data?: {
        url?: string;
        dataUrl?: string;
        vectorTiles?: { tilesUrl?: string };
    };
    clustering?: {
        enabled?: boolean;
        maxClusterRadius?: number;
        disableClusteringAtZoom?: number;
    };
    /**
     * The layer's attribute model — see `contracts/attributes.contract.ts`.
     *
     * Replaces three legacy members declared here and read by nothing:
     * `popup.fields`, `tooltip.fields` and `sidepanel.detailLayout`. That last one was
     * the third nesting level of a single `detailLayout` key spelled at three depths,
     * none of which the profile schema accepts.
     */
    attributes?: LayerAttributes;
    /**
     * Where this layer's edits are pushed — see `contracts/sync.contract.ts`.
     *
     * Declared per layer because on a backend such as Odoo each layer is a distinct
     * collection. Its absence is what makes a layer read-only offline: pulling a layer
     * for offline use never grants write access on its own.
     */
    write?: LayerWriteTarget;
}

/**
 * `Config` (ConfigInstance) is augmented at runtime with `get()`, `Profile`
 * and `getActiveProfile()`; narrow to the members actually read here.
 */
interface ConfigLike {
    get?(key: string): unknown;
    getActiveProfile?(): ActiveProfile | null | undefined;
    Profile?: { getActiveProfileConfig(): ActiveProfile | null | undefined };
}

const _Config = Config as unknown as ConfigLike;

function _showLegendOverlay() {
    if (Legend && typeof Legend.showLoadingOverlay === "function") {
        Legend.showLoadingOverlay();
    }
}
function _hideLegendOverlay() {
    if (Legend && typeof Legend.hideLoadingOverlay === "function") {
        Legend.hideLoadingOverlay();
    }
}
function _dispatchCustomEvent(name: string, detail: Record<string, unknown>) {
    try {
        document.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_e) {
        /* silent */
    }
}
function _refreshLayerManager() {
    if (LayerManager && LayerManager.refresh) {
        LayerManager.refresh();
    }
}

function _reapplyZoomVisibility() {
    // Canonical accessor rather than a local `globalThis as { GeoLeaf?: … }` block: it carries
    // the same globalThis→window fallback, and the local form is not assignable under
    // `exactOptionalPropertyTypes` (`var GeoLeaf: GeoLeafGlobal | undefined` is PRESENT holding
    // undefined, which `GeoLeaf?:` does not accept).
    const mgr = getGeoLeaf()?._GeoJSONLayerManager as
        { updateLayerVisibilityByZoom?: () => void } | undefined;
    if (mgr && typeof mgr.updateLayerVisibilityByZoom === "function") {
        mgr.updateLayerVisibilityByZoom();
    }
}

/** Window members assigned at runtime by the loading screen / perf tooling. */
interface LoadingWindow {
    _glLoadingScreen?: { updateProgress?: (p: number) => void };
    __GEOLEAF_PERF__?: boolean;
}

function _updateLoadingProgress(p: number): void {
    try {
        const w = window as unknown as LoadingWindow;
        if (
            typeof window !== "undefined" &&
            w._glLoadingScreen &&
            typeof w._glLoadingScreen.updateProgress === "function"
        ) {
            w._glLoadingScreen.updateProgress(p);
        }
    } catch (_e) {
        /* ignore */
    }
}

async function _loadLayersInBatches(
    visibleLayers: ThemeLayerConfig[],
    batchSize: number,
    applyFn: (cfg: ThemeLayerConfig) => Promise<unknown>
): Promise<void> {
    // R-perf S1 — measure per-batch duration (active only when __GEOLEAF_PERF__).
    const _perf =
        typeof window !== "undefined" && (window as unknown as LoadingWindow).__GEOLEAF_PERF__
            ? true
            : false;
    if (_perf) {
        getLog().info(`[Perf][batch] batchSize=${batchSize} couches=${visibleLayers.length}`);
    }
    for (let i = 0; i < visibleLayers.length; i += batchSize) {
        const batch = visibleLayers.slice(i, i + batchSize);
        const _tBatch = _perf ? performance.now() : 0;
        await Promise.all(batch.map((layerConfig: ThemeLayerConfig) => applyFn(layerConfig)));
        if (_perf) {
            getLog().info(
                `[Perf][batch] #${i / batchSize} taille=${batch.length} dur=${(
                    performance.now() - _tBatch
                ).toFixed(1)}ms`
            );
        }
        if (i === 0) {
            _updateLoadingProgress(98);
        }
    }
}

/**
 * Theme Applier module
 * @namespace _ThemeApplier
 * @private
 */
const _ThemeApplier = {
    /** @type {string|null} Currently active theme */
    _currentThemeId: null as string | null,

    /** @type {boolean} Flag pour savoir si c'est le premier loading */
    _isFirstLoad: true,

    /**
     * Initializes the ThemeApplier
     * @private
     */
    _init(this: ThemeApplierModule) {
        this._pendingLayerConfigs = new Map();
        this._pendingCheckTimer = null;
    },

    /**
     * Nettoie les ressources
     * @private
     */
    _cleanup(this: ThemeApplierModule) {
        if (this._pendingCheckTimer) {
            clearTimeout(this._pendingCheckTimer);
            this._pendingCheckTimer = null;
        }
        if (this._pendingLayerConfigs) {
            this._pendingLayerConfigs.clear();
        }
    },

    /**
     * Applies a theme
     * @param this - The theme-applier module. The method is invoked bound to it, so the
     *   receiver is part of the signature — and TSD-02 counts it as a parameter.
     * @param {Object} theme - Configuration of the theme
     * @param {Object} [options] - Options d'application
     * @param {boolean} [options.fitBounds] - Force le fitBounds
     * @returns {Promise<void>}
     */
    applyTheme(
        this: ThemeApplierModule,
        theme: ThemeConfig,
        options: ApplyThemeOptions = {}
    ): Promise<void> {
        if (!this._pendingLayerConfigs) {
            this._init();
        }
        _showLegendOverlay();

        if (!theme || !theme.id) {
            return Promise.reject(new Error("Invalid theme"));
        }
        if (!GeoJSONCore || !LayerManager) {
            return Promise.reject(new Error("GeoJSON or LayerManager modules not available"));
        }

        _dispatchCustomEvent("geoleaf:theme:applying", {
            themeId: theme.id,
            themeName: theme.name || theme.label || theme.id,
        });

        return this._applyThemeLayers(theme, options);
    },

    _applyThemeLayers(
        this: ThemeApplierModule,
        theme: ThemeConfig,
        options: ApplyThemeOptions
    ): Promise<void> {
        this._hideAllLayers();

        const layerConfigs = theme.layers || [];
        const profileConfig = _Config?.Profile?.getActiveProfileConfig();
        const perfConfig: { themeBatchSize?: number } = profileConfig?.performance || {};
        const enableFitBounds = false;
        const visibleLayers = layerConfigs.filter((cfg: ThemeLayerConfig) => cfg.visible !== false);
        // 🔻 Default raised from 3 to 6 on 07/08/2026 (S5.1), to match the loader's Phase 1 cap
        // (`PHASE1_BATCH_SIZE`). ⚠️ This is the SECOND cap on the reveal path and the roadmap
        // counted only the first: `_loadLayersInBatches` re-serialises the very same layers the
        // loader just finished, immediately before `geoleaf:theme:applied` fires. Leaving this
        // one at 3 would have kept a bottleneck of 3 right behind a loader freed to 6, and the
        // measured gain would have fallen short of the announced one for no visible reason.
        // An explicit `performance.themeBatchSize` still wins — no profile in this repo sets it.
        const BATCH_SIZE = perfConfig.themeBatchSize || 6;
        const self = this;

        return _loadLayersInBatches(visibleLayers, BATCH_SIZE, (cfg) => this._applyLayerConfig(cfg))
            .then(() => {
                _updateLoadingProgress(98);
                return Promise.resolve();
            })
            .then(() => {
                _updateLoadingProgress(99);
                self._currentThemeId = theme.id;
                _refreshLayerManager();
                _reapplyZoomVisibility();
                self._syncLegendVisibility();
                _dispatchCustomEvent("geoleaf:theme:applied", {
                    themeId: theme.id,
                    themeName: theme.name || theme.label || theme.id,
                    layerCount: visibleLayers.length,
                    totalLayersInTheme: layerConfigs.length,
                    timestamp: new Date().toISOString(),
                });
                const shouldFitBounds =
                    options.fitBounds === true || (self._isFirstLoad && enableFitBounds);
                if (shouldFitBounds) {
                    setTimeout(() => {
                        self._fitBoundsOnAllLayers();
                    }, 1000);
                    self._isFirstLoad = false;
                }
            })
            .catch((err) => {
                throw err;
            })
            .finally(() => {
                _hideLegendOverlay();
            });
    },

    /**
     * Retrieves the ID of the theme currentlement active
     * @returns {string|null}
     */
    getCurrentThemeId(this: ThemeApplierModule): string | null {
        return this._currentThemeId;
    },
};

// The full module shape is assembled across deferred/visibility/ui-sync, which
// attach the remaining members onto this binding; cast to the complete type.
const _ThemeApplierTyped = _ThemeApplier as unknown as ThemeApplierModule;

export { _ThemeApplierTyped as ThemeApplierCore };
