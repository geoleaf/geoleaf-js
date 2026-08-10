/*!
 * @geoleaf/host-runtime — floating-menu tooltips
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at PLUGINS S1 from `plugin-editor` and `plugin-measure`, which carried
 * byte-identical implementations.
 *
 * JS-positioned tooltip rather than a CSS one: the floating menus clip their overflow,
 * so a purely CSS tooltip would be cut off at the menu edge.
 * https://geoleaf.dev
 */

/**
 * JS-positioned tooltip for the floating menus, plus the stylesheet that presents it.
 *
 * The presentation lives beside the behaviour since STRUCT S2 (F8): this module writes
 * `gl-is-visible`, so the sheet that styles it belongs in the same package. It is adopted
 * as a side effect of importing this module — the same doctrine as
 * `@geoleaf/field-renderer`'s `ui/responsive-modal.ts`, and the reason the import sits
 * HERE rather than in `index.ts`. Measured at F8: the five plugins that never call
 * `wireTooltips` (cog, flatgeobuf, websocket, realtime-layer, file-import) are
 * byte-for-byte unchanged, so the side effect does not leak through the barrel.
 */

import "../css/tooltip.css";

/**
 * Positions and reveals the tooltip to the right of `btn`, vertically centred.
 * No-op when the tooltip element is absent or the button carries no `data-tooltip`.
 *
 * @param tooltipEl - The shared tooltip element, or `null` before the menu is built.
 * @param btn - The hovered/focused button; its `data-tooltip` supplies the label.
 */
export function showTooltip(tooltipEl: HTMLElement | null, btn: HTMLElement): void {
    if (!tooltipEl) return;
    const label = btn.dataset.tooltip;
    if (!label) return;
    tooltipEl.textContent = label;
    const r = btn.getBoundingClientRect();
    tooltipEl.style.left = `${r.right + 10}px`;
    tooltipEl.style.top = `${r.top + r.height / 2}px`;
    tooltipEl.classList.add("gl-is-visible");
}

/** Hides the tooltip. No-op when it is absent. */
export function hideTooltip(tooltipEl: HTMLElement | null): void {
    tooltipEl?.classList.remove("gl-is-visible");
}

/**
 * Wires mouse and keyboard tooltip triggers on every `[data-tooltip]` descendant of
 * `root`.
 *
 * Both element lookups are getters resolved at event time, not at wiring time: the
 * menus rebuild their DOM on `destroy()` + `init()`, and capturing by value would
 * leave the handlers pointing at a detached tooltip.
 *
 * @param getRoot - Resolves the menu root to scan for `[data-tooltip]`.
 * @param getTooltipEl - Resolves the shared tooltip element.
 */
export function wireTooltips(
    getRoot: () => HTMLElement | null,
    getTooltipEl: () => HTMLElement | null
): void {
    const root = getRoot();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLElement>("[data-tooltip]")) {
        btn.addEventListener("mouseenter", () => showTooltip(getTooltipEl(), btn));
        btn.addEventListener("focusin", () => showTooltip(getTooltipEl(), btn));
        btn.addEventListener("mouseleave", () => hideTooltip(getTooltipEl()));
        btn.addEventListener("focusout", () => hideTooltip(getTooltipEl()));
    }
}
