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

import { initGeolocationControl, disarmGeolocation } from "./geolocation.js";
import { registerLifecycleTeardown } from "../../kernel/shared/index.js";
import { getGeolocationConfig } from "./config.js";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";

let _started = false;
let _destroy: (() => void) | undefined;

/**
 * What `Core.destroy()` runs for this capability, through the lifecycle seam: it DISARMS — the
 * GPS watch stops and the state reads inactive. Not `_reset()`: the map is already destroyed,
 * and the control's teardown would touch it (same rule as the scale capability).
 */
function _disarmOnDestroy(): void {
    disarmGeolocation();
    _destroy = undefined;
    _started = false;
}

/** Idempotent mount for the geolocation capability. Safe to call multiple times. */
export const GeolocationLifecycle = {
    init(map: IMapAdapter): void {
        if (_started) return;
        _started = true;
        // Registered once: the seam is a Set.
        registerLifecycleTeardown(_disarmOnDestroy);
        const cfg = getGeolocationConfig();
        if (cfg.enabled === false) return;
        _destroy = initGeolocationControl(map, cfg.position);
    },

    /** Removes the control + tears down the GPS watch (module destroy / test seam). */
    _reset(): void {
        // `_started` resets whatever the teardown throws: left `true`, the next `init()` —
        // an application mounted again — would return at once, and this capability would
        // never come back.
        try {
            _destroy?.();
            _destroy = undefined;
        } finally {
            _started = false;
        }
    },
};
