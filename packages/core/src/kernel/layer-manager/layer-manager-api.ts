/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf LayerManager API (LayerManager namespace assembly)
 */

/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import {
    _applyLayerManagerConfig,
    _resolveBasemapDefs,
    _buildAutoBasemapSections,
    _createLayerEntry,
    _resolveMap,
} from "./layer-manager-helpers.js";
import { registerLifecycleTeardown } from "../shared/lifecycle.js";
import type {
    LMSection,
    LMConfig,
    LMControlInstance,
    LMLayerEntryOptions,
    LMGlobalLike,
    LMGlobalNamespace,
} from "./layer-manager-helpers.js";

/** Options accepted by `_registerGeoJsonLayer` (layer entry fields + section routing). */
interface RegisterLayerOptions extends LMLayerEntryOptions {
    layerManagerId?: string;
    legendSection?: string;
    legendSectionLabel?: string;
}

/** The `GeoLeaf` namespace members read/written by this aggregator. */
interface LMNamespace extends LMGlobalNamespace {
    Log?: { debug: (...args: unknown[]) => void };
    _LayerManagerControl?: {
        create: (options: LayerManagerOptions) => LMControlInstance | null;
    };
}

/** Host object carrying the `GeoLeaf` namespace (globalThis / window). */
interface LMHost extends LMGlobalLike {
    GeoLeaf: LMNamespace;
}

const _g: LMHost = (typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : ({} as LMHost)) as unknown as LMHost;

_g.GeoLeaf = _g.GeoLeaf || {};

/** Builds the default LayerManager options (a fresh object on each call). */
function _defaultLayerManagerOptions(): LayerManagerOptions {
    return {
        position: "bottomright",
        title: getLabel("ui.layer_manager.title"),
        collapsible: true,
        collapsed: false,
        sections: [] as LMSection[],
    };
}

/** Internal options object held by the LayerManager module. */
interface LayerManagerOptions {
    position: string;
    title: string;
    collapsible: boolean;
    collapsed: boolean;
    sections: LMSection[];
    map?: unknown;
    [key: string]: unknown;
}

/**
 * Module GeoLeaf.LayerManager (REFACTORED v1.0)
 *
 * MODULAR ARCHITECTURE:
 * - layer-manager/control.js : Control
 * - layer-manager/renderer.js: renders sections and items
 * - layer-manager/basemap-selector.js : basemap selector
 * - layer-manager/theme-selector.js : theme selector
 * - geoleaf.layer-manager.js (this file): Public aggregator/facade
 *
 * REQUIRED DEPENDENCIES (loaded before this module):
 * - layer-manager/renderer.js → GeoLeaf._LayerManagerRenderer
 * - layer-manager/basemap-selector.js → GeoLeaf._LayerManagerBasemapSelector
 * - layer-manager/theme-selector.js → GeoLeaf._LayerManagerThemeSelector
 * - layer-manager/control.js → GeoLeaf._LayerManagerControl
 *
 * Role:
 * - Creates a layer manager control for GeoLeaf
 * - Displays structured sections (basemaps, layers, categories)
 * - Supports a collapsible mode
 * - Preparation for integration with the Legend module (Phase 6)
 */

const LayerManagerModule = {
    /**
     * Reference to the map
     * @type {unknown}
     * @private
     */
    _map: null as unknown,
    /**
     * Reference to the legend control
     * @type {unknown}
     * @private
     */
    _control: null as LMControlInstance | null,
    /**
     * Timeout backing the refresh debounce
     * @type {number|null}
     * @private
     */
    _refreshTimeout: null as ReturnType<typeof setTimeout> | null,
    /**
     * Module-internal options
     * @type {Object}
     * @private
     */
    _options: _defaultLayerManagerOptions(),
    /**
     * Initialization of the module LayerManager
     *
     * @param {Object} options
     * @param {unknown} [options.map] - Map (falls back to GeoLeaf.Core.getMap() when absent)
     * @param {string} [options.position]
     * @param {string} [options.title]
     * @param {boolean} [options.collapsible]
     * @param {boolean} [options.collapsed]
     * @param {Array} [options.sections]
     * @returns {unknown} - The LayerManager control, or null
     */
    /**
     * Mounts the layer-manager panel.
     *
     * Called without arguments, everything comes from the profile configuration — the
     * recommended path. Anything passed here overrides that, field by field.
     *
     * @param options - Position, title, and collapsible/collapsed state.
     *
     * @example
     * ```js
     * // Initialisation depuis config (recommandé)
     * GeoLeaf.LayerManager.init();
     *
     * // Avec options personnalisées
     * GeoLeaf.LayerManager.init({
     *     position: "bottomleft",
     *     collapsible: true,
     *     collapsed: false,
     *     title: "Couches",
     * });
     * ```
     */
    init(options: Partial<LayerManagerOptions> = {}) {
        const map = _resolveMap(options, _g);
        if (!map) {
            Log?.error(
                "[GeoLeaf.LayerManager] No map instance available. Pass one via init({ map })."
            );
            return null;
        }
        this._map = map;
        Log?.info("[GeoLeaf.LayerManager] init: map assigned");
        this._options = this._mergeOptions(this._options, options);
        // Load the sections from layerManagerConfig when available
        this._loadConfigSections();
        // Auto-fill the basemap section
        this._autoPopulateBasemap();
        // Minimal auto-fill when no section is declared
        this._autoPopulateSections();
        // Create the control through the sub-module
        if (!_g.GeoLeaf._LayerManagerControl) {
            Log?.error("[GeoLeaf.LayerManager] Module _LayerManagerControl not loaded");
            return null;
        }
        this._control = _g.GeoLeaf._LayerManagerControl.create(this._options);
        if (!this._control) {
            Log?.error("[GeoLeaf.LayerManager] Failed to create control");
            return null;
        }
        this._control.addTo(this._map);
        Log?.info("[GeoLeaf.LayerManager] Control created and added to map");
        return this._control;
    },
    /**
     * Loads the sections from the configuration
     * @private
     */
    _loadConfigSections() {
        if (!(_g.GeoLeaf.Config && typeof _g.GeoLeaf.Config.get === "function")) return;
        const layerManagerConfig = _g.GeoLeaf.Config.get("layerManagerConfig") as LMConfig | null;
        if (_g.GeoLeaf.Log)
            _g.GeoLeaf.Log.debug("[LayerManager] Configuration loaded:", {
                title: layerManagerConfig?.title,
                collapsed: layerManagerConfig?.collapsedByDefault,
                sectionsCount: layerManagerConfig?.sections?.length || 0,
            });
        if (layerManagerConfig) _applyLayerManagerConfig(layerManagerConfig, this._options);
    },
    /**
     * Auto-fills the basemap section
     * @private
     */
    _autoPopulateBasemap() {
        if (!Array.isArray(this._options.sections)) return;
        const basemapSection = this._options.sections.find((s) => s.id === "basemap");
        if (basemapSection && (!basemapSection.items || basemapSection.items.length === 0)) {
            try {
                const basemapDefs = _resolveBasemapDefs(_g);
                if (basemapDefs && Object.keys(basemapDefs).length > 0) {
                    basemapSection.items = Object.keys(basemapDefs).map((k) => {
                        const d = basemapDefs[k] || {};
                        return { id: d.id || k, label: d.label || k };
                    });
                    Log?.info("[GeoLeaf.LayerManager] Basemap section auto-populated");
                }
            } catch (e) {
                Log?.warn("[GeoLeaf.LayerManager] Error while auto-populating basemaps:", e);
            }
        }
    },
    /**
     * Minimal section auto-fill
     * @private
     */
    _autoPopulateSections() {
        if (Array.isArray(this._options.sections) && this._options.sections.length > 0) return;
        let autoSections: LMSection[] = [];
        try {
            autoSections = _buildAutoBasemapSections(_g);
        } catch (_e) {
            // ignore
        }
        if (autoSections.length) {
            this._options.sections = autoSections;
            Log?.info("[GeoLeaf.LayerManager] auto-populated sections from Baselayers");
        } else {
            Log?.warn(
                "[GeoLeaf.LayerManager] Aucune section fournie et autoremplissage impossible."
            );
        }
    },
    /**
     * Registers a GeoJSON layer into its LayerManager section.
     *
     * Not the `legend` capability: this fills the COUCHES panel (`.gl-layer-manager`),
     * not `.gl-map-legend`. The section named by `layerManagerId` is created on the fly
     * when unknown, with a generic label and no accordion flag — those placeholder
     * values are meant to be overwritten by {@link _applyLayerManagerConfig}, which
     * runs later (at `init()`), since registration happens first.
     * @param {string} layerId - The layer id
     * @param {Object} options - Layer options
     */
    _registerGeoJsonLayer(layerId: string, options: RegisterLayerOptions = {}) {
        if (!this._options.sections) {
            this._options.sections = [];
        }
        // Utiliser layerManagerId ou legendSection (backward compatibility)
        const sectionId = options.layerManagerId || options.legendSection || "geojson-default";
        let section = this._options.sections.find((s) => s.id === sectionId);
        if (!section) {
            section = {
                id: sectionId,
                label: options.legendSectionLabel || getLabel("ui.layer_manager.geojson_section"),
                order: 10,
                items: [],
            };
            this._options.sections.push(section);
            this._options.sections.sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        const existingItem = section.items.find((item) => item.id === layerId);
        if (!existingItem) {
            section.items.push(_createLayerEntry(layerId, options));
            this._updateContent();
            Log?.debug(`[LayerManager] Layer "${layerId}" registered in section "${sectionId}"`);
        }
    },
    /**
     * Forces a content re-render
     * @private
     */
    _updateContent() {
        if (!this._control || typeof this._control.updateSections !== "function") {
            return;
        }
        this._control.updateSections(this._options.sections || []);
    },
    /**
     * Refreshes the LayerManager display
     * Used in particular after applying a theme to update toggle button states
     * Debounced so bursts collapse into one call (e.g. several layers toggling visibility on zoom)
     * @public
     * @param {boolean} [immediate=false] - When true, refresh immediately, bypassing the debounce
     */
    /**
     * Redraws the panel to match the current layer state.
     *
     * Debounced by default, so a burst of layer changes costs one redraw. Passing `immediate`
     * cancels any pending debounce and redraws synchronously — needed when the caller is
     * about to read the rendered DOM.
     *
     * A no-op, logged at debug, when the control is not yet mounted (early boot).
     *
     * @param immediate - Skip the debounce and redraw now. Defaults to `false`.
     *
     * @example
     * ```js
     * // Rafraîchissement debouncé (groupé par défaut)
     * GeoLeaf.LayerManager.refresh();
     *
     * // Rafraîchissement immédiat
     * GeoLeaf.LayerManager.refresh(true);
     * ```
     */
    refresh(immediate = false) {
        const control = this._control;
        if (!control || typeof control.refresh !== "function") {
            if (Log)
                Log.debug(
                    "[LayerManager] refresh(): control not yet initialized (early boot, skipping)"
                );
            return;
        }
        // If immediate refresh requested, cancel debounce and execute
        if (immediate) {
            if (this._refreshTimeout) {
                clearTimeout(this._refreshTimeout);
                this._refreshTimeout = null;
            }
            control.refresh();
            if (Log) Log.debug("[LayerManager] Display refreshed (immediate)");
            return;
        }
        // Debounce: cancel the pending timeout and schedule a new refresh
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
        }
        this._refreshTimeout = setTimeout(() => {
            this._refreshTimeout = null;
            control.refresh();
            if (Log) Log.debug("[LayerManager] Display refreshed (debounced)");
        }, 250);
    },
    /**
     * Option merge (shallow, with a lightweight merge for nested objects)
     * @param {Object} base
     * @param {Object} override
     * @returns {Object}
     * @private
     */
    _mergeOptions(
        base: Record<string, unknown>,
        override: Record<string, unknown> | null | undefined
    ): LayerManagerOptions {
        const result: Record<string, unknown> = Object.assign({}, base || {});
        if (!override) return result as LayerManagerOptions;
        Object.keys(override).forEach((key) => {
            const value = override[key];
            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                base &&
                typeof base[key] === "object" &&
                !Array.isArray(base[key])
            ) {
                result[key] = Object.assign({}, base[key], value);
            } else {
                result[key] = value;
            }
        });
        return result as LayerManagerOptions;
    },
    /**
     * Resets the module back to its post-import state.
     *
     * Run on map teardown so the control, the map handle and the accumulated
     * sections do not survive a destroy → recreate cycle. A pending debounced
     * refresh is cancelled too: its callback closes over the old control and
     * would fire against a detached DOM node.
     *
     * Idempotent — safe to call more than once.
     */
    _reset(): void {
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = null;
        }
        this._map = null;
        this._control = null;
        this._options = _defaultLayerManagerOptions();
    },
};

const LayerManager = LayerManagerModule;

// Self-register the teardown so Core.destroy() clears the layer-manager state.
registerLifecycleTeardown(() => LayerManager._reset());

export { LayerManager };
