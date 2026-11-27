/*!
 * @geoleaf/host-runtime — What covers the map
 *
 * The part of the map a user can actually see: the canvas minus the surfaces laid over it — the
 * desktop side panel, the mobile sheet, the primary theme bar, the toolbar, the basemap credit —
 * and whatever a plugin adds of its own (a floating window).
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** Insets, in pixels, from each edge of the map container. */
export interface Insets {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

/**
 * The application's surfaces that cover the map when they are shown.
 *
 * ⚠️ Named by the kernel's own ids and classes, and by the engine's credit control — no plugin owns
 * them, and a host that lays something else over the map is simply not accounted for: the fit then
 * keeps the uniform margin it always had.
 */
const KERNEL_OCCLUDERS: readonly string[] = [
    "#gl-right-panel",
    ".gl-sheet-panel",
    "#gl-theme-primary-container",
    ".gl-map-toolbar",
    ".maplibregl-ctrl-attrib",
];

/** Below this share of the canvas left free on an axis, the padding is given up. */
const MAX_COVERED_SHARE = 0.9;

/** A shown element's box, or `null` when it is hidden or has no extent. */
function shownRect(el: Element): DOMRect | null {
    if (el.getClientRects().length === 0) return null;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
}

/** The edges, in a fixed order — ties keep the first. */
const EDGES: readonly (keyof Insets)[] = ["top", "right", "bottom", "left"];

/**
 * The edge a surface eats into: the one whose inset it imposes is the smallest SHARE of the map
 * along that edge's axis.
 *
 * 🛑 Judged in proportion, never by contact or raw depth. Contact misread the phone's reduced
 * floating window — 328 × 76 px, 12 px off the right edge of a 412 px map: touching only that
 * edge, it was ranked there 340 px deep, two side insets filled the width and the fit fell back to
 * the uniform margin. It is a band, and 300 px of 839 (36 %) is less of the map than 340 of 412
 * (83 %). Raw depth misreads the mobile sheet the same way: 412 px from the left is less than
 * 503 px from the bottom, yet it is the whole width against a little over half the height.
 *
 * The same share puts a full-height panel on its side, a full-width sheet on its bottom, a corner
 * credit on the bottom it barely covers rather than the side it reaches across, and a toolbar
 * column on the left — whether the surface touches an edge or floats off it.
 */
function edgeOf(depths: Insets, width: number, height: number): keyof Insets {
    const share = (e: keyof Insets): number =>
        depths[e] / (e === "top" || e === "bottom" ? height : width);
    return EDGES.reduce((a, b) => (share(b) < share(a) ? b : a));
}

/**
 * How far each edge of `container` is covered by the application's surfaces.
 *
 * Each covering surface is assigned to one edge — the one from which it hides the smallest share
 * of the map — and eats into the view from that edge. A surface that does not overlap the container counts for
 * nothing.
 *
 * @param container The map's container.
 * @param extra Selectors of the caller's own surfaces, counted with the application's — a plugin's
 *   floating window, for instance.
 * @returns The insets; all zero when nothing covers the map.
 */
export function coveredInsets(container: Element, extra: readonly string[] = []): Insets {
    const box = container.getBoundingClientRect();
    const out = { top: 0, right: 0, bottom: 0, left: 0 };
    if (typeof document === "undefined") return out;
    for (const selector of [...KERNEL_OCCLUDERS, ...extra]) {
        for (const el of document.querySelectorAll(selector)) {
            const r = shownRect(el);
            if (!r) continue;
            if (r.right <= box.left || r.left >= box.right) continue;
            if (r.bottom <= box.top || r.top >= box.bottom) continue;
            const depths: Insets = {
                top: r.bottom - box.top,
                right: box.right - r.left,
                bottom: box.bottom - r.top,
                left: r.right - box.left,
            };
            const edge = edgeOf(depths, box.width, box.height);
            // Written per edge rather than `out[edge] = …`: four literal keys, no dynamic write.
            if (edge === "top") out.top = Math.max(out.top, depths.top);
            else if (edge === "right") out.right = Math.max(out.right, depths.right);
            else if (edge === "bottom") out.bottom = Math.max(out.bottom, depths.bottom);
            else out.left = Math.max(out.left, depths.left);
        }
    }
    return out;
}

/**
 * A fit's padding: `margin` on every edge, plus what covers it.
 *
 * ⚠️ Answers `null` when the covered edges leave no room — 90 % of the width or the height. A
 * padding larger than the canvas makes the engine refuse the fit, which would leave the framed
 * thing where nobody sees it: the caller then keeps its uniform margin.
 *
 * @param container The map's container.
 * @param insets What covers each edge, as {@link coveredInsets} measures it.
 * @param margin The room kept around the framed thing, in pixels.
 * @returns The four paddings, or `null` when they would not fit in the container.
 */
export function paddingClearOf(container: Element, insets: Insets, margin: number): Insets | null {
    const { width, height } = container.getBoundingClientRect();
    const pad = {
        top: insets.top + margin,
        right: insets.right + margin,
        bottom: insets.bottom + margin,
        left: insets.left + margin,
    };
    if (pad.left + pad.right >= width * MAX_COVERED_SHARE) return null;
    if (pad.top + pad.bottom >= height * MAX_COVERED_SHARE) return null;
    return pad;
}
