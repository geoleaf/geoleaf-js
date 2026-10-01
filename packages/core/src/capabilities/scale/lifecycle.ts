/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Scale capability — lifecycle / mount wiring.
 *
 * Mounts the scale control on `geoleaf:app:ready` (preserving the former deferred
 * timing in `init-deferred-ui.ts`), through `whenAppReady()` — an init that runs after the
 * reveal mounts at once. Reads `modules.scale` via `getScaleConfig()`
 * (merged config), late-gates on `enabled` (opt-out) and on at least one active
 * scale type — reproducing the former `initScaleControl` guard.
 */

import { ScaleControl, type ScaleMapLike } from "./scale-control.js";
import { getScaleConfig } from "./config.js";
import { registerLifecycleTeardown, whenAppReady } from "../../kernel/shared/index.js";

let _started = false;
let _map: ScaleMapLike | null = null;

/** Mounts the scale control once the app is ready, if enabled and configured. */
function _onAppReady(): void {
    if (typeof document === "undefined" || !_map) return;
    const cfg = getScaleConfig();
    if (cfg.enabled === false) return;
    // Preserve the former guard: render only when at least one scale type is on.
    if (!cfg.scaleGraphic && !cfg.scaleNumeric && !cfg.scaleNivel) return;
    ScaleControl.init(_map, {
        scaleGraphic: cfg.scaleGraphic,
        scaleNumeric: cfg.scaleNumeric,
        scaleNumericEditable: cfg.scaleNumericEditable,
        scaleNivel: cfg.scaleNivel,
        position: cfg.position,
    });
}

/**
 * What `Core.destroy()` runs for this capability, through the lifecycle seam: it DISARMS.
 *
 * `Core.destroy()` never reaches the module registry, so {@link ScaleLifecycle._reset} did not
 * run on it. A destroy landing before `geoleaf:app:ready` — from a listener of that very event,
 * laid before this one — let `_onAppReady` mount the scale control on the destroyed map: "map
 * is not ready", uncaught on the page.
 *
 * ⚠️ Not `_reset()`. `Core.destroy()` destroys the adapter BEFORE the seam runs, and the
 * control's own teardown unsubscribes from that adapter, which throws on a destroyed map.
 * What it laid dies with the map's container; only what could still fire is taken down here.
 */
function _disarmOnDestroy(): void {
    if (typeof document !== "undefined") {
        document.removeEventListener("geoleaf:app:ready", _onAppReady);
    }
    _map = null;
    _started = false;
}

/** Idempotent mount for the Scale capability. Safe to call multiple times. */
export const ScaleLifecycle = {
    init(map: ScaleMapLike): void {
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
            ScaleControl.destroy();
        } finally {
            _started = false;
            _map = null;
        }
    },
};
