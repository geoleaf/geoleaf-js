/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Keeps the bottom-left controls clear of the basemap credit while it is expanded.
 *
 * The credit is shown expanded at load (the adapter passes `attributionControl: {}`: below
 * 640 px MapLibre opens it at load and folds it at the first drag), which is what the providers'
 * terms ask for. On a phone, expanded, it spans the whole width of the bottom edge — measured on a
 * 412-px screen: x 10 → 402, y 785 → 829 — and covered the scale bar and the branding overlay of
 * the bottom-left corner until the user's first drag.
 *
 * Rather than fold the credit, the corner moves up: while the expanded credit overlaps the
 * corner horizontally, the map container carries `--gl-attrib-clearance` — the distance from
 * the map's bottom edge to the credit's top, plus a gap — and `geoleaf-controls.css` lifts `.maplibregl-ctrl-bottom-left` by it. Measured,
 * not guessed: the credit's text — hence its height — depends on the basemap.
 */

import { trackMapCleanup } from "./maplibre-event-subscriptions.js";

/** The CSS custom property the stylesheet reads. */
const ATTRIB_CLEARANCE_VAR = "--gl-attrib-clearance";

/** Breathing room between the credit and the lifted corner, in CSS px. */
const GAP_PX = 6;

interface MapLike {
    getContainer(): HTMLElement;
    on(type: string, listener: () => void): unknown;
    off(type: string, listener: () => void): unknown;
}

/** The height the bottom-left corner must clear, in CSS px — `0` when nothing overlaps. */
function _clearance(container: HTMLElement): number {
    const attrib = container.querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
    const corner = container.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-left");
    if (!attrib || !corner) return 0;
    const a = attrib.getBoundingClientRect();
    const c = corner.getBoundingClientRect();
    if (a.height === 0 || c.width === 0) return 0;
    // Horizontal overlap only: the two corners share the bottom edge by construction.
    if (a.left >= c.right || a.right <= c.left) return 0;
    // From the map's bottom edge to the credit's top — not the credit's height: the credit
    // floats above the edge (10 px on a phone), and a corner lifted by the height alone still
    // overlapped it by those pixels. Measured on the map container, never on the corner: the
    // corner is what this value moves, and measuring it would feed the lift back into itself.
    return Math.ceil(container.getBoundingClientRect().bottom - a.top) + GAP_PX;
}

/**
 * Starts keeping the bottom-left corner clear of the expanded credit, for the life of `map`.
 *
 * Re-measures when the credit opens or folds (its `class` changes), when it changes size, and
 * on map resize. Torn down with the map's tracked cleanups (`flushMapCleanups` on destroy).
 *
 * @param map - The native MapLibre map.
 *
 * @example
 * ```ts
 * watchAttributionClearance(nativeMap);
 * ```
 */
export function watchAttributionClearance(map: MapLike): void {
    const container = map.getContainer();
    const update = (): void => {
        const px = _clearance(container);
        if (px > 0) container.style.setProperty(ATTRIB_CLEARANCE_VAR, `${px}px`);
        else container.style.removeProperty(ATTRIB_CLEARANCE_VAR);
    };

    let classObserver: MutationObserver | null = null;
    let sizeObserver: ResizeObserver | null = null;
    const attach = (): void => {
        update();
        const attrib = container.querySelector(".maplibregl-ctrl-attrib");
        if (!attrib || classObserver) return;
        if (typeof MutationObserver !== "undefined") {
            classObserver = new MutationObserver(update);
            classObserver.observe(attrib, { attributes: true, attributeFilter: ["class"] });
        }
        if (typeof ResizeObserver !== "undefined") {
            sizeObserver = new ResizeObserver(update);
            sizeObserver.observe(attrib);
        }
    };

    map.on("load", attach);
    map.on("resize", update);
    trackMapCleanup(map, () => {
        map.off("load", attach);
        map.off("resize", update);
        classObserver?.disconnect();
        sizeObserver?.disconnect();
        container.style.removeProperty(ATTRIB_CLEARANCE_VAR);
    });
}
