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
 * timing in `init-deferred-ui.ts`). Reads `modules.scale` via `getScaleConfig()`
 * (merged config), late-gates on `enabled` (opt-out) and on at least one active
 * scale type — reproducing the former `initScaleControl` guard.
 */
"use strict";

import { ScaleControl, type ScaleMapLike } from "./scale-control.js";
import { getScaleConfig } from "./config.js";

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

/** Idempotent mount for the Scale capability. Safe to call multiple times. */
export const ScaleLifecycle = {
    init(map: ScaleMapLike): void {
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
        ScaleControl.destroy();
        _started = false;
        _map = null;
    },
};
