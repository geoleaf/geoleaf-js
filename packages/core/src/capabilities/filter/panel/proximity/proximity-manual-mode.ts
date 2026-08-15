/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Filter Panel - Proximity Manual Mode
 * Proximity mode activation from a manual click on the map — works for both the panel
 * and the toolbar. Eliminates duplication between activateManualMode() (panel) and the
 * manual branch of toggleProximityToolbar() (toolbar).
 *
 * Note: the radius is read through a callback at click time (not at activation time) so
 * it captures the current slider value, including one changed after activation.
 */
import { getLog } from "../../../../utils/general/di-accessors.js";
import type { IMapAdapter } from "../../../../contracts/map-adapter.contract.js";
import { armToolCursor, disarmToolCursor } from "../../../../kernel/shared/index.js";
import { ProximityState } from "./proximity-state.js";
import {
    createProximityCircle,
    createManualMarker,
    removeCircleAndMarker,
} from "./proximity-circle.js";
import { kmToMetres } from "../../units.js";

interface ManualModeOptions {
    onPointPlaced?: () => void;
}

/**
 * Activates manual mode on a given DOM wrapper.
 * Usable from the panel as well as from the toolbar.
 *
 * @param map          - MapLibre map instance
 * @param wrapper      - The [data-gl-filter-id="proximity"] element carrying the data-proximity-* attributes
 * @param getRadiusKm  - Callback invoked on click to read the current radius, in km
 * @param options      - Optional callbacks (onPointPlaced)
 */
export function activateManualMode(
    map: IMapAdapter,
    wrapper: HTMLElement,
    getRadiusKm: () => number,
    options?: ManualModeOptions
): void {
    const Log = getLog();

    Log.info("[GeoLeaf.Proximity] Manual mode: click on the map to define the search point");

    // ⚠️ Targets the CANVAS, not the root container. `.maplibregl-canvas-container` carries
    // an explicit `cursor: grab`, which beats anything inherited from `.maplibregl-map` —
    // this line wrote `crosshair` on the root for months and it was never once painted.
    armToolCursor(map, "crosshair");

    ProximityState.clickHandler = function (e: unknown): void {
        // Read the radius at click time, not at activation time
        const event = e as { latlng: { lat: number; lng: number } };
        const radiusKm = getRadiusKm();
        const radiusMeters = kmToMetres(radiusKm);

        removeCircleAndMarker(map);
        createProximityCircle(event.latlng, radiusMeters, map);
        createManualMarker(event.latlng, map, wrapper);

        if (!wrapper) {
            Log.warn("[GeoLeaf.Proximity] clickHandler: wrapper not found, attributes not updated");
            return;
        }

        wrapper.setAttribute("data-proximity-lat", String(event.latlng.lat));
        wrapper.setAttribute("data-proximity-lng", String(event.latlng.lng));
        wrapper.setAttribute("data-proximity-radius", String(radiusKm));
        wrapper.setAttribute("data-proximity-active", "true");

        disarmToolCursor(map);
        map.off("click", ProximityState.clickHandler!);
        ProximityState.clickHandler = null;

        Log.info("[GeoLeaf.Proximity] Manual proximity point defined", {
            lat: event.latlng.lat,
            lng: event.latlng.lng,
            radius: radiusKm,
        });

        options?.onPointPlaced?.();
    };

    map.on("click", ProximityState.clickHandler);
}
