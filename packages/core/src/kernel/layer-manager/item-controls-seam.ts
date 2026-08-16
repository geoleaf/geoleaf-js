/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Layer-manager per-layer control seam.
 *
 * The layer manager dispatches `geoleaf:layer-item:controls` each time it renders
 * a layer row's control container. Capabilities (e.g. labels) subscribe to inject
 * their per-layer buttons **without the kernel importing them statically** —
 * inverting the former hard `LabelButtonManager` import.
 *
 * This is a **raw `CustomEvent`**, not `dispatchGeoLeafEvent`: the detail carries a
 * live `HTMLElement` (the control container), which the sanitising GeoLeaf event
 * bus (JSON-only, no DOM refs) cannot transport — mirroring the existing
 * `geoleaf:toolbar:action` seam.
 */

/** Detail payload of the `geoleaf:layer-item:controls` seam event. */
export interface LayerItemControlsDetail {
    /** The layer whose control row was rendered. */
    layerId: string;
    /** The live control container element capabilities may inject buttons into. */
    controlsContainer: HTMLElement;
    /** Whether the layer row is toggleable (visibility toggle present). */
    toggleable: boolean;
}

/**
 * Dispatches the per-layer controls seam event (raw `CustomEvent` — the detail
 * carries a DOM element, so it bypasses the sanitising GeoLeaf event bus).
 */
export function emitLayerItemControls(detail: LayerItemControlsDetail): void {
    if (typeof document === "undefined") return;
    document.dispatchEvent(new CustomEvent("geoleaf:layer-item:controls", { detail }));
}
