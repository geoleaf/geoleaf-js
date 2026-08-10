/*!
 * @geoleaf/host-runtime — floating sub-menu anchoring
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at PLUGINS S5 from `plugin-editor` and `plugin-measure`, which computed
 * the same placement: walk up from the clicked button to its pill-bar ancestor, centre
 * the menu vertically on that bar, drop it to the bar's right, then clamp inside the map.
 *
 * The two copies were written a sprint apart — the editor's was extracted from its
 * façade at S4, the measure one was still inline in `public-api.ts` — and had not yet
 * drifted. Consolidating now is what keeps that true.
 *
 * Parameterised by `menuHeight` and `setPosition` rather than by a CSS variable prefix:
 * both plugins already own a getter and a setter for their own root, so the seam sits
 * at those two functions instead of at the custom-property names.
 * https://geoleaf.dev
 */

/** Gap between the pill bar and the menu, in px. */
const PILL_GAP = 10;

/** Inset kept between the menu and the map edges, in px. */
const EDGE_INSET = 4;

/** Minimum width kept visible when the menu would overflow the map's right edge, in px. */
const MIN_VISIBLE_WIDTH = 64;

/** What a plugin must supply for {@link positionMenuNear} to place its menu. */
export interface MenuPositionOptions {
    /** Rendered height of the menu, in px. Used to centre it on the pill bar. */
    menuHeight: number;
    /** Applies the computed viewport-absolute position to the plugin's own root. */
    setPosition(top: number, left: number): void;
    /** Gap between the pill bar and the menu, in px. Defaults to 10. */
    gap?: number;
}

/**
 * Places a floating sub-menu to the right of the toolbar pill, vertically centred on it
 * and clamped inside the map container.
 *
 * @param pillEl - The clicked toolbar button. Its pill-bar ancestor is preferred as the
 * anchor so the menu aligns to the bar rather than to one button; the button itself is
 * used when no bar is found.
 * @param mapEl - The map container the result is clamped to.
 * @param opts - Menu height, position sink, and optional gap.
 */
export function positionMenuNear(
    pillEl: Element,
    mapEl: HTMLElement,
    opts: MenuPositionOptions
): void {
    const mapRect = mapEl.getBoundingClientRect();
    const pillBarEl =
        pillEl.closest(".gl-map-toolbar-wrapper") ??
        pillEl.closest(".gl-map-toolbar") ??
        pillEl.parentElement;
    const pillRect = (pillBarEl ?? pillEl).getBoundingClientRect();

    const menuH = opts.menuHeight;
    const top = Math.max(
        mapRect.top + EDGE_INSET,
        Math.min(
            pillRect.top + pillRect.height / 2 - menuH / 2,
            mapRect.bottom - menuH - EDGE_INSET
        )
    );
    const left = Math.min(
        pillRect.right + (opts.gap ?? PILL_GAP),
        mapRect.right - MIN_VISIBLE_WIDTH
    );

    opts.setPosition(top, left);
}
