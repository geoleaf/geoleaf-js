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
 * former deferred timing in `init-deferred-ui.ts`), through `whenAppReady()`: an init that
 * runs after the reveal mounts at once. Late gate on the merged
 * `modules.coordinates.enabled` (opt-out).
 *
 * The map adapter is captured from `ICoreModule.init(adapter)` (the boot-created
 * MaplibreAdapter) and used at mount time.
 *
 * 🛑 This header used to say « the event is async relative to `registry.init()`, so
 * registering the listener catches it ». It was false for a profile without a default theme:
 * that reveal ran inside `UIModule.init()`, before this module, and the readout never mounted.
 */

import { CoordinatesDisplay } from "./coordinates.js";
import { getCoordinatesConfig } from "./config.js";
import { whenAppReady } from "../../kernel/shared/index.js";
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
        whenAppReady(_onAppReady);
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
