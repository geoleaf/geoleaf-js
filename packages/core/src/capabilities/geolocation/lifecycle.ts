/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Geolocation capability — lifecycle / mount wiring.
 *
 * Mounts the GPS control synchronously at `GeolocationModule.init()` (which runs
 * post-merge, after `loadActiveProfileResources`), reading `modules.geolocation`
 * via `getGeolocationConfig()` and late-gating on `enabled` (opt-out). Mirrors the
 * former synchronous mount in `ui-api._initMapControls`.
 */
"use strict";

import { initGeolocationControl } from "./geolocation.js";
import { getGeolocationConfig } from "./config.js";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";

let _started = false;
let _destroy: (() => void) | undefined;

/** Idempotent mount for the geolocation capability. Safe to call multiple times. */
export const GeolocationLifecycle = {
    init(map: IMapAdapter): void {
        if (_started) return;
        _started = true;
        const cfg = getGeolocationConfig();
        if (cfg.enabled === false) return;
        _destroy = initGeolocationControl(map, cfg.position);
    },

    /** Removes the control + tears down the GPS watch (module destroy / test seam). */
    _reset(): void {
        _destroy?.();
        _destroy = undefined;
        _started = false;
    },
};
