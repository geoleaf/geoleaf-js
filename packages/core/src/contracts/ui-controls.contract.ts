/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — UI Controls (internal type boundary)
 *
 * Interfaces and types for the UI controls cluster.
 * These types are internal to the core module — not part of the public API.
 */

import type { IMapAdapter } from "./map-adapter.contract.js";

// ─── Geolocation control ──────────────────────────────────────────────────────

/**
 * Internal runtime state for the geolocation control.
 * Tracks live map artefacts that must be cleaned up when geolocation stops.
 */
export interface IGeoLocationState {
    /** Whether the user-position marker is currently on the map. */
    hasMarker: boolean;
    /** Whether the accuracy-circle GeoJSON layer is currently on the map. */
    hasAccuracyLayer: boolean;
    /**
     * Toast element shown while the GPS fix is pending.
     * Dismissed on first fix or on error. Undefined before the first start attempt.
     */
    pendingGeolocToast: HTMLElement | null | undefined;
    /** The floating re-center button appended to the map container. */
    recenterBtn: HTMLButtonElement | null;
}

/**
 * Narrowed view of the profile config required by `initGeolocationControl`.
 */
export interface IGeoLocationControlConfig {
    ui?: {
        showGeolocation?: boolean;
    };
}

/**
 * Shape of a user-position snapshot stored in `GeoLocationState`.
 */
export interface UserPositionState {
    /** Latitude in decimal degrees. */
    lat: number;
    /** Longitude in decimal degrees. */
    lng: number;
    /** GPS accuracy in metres. */
    accuracy?: number;
    /** Unix timestamp (ms) when the fix was recorded. */
    timestamp?: number;
}

// ─── Proximity filter ─────────────────────────────────────────────────────────

/** @internal Custom circle overlay managed by proximity-circle.ts. Not a MapLibre source. */
export interface IProximityCircle {
    /** Update the circle radius without recreating the layer. */
    setRadius(newRadiusMeters: number): void;
    /** Move the circle centre to a new position. */
    setLatLng(ll: { lat: number; lng: number }): void;
    /** Return the current circle centre. */
    getCenter(): { lat: number; lng: number };
    /** Return the current radius in metres. */
    getRadius(): number;
    /** Return the current circle centre (alias for `getCenter`). */
    getLatLng(): { lat: number; lng: number };
}

/** @internal Custom marker handle managed by proximity-circle.ts. Not a MapLibre Marker. */
export interface IProximityMarker {
    /** Return the current marker position. */
    getLatLng(): { lat: number; lng: number };
}

/**
 * Internal runtime state shared by all proximity sub-modules.
 * Tracks active map artefacts, modes, and cleanup callbacks.
 */
export interface IProximityState {
    /** Whether proximity filter mode is currently active. */
    mode: boolean;
    /** The custom circle overlay managed by proximity-circle.ts (null when inactive). */
    circle: IProximityCircle | null;
    /** The custom centre-marker handle managed by proximity-circle.ts (null when inactive). */
    marker: IProximityMarker | null;
    /** Reference to the active map instance (null when not yet initialised). */
    map: IMapAdapter | null;
    /** The map-click event handler registered during placement mode (null when inactive). */
    clickHandler: ((e: unknown) => void) | null;
    /** Pending radius value (metres) waiting to be applied after a marker placement. */
    pendingRadius: number | null;
    /** Array of cleanup callbacks collected during proximity session (event listeners, etc.). */
    eventCleanups: Array<number | null | (() => void)>;
}
