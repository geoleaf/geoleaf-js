/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { _state } from "./theme-selector-state.js";
import { attachDOMEvent } from "./theme-selector-events.js";

/**
 * Attaches the click handler to a compact navigation button (prev/next).
 *
 * @param btn - Button nav
 * @param direction - "prev" | "next"
 */
export function attachCompactNavHandler(btn: HTMLElement, direction: "prev" | "next"): void {
    const SCROLL_AMOUNT = 120; // px per click
    const onClick = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (!_state.primaryScrollEl) return;
        const delta = direction === "next" ? SCROLL_AMOUNT : -SCROLL_AMOUNT;
        _state.primaryScrollEl.scrollBy({ left: delta, behavior: "smooth" });
    };
    attachDOMEvent(btn, "click", onClick, "ThemeSelector.compactNav");
}

/**
 * Updates the disabled state of the compact navigation buttons.
 */
export function updatePrimaryNavButtons(): void {
    const el = _state.primaryScrollEl;
    if (!el) return;
    const atStart = el.scrollLeft <= 2;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    if (_state.primaryScrollNavPrev) _state.primaryScrollNavPrev.disabled = atStart;
    if (_state.primaryScrollNavNext) _state.primaryScrollNavNext.disabled = atEnd;
}

/**
 * Scrolls the compact bar to make the active theme visible.
 *
 * @param themeId - ID of the theme active
 */
export function ensurePrimaryThemeVisible(themeId: string): void {
    if (!_state.primaryScrollEl) return;
    const btn = _state.primaryScrollEl.querySelector(
        `[data-theme-id="${themeId}"]`
    ) as HTMLElement | null;
    if (!btn) return;
    btn.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "nearest" });
    // Recalculate nav button state after scrolling
    setTimeout(() => updatePrimaryNavButtons(), 350);
}
