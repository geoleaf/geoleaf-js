/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

"use strict";

import { Log } from "../../utils/log/index.js";
import { _state } from "./theme-selector-state.js";
import { attachDOMEvent } from "./theme-selector-events.js";
import { createElement, domCreate } from "../../utils/general/dom-helpers.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { DOMSecurity } from "../../kernel/security/index.js";

/**
 * Attaches the change handler to the secondary dropdown.
 *
 * @param select - Element select
 * @param setThemeFn - Theme change function
 */
export function attachDropdownHandler(
    select: HTMLSelectElement,
    setThemeFn: (id: string) => Promise<void>
): void {
    const onChange = (ev: Event) => {
        ev.stopPropagation();
        const themeId = select.value;
        if (Log) Log.info(`[ThemeSelector] Dropdown changed: ${themeId}`);
        if (themeId) {
            setThemeFn(themeId).catch((e: unknown) =>
                Log?.error(`[ThemeSelector] Failed to set theme "${themeId}":`, e)
            );
        } else {
            if (Log) Log.warn("[ThemeSelector] Dropdown: empty themeId");
        }
    };
    attachDOMEvent(select, "change", onChange, "ThemeSelector.dropdown");
    if (Log) Log.debug("[ThemeSelector] Dropdown handler attached");
}

/**
 * Attaches the handler to a secondary navigation button (prev/next).
 *
 * @param btn - Button DOM
 * @param direction - "prev" | "next"
 * @param nextThemeFn - Function to activate the next theme
 * @param previousThemeFn - Function to activate the previous theme
 */
export function attachNavButtonHandler(
    btn: HTMLElement,
    direction: "prev" | "next",
    nextThemeFn: () => void,
    previousThemeFn: () => void
): void {
    const onClick = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (direction === "next") {
            nextThemeFn();
        } else {
            previousThemeFn();
        }
    };
    attachDOMEvent(btn, "click", onClick, "ThemeSelector.navButton");
}

/**
 * Updates the dropdown state after a theme change.
 *
 * @param themeId - ID of the active theme
 */
export function updateUIStateSecondary(themeId: string): void {
    if (!_state.dropdown) return;
    const isSecondary = _state.secondaryThemes.some((t) => t.id === themeId);
    if (isSecondary) {
        _state.dropdown.value = themeId;
    } else {
        _state.dropdown.value = "";
    }
}

/**
 * Appends one navigation arrow to the secondary selector's wrapper.
 *
 * Both callbacks are taken whichever direction is being built, so the two arrows are created by
 * identical calls differing only in `dir` — the direction decides which one is wired.
 *
 * ⚠️ This block described {@link createSecondaryUI} until 29/07/2026 and was left behind when
 * this helper was extracted: it documented three parameters this signature never had.
 *
 * @param wrapper - Element the button is appended to.
 * @param dir - Which arrow to build; also selects the CSS modifier class.
 * @param nextFn - Advances to the next secondary theme.
 * @param prevFn - Steps back to the previous one.
 */
function _buildSecondaryNavButton(
    wrapper: HTMLElement,
    dir: "prev" | "next",
    nextFn: () => void,
    prevFn: () => void
): void {
    const cls =
        dir === "prev" ? "gl-theme-nav gl-theme-nav--prev" : "gl-theme-nav gl-theme-nav--next";
    const btn = domCreate("button", cls, wrapper);
    btn.type = "button";
    btn.textContent = dir === "prev" ? "❮" : "❯";
    btn.title =
        dir === "prev" ? getLabel("aria.themes.prev_title") : getLabel("aria.themes.next_title");
    attachNavButtonHandler(btn, dir, nextFn, prevFn);
}

function _buildSecondaryDropdown(
    wrapper: HTMLElement,
    setThemeFn: (id: string) => Promise<void>
): void {
    const select = domCreate("select", "gl-theme-dropdown", wrapper);
    _state.dropdown = select;
    select.setAttribute("aria-label", getLabel("aria.themes.secondary_select"));

    const placeholderText = _state.config!.secondaryThemes.placeholder;
    const placeholder = createElement("option", {
        value: "",
        ...(placeholderText !== undefined && { textContent: placeholderText }),
        disabled: true,
    });
    select.appendChild(placeholder);

    _state.secondaryThemes.forEach((theme) => {
        const opt = createElement("option", { value: theme.id, textContent: theme.label });
        select.appendChild(opt);
    });

    const currentIsSecondary = _state.secondaryThemes.some((t) => t.id === _state.currentTheme);
    // `currentIsSecondary` implies `currentTheme` matched a secondary id (a string).
    select.value = currentIsSecondary ? (_state.currentTheme as string) : "";
    attachDropdownHandler(select, setThemeFn);
}

/**
 * Renders the secondary theme selector — a dropdown plus previous/next navigation — into its
 * configured container.
 *
 * Unlike the primary selector, a missing container **is** logged here: the secondary UI is only
 * created when something asked for it, so an absent container means a configuration that will
 * not do what its author intended.
 *
 * The dropdown shows an empty selection when the active theme is not one of the secondary
 * themes, rather than silently selecting the first entry — a selector that lies about the
 * current state is worse than one that admits it has no answer.
 *
 * @param setThemeFn - Applies a theme by id, used by the dropdown.
 * @param nextThemeFn - Advances to the next secondary theme, used by the forward control.
 * @param previousThemeFn - Steps back to the previous one. All three are injected rather than
 *   imported: the selector is a view and never decides what changing a theme means.
 */
export function createSecondaryUI(
    setThemeFn: (id: string) => Promise<void>,
    nextThemeFn: () => void,
    previousThemeFn: () => void
): void {
    if (!_state.secondaryContainer) {
        if (Log) Log.warn("[ThemeSelector] Secondary container not found");
        return;
    }
    if (Log)
        Log.debug(
            "[ThemeSelector] Creating secondary UI:",
            _state.secondaryThemes.length,
            "themes"
        );
    if (Log)
        Log.debug(
            "[ThemeSelector] IDs:",
            _state.secondaryThemes.map((t) => t.id)
        );

    DOMSecurity.clearElementFast(_state.secondaryContainer);
    _state.secondaryContainer.classList.add("gl-theme-selector-secondary");

    const wrapper = domCreate(
        "div",
        "gl-theme-selector-secondary__wrapper",
        _state.secondaryContainer
    );

    if (_state.config!.secondaryThemes.showNavigationButtons) {
        _buildSecondaryNavButton(wrapper, "prev", nextThemeFn, previousThemeFn);
    }

    _buildSecondaryDropdown(wrapper, setThemeFn);

    if (_state.config!.secondaryThemes.showNavigationButtons) {
        _buildSecondaryNavButton(wrapper, "next", nextThemeFn, previousThemeFn);
    }

    if (Log)
        Log.debug("[ThemeSelector] Secondary UI created:", _state.secondaryThemes.length, "themes");
}
