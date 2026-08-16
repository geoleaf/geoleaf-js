/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { _state, PRIMARY_COMPACT_THRESHOLD, type ThemeEntry } from "./theme-selector-state.js";
import { attachDOMEvent } from "./theme-selector-events.js";
import {
    attachCompactNavHandler,
    updatePrimaryNavButtons,
    ensurePrimaryThemeVisible,
} from "./theme-selector-compact.js";
import { DOMSecurity } from "../../kernel/security/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { domCreate } from "../../utils/general/dom-helpers.js";

/**
 * Attaches the click handler to a primary theme button.
 *
 * @param btn - Button DOM
 * @param theme - Theme configuration
 * @param setThemeFn - Theme change function
 */
function attachPrimaryButtonHandler(
    btn: HTMLElement,
    theme: ThemeEntry,
    setThemeFn: (id: string) => Promise<void>
): void {
    const onClick = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        setThemeFn(theme.id).catch((e: unknown) =>
            Log?.error(`[ThemeSelector] Failed to set theme "${theme.id}":`, e)
        );
    };
    attachDOMEvent(btn, "click", onClick, "ThemeSelector.primaryButton");
}

/**
 * Updates the active state of the primary buttons and manages the compact scroll.
 *
 * @param themeId - ID of the active theme
 */
export function updateUIStatePrimary(themeId: string): void {
    if (!_state.primaryContainer) return;
    const buttons = _state.primaryContainer.querySelectorAll<HTMLElement>(".gl-theme-btn");
    buttons.forEach((btn) => {
        if (btn.dataset.themeId === themeId) {
            btn.classList.add("gl-theme-btn--active");
        } else {
            btn.classList.remove("gl-theme-btn--active");
        }
    });
    // Compact mode: scroll to the active theme (Phase 4)
    if (_state.primaryScrollEl) {
        ensurePrimaryThemeVisible(themeId);
    }
}

/**
 * Builds the compact variant of the primary selector — a horizontal scroller flanked by
 * previous/next arrows — used once the theme count passes the compact threshold.
 *
 * ⚠️ This block described {@link createPrimaryUI} until 29/07/2026 and was left behind when
 * this helper was extracted: it documented a `setThemeFn` parameter this signature never had.
 *
 * @param container - The primary container; receives the `--compact` modifier class.
 * @returns The scroller element, whose references the caller stores in module state.
 */
function _buildCompactPrimaryUI(container: HTMLElement): HTMLElement {
    container.classList.add("gl-theme-selector-primary--compact");

    const navPrev = domCreate(
        "button",
        "gl-theme-selector-primary__nav gl-theme-selector-primary__nav--prev",
        container
    );
    navPrev.type = "button";
    navPrev.setAttribute("aria-label", getLabel("aria.themes.nav_prev"));
    navPrev.innerHTML = "&#8249;"; // SAFE: static HTML entity, no user data
    _state.primaryScrollNavPrev = navPrev;
    attachCompactNavHandler(navPrev, "prev");

    const scrollEl = domCreate("div", "gl-theme-selector-primary__scroll", container);
    _state.primaryScrollEl = scrollEl;
    scrollEl.addEventListener("scroll", () => updatePrimaryNavButtons());

    const navNext = domCreate(
        "button",
        "gl-theme-selector-primary__nav gl-theme-selector-primary__nav--next",
        container
    );
    navNext.type = "button";
    navNext.setAttribute("aria-label", getLabel("aria.themes.nav_next"));
    navNext.innerHTML = "&#8250;"; // SAFE: static HTML entity, no user data
    _state.primaryScrollNavNext = navNext;
    attachCompactNavHandler(navNext, "next");

    return scrollEl;
}

/**
 * Renders the primary theme selector into its configured container.
 *
 * A no-op when no primary container was configured — the selector is optional, so its absence
 * is a valid configuration and not an error worth logging. The container is cleared and its
 * modifier classes reset on every call, which makes the function safe to re-run after a
 * profile switch: the compact-mode references are dropped so a stale scroll element cannot
 * survive into the new layout.
 *
 * @param setThemeFn - Applies a theme by id. Injected rather than imported so the selector
 *   stays a view: it never decides what applying a theme means.
 */
export function createPrimaryUI(setThemeFn: (id: string) => Promise<void>): void {
    if (!_state.primaryContainer) return;

    // Clear the container
    DOMSecurity.clearElementFast(_state.primaryContainer);

    // Add the CSS class (remove --compact first in case of re-init)
    _state.primaryContainer.classList.add("gl-theme-selector-primary");
    _state.primaryContainer.classList.remove("gl-theme-selector-primary--compact");

    // Reset references mode compact
    _state.primaryScrollEl = null;
    _state.primaryScrollNavPrev = null;
    _state.primaryScrollNavNext = null;

    // Configurable threshold (Phase 4): if > threshold → compact mode (nav + horizontal scroll)
    const threshold: number =
        _state.config?.primaryThemes?.compactThreshold ?? PRIMARY_COMPACT_THRESHOLD;
    const isCompact = _state.primaryThemes.length > threshold;

    // Container that will receive the buttons (direct or scrollable zone)
    let btnParent: HTMLElement = _state.primaryContainer;

    if (isCompact) {
        btnParent = _buildCompactPrimaryUI(_state.primaryContainer);
    }

    // Create a button for each primary theme
    _state.primaryThemes.forEach((theme) => {
        const btn = domCreate("button", "gl-theme-btn", btnParent);
        btn.type = "button";
        btn.dataset.themeId = theme.id;
        btn.title = theme.description || theme.label;

        // Button content: icon + label
        const iconSpan = domCreate("span", "gl-theme-btn__icon", btn);
        iconSpan.textContent = theme.icon || "";

        const labelSpan = domCreate("span", "gl-theme-btn__label", btn);
        labelSpan.textContent = theme.label;

        // Mark the active theme
        if (theme.id === _state.currentTheme) {
            btn.classList.add("gl-theme-btn--active");
        }

        // Click handler
        attachPrimaryButtonHandler(btn, theme, setThemeFn);
    });

    if (isCompact) {
        // Initialize the nav buttons state after render (scrollWidth available)
        requestAnimationFrame(() => updatePrimaryNavButtons());
    }

    if (Log)
        Log.debug(
            "[ThemeSelector] Primary UI created:",
            _state.primaryThemes.length,
            "buttons",
            isCompact ? "(mode compact)" : ""
        );
}
