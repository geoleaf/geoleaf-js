/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Labels capability — lifecycle / event wiring.
 *
 * Wires the `Labels` singleton init/destroy and **owns the per-layer toggle
 * button** (🏷️): subscribes to the kernel `geoleaf:layer-item:controls` seam and
 * injects the label button into each layer's control container — so the layer
 * manager no longer imports labels statically.
 *
 * Invoked by `LabelsModule` (registered in `boot.ts` only when
 * `modules.labels.enabled` is set), replacing the former dispersed init
 * (`init-deferred-ui.ts` + `globals.ui.ts`).
 */

import { Labels } from "./labels.js";
import { LabelButtonManager } from "./label-button-manager.js";
import type { LayerItemControlsDetail } from "../../kernel/layer-manager/item-controls-seam.js";

/** Injects the label toggle button when the layer manager renders a layer's controls. */
function onLayerItemControls(e: Event): void {
    const detail = (e as CustomEvent<LayerItemControlsDetail>).detail;
    if (!detail || !detail.layerId || !detail.controlsContainer) return;
    if (!LabelButtonManager) return; // Lite stub → no button
    LabelButtonManager.createButton(detail.layerId, detail.controlsContainer);
    LabelButtonManager.syncImmediate(detail.layerId);
}

/**
 * Re-syncs label buttons for layers already rendered before the capability
 * initialised (first-render net — mirrors the manager's existing auto-heal).
 */
function syncExistingLayers(): void {
    const mgr = LabelButtonManager;
    if (typeof document === "undefined" || !mgr) return;
    document.querySelectorAll("[data-layer-id]").forEach((el) => {
        const layerId = (el as HTMLElement).getAttribute("data-layer-id");
        if (layerId) mgr.syncImmediate(layerId);
    });
}

let _started = false;

/** Idempotent event wiring for the Labels capability. Safe to call multiple times. */
export const LabelsLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        if (Labels) Labels.init();
        document.addEventListener("geoleaf:layer-item:controls", onLayerItemControls);
        syncExistingLayers();
    },

    /**
     * Detaches the seam, removes the injected buttons and tears down labels (module
     * destroy / test seam).
     *
     * The button removal is not cosmetic: each button carries two listeners
     * (`attachEventHandler`) and nothing else releases them, so a destroy with no
     * re-init left clickable 🏷️ toggles wired to a destroyed singleton.
     */
    _reset(): void {
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:layer-item:controls", onLayerItemControls);
        }
        if (LabelButtonManager) LabelButtonManager.removeButtons();
        if (Labels) Labels.destroy();
        _started = false;
    },
};
