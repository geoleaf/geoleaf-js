/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Module - Visibility Manager
 * Centralised visibility manager for layers with priority management
 *
 * Manages three sources of visibility change:
 * - 'user': Manual user action (toggle, explicit show/hide)
 * - 'theme': Change via theme application
 * - 'zoom': Automatic change based on the zoom level
 *
 * Priority rules:
 * 1. user > theme > zoom (the user always has the final say)
 * 2. A 'user' action cancels 'theme' and 'zoom' flags
 * 3. A 'theme' action can override 'zoom' but not 'user'
 * 4. A 'zoom' action never changes the state if 'user' or 'theme' is active
 */

import { GeoJSONShared } from "./shared.js";
import { getLog } from "../../utils/general/di-accessors.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { dispatchGeoLeafEvent } from "../events/event-bus.js";
import type { GeoJSONAdapter, GeoJSONLayerEntry, GeoJSONSharedState } from "./core-types.js";

/** Visibility source identifier. */
type VisibilitySourceValue = "user" | "theme" | "zoom" | "system";

/** Per-layer visibility bookkeeping stored on `layerData._visibility`. */
interface VisibilityMeta {
    current: boolean;
    logicalState: boolean;
    source: VisibilitySourceValue;
    userOverride: boolean;
    themeOverride: boolean;
    themeDesired: boolean | null;
    zoomConstrained: boolean;
}

/** Layer entry as consumed by the visibility manager (legacy compat flags + typed metadata). */
type VisibilityLayerData = GeoJSONLayerEntry & {
    _visibility?: VisibilityMeta;
    userDisabled?: boolean;
    themeHidden?: boolean;
};

/** State view used by the visibility manager (may be the shared state or a test fallback). */
type VisibilityState = Pick<GeoJSONSharedState, "map" | "layers" | "adapter">;

// Lazy dependencies — fallback for tests where shared may be resolved differently
const _defaultState: VisibilityState = {
    map: null,
    layers: new Map<string, GeoJSONLayerEntry>(),
    adapter: null,
};
const getState = (): VisibilityState =>
    GeoJSONShared && GeoJSONShared.state ? GeoJSONShared.state : _defaultState;

/** Public surface of the visibility manager (assembled below). */
interface VisibilityManagerShape {
    setVisibility(layerId: string, visible: boolean, source: VisibilitySourceValue): boolean;
    _canChangeVisibility(
        meta: VisibilityMeta,
        source: VisibilitySourceValue,
        desiredVisible: boolean
    ): boolean;
    _updateVisibilityFlags(
        meta: VisibilityMeta,
        source: VisibilitySourceValue,
        visible: boolean
    ): void;
    _applyVisibilityChange(
        layerId: string,
        layerData: VisibilityLayerData,
        visible: boolean,
        /** Omitted = apply to the map. `ZOOM` reports only — the engine renders it. */
        source?: VisibilitySourceValue
    ): boolean;
    _notifyLegend(layerId: string, visible: boolean): void;
    _fireVisibilityEvent(layerId: string, visible: boolean, source: VisibilitySourceValue): void;
    resetUserOverride(layerId: string): void;
    resetAllUserOverrides(): void;
    getVisibilityState(layerId: string): {
        current: boolean;
        logicalState: boolean;
        source: VisibilitySourceValue;
        userOverride: boolean;
        themeOverride: boolean;
        zoomConstrained: boolean;
    } | null;
    VisibilitySource: typeof VisibilitySource;
    _getTestState(): VisibilityState;
}

const VisibilityManager = {} as VisibilityManagerShape;

/**
 * Possible visibility states
 * @private
 */
const VisibilitySource = {
    USER: "user",
    THEME: "theme",
    ZOOM: "zoom",
    SYSTEM: "system", // Initial load, etc.
} as const;

/**
 * Initialises visibility metadata for a layer
 * @param {Object} layerData - Layer data
 * @private
 */
function initVisibilityMetadata(layerData: VisibilityLayerData) {
    if (!layerData._visibility) {
        layerData._visibility = {
            current: false, // current physical state on the map (true/false)
            logicalState: false, // logical state (button ON/OFF, independent of zoom)
            source: VisibilitySource.SYSTEM, // Last modification source
            userOverride: false, // User has forced a state
            themeOverride: false, // A theme has forced a state
            themeDesired: null, // Visibility desired by the theme (true/false)
            zoomConstrained: false, // Layer is constrained by zoom
        };
    }
}

/**
 * Sets the visibility of a layer with priority management
 *
 * @param this - The visibility manager. The function is invoked bound to it, so the receiver
 *   is part of the signature — and TSD-02 counts it as a parameter.
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - Desired visibility state
 * @param {string} source - Source of the change ('user' | 'theme' | 'zoom' | 'system')
 * @returns {boolean} - true if visibility was changed, false otherwise
 */
VisibilityManager.setVisibility = function (
    this: VisibilityManagerShape,
    layerId: string,
    visible: boolean,
    source: VisibilitySourceValue
) {
    const state = getState();
    const Log = getLog();
    const layerData = state.layers.get(layerId) as VisibilityLayerData | undefined;

    if (!layerData) {
        Log.warn("[VisibilityManager] Layer not found:", layerId);
        return false;
    }

    // Initialise metadata if needed
    initVisibilityMetadata(layerData);

    // `initVisibilityMetadata` guarantees `_visibility` is set.
    const meta = layerData._visibility as VisibilityMeta;

    // Fast-path for zoom: skip entirely when physical state is already correct.
    // This prevents redundant adapter calls and legend rebuilds on every zoom tick.
    if (source === VisibilitySource.ZOOM && meta.current === visible) {
        return false;
    }

    const oldVisible = meta.current;
    const oldSource = meta.source;
    // Snapshot logical state before flag update to detect user-intent changes.
    const oldLogicalState = meta.logicalState;
    const oldUserOverride = meta.userOverride;

    // Apply priority rules
    const canChange = this._canChangeVisibility(meta, source, visible);

    if (!canChange) {
        Log.debug(
            `[VisibilityManager] Change denied for ${layerId}: ` +
                `source=${source}, userOverride=${meta.userOverride}, themeOverride=${meta.themeOverride}`
        );
        return false;
    }

    // Update flags based on the source
    this._updateVisibilityFlags(meta, source, visible);

    // Apply the effective change
    const changed = this._applyVisibilityChange(layerId, layerData, visible, source);

    // A USER action may change the logical intent without causing a physical map change
    // (e.g. re-showing a layer already on the map, or acting on a shared cluster).
    // We must still fire the event so permalink / other listeners can sync.
    const logicalChanged =
        source === VisibilitySource.USER &&
        (meta.logicalState !== oldLogicalState || meta.userOverride !== oldUserOverride);

    if (changed) {
        meta.current = visible;
        meta.source = source;

        Log.debug(
            `[VisibilityManager] ${layerId}: ${oldVisible} ? ${visible} ` +
                `(source: ${oldSource} ? ${source})`
        );

        // Update legacy flags for compatibility
        layerData.visible = visible;
        layerData.userDisabled = meta.userOverride && !visible;
        layerData.themeHidden = meta.themeOverride && !visible;

        // Notify the legend
        this._notifyLegend(layerId, visible);

        // Emit the event
        this._fireVisibilityEvent(layerId, visible, source);
    } else if (logicalChanged) {
        // Physical state unchanged but user changed their intent — sync URL/listeners.
        this._fireVisibilityEvent(layerId, visible, source);
    }

    return changed;
};

/**
 * Checks whether visibility can be changed based on priority rules
 * @param {Object} meta - Visibility metadata
 * @param {string} source - Source of the change
 * @param _desiredVisible - The visibility being asked for. Accepted for signature symmetry
 *   with the other visibility hooks and currently unused: the decision rests on the SOURCE's
 *   priority, not on the direction of the change.
 * @returns {boolean}
 * @private
 */
VisibilityManager._canChangeVisibility = function (
    meta: VisibilityMeta,
    source: VisibilitySourceValue,
    _desiredVisible: boolean
) {
    // User can always change
    if (source === VisibilitySource.USER) {
        return true;
    }

    // IMPORTANT: Zoom MUST ALWAYS be able to modify the physical display (current)
    // even if userOverride is true. This allows show/hide based on zoom thresholds
    // while keeping logicalState independent.
    if (source === VisibilitySource.ZOOM) {
        return true;
    }

    // If user has set an override, only the user can change the logical state
    if (meta.userOverride) {
        return false;
    }

    // KERNEL S6: a guard used to sit here, meant to stop a zoom change from re-showing
    // a layer a theme had explicitly hidden. It tested `source === ZOOM`, which the
    // early return above already made unreachable — it never ran, in any build. It has
    // been removed rather than repaired: making it effective would change visibility
    // precedence (theme over zoom), which is a product decision, not a cleanup.

    // Themes can override zoom but not the user
    if (source === VisibilitySource.THEME) {
        return true;
    }

    // Default: allow (for 'system' and others)
    return true;
};

/**
 * Updates visibility flags based on the source
 * ## Precedence between sources — the actual, deliberate rule (backlog B.11)
 *
 * `USER` outranks everything: once `userOverride` is set, neither `THEME` nor `ZOOM`
 * touches the flags. `THEME` and `ZOOM` are otherwise **independent axes** — `THEME`
 * drives `logicalState` (should this layer be on?), `ZOOM` drives only the physical
 * `current` through `zoomConstrained`, and never writes `logicalState`.
 *
 * ⚠️ **A zoom change CAN re-show a layer a theme had hidden, and that is not a bug.**
 * A guard purged at S6 claimed to prevent it; it was unreachable from the day it was
 * written, so **the protection never existed in any shipped build**. Making it effective
 * would change the visibility precedence — a product decision, not a cleanup — and was
 * declined: no observed defect motivates it, and theme-vs-zoom ordering is only
 * meaningful once a profile actually relies on it. Do not "restore" it as a fix.
 *
 * @param {Object} meta - Visibility metadata
 * @param {string} source - Source of the change
 * @param {boolean} visible - Visibility state
 * @private
 */
VisibilityManager._updateVisibilityFlags = function (
    meta: VisibilityMeta,
    source: VisibilitySourceValue,
    visible: boolean
) {
    switch (source) {
        case VisibilitySource.USER:
            meta.userOverride = true;
            meta.themeOverride = false; // Reset theme override
            meta.zoomConstrained = false;
            meta.logicalState = visible; // Update the logical state
            break;

        case VisibilitySource.THEME:
            // Do not override userOverride if already set
            if (!meta.userOverride) {
                meta.themeOverride = true;
                meta.themeDesired = visible;
                meta.zoomConstrained = false;
                meta.logicalState = visible; // Update the logical state
            }
            break;

        case VisibilitySource.ZOOM:
            // Mark zoom constraint (except user override)
            // DO NOT modify logicalState — zoom does not affect logical state
            if (!meta.userOverride) {
                meta.zoomConstrained = true;
            }
            break;

        case VisibilitySource.SYSTEM:
            // Reset all overrides for a clean load
            meta.userOverride = false;
            meta.themeOverride = false;
            meta.themeDesired = null;
            meta.zoomConstrained = false;
            meta.logicalState = visible; // Initialise the logical state
            break;
    }
};

/** Layer manager surface accessed for UI refresh (on the global's `unknown` tail). */
interface LayerManagerLike {
    refresh?: () => void;
}
/** Label-button manager surface accessed for sync (on the global's `unknown` tail). */
interface LabelButtonManagerLike {
    syncImmediate?: (layerId: string) => void;
}
/** Labels module surface accessed for label refresh (on the global's `unknown` tail). */
interface LabelsLike {
    refreshLabels?: (layerId: string) => void;
    _hideLabelsForLayer?: (layerId: string) => void;
}
/** Legend module surface accessed for visibility sync (on the global's `unknown` tail). */
interface LegendLike {
    setLayerVisibility?: (layerId: string, visible: boolean) => void;
}

function _syncVisibilityUI(layerId: string): void {
    const GeoLeaf = getGeoLeaf();
    if (!GeoLeaf) return;
    const LayerManager = GeoLeaf.LayerManager as LayerManagerLike | undefined;
    if (LayerManager && typeof LayerManager.refresh === "function") {
        LayerManager.refresh();
    }
    const LabelButtonManager = GeoLeaf._LabelButtonManager as LabelButtonManagerLike | undefined;
    if (LabelButtonManager && typeof LabelButtonManager.syncImmediate === "function") {
        LabelButtonManager.syncImmediate(layerId);
    }
}

/**
 * Physically applies the visibility change (add/remove layer)
 *
 * @param layerId - Layer id.
 * @param _layerData - Unused. Scale gating is the ENGINE's job (S5/N-1b), so this member reads
 *   the sub-layer `minzoom`/`maxzoom` from the map rather than from the layer data it is handed.
 * @param visible - Desired visibility state.
 * @param source - Origin of the change (`"user" | "theme" | "zoom" | "system"`), carried into the
 *   emitted event so listeners can tell a user action from an automatic one.
 * @returns `true` if a change was made.
 * @private
 */
VisibilityManager._applyVisibilityChange = function (
    layerId: string,
    _layerData: VisibilityLayerData,
    visible: boolean,
    source?: string
) {
    const state = getState();
    const Log = getLog();

    // Scale gating is the ENGINE's job (S5/N-1b): each sub-layer carries `minzoom`/`maxzoom`
    // derived from the style's `scaleConfig`, so MapLibre hides the layer continuously
    // while zooming instead of at `zoomend`. Writing `visibility: none` here too would
    // give the layer two masters for the same decision — the last writer would win, and
    // they disagree the moment the two evaluate at different latitudes. The ZOOM source
    // therefore only reports: flags, legend, labels and events still run below.
    if (source === VisibilitySource.ZOOM) {
        _syncVisibilityUI(layerId);
        return true;
    }

    const Core = getGeoLeaf()?.Core as { getMap?: () => GeoJSONAdapter | undefined } | undefined;
    const adapter: GeoJSONAdapter | null = state.adapter || Core?.getMap?.() || null;
    if (!adapter) {
        Log.warn("[VisibilityManager] Adapter not available for:", layerId);
        return false;
    }
    try {
        if (visible) adapter.showLayer(layerId);
        else adapter.hideLayer(layerId);
        _syncVisibilityUI(layerId);
        return true;
    } catch (err) {
        Log.error("[VisibilityManager] Visibility error for " + layerId + ":", err);
        return false;
    }
};

function _notifyLabelsModule(layerId: string, visible: boolean): void {
    const Labels = getGeoLeaf()?.Labels as LabelsLike | undefined;
    if (!Labels) return;
    if (visible && typeof Labels.refreshLabels === "function") {
        Labels.refreshLabels(layerId);
        return;
    }
    if (!visible && typeof Labels._hideLabelsForLayer === "function") {
        Labels._hideLabelsForLayer(layerId);
    }
}

/**
 * Notifies the Legend module of a visibility change
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - Visibility state
 * @private
 */
VisibilityManager._notifyLegend = function (layerId: string, visible: boolean) {
    const GeoLeaf = getGeoLeaf();
    if (!GeoLeaf) return;
    const Legend = GeoLeaf.Legend as LegendLike | undefined;
    if (Legend && typeof Legend.setLayerVisibility === "function") {
        Legend.setLayerVisibility(layerId, visible);
    }
    _notifyLabelsModule(layerId, visible);
    const LabelButtonManager = GeoLeaf._LabelButtonManager as LabelButtonManagerLike | undefined;
    if (LabelButtonManager && typeof LabelButtonManager.syncImmediate === "function") {
        LabelButtonManager.syncImmediate(layerId);
    }
};

/**
 * Emits a visibility change event
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - Visibility state
 * @param {string} source - Source of the change
 * @private
 */
VisibilityManager._fireVisibilityEvent = function (
    layerId: string,
    visible: boolean,
    source: VisibilitySourceValue
) {
    const state = getState();
    if (!state.map) return;

    try {
        state.map.fire("geoleaf:geojson:visibility-changed", {
            layerId: layerId,
            visible: visible,
            source: source,
        });
    } catch (_e) {
        // Silent
    }

    // Also dispatch as DOM CustomEvent so cross-module listeners (permalink, filter lazy-loader)
    // can subscribe via document.addEventListener without needing the map instance.
    // Only for non-zoom sources to avoid excessive events during zoom recalculation.
    if (source !== VisibilitySource.ZOOM && typeof document !== "undefined") {
        try {
            document.dispatchEvent(
                new CustomEvent("geoleaf:geojson:visibility-changed", {
                    detail: { layerId: layerId, visible: visible, source: source },
                    bubbles: false,
                })
            );
        } catch (_e) {
            // Silent
        }
    }

    // New canonical event for integrators — fires for ALL sources including zoom
    dispatchGeoLeafEvent("geoleaf:layer:toggle", {
        layerId: String(layerId),
        visible: Boolean(visible),
        source: String(source) as "user" | "theme" | "zoom" | "system",
    });
};

/**
 * Resets user overrides for a layer
 * Used by themes to regain control
 *
 * @param {string} layerId - Layer ID
 */
VisibilityManager.resetUserOverride = function (layerId: string) {
    const state = getState();
    const layerData = state.layers.get(layerId) as VisibilityLayerData | undefined;

    if (layerData && layerData._visibility) {
        layerData._visibility.userOverride = false;
        getLog().debug(`[VisibilityManager] User override reset for ${layerId}`);
    }
};

/**
 * Resets all user overrides
 * Used by themes during a complete theme change
 */
VisibilityManager.resetAllUserOverrides = function () {
    const state = getState();
    let count = 0;

    state.layers.forEach((entry) => {
        const layerData = entry as VisibilityLayerData;
        if (layerData._visibility && layerData._visibility.userOverride) {
            layerData._visibility.userOverride = false;
            count++;
        }
    });

    if (count > 0) {
        getLog().debug(`[VisibilityManager] ${count} user override(s) reset`);
    }
};

/**
 * Gets the complete visibility state of a layer.
 *
 * ⚠️ `current` is the **physical** visibility — what is on screen right now, which the
 * zoom can force to `false`. `logicalState` is the **user intent** (the ON/OFF the
 * button shows), and the zoom never touches it. Callers deciding what a click should
 * do must read `logicalState`; callers describing what is rendered read `current`.
 * Reading `current` to drive a toggle was backlog B.19: on a layer logically ON but
 * zoom-hidden, the click called `showLayer()` and the button would not switch off.
 *
 * @param {string} layerId - Layer ID
 * @returns {Object|null} - Visibility metadata or null
 */
VisibilityManager.getVisibilityState = function (layerId: string) {
    const state = getState();
    const layerData = state.layers.get(layerId) as VisibilityLayerData | undefined;

    if (!layerData) {
        return null;
    }

    initVisibilityMetadata(layerData);

    // `initVisibilityMetadata` guarantees `_visibility` is set.
    const meta = layerData._visibility as VisibilityMeta;
    return {
        current: meta.current,
        logicalState: meta.logicalState,
        source: meta.source,
        userOverride: meta.userOverride,
        themeOverride: meta.themeOverride,
        zoomConstrained: meta.zoomConstrained,
    };
};

/**
 * Exports constants for external use
 */
VisibilityManager.VisibilitySource = VisibilitySource;
/** Exposed for tests where GeoJSONShared is not injected (different module resolution) */
VisibilityManager._getTestState = () => _defaultState;

getLog().info("[GeoLeaf._LayerVisibilityManager] Module loaded");

export { VisibilityManager };
