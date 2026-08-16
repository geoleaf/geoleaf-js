/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Layer-manager panel seam.
 *
 * The layer manager dispatches `geoleaf:layer-manager:panel` once its structure is
 * built. Capabilities (e.g. profile-switcher) subscribe to insert their own controls
 * at the top of the panel **without the kernel importing them statically** — the same
 * inversion as `geoleaf:layer-item:controls` (labels) and
 * `geoleaf:desktop-panel:tabs-ready` (share).
 *
 * This is a **raw `CustomEvent`**, not `dispatchGeoLeafEvent`: the detail carries live
 * `HTMLElement`s, which the sanitising GeoLeaf event bus (JSON-only, no DOM refs)
 * cannot transport.
 *
 * ⚠️ The control is rebuilt on a destroy → recreate cycle, so this event fires more
 * than once per session. **Subscribers must be idempotent.**
 */

/** Detail payload of the `geoleaf:layer-manager:panel` seam event. */
export interface LayerManagerPanelDetail {
    /** The layer manager root (`.gl-layer-manager`). */
    container: HTMLElement;
    /** The main wrapper holding the header and body wrappers. */
    mainWrapper: HTMLElement;
    /**
     * The header wrapper. Insert **after** this node and **before** the body wrapper:
     * the body is emptied on every `renderSections()` call
     * (`render-sections.ts` → `clearElementFast`), so anything mounted inside it
     * disappears the first time a layer is toggled.
     */
    headerWrapper: HTMLElement;
}

/**
 * Dispatches the layer-manager panel seam event (raw `CustomEvent` — the detail
 * carries DOM elements, so it bypasses the sanitising GeoLeaf event bus).
 */
export function emitLayerManagerPanel(detail: LayerManagerPanelDetail): void {
    if (typeof document === "undefined") return;
    document.dispatchEvent(new CustomEvent("geoleaf:layer-manager:panel", { detail }));
}
