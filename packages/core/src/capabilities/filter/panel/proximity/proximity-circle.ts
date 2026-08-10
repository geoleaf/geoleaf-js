/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Filter Panel - Proximity Circle
 * Creation and removal of proximity circle overlay + draggable marker via adapter.
 * Eliminates duplication between activateGPSMode (panel) and toggleProximityToolbar (toolbar).
 */
import type {
    IMapAdapter,
    GeoLeafMarkerHandle,
    GeoLeafMarkerOptions,
} from "../../../../contracts/map-adapter.contract.js";
import type {
    IProximityCircle,
    IProximityMarker,
} from "../../../../contracts/ui-controls.contract.js";
import { ProximityState } from "./proximity-state.js";
import { EARTH_RADIUS_M } from "../../../../utils/geo/haversine.js";

/** Unique layer/marker IDs used by the proximity module. */
const CIRCLE_LAYER_ID = "__gl_proximity_circle";
const MARKER_ID = "__gl_proximity_marker";

function _resolveNativeMarker(map: IMapAdapter): GeoLeafMarkerHandle | null {
    return map.getMarkerHandle?.(MARKER_ID) ?? null;
}

function _attachDragendSync(nativeMarker: GeoLeafMarkerHandle, wrapper: HTMLElement): void {
    nativeMarker.on("dragend", () => {
        const ll = nativeMarker.getLngLat();
        const pos = { lat: ll.lat, lng: ll.lng };
        if (ProximityState.circle && ProximityState.circle.setLatLng) {
            ProximityState.circle.setLatLng(pos);
        }
        wrapper.setAttribute("data-proximity-lat", String(pos.lat));
        wrapper.setAttribute("data-proximity-lng", String(pos.lng));
    });
}

function _buildMarkerHandle(
    nativeMarker: GeoLeafMarkerHandle | null,
    latlng: { lat: number; lng: number }
): IProximityMarker {
    return {
        _id: MARKER_ID,
        getLatLng(): { lat: number; lng: number } {
            if (nativeMarker) {
                const ll = nativeMarker.getLngLat();
                return { lat: ll.lat, lng: ll.lng };
            }
            return latlng;
        },
    } as IProximityMarker;
}

/**
 * Generates a GeoJSON Polygon approximating a circle.
 * @param center - { lat, lng } center of the circle
 * @param radiusMeters - radius in meters
 * @param steps - number of polygon vertices (default 64)
 */
function _circlePolygon(
    center: { lat: number; lng: number },
    radiusMeters: number,
    steps = 64
): GeoJSON.Feature {
    const coords: [number, number][] = [];
    // Kernel constant, NOT a local one (CAPACITÉS S10). This polygon is what the user sees
    // as "inside the radius"; `predicate.ts` decides what actually passes the filter using
    // `haversineDistance`. Both must stand on the same earth, or the drawn boundary and the
    // real one differ — which they did, by 1,4 ppm, until this import.
    const lat = (center.lat * Math.PI) / 180;
    const lng = (center.lng * Math.PI) / 180;
    const d = radiusMeters / EARTH_RADIUS_M;

    for (let i = 0; i <= steps; i++) {
        const bearing = (2 * Math.PI * i) / steps;
        const pLat = Math.asin(
            Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(bearing)
        );
        const pLng =
            lng +
            Math.atan2(
                Math.sin(bearing) * Math.sin(d) * Math.cos(lat),
                Math.cos(d) - Math.sin(lat) * Math.sin(pLat)
            );
        coords.push([(pLng * 180) / Math.PI, (pLat * 180) / Math.PI]);
    }
    return {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [coords] },
    };
}

/**
 * Creates the proximity circle overlay and stores a reference in ProximityState.circle.
 */
export function createProximityCircle(
    latlng: { lat: number; lng: number },
    radiusMeters: number,
    map: IMapAdapter
): void {
    const fc = {
        type: "FeatureCollection",
        features: [_circlePolygon(latlng, radiusMeters)],
    };

    // Remove previous circle layer if present
    if (map.hasLayer && map.hasLayer(CIRCLE_LAYER_ID)) {
        map.removeLayer(CIRCLE_LAYER_ID);
    }

    map.addGeoJSONLayer(CIRCLE_LAYER_ID, fc, {
        color: "#c2410c",
        fillColor: "#c2410c",
        fillOpacity: 0.2,
        weight: 2,
        opacity: 1,
        interactive: false,
    });

    // Closure variables for mutable circle state (avoids `this` type issues with interface cast)
    let _center = { lat: latlng.lat, lng: latlng.lng };
    let _radius = radiusMeters;

    // Store a handle so other modules can detect circle presence & update it
    ProximityState.circle = {
        /** Update circle radius (re-creates the GeoJSON polygon). */
        setRadius(newRadiusMeters: number) {
            _radius = newRadiusMeters;
            const newFc = {
                type: "FeatureCollection",
                features: [_circlePolygon(_center, newRadiusMeters)],
            };
            if (map.updateLayerData) {
                map.updateLayerData(CIRCLE_LAYER_ID, newFc);
            }
        },
        setLatLng(ll: { lat: number; lng: number }) {
            _center = { lat: ll.lat, lng: ll.lng };
            const newFc = {
                type: "FeatureCollection",
                features: [_circlePolygon(ll, _radius)],
            };
            if (map.updateLayerData) {
                map.updateLayerData(CIRCLE_LAYER_ID, newFc);
            }
        },
        getCenter() {
            return _center;
        },
        getRadius() {
            return _radius;
        },
        getLatLng() {
            return _center;
        },
    } as IProximityCircle;
}

/**
 * Replaces the proximity marker, wires its drag synchronisation and stores the handle.
 *
 * The GPS and manual markers differ by their styling options and nothing else — same
 * teardown, same drag wiring, same state handling — so the flow lives here once and the
 * two exported entry points below supply only what actually diverges.
 */
function _createProximityMarker(
    latlng: { lat: number; lng: number },
    map: IMapAdapter,
    wrapper: HTMLElement,
    options: GeoLeafMarkerOptions
): void {
    // Remove previous marker if present
    if (map.removeMarker) {
        try {
            map.removeMarker(MARKER_ID);
        } catch (_e) {
            /* noop */
        }
    }

    map.createMarker(MARKER_ID, latlng, options);

    const nativeMarker = _resolveNativeMarker(map);
    if (nativeMarker && typeof nativeMarker.on === "function") {
        _attachDragendSync(nativeMarker, wrapper);
    }

    ProximityState.marker = _buildMarkerHandle(nativeMarker, latlng);
}

/**
 * Creates the GPS marker (blue, draggable) and stores it in ProximityState.marker.
 * Attaches dragend to synchronize the circle and the wrapper data attributes.
 */
export function createGPSMarker(
    latlng: { lat: number; lng: number },
    map: IMapAdapter,
    wrapper: HTMLElement
): void {
    _createProximityMarker(latlng, map, wrapper, {
        draggable: true,
        // CSP-safe: styled via .gl-proximity-gps-marker (geoleaf-ui.css), not an inline style.
        className: "gl-proximity-gps-marker",
        iconSize: [20, 20],
        iconAnchor: [10, 10],
    });
}

/**
 * Creates the manual marker (default style, draggable) and stores it in ProximityState.marker.
 * Attaches dragend to synchronize the circle and the wrapper data attributes.
 */
export function createManualMarker(
    latlng: { lat: number; lng: number },
    map: IMapAdapter,
    wrapper: HTMLElement
): void {
    _createProximityMarker(latlng, map, wrapper, { draggable: true });
}

/**
 * Removes the circle overlay and marker from the map, resets ProximityState references.
 */
export function removeCircleAndMarker(map: IMapAdapter): void {
    if (ProximityState.circle) {
        try {
            if (map.hasLayer && map.hasLayer(CIRCLE_LAYER_ID)) {
                map.removeLayer(CIRCLE_LAYER_ID);
            }
        } catch (_e) {
            /* noop */
        }
        ProximityState.circle = null;
    }
    if (ProximityState.marker) {
        try {
            if (map.removeMarker) {
                map.removeMarker(MARKER_ID);
            }
        } catch (_e) {
            /* noop */
        }
        ProximityState.marker = null;
    }
}
