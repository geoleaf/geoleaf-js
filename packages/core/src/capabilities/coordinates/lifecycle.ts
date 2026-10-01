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
import { registerLifecycleTeardown, whenAppReady } from "../../kernel/shared/index.js";
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

/**
 * What `Core.destroy()` runs for this capability, through the lifecycle seam: it DISARMS.
 *
 * `Core.destroy()` never reaches the module registry, so {@link CoordinatesLifecycle._reset}
 * did not run on it. A destroy landing before `geoleaf:app:ready` — from a listener of that very
 * event, laid before this one — let `_onAppReady` mount the readout on the destroyed map: "map
 * is not ready", uncaught on the page.
 *
 * ⚠️ Not `_reset()`. `Core.destroy()` destroys the adapter BEFORE the seam runs, and the
 * readout's own teardown unsubscribes from that adapter, which throws on a destroyed map.
 * What it laid dies with the map's container; only what could still fire is taken down here.
 */
function _disarmOnDestroy(): void {
    if (typeof document !== "undefined") {
        document.removeEventListener("geoleaf:app:ready", _onAppReady);
    }
    _map = null;
    _started = false;
}

/** Idempotent mount for the Coordinates capability. Safe to call multiple times. */
export const CoordinatesLifecycle = {
    init(map: CoordinatesMapLike): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        _map = map;
        whenAppReady(_onAppReady);
        // Registered once: the seam is a Set.
        registerLifecycleTeardown(_disarmOnDestroy);
    },

    /** Detaches the listener and tears down the control (module destroy / test). */
    _reset(): void {
        // `_started` resets whatever the teardown throws: left `true`, the next `init()` —
        // an application mounted again — would return at once, and this capability would
        // never come back.
        try {
            if (typeof document !== "undefined") {
                document.removeEventListener("geoleaf:app:ready", _onAppReady);
            }
            CoordinatesDisplay.destroy();
        } finally {
            _started = false;
            _map = null;
        }
    },
};
