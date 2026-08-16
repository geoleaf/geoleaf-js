/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter capability — public API surface.
 *
 * Mounted on `GeoLeaf.Filter` via `geoleaf.filter.ts`. Exposes the read helpers
 * (`isEnabled`/`getConfig`) plus the S13 **serialisation contract** — the single,
 * DOM-free way to read (`getActiveFilter`) and restore (`applyFilter`) the active
 * filter, consumed by the `permalink` capability — and the imperative helpers
 * (`reset`/`applyNow`/`hasActiveFilters`/`proximity`) consumed by the mobile toolbar
 * and desktop control-builder. These replace the removed `_UIFilterPanel*` globals.
 *
 * Glue only: every method delegates to a capability module (`state`/`apply`/
 * `serialize`/`panel/write`/`panel/proximity`). No business logic here.
 *
 * @example
 * // Integrator checks whether the filter panel is active
 * if (GeoLeaf.Filter.isEnabled()) { … }
 */

import { dispatchGeoLeafEvent } from "../../kernel/events/index.js";
import { getFilterConfig } from "./config.js";
import { readActiveFilter } from "./panel/state.js";
import { applyActiveFilterToSources, applyFilterFromPanel } from "./apply.js";
import { expandActiveFilter } from "./taxonomy-options.js";
import { serializeActiveFilter, deserializeActiveFilter } from "./serialize.js";
import { writePanelControls, resetPanelControls } from "./panel/write.js";
import { FilterPanelProximity } from "./panel/proximity/proximity.js";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";
import type { FilterProximityApi, FilterPublicApi, SerializedFilterState } from "./types.js";

/** The mounted panel element, or `null` (not mounted / SSR). */
function _panel(): HTMLElement | null {
    if (typeof document === "undefined") return null;
    return document.getElementById("gl-filter-panel");
}

/** Proximity sub-API delegating to the capability's proximity module. */
const _proximity: FilterProximityApi = {
    setRadius: (radiusKm: number): void => FilterPanelProximity.setProximityRadius(radiusKm),
    toggle: (
        map: IMapAdapter,
        radiusKm?: number,
        options?: { onPointPlaced?: () => void }
    ): boolean => FilterPanelProximity.toggleProximityToolbar(map, radiusKm, options),
};

/** Builds the object mounted on `GeoLeaf.Filter`. */
export function buildPublicApi(): FilterPublicApi {
    return {
        isEnabled: (): boolean => getFilterConfig().enabled !== false,

        getConfig: () => getFilterConfig(),

        getActiveFilter: (): SerializedFilterState =>
            serializeActiveFilter(readActiveFilter(_panel(), getFilterConfig())),

        applyFilter: (state: SerializedFilterState): void => {
            const config = getFilterConfig();
            writePanelControls(_panel(), state, config);
            applyActiveFilterToSources(expandActiveFilter(deserializeActiveFilter(state, config)));
            dispatchGeoLeafEvent("geoleaf:filters:applied", {});
        },

        applyNow: (): void => applyFilterFromPanel(_panel(), getFilterConfig()),

        reset: (): void => {
            const panel = _panel();
            resetPanelControls(panel);
            applyFilterFromPanel(panel, getFilterConfig());
        },

        hasActiveFilters: (): boolean => readActiveFilter(_panel(), getFilterConfig()).length > 0,

        proximity: _proximity,
    };
}
