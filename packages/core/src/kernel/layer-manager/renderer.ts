/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LayerManager Renderer module — orchestrator
 * Delegates to the specialized sub-modules.
 *
 * Sous-modules:
 * - visibility-checker.ts: checkLayerVisibility (read by syncToggles)
 * - render-sections.ts   : renderSections
 *
 * EXPOSE:
 * - LMRenderer (object) — `renderSections` + `syncToggles`, the only two methods
 *   `control.ts` calls. The `_render*` wrappers that used to delegate to the
 *   item-controls/attach-toggle were removed (S4): no caller left. Those
 *   sub-modules are still consumed directly by `render-sections.ts`.
 */

import { Log } from "../../utils/log/index.js";
import { GeoJSONShared } from "../shared/geojson-state.js";
import { GeoJSONCore } from "../geojson/core.js";
import { renderSections } from "./render-sections.js";
import type { LMSection } from "./layer-manager-helpers.js";
import { checkLayerVisibility } from "./visibility-checker.js";

const _LayerManagerRenderer = {
    renderSections(bodyEl: HTMLElement | null, sections: LMSection[]) {
        renderSections(bodyEl, sections);
    },

    /**
     * Syncs the existing toggles' state without regenerating the DOM.
     * Used after applying a theme to update the toggles.
     * @public
     */
    syncToggles() {
        // Find every layer item in the DOM
        const layerItems = document.querySelectorAll("[data-layer-id]");

        if (Log) Log.debug(`[LayerManager Renderer] Synchronizing ${layerItems.length} toggles`);

        layerItems.forEach((itemEl) => {
            const layerId = itemEl.getAttribute("data-layer-id");
            if (!layerId) return;

            // Collect the visibility info for logging
            const layerData = GeoJSONCore?.getLayerById(layerId);
            const isVisible = checkLayerVisibility(layerId);

            if (Log)
                Log.debug(`[LayerManager Renderer] Layer ${layerId}:`, {
                    isVisible,
                    hasLayerData: !!layerData,
                    hasVisibility: !!(layerData && layerData._visibility),
                    currentValue: layerData?._visibility?.current,
                    onMap:
                        layerData?.layer && GeoJSONShared.state.map
                            ? (
                                  GeoJSONShared.state.map as {
                                      hasLayer?: (l: unknown) => boolean;
                                  }
                              ).hasLayer?.(layerData.layer)
                            : false,
                });

            // Update the gl-layer--hidden class
            if (isVisible) {
                itemEl.classList.remove("gl-layer--hidden");
            } else {
                itemEl.classList.add("gl-layer--hidden");
            }

            // Find and update the toggle button
            const toggleBtn = itemEl.querySelector(".gl-layer-manager__item-toggle");
            if (toggleBtn) {
                toggleBtn.setAttribute("aria-pressed", isVisible ? "true" : "false");

                const onClass = "gl-layer-manager__item-toggle--on";
                if (isVisible) {
                    toggleBtn.classList.add(onClass);
                } else {
                    toggleBtn.classList.remove(onClass);
                }
            }
        });

        if (Log) Log.debug("[LayerManager Renderer] Toggle states synchronized");
    },
};

const LMRenderer = _LayerManagerRenderer;
export { LMRenderer };
