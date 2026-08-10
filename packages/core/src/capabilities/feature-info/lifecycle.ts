/*!
 * GeoLeaf Core (feature-info capability) — Lifecycle / event wiring
 * © 2026 Mattieu Pottier — MIT License
 *
 * Subscribes to the `geoleaf:feature:click` and `geoleaf:feature:hover` kernel
 * seam events and dispatches to the three attribute-rendering surfaces:
 * tooltip (hover), popup (click), and side-panel (selection via "Voir plus").
 * https://geoleaf.dev
 */
import { getFeatureInfoConfig } from "./config.js";
import { handleClick, destroyPopup } from "./surfaces/popup.js";
import { handleHover, destroyTooltip } from "./surfaces/tooltip.js";
import { destroySidePanel } from "./surfaces/sidepanel.js";
import type { GeoLeafFeatureClickDetail, GeoLeafFeatureHoverDetail } from "./types.js";

function onFeatureClick(e: Event): void {
    const config = getFeatureInfoConfig();
    if (!config.enabled) return;
    const detail = (e as CustomEvent<GeoLeafFeatureClickDetail>).detail;
    if (!detail || typeof detail.layerId !== "string") return;
    handleClick(detail);
}

function onFeatureHover(e: Event): void {
    const config = getFeatureInfoConfig();
    if (!config.enabled) return;
    const detail = (e as CustomEvent<GeoLeafFeatureHoverDetail>).detail;
    if (!detail || typeof detail.layerId !== "string") return;
    handleHover(detail);
}

let _started = false;

/** Idempotent event wiring. Safe to call multiple times. */
export const FeatureInfoLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        document.addEventListener("geoleaf:feature:click", onFeatureClick);
        document.addEventListener("geoleaf:feature:hover", onFeatureHover);
    },

    /** Test seam: detaches listeners and tears down DOM elements. */
    _reset(): void {
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:feature:click", onFeatureClick);
            document.removeEventListener("geoleaf:feature:hover", onFeatureHover);
        }
        destroyPopup();
        destroyTooltip();
        destroySidePanel();
        _started = false;
    },
};
