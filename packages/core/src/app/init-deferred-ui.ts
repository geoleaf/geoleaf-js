/*!
 * GeoLeaf Core – App / Init Deferred UI
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * App init: non-critical UI panels deferred to post-reveal (geoleaf:app:ready).
 * Extracted from app/init.ts — registers a single `{ once: true }` listener;
 * behavior and ordering are preserved (the panel inits do not affect first render
 * or revealApp timing, so they run after the app reveals).
 */

import type { DeferredUIDeps } from "./app-types.js";
import { asFn, member } from "./app-types.js";

/**
 * Defers LayerManager, desktop panel activation, Scale and CoordinatesDisplay to
 * the `geoleaf:app:ready` event. (Legend now mounts via `LegendLifecycle`; the
 * label system via `LabelsLifecycle` during `registry.init()`.)
 * @param deps Shared boot dependencies passed by `initApp`.
 */

export function setupDeferredUIPanels({ GeoLeaf, cfg, map, AppLog, _pm }: DeferredUIDeps): void {
    // ========================================================
    // R4.2.1 — Defer non-critical UI panels to post-reveal (geoleaf:app:ready)
    // LayerManager, activateDesktopPanel, Scale, CoordinatesDisplay do not affect
    // the map first render or revealApp timing.
    // They are initialized after the app reveals to free the main thread during
    // the async theme-loading phase (which gates the startup measurement).
    // ========================================================
    document.addEventListener(
        "geoleaf:app:ready",
        function _initDeferredUIPanels() {
            _pm("geoleaf:init:deferredUI:start");
            // Layer manager (legend now mounts on app:ready via LegendLifecycle)
            const layerManagerInit = asFn(member(GeoLeaf.LayerManager, "init"));
            if (cfg.ui && cfg.ui.showLayerManager !== false && layerManagerInit) {
                try {
                    layerManagerInit.call(GeoLeaf.LayerManager, {
                        map: map,
                        position: "bottomright",
                    });
                } catch (e) {
                    AppLog.warn("GeoLeaf.LayerManager.init() threw an error:", e);
                }
            }
            // Activate the right desktop panel (after LayerManager)
            const activateDesktopPanel = asFn(member(GeoLeaf.UI, "activateDesktopPanel"));
            if (activateDesktopPanel) {
                try {
                    activateDesktopPanel.call(GeoLeaf.UI);
                    AppLog.log("Right desktop panel activated.");
                } catch (e) {
                    AppLog.warn("Error activating right desktop panel:", e);
                }
            }
            // Scale control: relocated to the in-core `scale` capability (ScaleModule →
            // ScaleLifecycle, which mounts it on app:ready), no longer wired here.
            // Label system: init is now driven by LabelsModule → LabelsLifecycle.init()
            // during registry.init() (S4 capability migration), not here.
            // Coordinates readout: relocated to the in-core `coordinates` capability
            // (CoordinatesModule → CoordinatesLifecycle, which mounts it on app:ready).
            _pm("geoleaf:init:deferredUI:end");
        },
        { once: true }
    );
}
