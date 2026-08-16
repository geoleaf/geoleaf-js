/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Coordinates capability — lifecycle / mount wiring.
 *
 * Mounts the cursor coordinates readout on `geoleaf:app:ready` (preserving the
 * former deferred timing in `init-deferred-ui.ts`). The event is async relative to
 * `registry.init()`, so registering the listener during `CoordinatesModule.init()`
 * catches it. Late gate on the merged `modules.coordinates.enabled` (opt-out).
 *
 * The map adapter is captured from `ICoreModule.init(adapter)` (the boot-created
 * MaplibreAdapter) and used at mount time. Depends on `geojson` (not `ui`) so the
 * subscription runs before the event fires (mirrors labels/theme-selector).
 */

import { CoordinatesDisplay } from "./coordinates.js";
import { getCoordinatesConfig } from "./config.js";
import type { CoordinatesMapLike } from "./types.js";

let _started = false;
let _map: CoordinatesMapLike | null = null;

/** Mounts the readout once the app (map + deferred UI) is ready, if enabled. */
function _onAppReady(): void {
    if (typeof document === "undefined" || !_map) return;
    const cfg = getCoordinatesConfig();
    if (cfg.enabled === false) return;
    CoordinatesDisplay.init(_map, { position: cfg.position, decimals: cfg.decimals });
}

/** Idempotent mount for the Coordinates capability. Safe to call multiple times. */
export const CoordinatesLifecycle = {
    init(map: CoordinatesMapLike): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        _map = map;
        document.addEventListener("geoleaf:app:ready", _onAppReady, { once: true });
    },

    /** Detaches the listener and tears down the control (module destroy / test). */
    _reset(): void {
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:app:ready", _onAppReady);
        }
        CoordinatesDisplay.destroy();
        _started = false;
        _map = null;
    },
};
