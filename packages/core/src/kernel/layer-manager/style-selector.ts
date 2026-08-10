/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Selector de styles for the manager for layers.
 * @version 1.2.0
 */

"use strict";

import { GeoJSONCore } from "../geojson/core.js";
import { StyleLoader } from "../../utils/loaders/style-loader.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { LegendContract } from "../../capabilities/legend/legend-seam.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { Log } from "../../utils/log/index.js";

const state = {
    currentStyles: new Map<string, string>(),
};

/** Labels surface consumed via the runtime global (no static capability import). */
interface LabelsLike {
    initializeLayerLabels?(layerId: string): void;
}

/** Label button manager surface consumed via the runtime global. */
interface LabelButtonManagerLike {
    syncImmediate?(layerId: string): void;
}

function _applyStyleResult(
    layerData: ResolvedLayerData,
    layerId: string,
    styleId: string,
    res: { styleData: unknown; metadata: unknown }
): void {
    layerData.currentStyle = res.styleData;
    layerData.currentStyleMetadata = res.metadata;
    // Extract the nested `style` object from the style file JSON.
    // Style files have the shape { id, label, style: { fillColor, … }, styleRules: [...], legend }.
    // normalizeToFlat() is a shallow copy — passing the root object would leave
    // paint properties nested inside flat.style. We unwrap here so the adapter
    // receives a flat paint object directly, while preserving styleRules so that
    // applyLayerStyle() can rebuild MapLibre case-expressions for per-category colouring.
    const sd = res.styleData as
        | { style?: Record<string, unknown>; styleRules?: unknown[] }
        | null
        | undefined;
    const paintData: Record<string, unknown> = { ...(sd?.style ?? sd ?? {}) };
    if (Array.isArray(sd?.styleRules)) {
        paintData.styleRules = sd.styleRules;
    }
    if (typeof GeoJSONCore.setLayerStyle === "function") {
        GeoJSONCore.setLayerStyle(layerId, paintData);
    }
    const GeoLeaf = getGeoLeaf();
    (GeoLeaf?.Labels as LabelsLike | undefined)?.initializeLayerLabels?.(layerId);
    (GeoLeaf?._LabelButtonManager as LabelButtonManagerLike | undefined)?.syncImmediate?.(layerId);
    if (LegendContract.isAvailable()) {
        LegendContract.loadLayerLegend(layerData.config.id, styleId, layerData.config);
    }
}

/**
 * Layer data view (subset of {@link GeoJSONCore.getLayerData}) consumed by the
 * style selector — the fields it reads and writes while applying a style.
 */
interface ResolvedLayerData {
    config: {
        id?: string;
        styles?: { available?: StyleItemConfig[] };
        _profileId?: string;
        _layerDirectory?: string;
        [key: string]: unknown;
    };
    currentStyle?: unknown;
    currentStyleMetadata?: unknown;
    [key: string]: unknown;
}

function _resolveStyleConfig(
    layerId: string,
    styleId: string
): { layerData: ResolvedLayerData; styleConfig: StyleItemConfig } | null {
    if (!GeoJSONCore) return null;
    const layerData = GeoJSONCore.getLayerData(layerId) as ResolvedLayerData | null;
    if (!layerData) return null;
    if (!layerData.config?.styles || !Array.isArray(layerData.config.styles.available)) return null;
    const styleConfig = layerData.config.styles.available.find(
        (s: StyleItemConfig) => s.id === styleId
    );
    return styleConfig ? { layerData, styleConfig } : null;
}

interface StyleItemConfig {
    id: string;
    label?: string;
    file?: string;
}

interface LayerItemStyles {
    available?: StyleItemConfig[];
    default?: string;
    directory?: string;
}

/**
 * The subset of a layer entry the style selector needs: its identity and the styles it offers.
 *
 * Deliberately narrower than the full layer config — the selector never reads geometry or
 * data, so a caller can build one from any layer-shaped object.
 */
export interface LayerItemForStyle {
    /** Layer id, the key under which the current style is tracked. */
    id: string;
    /** Display name; falls back to the id when absent. */
    label?: string;
    /** The alternative styles this layer offers. Absent means no style choice is rendered. */
    styles?: LayerItemStyles;
}

const _LayerManagerStyleSelector = {
    getCurrentStyle(layerId: string): string | null {
        return state.currentStyles.get(layerId) ?? null;
    },

    setCurrentStyle(layerId: string, styleId: string): void {
        state.currentStyles.set(layerId, styleId);
    },

    renderDOM(item: LayerItemForStyle): HTMLElement | null {
        if (
            !item.styles ||
            !Array.isArray(item.styles.available) ||
            item.styles.available.length <= 1
        ) {
            return null;
        }

        const currentStyle =
            this.getCurrentStyle(item.id) || item.styles.default || item.styles.available[0]?.id;
        const selectId = "style-selector-" + item.id;

        const container = document.createElement("div");
        container.className = "gl-layer-manager__style-selector";

        const select = document.createElement("select");
        select.id = selectId;
        select.className = "gl-layer-manager__style-select";
        select.setAttribute("data-layer-id", item.id);
        // WCAG 2.1 AA (4.1.2 Name, Role, Value): the native <select> has no
        // associated <label>, so provide an accessible name. Append the layer
        // label when available to disambiguate multiple per-layer selectors.
        const styleSelectName = getLabel("aria.layer.style_select");
        select.setAttribute(
            "aria-label",
            item.label ? styleSelectName + " — " + item.label : styleSelectName
        );

        item.styles.available.forEach((style) => {
            const option = document.createElement("option");
            option.value = style.id;
            option.textContent = style.label ?? style.id;
            if (style.id === currentStyle) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        container.appendChild(select);
        return container;
    },

    bindEvents(container: HTMLElement, item: LayerItemForStyle): void {
        if (
            !item.styles ||
            !Array.isArray(item.styles.available) ||
            item.styles.available.length <= 1
        ) {
            return;
        }

        const selectId = "style-selector-" + item.id;
        const select = container.querySelector<HTMLSelectElement>("#" + selectId);

        if (!select) return;

        const self = this;

        select.addEventListener("change", function (this: HTMLSelectElement) {
            const styleId = this.value;
            const layerId = this.getAttribute("data-layer-id");
            if (layerId) {
                self.setCurrentStyle(layerId, styleId);
                self.applyStyle(layerId, styleId).catch((e: unknown) =>
                    Log?.error(`[StyleSelector] Failed to apply style "${styleId}":`, e)
                );
            }
        });
    },

    async applyStyle(layerId: string, styleId: string): Promise<void> {
        const resolved = _resolveStyleConfig(layerId, styleId);
        if (!resolved) return;
        const { layerData, styleConfig } = resolved;

        try {
            if (!StyleLoader) return;

            const profileId = layerData.config._profileId;
            const layerDirectory = layerData.config._layerDirectory;

            if (!profileId || !layerDirectory) return;

            const result = await StyleLoader.loadAndValidateStyle(
                profileId,
                layerId,
                styleId,
                styleConfig.file ?? "",
                layerDirectory
            );

            _applyStyleResult(
                layerData,
                layerId,
                styleId,
                result as { styleData: unknown; metadata: unknown }
            );
        } catch (_error) {
            // log removed
        }
    },
};

const StyleSelector = _LayerManagerStyleSelector;
export { StyleSelector };
