/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Centralized manager for the label button in the Layer Manager
 */

import { Log } from "../../utils/log/index.js";
import { _UIComponents } from "../../kernel/ui/index.js";
import { GeoJSONCore } from "../../kernel/geojson/index.js";
import { Labels } from "./labels.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import type {
    LabelButtonManagerApi,
    LabelButtonSyncState,
    LabelLayerData,
    LabelsGeoJSONCore,
} from "./types.js";

/** GeoJSON core typed via the labels structural accessor (no `any`). */
const _GeoJSONCore = GeoJSONCore as unknown as LabelsGeoJSONCore;

function _buildLabelToggleButton(): HTMLButtonElement {
    const labelToggle = domCreate("button", "gl-layer-manager__label-toggle");
    labelToggle.type = "button";
    labelToggle.setAttribute("aria-label", getLabel("aria.labels.toggle"));
    labelToggle.disabled = true;
    labelToggle.classList.add("gl-layer-manager__label-toggle--disabled");
    const iconSpan = document.createElement("span");
    iconSpan.className = "gl-layer-manager__label-toggle-icon";
    iconSpan.textContent = "🏷️";
    labelToggle.appendChild(iconSpan);
    labelToggle.title = getLabel("aria.labels.toggle");
    return labelToggle;
}

function _buildLabelToggleHandler(
    labelToggle: HTMLButtonElement,
    layerId: string
): (ev: Event) => void {
    return function (ev: Event) {
        ev.stopPropagation();
        ev.preventDefault();
        if (labelToggle.disabled) return;
        try {
            const layerData: LabelLayerData | null | undefined =
                _GeoJSONCore?.getLayerById?.(layerId);
            const labelEnabled = layerData?.currentStyle?.label?.enabled === true;
            if (!labelEnabled) return;
            if (Labels?.toggleLabels) {
                const newState = Labels.toggleLabels(layerId);
                if (newState) {
                    labelToggle.classList.add("gl-layer-manager__label-toggle--on");
                    labelToggle.setAttribute("aria-pressed", "true");
                } else {
                    labelToggle.classList.remove("gl-layer-manager__label-toggle--on");
                    labelToggle.setAttribute("aria-pressed", "false");
                }
            }
        } catch (err) {
            if (Log) Log.warn("[LabelButtonManager] Error toggling labels:", err);
        }
    };
}

const LabelButtonManager: LabelButtonManagerApi = {
    createButton(layerId: string, controlsContainer: HTMLElement): HTMLElement | null {
        if (!layerId || !controlsContainer) {
            if (Log)
                Log.warn("[LabelButtonManager] createButton: missing parameters", {
                    layerId,
                    hasContainer: !!controlsContainer,
                });
            return null;
        }
        const existingButton = controlsContainer.querySelector(".gl-layer-manager__label-toggle");
        if (existingButton) return existingButton as HTMLElement;
        const labelToggle = _buildLabelToggleButton();
        const onLabelToggle = _buildLabelToggleHandler(labelToggle, layerId);
        _UIComponents.attachEventHandler(labelToggle, "click", onLabelToggle);
        const visibilityToggle = controlsContainer.querySelector(".gl-layer-manager__item-toggle");
        if (visibilityToggle) controlsContainer.insertBefore(labelToggle, visibilityToggle);
        else controlsContainer.appendChild(labelToggle);
        return labelToggle;
    },

    _doSync(layerId: string): void {
        if (!layerId) return;
        let button = document.querySelector(
            `[data-layer-id="${layerId}"] .gl-layer-manager__label-toggle`
        );
        if (!button) {
            const layerItem = document.querySelector(`[data-layer-id="${layerId}"]`);
            if (!layerItem) return;
            const controlsContainer = layerItem.querySelector(".gl-layer-manager__item-controls");
            if (controlsContainer) {
                button = controlsContainer.querySelector(".gl-layer-manager__label-toggle");
                if (!button) button = this.createButton(layerId, controlsContainer as HTMLElement);
            }
        }
        if (!button) return;
        const state = this._getState(layerId);
        this._applyState(button as HTMLButtonElement, state);
    },

    _getState(layerId: string): LabelButtonSyncState {
        const layerData = _GeoJSONCore?.getLayerById?.(layerId);
        return {
            layerId,
            layerExists: !!layerData,
            layerVisible: layerData?._visibility?.current === true,
            labelEnabled: layerData?.currentStyle?.label?.enabled === true,
            areLabelsActive: Labels?.areLabelsEnabled?.(layerId) || false,
        };
    },

    _applyState(button: HTMLButtonElement, state: LabelButtonSyncState): void {
        const canUseLabels = state.labelEnabled && state.layerVisible;
        if (canUseLabels) {
            button.disabled = false;
            button.classList.remove("gl-layer-manager__label-toggle--disabled");
            const shouldAppearOn = state.areLabelsActive && state.layerVisible;
            if (shouldAppearOn) {
                button.classList.add("gl-layer-manager__label-toggle--on");
                button.setAttribute("aria-pressed", "true");
            } else {
                button.classList.remove("gl-layer-manager__label-toggle--on");
                button.setAttribute("aria-pressed", "false");
            }
        } else {
            button.disabled = true;
            button.classList.add("gl-layer-manager__label-toggle--disabled");
            button.classList.remove("gl-layer-manager__label-toggle--on");
            button.setAttribute("aria-pressed", "false");
        }
    },

    syncImmediate(layerId: string): void {
        if (!layerId) return;
        this._doSync(layerId);
    },

    /**
     * Detaches every 🏷️ button this manager injected (teardown counterpart of
     * {@link createButton}).
     *
     * Removing the element is the only way to release its handlers:
     * `attachEventHandler` puts TWO listeners on each button — the toggle handler and
     * a `stopPropagation` guard (`ui/widgets.ts`) — and hands back nothing to
     * unsubscribe with. Left in place, the buttons stayed painted in a layer list they
     * no longer serve and kept calling into a destroyed `Labels` singleton.
     *
     * Scoped by the manager's own class, and swept across the document rather than a
     * caller-supplied container: buttons are injected one per layer row, from a seam
     * whose containers the capability never holds on to.
     */
    removeButtons(): void {
        if (typeof document === "undefined") return;
        document.querySelectorAll(".gl-layer-manager__label-toggle").forEach((btn) => btn.remove());
    },
};

export { LabelButtonManager };
