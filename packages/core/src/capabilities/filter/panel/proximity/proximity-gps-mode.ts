/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Filter Panel - Proximity GPS Mode
 * Proximity mode activation from the GPS position — works for both the panel and the toolbar.
 * Eliminates duplication between activateGPSMode() (panel) and the GPS branch
 * of toggleProximityToolbar() (toolbar).
 */
import { getLog } from "../../../../utils/general/di-accessors.js";
import type { IMapAdapter } from "../../../../contracts/map-adapter.contract.js";
import { GeoLocationState } from "../../../geolocation/state.js";
import { ProximityState } from "./proximity-state.js";
import {
    createProximityCircle,
    createGPSMarker,
    removeCircleAndMarker,
} from "./proximity-circle.js";
import { kmToMetres } from "../../units.js";

interface GPSModeOptions {
    onPointPlaced?: () => void;
}

/**
 * Activates GPS mode on a given DOM wrapper.
 * Usable from the panel (wrapper resolved via container.closest) as well as from the
 * toolbar (virtual wrapper resolved via getElementById).
 *
 * @param map        - MapLibre map instance
 * @param wrapper    - The [data-gl-filter-id="proximity"] element carrying the data-proximity-* attributes
 * @param radiusKm   - Radius in kilometers
 * @param options    - Optional callbacks (onPointPlaced)
 */
export function activateGPSMode(
    map: IMapAdapter,
    wrapper: HTMLElement,
    radiusKm: number,
    options?: GPSModeOptions
): void {
    const Log = getLog();

    removeCircleAndMarker(map);

    const gpsPos = GeoLocationState.userPosition;
    if (!gpsPos) {
        Log.warn("[GeoLeaf.Proximity] activateGPSMode: no GPS position available");
        return;
    }
    const gpsLatLng = {
        lat: gpsPos.lat,
        lng: gpsPos.lng,
    };

    createProximityCircle(gpsLatLng, kmToMetres(radiusKm), map);

    if (!GeoLocationState.active) {
        // GPS is not in continuous-tracking mode: create a draggable GPS marker
        createGPSMarker(gpsLatLng, map, wrapper);
    } else {
        ProximityState.marker = null;
        Log.info("[GeoLeaf.Proximity] Circle displayed around continuous tracking GPS marker");
    }

    if (!wrapper) {
        Log.warn("[GeoLeaf.Proximity] activateGPSMode: wrapper not found, attributes not updated");
        return;
    }

    wrapper.setAttribute("data-proximity-lat", String(gpsLatLng.lat));
    wrapper.setAttribute("data-proximity-lng", String(gpsLatLng.lng));
    wrapper.setAttribute("data-proximity-radius", String(radiusKm));
    wrapper.setAttribute("data-proximity-active", "true");

    map.setView(gpsLatLng, Math.max(map.getZoom(), 14));

    // No click handler is needed in GPS mode
    ProximityState.clickHandler = null;

    Log.info("[GeoLeaf.Proximity] GPS mode enabled", {
        lat: gpsLatLng.lat,
        lng: gpsLatLng.lng,
        radius: radiusKm,
    });

    options?.onPointPlaced?.();
}

/**
 * Checks if a recent GPS position (< 5 minutes) is available.
 */
export function hasRecentGPS(): boolean {
    return (
        !!GeoLocationState.userPosition &&
        Date.now() - (GeoLocationState.userPosition.timestamp ?? 0) < 300000
    );
}
