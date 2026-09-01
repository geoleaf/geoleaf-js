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
        // Kept for call-shape compatibility: entry points pass the resolved config through.
        // Nothing here reads it any more — see the dated note below.
        _cfg?: { ui?: { showCacheButton?: boolean }; [key: string]: unknown }
    ): unknown {
        if (!map) {
            if (Log) Log.error("[CacheButton.ButtonControl] Map non disponible");
            return null;
        }

        // The visibility guard that used to sit here was removed on 24/08/2026, as a
        // DECIDED behaviour change on a published package (3.1.0 wave). Since S2 this
        // module renders no button — it only CAPTURES the map for the cache modal — yet
        // it still read `ui.showCacheButton` and returned null on false. The toolbar slot
        // reads `modules.offline-ui.showButton` first with that same legacy key as
        // fallback, so the perverse profile `showButton: true` + `showCacheButton: false`
        // rendered a VISIBLE button over a modal whose sub-modules got `null` from
        // `getMap()`. Capture is now unconditional; button visibility belongs to the
        // slot alone (held equal on both declaration sides by the SLOT gate). A profile
        // that set the legacy key to false loses nothing: it now gets a working modal
        // behind a button the slot still hides.
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
