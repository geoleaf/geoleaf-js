/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Geolocation capability — public API surface.
 *
 * Exposes capability read helpers (`isEnabled` / `getConfig`) plus `getState()` — the
 * public seam for the GPS state singleton (read by external plugins such as
 * `plugin-addpoi`; in-core consumers import the state module directly). Mounted on
 * `GeoLeaf.Geolocation` via `geoleaf.geolocation.ts`.
 */

import { GeoLocationState } from "./state.js";
import { getGeolocationConfig, type GeolocationCapabilityConfig } from "./config.js";

/** Snapshot of the GPS state exposed via `GeoLeaf.Geolocation.getState()`. */
export interface GeolocationStateSnapshot {
    active: boolean;
    watchId: number | null;
    userPosition: { lat: number; lng: number; accuracy?: number; timestamp?: number } | null;
}

/** The object mounted on `GeoLeaf.Geolocation`. */
export interface GeolocationPublicApi {
    /** Returns `true` when the GPS button is enabled (`modules.geolocation.enabled !== false`). */
    isEnabled(): boolean;
    /** Returns the resolved `modules.geolocation` config (merged over the built-in defaults). */
    getConfig(): GeolocationCapabilityConfig;
    /** Returns the live GPS state singleton (position, accuracy, active/watch flags). */
    getState(): GeolocationStateSnapshot;
}

/** Builds the object mounted on `GeoLeaf.Geolocation`. */
export function buildPublicApi(): GeolocationPublicApi {
    return {
        isEnabled: (): boolean => getGeolocationConfig().enabled !== false,
        getConfig: (): GeolocationCapabilityConfig => getGeolocationConfig(),
        getState: (): GeolocationStateSnapshot => GeoLocationState as GeolocationStateSnapshot,
    };
}
