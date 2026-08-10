/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Desktop tab-strip control seam.
 *
 * The desktop panel dispatches `geoleaf:desktop-panel:tabs-ready` once its bottom tab
 * strip is built. Capabilities (e.g. share) subscribe to inject their own bottom
 * buttons **without the kernel importing them statically** — inverting the former hard
 * `appendShareButtonToTabs` import, and mirroring the layer-manager
 * `geoleaf:layer-item:controls` seam.
 *
 * This is a **raw `CustomEvent`**, not `dispatchGeoLeafEvent`: the detail carries a live
 * `HTMLElement` (the tab strip), which the sanitising GeoLeaf event bus (JSON-only, no
 * DOM refs) cannot transport — mirroring the existing `geoleaf:toolbar:action` seam.
 */
"use strict";

/** Detail payload of the `geoleaf:desktop-panel:tabs-ready` seam event. */
export interface DesktopTabsReadyDetail {
    /** The live desktop tab strip (`.gl-rp-tabs`) capabilities may inject buttons into. */
    tabs: HTMLElement;
}

/**
 * Dispatches the desktop tab-strip seam event (raw `CustomEvent` — the detail carries a
 * DOM element, so it bypasses the sanitising GeoLeaf event bus). Called once per panel
 * build, synchronously, so subscribers inject in the same tick (position preserved).
 */
export function emitDesktopTabsReady(tabs: HTMLElement): void {
    if (typeof document === "undefined") return;
    document.dispatchEvent(
        new CustomEvent<DesktopTabsReadyDetail>("geoleaf:desktop-panel:tabs-ready", {
            detail: { tabs },
        })
    );
}
