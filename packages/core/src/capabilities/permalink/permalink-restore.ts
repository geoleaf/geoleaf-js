/*!
 * GeoLeaf Core – Permalink / State restoration (apply side)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Apply-side **layer-visibility** restoration extracted from `permalink-sync.ts`.
 * Restores the user-overridden hidden (`layers`) and shown (`shownLayers`) layers
 * from a decoded {@link PermalinkState}.
 *
 * The textual / taxonomy / tag / rating filter restore moved to the Filter
 * capability's `applyFilter()` contract (S13, `permalink-sync._restoreFilterState`),
 * removing the former ghost-injection + `_UIFilterPanel*` reaches.
 *
 * @see permalink-sync for the capture / sync logic and the filter restore
 *
 * @merged 2026-07-26 (STRUCT S8) — absorbed `permalink-layers.ts`, its only consumer
 * being this file. The two carried overlapping responsibilities (X2b): one could not
 * state in a sentence which of them to open to read layer restoration, because the
 * answer was "both". `restoreShownLayer` is the single-layer case of what
 * `applyPermalinkLayerVisibility` does for the whole set.
 */

import { GeoJSONShared, VisibilityManager } from "../../kernel/geojson/index.js";
import { ThemeApplierCore } from "../../kernel/themes/index.js";
import type { PermalinkState } from "./types.js";

/**
 * Restore a single layer requested via `gl_shown=...`. Idempotent and tolerant — any
 * unexpected throw is silently absorbed.
 *
 * Two paths, because a shared URL may name a layer the active theme did not load:
 *   1. already registered in `GeoJSONShared` → apply the user override synchronously ;
 *   2. otherwise it sits in the profile catalog → lazy-load it through the same path as
 *      the layer-manager "load on demand" toggle, then apply the override.
 *
 * Fixes the bug where copy/pasting a URL with `gl_shown=...` for a layer outside the
 * active theme silently dropped the layer.
 *
 * Not exported: since the merge its only caller is `applyPermalinkLayerVisibility`
 * below. It was exported only to cross the file boundary that no longer exists —
 * `check-orphan-exports` caught it as a new orphan the moment the boundary went.
 *
 * @param layerId - The layer id to make visible.
 */
function restoreShownLayer(layerId: string): void {
    try {
        if (GeoJSONShared.state.layers?.get(layerId)) {
            VisibilityManager.setVisibility(layerId, true, "user");
            return;
        }
        const load = ThemeApplierCore?._loadLayerFromProfile;
        if (typeof load !== "function") return;
        Promise.resolve(load.call(ThemeApplierCore, layerId))
            .then((ok: unknown) => {
                if (!ok) return;
                try {
                    VisibilityManager.setVisibility(layerId, true, "user");
                } catch {
                    /* visibility apply failed after successful load */
                }
            })
            .catch(() => {
                /* layer absent from profile catalog */
            });
    } catch {
        /* defensive — guard against unexpected throws */
    }
}

/** Restores user-overridden hidden (`layers`) and shown (`shownLayers`) layer visibility. */
export function applyPermalinkLayerVisibility(
    state: PermalinkState,
    hasLayers: boolean,
    hasShownLayers: boolean
): void {
    if (hasLayers) {
        for (const layerId of state.layers as string[]) {
            try {
                VisibilityManager.setVisibility(layerId, false, "user");
            } catch {
                // Layer may not exist in this profile
            }
        }
    }
    if (hasShownLayers) {
        for (const id of state.shownLayers as string[]) restoreShownLayer(id);
    }
}
