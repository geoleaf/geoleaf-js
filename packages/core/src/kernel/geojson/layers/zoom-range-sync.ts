/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Layer Manager — native zoom-range synchronisation
 *
 * Keeps each layer's native `minzoom`/`maxzoom` in step with its style `scaleConfig`
 * (S5/N-1b). The engine renders the scale window, but a scale denominator only becomes a
 * zoom level THROUGH the latitude — the same 1:X sits ~1 zoom lower at 60°N than at the
 * equator. A range posted at load time therefore drifts as the map travels north or south.
 *
 * Zoom does NOT affect the conversion, so this listens to `moveend`, not `zoomend`, and
 * only re-pushes past a latitude threshold — panning within a city recomputes nothing.
 */
"use strict";

import { GeoJSONShared } from "../shared.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import { scaleToZoom } from "../../../utils/general/scale-utils.js";
import type { GeoJSONLayerEntry, GeoJSONNativeMap } from "../core-types.js";

const getState = () => GeoJSONShared.state;

/** Adapter surface used here — the layer-level zoom range setter. */
interface ZoomRangeAdapterLike {
    setLayerZoomRange?(id: string, minZoom: number | null, maxZoom: number | null): void;
}

/**
 * Latitude drift, in degrees, that triggers a re-push.
 *
 * The conversion error grows with `log2(cos(lat0) / cos(lat))`. Around 2° it stays well
 * under a tenth of a zoom level at mid-latitudes — imperceptible — while keeping the
 * re-push rare. Near the poles `cos` collapses fast, hence the extra guard in
 * {@link _hasLatitudeDrifted}.
 */
const LAT_DRIFT_DEGREES = 2;

/** Last latitude the ranges were computed at. `null` = never pushed. */
let _lastSyncLat: number | null = null;

/** True when the map has moved far enough in latitude for the conversion to drift. */
function _hasLatitudeDrifted(lat: number): boolean {
    if (_lastSyncLat === null) return true;
    return Math.abs(lat - _lastSyncLat) >= LAT_DRIFT_DEGREES;
}

/** Reads the style's scale window, or null when the layer declares no constraint. */
function _readScaleConfig(
    layerData: GeoJSONLayerEntry
): { minScale?: number | null; maxScale?: number | null } | null {
    return (layerData.currentStyle?.scaleConfig ?? null) as {
        minScale?: number | null;
        maxScale?: number | null;
    } | null;
}

/**
 * Recomputes and re-pushes every layer's native zoom range at the given latitude.
 *
 * @param lat - Latitude to convert the scale bounds at (the map centre).
 * @returns The number of layers whose range was pushed.
 */
function syncZoomRanges(lat: number): number {
    if (!Number.isFinite(lat)) return 0;
    if (!_hasLatitudeDrifted(lat)) return 0;

    const state = getState();
    const Core = getGeoLeaf()?.Core as
        | { getMap?: () => ZoomRangeAdapterLike | undefined }
        | undefined;
    const adapter = (state.adapter || Core?.getMap?.()) as ZoomRangeAdapterLike | undefined;
    if (!adapter || typeof adapter.setLayerZoomRange !== "function") return 0;

    let pushed = 0;
    state.layers.forEach((layerData: GeoJSONLayerEntry, layerId: string) => {
        const scaleConfig = _readScaleConfig(layerData);
        if (!scaleConfig) return;
        const minZoom = scaleToZoom(scaleConfig.minScale, lat);
        const maxZoom = scaleToZoom(scaleConfig.maxScale, lat);
        // Both null = the style declares a scaleConfig with no usable bound: clearing the
        // range is still correct (it removes a range a previous latitude may have set).
        adapter.setLayerZoomRange!(layerId, minZoom, maxZoom);
        pushed++;
    });

    _lastSyncLat = lat;
    if (pushed > 0) {
        getLog().debug(
            `[GeoLeaf.GeoJSON] zoom ranges re-pushed at lat ${lat.toFixed(2)} (${pushed} layer(s))`
        );
    }
    return pushed;
}

/**
 * Binds the latitude watcher to the map.
 *
 * `moveend` and not `zoomend`: zooming never changes a scale→zoom conversion, only moving
 * in latitude does. Called once the map exists; resets the drift tracking so a re-created
 * map starts from a clean slate rather than inheriting the previous one's latitude.
 */
export function bindZoomRangeSync(map: GeoJSONNativeMap): void {
    _lastSyncLat = null;
    map.on("moveend", () => {
        const lat = map.getCenter?.()?.lat;
        if (typeof lat === "number") syncZoomRanges(lat);
    });
}
