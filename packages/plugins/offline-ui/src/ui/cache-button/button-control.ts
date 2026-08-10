/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview UI Cache Button - Map capture module
 * @description Captures the real MapLibre map for the cache modal.
 *
 * S2 (storage modernisation): the button is no longer injected as a MapLibre
 * IControl in the top-left corner. It is now registered as a toolbar slot via
 * `GeoLeaf.registry.register` (see entry.ts) and rendered by the core in the
 * desktop band / mobile pill. This module's sole remaining job is to capture
 * the real map at `geoleaf:map:ready` (core calls `CacheButton.init(map, cfg)`)
 * so the modal sub-modules (CacheControl) run against the actual map instead of
 * the former `tempMap` hack.
 * @author GeoLeaf Team
 * @version 5.0.0
 */

import { Log } from "@geoleaf/host-runtime";

/** The real MapLibre map instance, captured at map-ready. */
let _realMap: unknown = null;

/**
 * Button Control Module — map capture only (no DOM control since S2).
 */
const ButtonControl = {
    /**
     * Captures the real map so the modal can run its sub-modules against it.
     * Called by the core during init when the Storage plugin is loaded.
     * The actual button is rendered by the core from the registry slot.
     *
     * @returns the captured map, or null when disabled / unavailable.
     */
    init(
        map: unknown,
        cfg: { ui?: { showCacheButton?: boolean }; [key: string]: unknown }
    ): unknown {
        if (!map) {
            if (Log) Log.error("[CacheButton.ButtonControl] Map non disponible");
            return null;
        }

        // Mirror the registry slot's profileKey guard (ui.showCacheButton).
        const showCacheButton = cfg?.ui?.showCacheButton !== false; // Default true
        if (!showCacheButton) {
            if (Log) Log.info("[CacheButton.ButtonControl] Disabled by configuration");
            return null;
        }

        _realMap = map;
        if (Log) Log.info("[CacheButton.ButtonControl] Real map captured for cache modal");
        return map;
    },

    /** Returns the captured real map (null before map-ready). */
    getMap(): unknown {
        return _realMap;
    },
};

// ── ESM Export ──
export { ButtonControl };

if (Log) Log.info("[CacheButton.ButtonControl] Module loaded.");
