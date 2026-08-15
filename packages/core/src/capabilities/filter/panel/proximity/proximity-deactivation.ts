/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Filter Panel - Proximity Deactivation
 * Proximity mode deactivation and cleanup — shared by the panel and the toolbar.
 */
import { getLog } from "../../../../utils/general/di-accessors.js";
import { getLabel } from "../../../../utils/i18n/i18n.js";
import type { IMapAdapter } from "../../../../contracts/map-adapter.contract.js";
import { disarmToolCursor } from "../../../../kernel/shared/index.js";
import { ProximityState } from "./proximity-state.js";
import { removeCircleAndMarker } from "./proximity-circle.js";

/**
 * Clears the map-side elements: circle, marker, click handler and cursor.
 * Leaves the panel DOM untouched.
 *
 * Also releases exclusive mode, so the core's hover handlers resume owning the cursor —
 * see `kernel/shared/map-cursor.ts`.
 */
export function cleanupMapElements(map: IMapAdapter): void {
    disarmToolCursor(map);

    if (ProximityState.clickHandler) {
        map.off("click", ProximityState.clickHandler);
        ProximityState.clickHandler = null;
    }

    removeCircleAndMarker(map);
}

/**
 * Deactivates proximity mode from the filter panel.
 * Restores the panel UI to its initial state and clears the map.
 */
export function deactivatePanel(btn: HTMLElement, container: HTMLElement, map: IMapAdapter): void {
    const Log = getLog();

    btn.textContent = getLabel("ui.filter.activate");
    btn.classList.remove("gl-is-active");

    const rangeWrapper = container.querySelector(
        ".gl-filter-panel__proximity-range"
    ) as HTMLElement | null;
    const instruction = container.querySelector(
        ".gl-filter-panel__proximity-instruction"
    ) as HTMLElement | null;

    if (rangeWrapper) rangeWrapper.style.display = "none";
    if (instruction) instruction.style.display = "none";

    cleanupMapElements(map);

    // Reset the slider to its default value
    const radiusInput = container.querySelector(
        "[data-filter-proximity-radius]"
    ) as HTMLInputElement | null;
    if (radiusInput) {
        const defaultVal =
            radiusInput.getAttribute("data-proximity-radius-default") || radiusInput.min || "10";
        radiusInput.value = defaultVal;
        const rangeValueSpan = radiusInput
            .closest(".gl-filter-panel__range-wrapper")
            ?.querySelector(".gl-filter-panel__range-value") as HTMLElement | null;
        if (rangeValueSpan) rangeValueSpan.textContent = defaultVal;
    }

    // Drop the data-proximity-* attributes from the wrapper
    const wrapper = container.closest("[data-gl-filter-id='proximity']");
    if (wrapper) {
        wrapper.removeAttribute("data-proximity-active");
        wrapper.removeAttribute("data-proximity-lat");
        wrapper.removeAttribute("data-proximity-lng");
        wrapper.removeAttribute("data-proximity-radius");
    }

    ProximityState.pendingRadius = null;

    Log.info("[GeoLeaf.Proximity] Proximity mode disabled (panel)");
}

/**
 * Resets proximity mode from the outside (e.g. a "Reset" button).
 * Touches the map-side elements only, never the panel DOM.
 */
export function resetProximity(): void {
    if (!ProximityState.map) return;
    cleanupMapElements(ProximityState.map);
    ProximityState.mode = false;
}
