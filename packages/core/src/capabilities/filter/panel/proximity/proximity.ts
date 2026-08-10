/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Filter Panel - Proximity
 * Orchestrator of the proximity module (panel + toolbar).
 * The state and domain logic are delegated to sub-modules:
 *   - proximity-state.ts      : shared state
 *   - proximity-circle.ts     : creation/removal of the map-side elements
 *   - proximity-gps-mode.ts   : GPS activation (panel + toolbar)
 *   - proximity-manual-mode.ts: manual activation (panel + toolbar)
 *   - proximity-deactivation.ts: deactivation/cleanup
 */
import { getLog } from "../../../../utils/general/di-accessors.js";
import { getLabel } from "../../../../utils/i18n/i18n.js";
import { events } from "../../../../utils/general/event-listener-manager.js";
import type { IMapAdapter } from "../../../../contracts/map-adapter.contract.js";
import { ProximityState } from "./proximity-state.js";
import { removeCircleAndMarker } from "./proximity-circle.js";
import { activateGPSMode, hasRecentGPS } from "./proximity-gps-mode.js";
import { activateManualMode } from "./proximity-manual-mode.js";
import {
    cleanupMapElements,
    deactivatePanel,
    resetProximity as _resetProximity,
} from "./proximity-deactivation.js";
import { kmToMetres } from "../../units.js";

/** Public API surface of the proximity filter module. */
interface FilterPanelProximityAPI {
    initProximityFilter(map: IMapAdapter): void;
    destroy(): void;
    toggleProximityMode(btn: HTMLElement, map: IMapAdapter): void;
    activateGPSMode(container: HTMLElement, map: IMapAdapter): void;
    activateManualMode(container: HTMLElement, map: IMapAdapter): void;
    deactivateProximityMode(btn: HTMLElement, container: HTMLElement, map: IMapAdapter): void;
    resetProximity: () => void;
    toggleProximityToolbar(
        map: IMapAdapter,
        defaultRadius?: number,
        options?: { onPointPlaced?: () => void }
    ): boolean;
    setProximityRadius(radiusKm: number): void;
    _eventCleanups: Array<number | null | (() => void)>;
}

const FilterPanelProximity = {} as FilterPanelProximityAPI;

/**
 * Initializes the proximity feature
 * @param Log - Logger handle, injected rather than imported so the panel stays testable.
 * @param {unknown} map - Map instance
 */
function _attachProximityEvents(Log: ReturnType<typeof getLog>, map: IMapAdapter): void {
    const inputHandler = function (evt: Event): void {
        const target = evt.target as HTMLElement | null;
        const slider = target?.closest("[data-filter-proximity-radius]") as HTMLInputElement | null;
        if (!slider) return;
        const proximityControl = slider.closest(".gl-filter-panel__proximity");
        if (!proximityControl) return;
        const wrapper = proximityControl.closest(
            "[data-gl-filter-id='proximity']"
        ) as HTMLElement | null;
        if (!wrapper) return;
        const newRadius = parseFloat(slider.value);
        wrapper.setAttribute("data-proximity-radius", String(newRadius));
        if (ProximityState.circle) ProximityState.circle.setRadius(kmToMetres(newRadius));
    };
    const clickHandler = function (evt: Event): void {
        const target = evt.target as HTMLElement | null;
        const btn = target?.closest("[data-filter-proximity-btn]") as HTMLElement | null;
        if (!btn) return;
        evt.preventDefault();
        FilterPanelProximity.toggleProximityMode(btn, map);
    };
    if (events) {
        ProximityState.eventCleanups.push(
            events.on(document, "input", inputHandler, false, "ProximityFilter.radiusInput")
        );
        ProximityState.eventCleanups.push(
            events.on(document, "click", clickHandler, false, "ProximityFilter.buttonClick")
        );
    } else {
        Log.warn(
            "[ProximityFilter] EventListenerManager not available - listeners will not be cleaned up"
        );
        document.addEventListener("input", inputHandler);
        document.addEventListener("click", clickHandler);
    }
}

FilterPanelProximity.initProximityFilter = function (map: IMapAdapter): void {
    const Log = getLog();
    if (!map) {
        Log.warn("[GeoLeaf.UI.FilterPanel] Map not available for proximity filter");
        return;
    }
    ProximityState.mode = false;
    ProximityState.circle = null;
    ProximityState.marker = null;
    ProximityState.map = map;
    ProximityState.clickHandler = null;
    _attachProximityEvents(Log, map);
    Log.info("[GeoLeaf.UI.FilterPanel] Proximity filter initialized");
};

/**
 * Tears the proximity filter down: releases the document listeners registered by
 * initProximityFilter, then removes the circle and marker from the map.
 */
FilterPanelProximity.destroy = function () {
    const Log = getLog();

    if (ProximityState.eventCleanups && ProximityState.eventCleanups.length > 0) {
        ProximityState.eventCleanups.forEach((cleanup) => {
            if (typeof cleanup === "function") cleanup();
        });
        ProximityState.eventCleanups = [];
        Log.info("[ProximityFilter] Event listeners cleaned up");
    }

    if (ProximityState.map) {
        removeCircleAndMarker(ProximityState.map);
    }

    ProximityState.map = null;
    ProximityState.mode = false;
};

/**
 * Toggles proximity mode from the filter panel.
 * @param {HTMLElement} btn - Proximity button
 * @param {unknown} map - Map instance
 */
FilterPanelProximity.toggleProximityMode = function (btn: HTMLElement, map: IMapAdapter): void {
    ProximityState.mode = !ProximityState.mode;

    const container = btn.closest(".gl-filter-panel__proximity") as HTMLElement | null;
    if (!container) return;
    const rangeWrapper = container.querySelector(
        ".gl-filter-panel__proximity-range"
    ) as HTMLElement | null;
    const instruction = container.querySelector(
        ".gl-filter-panel__proximity-instruction"
    ) as HTMLElement | null;

    if (ProximityState.mode) {
        btn.textContent = getLabel("ui.filter.disable");
        btn.classList.add("gl-is-active");
        if (rangeWrapper) rangeWrapper.style.display = "block";
        if (instruction) instruction.style.display = "block";

        const wrapper = container.closest("[data-gl-filter-id='proximity']") as HTMLElement | null;
        const radiusInput = container.querySelector(
            "[data-filter-proximity-radius]"
        ) as HTMLInputElement | null;
        const radiusKm = radiusInput ? parseFloat(radiusInput.value) : 10;

        if (!wrapper) return;

        if (hasRecentGPS()) {
            activateGPSMode(map, wrapper, radiusKm);
        } else {
            activateManualMode(map, wrapper, () => {
                const inp = container.querySelector("[data-filter-proximity-radius]");
                return inp ? parseFloat((inp as HTMLInputElement).value) : 10;
            });
        }
    } else {
        deactivatePanel(btn, container, map);
    }
};

/**
 * Enables automatic GPS mode (public API kept for compatibility).
 * @param {HTMLElement} container - Proximity container
 * @param {unknown} map - Map instance
 */
FilterPanelProximity.activateGPSMode = function (container: HTMLElement, map: IMapAdapter): void {
    const wrapper = container.closest("[data-gl-filter-id='proximity']") as HTMLElement | null;
    if (!wrapper) return;
    const radiusInput = container.querySelector(
        "[data-filter-proximity-radius]"
    ) as HTMLInputElement | null;
    const radiusKm = radiusInput ? parseFloat(radiusInput.value) : 10;
    activateGPSMode(map, wrapper, radiusKm);
};

/**
 * Enables manual mode (public API kept for compatibility).
 * @param {HTMLElement} container - Proximity container
 * @param {unknown} map - Map instance
 */
FilterPanelProximity.activateManualMode = function (
    container: HTMLElement,
    map: IMapAdapter
): void {
    const wrapper = container.closest("[data-gl-filter-id='proximity']") as HTMLElement | null;
    if (!wrapper) return;
    activateManualMode(map, wrapper, () => {
        const inp = container.querySelector(
            "[data-filter-proximity-radius]"
        ) as HTMLInputElement | null;
        return inp ? parseFloat(inp.value) : 10;
    });
};

/**
 * Disables proximity mode (public API preserved for compatibility)
 * @param {HTMLElement} btn - Proximity button
 * @param {HTMLElement} container - Proximity container
 * @param {unknown} map - Map instance
 */
FilterPanelProximity.deactivateProximityMode = function (
    btn: HTMLElement,
    container: HTMLElement,
    map: IMapAdapter
): void {
    deactivatePanel(btn, container, map);
};

/**
 * Fully resets proximity mode from the outside (e.g. a "Reset" button).
 */
FilterPanelProximity.resetProximity = _resetProximity;

/**
 * Enables/disables proximity search from the mobile bar, with no dependency on the
 * filter panel DOM. Uses a virtual DOM wrapper so the filter engine still finds the
 * attributes it reads.
 *
 * @param {unknown} map - Map instance
 * @param {number} [defaultRadius=10] - Default radius, in km
 * @param options - `onPointPlaced` fires once the user has dropped the proximity centre,
 *   which is what lets the caller close a mobile sheet at the right moment rather than on
 *   activation.
 * @returns {boolean} The new active state
 */
FilterPanelProximity.toggleProximityToolbar = function (
    map: IMapAdapter,
    defaultRadius?: number,
    options?: { onPointPlaced?: () => void }
): boolean {
    const Log = getLog();
    const effectiveDefaultRadius = defaultRadius ?? 10;
    ProximityState.mode = !ProximityState.mode;

    const effectiveRadius = ProximityState.pendingRadius ?? effectiveDefaultRadius;

    // Virtual wrapper the filter engine can read, standing in for the panel DOM
    let wrapper = document.getElementById("gl-proximity-toolbar-wrapper");
    if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.id = "gl-proximity-toolbar-wrapper";
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        wrapper.style.display = "none";
        document.body.appendChild(wrapper);
    }
    wrapper.setAttribute("data-proximity-radius", String(effectiveRadius));

    if (ProximityState.mode) {
        if (hasRecentGPS()) {
            activateGPSMode(map, wrapper, effectiveRadius, options);
        } else {
            activateManualMode(
                map,
                wrapper,
                () => ProximityState.pendingRadius ?? effectiveDefaultRadius,
                options
            );
        }
    } else {
        // Toolbar deactivation
        ProximityState.pendingRadius = null;
        cleanupMapElements(map);
        const existingWrapper = document.getElementById("gl-proximity-toolbar-wrapper");
        if (existingWrapper) {
            existingWrapper.removeAttribute("data-proximity-active");
            existingWrapper.removeAttribute("data-proximity-lat");
            existingWrapper.removeAttribute("data-proximity-lng");
        }
        Log.info("[GeoLeaf.Toolbar] Proximity disabled");
    }

    return ProximityState.mode;
};

/**
 * Updates the radius of the active proximity circle without recreating it.
 * Used by the mobile banner slider.
 * @param {number} radiusKm - New radius in kilometers
 */
FilterPanelProximity.setProximityRadius = function (radiusKm: number): void {
    /* Memorize the radius even if the circle doesn't exist yet (marker not placed) */
    ProximityState.pendingRadius = radiusKm;
    const wrapper = document.getElementById("gl-proximity-toolbar-wrapper");
    if (wrapper) wrapper.setAttribute("data-proximity-radius", String(radiusKm));
    if (!ProximityState.mode || !ProximityState.circle) return;
    ProximityState.circle.setRadius(kmToMetres(radiusKm));
};

// Proxy _eventCleanups → ProximityState.eventCleanups, kept for test compatibility
Object.defineProperty(FilterPanelProximity, "_eventCleanups", {
    get: () => ProximityState.eventCleanups,
    set: (v: typeof ProximityState.eventCleanups) => {
        ProximityState.eventCleanups = v;
    },
    configurable: true,
    enumerable: false,
});

export { FilterPanelProximity };
