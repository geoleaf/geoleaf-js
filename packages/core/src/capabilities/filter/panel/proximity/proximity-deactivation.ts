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

    // The slider-reset block that lived here was removed on 24/08/2026 as dead by
    // construction: it selected `[data-filter-proximity-radius]` inside the panel and read
    // a `data-proximity-radius-default` attribute — but `render.ts` states the panel does
    // NOT render proximity ("driven by the toolbar button (S5), not rendered in the
    // panel"), nothing anywhere writes either attribute (measured across packages/,
    // profiles/, apps/ and the public docs — an integrator has no documented channel to
    // add them), and the default attribute's only occurrence in the whole repo was this
    // very reader. The live radius path is the mobile toolbar; the reset it needs is
    // handled there.

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

/** Id of the hidden wrapper the toolbar fills and the filter engine reads. */
export const TOOLBAR_WRAPPER_ID = "gl-proximity-toolbar-wrapper";

/**
 * Attribute the wrapper carries while the toolbar's proximity is armed — from the button press,
 * before any point is placed. The toolbar reads it after a filter pass to learn that a reset
 * disarmed it.
 */
export const TOOLBAR_ARMED_ATTR = "data-proximity-armed";

/**
 * Drops the toolbar wrapper's centre and armed state, so the filter engine no longer reads a
 * proximity from it. The radius stays: it is the slider's setting, not a filter.
 */
export function clearToolbarWrapper(): void {
    const wrapper = document.getElementById(TOOLBAR_WRAPPER_ID);
    if (!wrapper) return;
    wrapper.removeAttribute("data-proximity-active");
    wrapper.removeAttribute("data-proximity-lat");
    wrapper.removeAttribute("data-proximity-lng");
    wrapper.removeAttribute(TOOLBAR_ARMED_ATTR);
}

/**
 * Resets proximity mode from the outside — the filter's `reset()` and the panel's reset button.
 *
 * Clears the map-side elements (circle, marker, click handler, cursor) and the toolbar
 * wrapper the filter engine reads, and disarms the mode. It used to stop at the map: the
 * wrapper kept its centre, so the next filter pass still applied the proximity it had just
 * « reset ». Never touches the panel DOM; the toolbar resyncs its button on the filter pass
 * that follows.
 */
export function resetProximity(): void {
    if (ProximityState.map) cleanupMapElements(ProximityState.map);
    ProximityState.mode = false;
    ProximityState.pendingRadius = null;
    clearToolbarWrapper();
}
