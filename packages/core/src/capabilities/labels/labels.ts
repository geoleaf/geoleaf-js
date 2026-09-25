/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Labels module for GeoLeaf.
 * Manages floating labels on features.
 * @namespace Labels
 */

import { Log } from "../../utils/log/index.js";
import { LabelRenderer } from "./label-renderer.js";
import {
    isScaleInRange as _isScaleInRange,
    calculateMapScale as _calculateMapScale,
} from "../../utils/general/scale-utils.js";
import { Core } from "../../api/geoleaf.core.js";
import { GeoJSONCore, resolveLayerLabelConfig } from "../../kernel/geojson/index.js";
import type {
    LabelLayerData,
    LabelsApi,
    LabelsGeoJSONCore,
    LabelsMapHandle,
    LabelsNativeMap,
    LabelStyleLike,
    LabelUserConfig,
    LayerLabelState,
    LayerStyleLabel,
    RemovableTooltip,
} from "./types.js";

const ScaleUtils = { isScaleInRange: _isScaleInRange, calculateMapScale: _calculateMapScale };

/**
 * Module state. The listener slots are not bookkeeping: this module's `zoomend` and
 * `style.load` subscriptions are process-wide and `map.on` hands back nothing to
 * unsubscribe with. Keeping the map handle AND the exact handler is the only way
 * `destroy()` can release them, and resetting `zoomListenerAttached` there is what lets a
 * later `init()` re-arm. `zoomMap` and `styleMap` are also the identities the arming
 * compares against, so a map re-created without this module's `destroy()` —
 * `Core.destroy()` then `Core.init()` — re-arms on the new one.
 */
const _state: {
    layers: Map<string, LayerLabelState>;
    zoomListenerAttached: boolean;
    zoomMap: LabelsMapHandle | null;
    zoomHandler: (() => void) | null;
    styleMap: LabelsNativeMap | null;
    styleHandler: (() => void) | null;
} = {
    layers: new Map(),
    zoomListenerAttached: false,
    zoomMap: null,
    zoomHandler: null,
    styleMap: null,
    styleHandler: null,
};

/**
 * Releases the process-wide `zoomend` subscription and clears the slots, so that a
 * subsequent `_ensureZoomListener()` re-attaches from scratch.
 *
 * Tolerates a map handle without `off()`: `LabelsMapHandle` declares it optional
 * because partial adapters and test doubles legitimately omit it. Dropping the
 * subscription silently is the correct degradation — throwing would take the whole
 * `destroy()` down with it, and everything after it (the layer teardown already
 * ran, but the global listener would stay).
 */
function _detachZoomListener(): void {
    const map = _state.zoomMap;
    const zoomHandler = _state.zoomHandler;
    if (map && zoomHandler && typeof map.off === "function") {
        map.off("zoomend", zoomHandler);
    }
    _state.zoomMap = null;
    _state.zoomHandler = null;
    _state.zoomListenerAttached = false;
}

/**
 * Releases the `style.load` subscription, tolerating an engine without `off()` like
 * {@link _detachZoomListener} does.
 */
function _detachStyleListener(): void {
    const native = _state.styleMap;
    const handler = _state.styleHandler;
    if (native && handler && typeof native.off === "function") {
        native.off("style.load", handler);
    }
    _state.styleMap = null;
    _state.styleHandler = null;
}

/**
 * Arms the `style.load` subscription on the CURRENT map's engine, once.
 *
 * 🛑 A basemap switch that REPLACES the style erases every label layer. The layer is not the
 * adapter's — the renderer adds it to the engine directly, on its layer's source —, so the
 * switch carries the source into the incoming style and the diff removes the label layer,
 * while `tooltips` still reads "shown" and no zoom would ever rebuild it. The handler rebuilds
 * each labelled layer through `refreshLabels`, which also re-reads the font from the incoming
 * style: a label carried as-is would keep a font the new glyph server may not serve.
 *
 * ⚠️ The native event, and NOT `geoleaf:basemap:change`: that one is not emitted for a silent
 * switch, and the boot's own activation of the default basemap is silent — labels built while a
 * vector default style downloads would be erased at its arrival with nothing to rebuild them.
 *
 * @param self - The module, whose `refreshLabels` the handler calls.
 */
function _ensureStyleListener(self: LabelsApi): void {
    const native = _getMap()?.getNativeMap?.() ?? null;
    if (_state.styleMap === native) return;
    if (_state.styleMap) _detachStyleListener();
    if (!native || typeof native.on !== "function") return;
    const handler = () => {
        _state.layers.forEach((_, layerId) => self.refreshLabels(layerId));
    };
    native.on("style.load", handler);
    _state.styleMap = native;
    _state.styleHandler = handler;
}

/**
 * The layer's declared label configuration — its style's `label` object, else its definition's
 * `labels` block. See `resolveLayerLabelConfig`: every reader of this module asks there, never
 * `currentStyle.label` alone, which is `null` when the style file is missing.
 */
function _getIntegratedLabel(layerData: LabelLayerData | null): LayerStyleLabel | null {
    return resolveLayerLabelConfig(layerData);
}

function _hasConfigLabel(labelConfig: LabelUserConfig): boolean {
    if (!labelConfig) return false;
    if (!labelConfig.enabled) return false;
    if (!labelConfig.labelId) return false;
    return true;
}

function _resolveLabelStyleConfig(
    layerData: LabelLayerData | null,
    labelConfig: LabelUserConfig,
    _layerId: string
): LabelStyleLike | null | "disabled" {
    const integratedLabel = _getIntegratedLabel(layerData);
    if (integratedLabel) {
        if (integratedLabel.enabled !== true) return "disabled";
        const result: LabelStyleLike = Object.assign({}, integratedLabel);
        if (layerData?.currentStyle && layerData.currentStyle.labelScale) {
            result.labelScale = layerData.currentStyle.labelScale;
        }
        return result;
    }
    if (_hasConfigLabel(labelConfig)) return _buildLabelStyleFromConfig(labelConfig);
    return null;
}

function _buildLabelStyleFromConfig(labelConfig: LabelUserConfig): LabelStyleLike {
    const cfg = labelConfig;
    const font = cfg.font
        ? cfg.font
        : { family: "Arial", sizePt: 10, weight: 50, bold: false, italic: false };
    const color = cfg.color ? cfg.color : "#000000";
    const opacity = cfg.opacity ? cfg.opacity : 1.0;
    const buffer = cfg.buffer ? cfg.buffer : { enabled: false };
    const background = cfg.background ? cfg.background : { enabled: false };
    const offset = cfg.offset ? cfg.offset : { distancePx: 0 };
    return {
        enabled: true,
        ...(cfg.labelId !== undefined && { field: cfg.labelId }),
        font,
        color,
        opacity,
        buffer,
        background,
        offset,
    };
}

function _resolveLabelEffectiveShow(
    labelStyleConfig: LabelStyleLike,
    showImmediately: boolean
): boolean {
    if (labelStyleConfig.visibleByDefault !== undefined) return labelStyleConfig.visibleByDefault;
    return showImmediately;
}

function _computeShouldShow(
    effectiveShowImmediately: boolean,
    layerData: LabelLayerData | null
): boolean {
    if (!layerData) return effectiveShowImmediately;
    if (!layerData._visibility) return effectiveShowImmediately;
    return effectiveShowImmediately && layerData._visibility.current === true;
}

async function _doEnableLabels(
    self: LabelsApi,
    layerId: string,
    labelConfig: LabelUserConfig,
    showImmediately: boolean
): Promise<void> {
    const layerData = self._getLayerData(layerId);
    const labelStyleConfig = _resolveLabelStyleConfig(layerData, labelConfig, layerId);
    if (labelStyleConfig === "disabled") {
        if (Log) Log.debug("[Labels] Embedded labels disabled for", layerId);
        return;
    }
    if (!labelStyleConfig) {
        if (Log) Log.debug("[Labels] No label configured for", layerId);
        return;
    }
    const effectiveShowImmediately = _resolveLabelEffectiveShow(labelStyleConfig, showImmediately);
    _state.layers.set(layerId, {
        enabled: effectiveShowImmediately,
        config: labelConfig,
        labelStyle: labelStyleConfig,
        tooltips: new Map(),
    });
    const shouldShowLabels = _computeShouldShow(effectiveShowImmediately, layerData);
    if (shouldShowLabels) await self._createLabelsForLayer(layerId);
    self._ensureZoomListener();
    _ensureStyleListener(self);
    if (Log) Log.debug("[Labels] Label config prepared for", layerId);
}

function _getMap(): LabelsMapHandle | null {
    if (Core && Core.getMap) return Core.getMap() as LabelsMapHandle | null;
    return null;
}

function _isLayerVisible(layerData: LabelLayerData | null): boolean {
    if (!layerData) return false;
    if (!layerData._visibility) return false;
    return layerData._visibility.current === true;
}

function _isOutOfRange(
    self: LabelsApi,
    map: LabelsMapHandle | null,
    config: LabelUserConfig,
    labelStyle: LabelStyleLike
): boolean {
    if (!map) return false;
    if (labelStyle.labelScale) {
        const { minScale, maxScale } = labelStyle.labelScale;
        if (minScale == null && maxScale == null) return false;
        const currentScale = self._calculateMapScale(map);
        return !self._isScaleInRange(currentScale, minScale, maxScale);
    }
    if (config.minZoom === undefined) return false;
    if (config.maxZoom === undefined) return false;
    const currentZoom = map.getZoom();
    if (currentZoom < config.minZoom) return true;
    if (currentZoom > config.maxZoom) return true;
    return false;
}

function _renderTooltipsForLayer(
    layerId: string,
    _layerData: LabelLayerData | null,
    config: LabelUserConfig,
    labelStyle: LabelStyleLike,
    tooltips: Map<string, RemovableTooltip>
): void {
    if (!LabelRenderer) {
        if (Log) Log.error("[Labels] GeoLeaf._LabelRenderer not available!");
        return;
    }
    const resolvedLabelId = labelStyle.field || config.labelId;
    const labelConfig = {
        ...(resolvedLabelId !== undefined && { labelId: resolvedLabelId }),
        ...(config.minZoom !== undefined && { minZoom: config.minZoom }),
        ...(config.maxZoom !== undefined && { maxZoom: config.maxZoom }),
    };
    // MapLibre path — native symbol layer on the GeoJSON source
    LabelRenderer.createSymbolLayerForMapLibre(layerId, labelConfig, labelStyle, tooltips);
}

/**
 * Tears down a layer's label entries. Despite the name, these are not DOM
 * tooltips: each entry is a closure calling `nativeMap.removeLayer()`, which
 * throws when the MapLibre style has been reloaded or destroyed in between —
 * a basemap switch or a theme change is enough.
 *
 * The catch sits INSIDE the callback and `.clear()` OUTSIDE it, and neither
 * placement is cosmetic. Wrapping the whole `forEach` instead would let the
 * first failing entry skip both the remaining removals and `.clear()`, leaving
 * a non-empty map — and `_processZoomLayerItem` reads `tooltips.size > 0` as
 * "labels are showing", so the layer would never rebuild its labels again.
 *
 * @param tooltips - The layer's entry map. Tolerates `undefined`: the type says
 *   it is always present, but the callers guard it anyway (JS callers, partial
 *   mocks), and dropping that guard at the call sites must not weaken them.
 */
function _clearTooltips(tooltips: Map<string, RemovableTooltip> | undefined): void {
    if (!tooltips) return;
    tooltips.forEach((t: RemovableTooltip) => {
        try {
            // `t?.remove` and `t && t.remove` are equivalent here — do not
            // "fix" one into the other believing it addresses a defect.
            if (t?.remove) t.remove();
        } catch (_e) {
            /* a stale style makes removeLayer throw; the entry goes either way */
        }
    });
    tooltips.clear();
}

function _processZoomLayerItem(
    self: LabelsApi,
    layerState: LayerLabelState,
    layerId: string,
    currentScale: number,
    detail: { zoom?: number },
    map: LabelsMapHandle | null
): void {
    if (!layerState.enabled) return;
    if (!_isLayerVisible(self._getLayerData(layerId))) {
        if (layerState.tooltips && layerState.tooltips.size) _clearTooltips(layerState.tooltips);
        return;
    }
    const { labelStyle, config } = layerState;
    const shouldShow = _resolveShouldShowForZoom(
        self,
        currentScale,
        detail,
        map,
        config,
        labelStyle
    );
    const isShowing = layerState.tooltips && layerState.tooltips.size > 0;
    if (shouldShow && !isShowing)
        self._createLabelsForLayer(layerId).catch((e: unknown) =>
            Log?.error(`[Labels] Failed to create labels for "${layerId}":`, e)
        );
    else if (!shouldShow && isShowing) _clearTooltips(layerState.tooltips);
}

function _resolveShouldShowForZoom(
    self: LabelsApi,
    currentScale: number,
    detail: { zoom?: number },
    map: LabelsMapHandle | null,
    config: LabelUserConfig,
    labelStyle: LabelStyleLike
): boolean {
    if (labelStyle.labelScale) {
        const { minScale, maxScale } = labelStyle.labelScale;
        return self._isScaleInRange(currentScale, minScale, maxScale);
    }
    if (config.minZoom === undefined) return true;
    if (config.maxZoom === undefined) return true;
    const zoom = detail.zoom !== undefined ? detail.zoom : map!.getZoom();
    if (zoom < config.minZoom) return false;
    if (zoom > config.maxZoom) return false;
    return true;
}

const Labels: LabelsApi = {
    /**
     * Lifecycle entry point, kept as the anchor `LabelsLifecycle` / `LabelsModule` call.
     *
     * It subscribes to nothing: the only subscription this module ever had at init time
     * was `geoleaf:layer-loaded`, a seam **no emitter has ever published** in the whole
     * history of the repo (B.39). The layer-load path drives labels by direct call
     * instead — `geojson/loader/single-layer.ts` → `Labels.initializeLayerLabels()` —
     * and visibility / style changes go through `refreshLabels()` / `enableLabels()`.
     * The `zoomend` subscription is armed lazily by `_ensureZoomListener()`, once a
     * layer actually has labels — and the engine's `style.load` with it, which rebuilds the
     * label layers a basemap switch erases.
     */
    init(_options: Record<string, unknown> = {}): void {
        if (Log) Log.debug("[Labels] Labels module initialized");
    },

    initializeLayerLabels(layerId: string): void {
        if (!layerId) return;
        const layerData = this._getLayerData(layerId);
        if (!layerData) return;
        this._hideLabelsForLayer(layerId);
        _state.layers.delete(layerId);
        const declared = _getIntegratedLabel(layerData);
        if (declared?.enabled !== true) {
            if (Log)
                Log.debug(
                    "[Labels.initialize] No label configuration, or labels disabled, for",
                    layerId
                );
            return;
        }
        const visibleByDefault = declared.visibleByDefault === true;
        if (!visibleByDefault) {
            if (Log) Log.debug("[Labels.initialize] Labels disabled by default for", layerId);
            return void this.enableLabels(layerId, {}, false);
        }
        const isLayerVisible = layerData._visibility?.current === true;
        if (!isLayerVisible) {
            if (Log)
                Log.debug("[Labels.initialize] Labels configured but layer hidden for", layerId);
            return void this.enableLabels(layerId, {}, false);
        }
        if (Log) Log.debug("[Labels.initialize] Initializing visible labels for", layerId);
        return void this.enableLabels(layerId, {}, true);
    },

    async enableLabels(
        layerId: string,
        labelConfig: LabelUserConfig = {},
        showImmediately = true
    ): Promise<void> {
        if (!layerId) {
            if (Log) Log.warn("[Labels] enableLabels: layerId missing");
            return;
        }
        if (labelConfig.styleFile) {
            throw new Error(
                `Obsolete configuration: labels.styleFile detected in layer ${layerId}`
            );
        }
        if (Log)
            Log.debug(
                "[Labels] Preparing labels for",
                layerId,
                "showImmediately:",
                showImmediately
            );
        try {
            await _doEnableLabels(this, layerId, labelConfig, showImmediately);
        } catch (err) {
            if (Log) Log.error("[Labels] Error preparing labels:", err);
            Log.error("[Labels] Stack trace:", (err as Error).stack);
        }
    },

    disableLabels(layerId: string): void {
        if (!layerId) return;
        const layerState = _state.layers.get(layerId);
        if (!layerState) return;
        if (Log) Log.debug("[Labels] Disabling labels for", layerId);
        _clearTooltips(layerState.tooltips);
        layerState.enabled = false;
    },

    _hideLabelsForLayer(layerId: string): void {
        if (!layerId) return;
        const layerState = _state.layers.get(layerId);
        if (!layerState) return;
        _clearTooltips(layerState.tooltips);
    },

    toggleLabels(layerId: string): boolean {
        if (!layerId) return false;
        const layerState = _state.layers.get(layerId);
        if (!layerState) return false;
        const layerData = this._getLayerData(layerId);
        if (_getIntegratedLabel(layerData)?.enabled !== true) return false;
        if (layerState.enabled) {
            this._hideLabelsForLayer(layerId);
            layerState.enabled = false;
            return false;
        }
        layerState.enabled = true;
        this.refreshLabels(layerId);
        return true;
    },

    hasLabelConfig(layerId: string): boolean {
        return _state.layers.has(layerId);
    },

    areLabelsEnabled(layerId: string): boolean {
        const layerState = _state.layers.get(layerId);
        return layerState ? layerState.enabled : false;
    },

    refreshLabels(layerId: string): void {
        if (!layerId) return;
        const layerState = _state.layers.get(layerId);
        if (!layerState || !layerState.enabled) return;
        const layerData = this._getLayerData(layerId);
        if (!layerData?._visibility?.current) return;
        _clearTooltips(layerState.tooltips);
        this._createLabelsForLayer(layerId).catch((e: unknown) =>
            Log?.error(`[Labels] Failed to refresh labels for "${layerId}":`, e)
        );
    },

    async _createLabelsForLayer(layerId: string): Promise<void> {
        const layerState = _state.layers.get(layerId);
        if (!layerState) return;
        if (!layerState.enabled) return;
        const layerData = this._getLayerData(layerId);
        if (!_isLayerVisible(layerData)) return;
        const hasFeatures = Array.isArray(layerData?.features);
        if (!hasFeatures) {
            if (Log) Log.warn("[Labels] GeoJSON layer not found:", layerId);
            return;
        }
        const map = _getMap();
        if (_isOutOfRange(this, map, layerState.config, layerState.labelStyle)) return;
        _renderTooltipsForLayer(
            layerId,
            layerData,
            layerState.config,
            layerState.labelStyle,
            layerState.tooltips
        );
    },

    _getLayerData(layerId: string): LabelLayerData | null {
        const core = GeoJSONCore as unknown as LabelsGeoJSONCore;
        if (!core || typeof core.getLayerById !== "function") return null;
        return core.getLayerById(layerId);
    },

    /**
     * Arms the `zoomend` subscription on the CURRENT map adapter.
     *
     * The early return compares the adapter, not just the flag: a map destroyed and
     * re-created — `Core.destroy()` then `Core.init()` — hands back a NEW adapter, with no
     * `destroy()` of this module in between. On the flag alone the subscription stayed on
     * the discarded map and labels silently stopped reacting to zoom for the rest of the
     * session. (A basemap switch does not replace the adapter: it replaces the engine's
     * style, which `_ensureStyleListener` answers.)
     */
    _ensureZoomListener(): void {
        const map = Core && Core.getMap ? (Core.getMap() as LabelsMapHandle | null) : null;
        if (_state.zoomListenerAttached && _state.zoomMap === map) return;
        if (!map) return;
        // Adapter replaced: release the stale subscription before re-arming, otherwise
        // the discarded map keeps a handler holding this module alive.
        if (_state.zoomListenerAttached) _detachZoomListener();
        const handler = () => {
            this._handleZoomChange({ zoom: map.getZoom() });
        };
        map.on("zoomend", handler);
        _state.zoomMap = map;
        _state.zoomHandler = handler;
        _state.zoomListenerAttached = true;
    },

    _handleZoomChange(detail: { zoom?: number }): void {
        if (!detail) return;
        const map = _getMap();
        if (!map) return;
        const currentScale = this._calculateMapScale(map);
        _state.layers.forEach((layerState, layerId) => {
            _processZoomLayerItem(this, layerState, layerId, currentScale, detail, map);
        });
    },

    _calculateMapScale(map: LabelsMapHandle | null): number {
        if (ScaleUtils && typeof ScaleUtils.calculateMapScale === "function")
            return ScaleUtils.calculateMapScale(map, { logger: Log });
        if (Log) Log.warn("[Labels] ScaleUtils.calculateMapScale unavailable");
        return 0;
    },

    _isScaleInRange(
        currentScale: number,
        minScale: number | null | undefined,
        maxScale: number | null | undefined
    ): boolean {
        if (ScaleUtils && typeof ScaleUtils.isScaleInRange === "function")
            return ScaleUtils.isScaleInRange(currentScale, minScale, maxScale, Log);
        if (Log) Log.warn("[Labels] ScaleUtils.isScaleInRange unavailable");
        return true;
    },

    destroy(): void {
        if (Log) Log.debug("[Labels] Destroying Labels module");
        _state.layers.forEach((_, layerId) => this.disableLabels(layerId));
        _state.layers.clear();
        _detachZoomListener();
        _detachStyleListener();
    },
};

export { Labels };
