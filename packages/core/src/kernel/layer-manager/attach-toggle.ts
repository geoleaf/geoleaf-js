/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LayerManager — Toggle Handler
 * Handles clicks on a layer's toggle button (show/hide, lazy-load, label-btn sync).
 *
 * Extracted from layer-manager/renderer.ts.
 */

import { Log } from "../../utils/log/index.js";
import { GeoJSONCore } from "../geojson/core.js";
import { ThemeApplierCore } from "../themes/theme-applier/core.js";

type ToggleBtn = HTMLButtonElement & { _toggleHandlerAttached?: boolean; _isToggling?: boolean };

function _stopEventPropagation(ev: Event) {
    ev.stopPropagation();
    ev.preventDefault();
}

function _findLabelBtn(layerItem: Element | null, toggleBtn: ToggleBtn): Element | null {
    if (layerItem) {
        const btn = layerItem.querySelector(".gl-layer-manager__label-toggle");
        if (btn) return btn;
    }
    if (toggleBtn.parentElement) {
        return toggleBtn.parentElement.querySelector(".gl-layer-manager__label-toggle");
    }
    return null;
}

function _enableLabelBtnIfApplicable(labelBtn: Element, itemId: string) {
    const ld =
        GeoJSONCore && typeof GeoJSONCore.getLayerById === "function"
            ? GeoJSONCore.getLayerById(itemId)
            : null;
    if (!ld) return;
    // `currentStyle.label` may carry a nested `{ enabled }` flag (style-file shape),
    // narrowed structurally since the runtime entry types `label` loosely.
    const labelCfg = (ld.currentStyle as { label?: { enabled?: boolean } } | null | undefined)
        ?.label;
    const labelEnabled = labelCfg?.enabled === true;
    if (!labelEnabled) return;
    (labelBtn as HTMLButtonElement).disabled = false;
    labelBtn.classList.remove("gl-layer-manager__label-toggle--disabled");
}

function _handleLayerHide(toggleBtn: ToggleBtn, layerItem: Element | null, itemId: string) {
    GeoJSONCore.hideLayer(itemId);
    toggleBtn.setAttribute("aria-pressed", "false");
    toggleBtn.classList.remove("gl-layer-manager__item-toggle--on");
    if (layerItem) layerItem.classList.add("gl-layer--hidden");
    const labelBtn = _findLabelBtn(layerItem, toggleBtn);
    if (labelBtn) {
        (labelBtn as HTMLButtonElement).disabled = true;
        labelBtn.classList.add("gl-layer-manager__label-toggle--disabled");
        labelBtn.classList.remove("gl-layer-manager__label-toggle--on");
        labelBtn.setAttribute("aria-pressed", "false");
    } else {
        if (Log) Log.warn("[LayerManager] Label button NOT FOUND for deactivation:", itemId);
    }
}

function _handleLayerShow(toggleBtn: ToggleBtn, layerItem: Element | null, itemId: string) {
    GeoJSONCore.showLayer(itemId);
    toggleBtn.setAttribute("aria-pressed", "true");
    toggleBtn.classList.add("gl-layer-manager__item-toggle--on");
    if (layerItem) layerItem.classList.remove("gl-layer--hidden");
    const labelBtn = _findLabelBtn(layerItem, toggleBtn);
    if (labelBtn) {
        _enableLabelBtnIfApplicable(labelBtn, itemId);
    }
}

function _afterLazyLoadSuccess(toggleBtn: ToggleBtn, itemId: string, loadedLayer: unknown) {
    toggleBtn.classList.remove("gl-layer-manager__item-toggle--loading");
    toggleBtn.disabled = false;
    if (!loadedLayer) {
        if (Log) Log.warn("[LayerManager] Layer loading failed:", itemId);
        return;
    }
    if (Log) Log.info("[LayerManager] Layer loaded successfully:", itemId);
    GeoJSONCore.showLayer(itemId);
    toggleBtn.setAttribute("aria-pressed", "true");
    toggleBtn.classList.add("gl-layer-manager__item-toggle--on");
    const layerItem = document.querySelector('[data-layer-id="' + itemId + '"]');
    if (layerItem) layerItem.classList.remove("gl-layer--hidden");
    const labelBtn = _findLabelBtn(layerItem, toggleBtn);
    if (labelBtn) _enableLabelBtnIfApplicable(labelBtn, itemId);
}

function _handleLazyLoad(toggleBtn: ToggleBtn, itemId: string) {
    if (Log) Log.info("[LayerManager] Layer not loaded, loading on demand:", itemId);
    toggleBtn.classList.add("gl-layer-manager__item-toggle--loading");
    toggleBtn.disabled = true;
    const loader =
        ThemeApplierCore && typeof ThemeApplierCore._loadLayerFromProfile === "function"
            ? ThemeApplierCore._loadLayerFromProfile
            : null;
    if (!loader) {
        toggleBtn.classList.remove("gl-layer-manager__item-toggle--loading");
        toggleBtn.disabled = false;
        if (Log) Log.warn("[LayerManager] ThemeApplierCore not available for loading:", itemId);
        return;
    }
    loader
        .call(ThemeApplierCore, itemId)
        .then((loadedLayer: unknown) => {
            _afterLazyLoadSuccess(toggleBtn, itemId, loadedLayer);
        })
        .catch((err: unknown) => {
            toggleBtn.classList.remove("gl-layer-manager__item-toggle--loading");
            toggleBtn.disabled = false;
            if (Log) Log.error("[LayerManager] Error loading layer:", itemId, err);
        });
}

/**
 * Attaches the toggle handler to a layer.
 * @param toggleBtn - Le button HTML
 * @param itemId - The layer identifier
 * @param checkVisibility - Injected visibility-check callback (avoids a circular dependency)
 */
function attachToggleHandler(
    toggleBtn: ToggleBtn,
    itemId: string,
    checkVisibility: (id: string) => boolean
) {
    // GUARD: bail out when a handler is already attached
    if (toggleBtn._toggleHandlerAttached) {
        return;
    }

    // Mark as attached BEFORE creating the handler
    toggleBtn._toggleHandlerAttached = true;

    const onToggle = function (ev: Event) {
        if (toggleBtn._isToggling) {
            if (Log) Log.warn("[LayerManager] Toggle already in progress, blocked:", itemId);
            _stopEventPropagation(ev);
            return;
        }
        toggleBtn._isToggling = true;
        _stopEventPropagation(ev);
        setTimeout(() => {
            toggleBtn._isToggling = false;
        }, 100);
        try {
            if (!itemId || !GeoJSONCore) return;
            const layerData = GeoJSONCore.getLayerById(itemId);
            if (!layerData) {
                _handleLazyLoad(toggleBtn, itemId);
                return;
            }
            const isCurrentlyVisible = checkVisibility(itemId);
            const layerItem = document.querySelector(`[data-layer-id="${itemId}"]`);
            if (isCurrentlyVisible) {
                _handleLayerHide(toggleBtn, layerItem, itemId);
            } else {
                _handleLayerShow(toggleBtn, layerItem, itemId);
            }
        } catch (err) {
            if (Log) Log.warn("[LayerManager] Toggle error:", err);
        }
    };

    toggleBtn.addEventListener("click", onToggle);
}

export { attachToggleHandler };
