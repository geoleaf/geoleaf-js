/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Shared collapse/expand behaviour for panel-style map controls
 * (layer manager, legend). Both controls expose an identical toggle button
 * and collapse mechanism — only the BEM class prefix differs.
 *
 * @version 1.0.0
 */

import { getLabel } from "../../utils/i18n/i18n.js";
import { domCreate } from "../../utils/general/dom-helpers.js";

/**
 * Creates a collapse/expand toggle button inside a control header.
 *
 * The button uses the BEM modifier `<classPrefix>__toggle`, an i18n
 * `aria-label` and the "⟱" glyph. Clicking it stops propagation and invokes
 * `onToggle`. A teardown that detaches the listener (clone-replace) is pushed
 * into `cleanups` so the control can dispose it on removal.
 *
 * @param header - The header element the button is appended to.
 * @param classPrefix - BEM block prefix, e.g. `"gl-layer-manager"` or `"gl-map-legend"`.
 * @param onToggle - Invoked on click, after `stopPropagation`.
 * @param cleanups - Array collecting teardown callbacks.
 * @returns The created button element.
 */
export function createCollapsibleToggle(
    header: HTMLElement,
    classPrefix: string,
    onToggle: () => void,
    cleanups: (() => void)[]
): HTMLButtonElement {
    const toggleEl = domCreate("button", `${classPrefix}__toggle`, header);
    toggleEl.type = "button";
    toggleEl.setAttribute("aria-label", getLabel("aria.legend.toggle"));
    toggleEl.textContent = "⟱";
    toggleEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onToggle();
    });
    cleanups.push(() => {
        toggleEl.replaceWith(toggleEl.cloneNode(true));
    });
    return toggleEl;
}

/**
 * Toggles the `<classPrefix>--collapsed` modifier on a control container.
 *
 * @param container - The control's root element.
 * @param classPrefix - BEM block prefix, e.g. `"gl-layer-manager"`.
 * @returns `true` when the container is now collapsed.
 */
export function applyToggleCollapsed(container: HTMLElement, classPrefix: string): boolean {
    return container.classList.toggle(`${classPrefix}--collapsed`);
}
