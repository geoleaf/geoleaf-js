/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Theme Applier - Visibility
 * Layer visibility management and style application
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
 * ⚠️ **SIDE-EFFECT module**: grafts 3 members onto `ThemeApplierCore` at import;
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
import { Log } from "../../../utils/log/index.js";
import { Config } from "../../config/config-primitives.js";
import { ThemeApplierCore as _TA } from "./core.js";
import type { ActiveProfile, ThemeApplierModule, ThemeLayerConfig } from "./core.js";
import { GeoJSONShared } from "../../shared/geojson-state.js";
import { LayerVisibilityManager } from "../../shared/layer-visibility-state.js";
import { LayerManagerStyle } from "../../geojson/layers/style.js";
import { StyleLoader } from "../../../utils/loaders/style-loader.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import { LayerManager } from "../../../api/geoleaf.layer-manager.js";
import { StyleSelector } from "../../layer-manager/style-selector.js";

const TA: ThemeApplierModule = _TA;

/** `Config` augmented at runtime with `getActiveProfile()`. */
interface ConfigLike {
    getActiveProfile?(): ActiveProfile | null | undefined;
}
const _Config = Config as unknown as ConfigLike;

// ── Local structural views (loose runtime collaborators) ────────────────────

/** Visibility manager: state + enum, narrowed to members used here. */
interface VisibilityManagerLike {
    resetAllUserOverrides(): void;
    setVisibility(layerId: string, visible: boolean, source: unknown): void;
    VisibilitySource: { THEME: unknown };
}

/** Registered GeoJSON layer record (loose runtime shape). */
interface LayerDataLike {
    config?: { styles?: { available?: AvailableStyle[] } };
    _layerDirectory?: string;
    currentStyle?: unknown;
}

/** An available-style descriptor declared on a layer's config. */
interface AvailableStyle {
    id?: string;
    file?: string;
}

/** Style flat-paint / rules file as returned by the style loader. */
interface StyleData {
    style?: Record<string, unknown>;
    styleRules?: unknown;
}

/** Result of `StyleLoader.loadAndValidateStyle`. */
interface StyleLoadResult {
    styleData?: StyleData;
}

/** Style applier surface used here. */
interface LayerManagerStyleLike {
    setLayerStyle(layerId: string, paint: Record<string, unknown>): void;
}

/** Labels surface consumed via the runtime global (no static capability import). */
interface LabelsLike {
    disableLabels(layerId: string): void;
    initializeLayerLabels(layerId: string): void;
}

/** Label button manager surface consumed via the runtime global. */
interface LabelButtonManagerLike {
    syncImmediate(layerId: string): void;
}

/**
 * Deactivates all GeoJSON layers
 * @private
 */
TA._hideAllLayers = function () {
    if (!GeoJSONShared.state.layers) {
        return;
    }

    const VisibilityManager = LayerVisibilityManager as unknown as VisibilityManagerLike;
    if (!VisibilityManager) {
        return;
    }

    // Reset all user overrides to let the theme take control
    VisibilityManager.resetAllUserOverrides();

    // Iterate over all registered layers
    GeoJSONShared.getLayers().forEach((_layerData: unknown, layerId: string) => {
        VisibilityManager.setVisibility(layerId, false, VisibilityManager.VisibilitySource.THEME);
    });
};

/**
 * Applies the configuration d'a layer (visible/hidden + style)
 * @param {Object} layerConfig - Configuration { id, visible, style }
 * @returns {Promise<void>}
 * @private
 */
TA._applyLayerConfig = function (layerConfig: ThemeLayerConfig) {
    if (!layerConfig?.id) {
        return Promise.resolve();
    }

    const layerId = layerConfig.id;
    const visible = layerConfig.visible !== false;
    const styleId = layerConfig.style ? String(layerConfig.style).trim() : undefined;

    // Retrieve the layer from the registre
    const layerData = GeoJSONShared.state.layers?.get(layerId);

    // R-perf S1 (refinement) — full per-layer cost: captures the pre-load gap
    // (ThemeCache.get lookup, def normalisation) + load + post-load style apply,
    // i.e. everything the per-layer [Perf][layer] marks do NOT see.
    const _perf =
        typeof window !== "undefined" &&
        (window as unknown as { __GEOLEAF_PERF__?: boolean }).__GEOLEAF_PERF__;
    const _t0 = _perf ? performance.now() : 0;

    // Layer not yet registered (cold registry). Under F0's "drop" loading model,
    // off-default-theme layers are NOT loaded at boot (see profile.ts::_splitTasksByTheme);
    // this ADD branch loads them on theme switch and is REQUIRED — do NOT purge it (nor
    // _loadLayerFromProfile / the pending cluster). The registry is warm (→ TOGGLE below)
    // only at boot, for the default theme. See CDC_capacite-theme-selector.md §8.1bis.
    let _result: Promise<unknown>;
    if (!layerData) {
        _result = TA._loadLayerFromProfile(layerId).then((loadedLayer: unknown) => {
            if (loadedLayer) {
                return TA._setLayerVisibilityAndStyle(layerId, visible, styleId);
            } else {
                return TA._scheduleLayerConfig(layerId, visible, styleId);
            }
        });
    } else {
        // The layer already exists, apply the visibility directly
        _result = TA._setLayerVisibilityAndStyle(layerId, visible, styleId);
    }

    if (_perf) {
        return _result.finally(() => {
            Log.info(
                `[Perf][applyLayerConfig] ${layerId}: total=${(performance.now() - _t0).toFixed(
                    1
                )}ms existed=${!!layerData}`
            );
        });
    }
    return _result;
};

function _resolveEffectiveStyleId(
    styleId: string,
    availableStyles: AvailableStyle[]
): { styleId: string; exists: boolean } {
    const styleExists = availableStyles.some((s: AvailableStyle) => s.id === styleId);
    if (styleExists) return { styleId, exists: true };
    const fallbackMap: Record<string, string> = { default: "default", defaut: "default" };
    const fallbackStyleId = fallbackMap[styleId];
    if (fallbackStyleId) {
        const fallbackExists = availableStyles.some(
            (s: AvailableStyle) => s.id === fallbackStyleId
        );
        if (fallbackExists) return { styleId: fallbackStyleId, exists: true };
    }
    return { styleId, exists: false };
}

function _getProfileId(): string {
    if (_Config && typeof _Config.getActiveProfile === "function") {
        const activeProfile = _Config.getActiveProfile();
        return activeProfile?.id || "default";
    }
    return "default";
}

function _applyLayerHidden(layerId: string): void {
    const VisibilityManager = LayerVisibilityManager as unknown as VisibilityManagerLike;
    VisibilityManager.setVisibility(layerId, false, VisibilityManager.VisibilitySource.THEME);
    const GeoLeaf = getGeoLeaf();
    (GeoLeaf?.Labels as LabelsLike | undefined)?.disableLabels(layerId);
    (GeoLeaf?._LabelButtonManager as LabelButtonManagerLike | undefined)?.syncImmediate(layerId);
}

function _onStyleLoaded(
    layerId: string,
    styleId: string | undefined,
    result: StyleLoadResult
): void {
    const styleConfig = result.styleData;
    // Style files have the shape { id, label, style: { fillColor, … }, styleRules: [...], legend }.
    // Unwrap the nested `style` flat-paint object so normalizeToFlat() finds paint keys at
    // the root level (required for fill-extrusion). Preserve styleRules so that
    // applyLayerStyle() can rebuild MapLibre case-expressions for per-category colouring.
    const paintForStyle: Record<string, unknown> = {
        ...(styleConfig?.style ?? styleConfig),
    };
    if (Array.isArray(styleConfig?.styleRules)) {
        paintForStyle.styleRules = styleConfig.styleRules;
    }
    (LayerManagerStyle as unknown as LayerManagerStyleLike).setLayerStyle(layerId, paintForStyle);
    const layerDataForStyle = GeoJSONShared.state.layers?.get(layerId);
    // Keep the full style object in currentStyle (unwrapped as `currentStyle.style
    // ?? currentStyle` where read) so the active style is preserved.
    if (layerDataForStyle) (layerDataForStyle as LayerDataLike).currentStyle = styleConfig;
    const GeoLeaf = getGeoLeaf();
    (GeoLeaf?.Labels as LabelsLike | undefined)?.initializeLayerLabels(layerId);
    (GeoLeaf?._LabelButtonManager as LabelButtonManagerLike | undefined)?.syncImmediate(layerId);
    if (LayerManager && typeof LayerManager.refresh === "function") LayerManager.refresh();
    if (StyleSelector) StyleSelector.setCurrentStyle(layerId, styleId!);
    TA._updateStyleSelector(layerId, styleId);
    TA._loadLegendForStyle(layerId, styleId);
}

function _applyLayerVisible(
    layerId: string,
    styleId: string | undefined,
    layerData: LayerDataLike
): Promise<unknown> {
    const VisibilityManager = LayerVisibilityManager as unknown as VisibilityManagerLike;
    VisibilityManager.setVisibility(layerId, true, VisibilityManager.VisibilitySource.THEME);
    if (!styleId || !(LayerManagerStyle as unknown as LayerManagerStyleLike)?.setLayerStyle)
        return Promise.resolve();
    const availableStyles: AvailableStyle[] = layerData.config?.styles?.available || [];
    const { styleId: effectiveStyleId, exists } = _resolveEffectiveStyleId(
        styleId,
        availableStyles
    );
    if (!exists) return Promise.resolve();
    const styleFile = availableStyles.find((s: AvailableStyle) => s.id === effectiveStyleId)?.file;
    if (!styleFile) return Promise.resolve();
    const profileId = _getProfileId();
    const layerDirectory = layerData._layerDirectory || layerId;
    const localStyleLoader = StyleLoader;
    if (!localStyleLoader) {
        Log?.error(`[ThemeApplier] StyleLoader non disponible`);
        return Promise.resolve();
    }
    return localStyleLoader
        .loadAndValidateStyle(
            profileId,
            layerId,
            effectiveStyleId,
            styleFile,
            `layers/${layerDirectory}`
        )
        .then((result) => {
            _onStyleLoaded(layerId, styleId, result as StyleLoadResult);
            return result;
        })
        .catch((_err: unknown) => {
            // Silent — error already logged by StyleLoader
        });
}

/**
 * Sets a layer's visibility and style
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - Desired visibility
 * @param {string} styleId - Style ID to apply
 * @returns {Promise<void>}
 * @private
 */
TA._setLayerVisibilityAndStyle = function (
    layerId: string,
    visible: boolean,
    styleId: string | undefined
) {
    const layerData = GeoJSONShared.state.layers?.get(layerId);
    if (!layerData) return Promise.resolve();
    if (!LayerVisibilityManager) return Promise.resolve();
    if (visible) return _applyLayerVisible(layerId, styleId, layerData as LayerDataLike);
    _applyLayerHidden(layerId);
    return Promise.resolve();
};

export { TA as ThemeApplierVisibility };
