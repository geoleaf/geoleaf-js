/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Language-switcher capability — button + popover.
 *
 * Mirrors `capabilities/permalink/share/share-button-desktop.ts`: same `.gl-rp-tab-btn`
 * base class, same insertion point (before the theme toggle), same idempotency guard.
 *
 * ⚠️ Class names are string LITERALS, never composed: purgecss scans statically, and a
 * name it cannot read is stripped from the production CSS — the control would render
 * unstyled with every test still green (a trap walked into once already).
 */

import { domCreate } from "../../utils/general/dom-helpers.js";
import { getLabel, getActiveLang } from "../../utils/i18n/i18n.js";
import { getLanguageSwitcherConfig, getOfferedLanguages, type LanguageEntry } from "./config.js";
import { switchToLanguage } from "./language-switch.js";
import {
    closeChoicePopover,
    initChoiceButton,
    toggleChoicePopover,
} from "../../utils/controls/choice-popover.js";

/** Marker + idempotency class of the button. */
export const LANG_BUTTON_CLASS = "gl-rp-lang-btn";
/** Popover root class. */
const LANG_POPOVER_CLASS = "gl-lang-popover";
/** One row of the popover. */
const LANG_POPOVER_ITEM_CLASS = "gl-lang-popover__item";

/** Renders a language as flag or code, per `display`. */
function _glyphFor(lang: LanguageEntry, display: "flag" | "code"): string {
    return display === "code" ? lang.code.toUpperCase() : lang.flag;
}

/**
 * Builds the list of languages — plain buttons, the active one marked `aria-current`. Placed,
 * opened and closed by the shared disclosure (`utils/controls/choice-popover.ts`).
 */
function _buildPopover(display: "flag" | "code"): HTMLElement {
    const popover = domCreate("div", LANG_POPOVER_CLASS);
    popover.setAttribute("aria-label", getLabel("aria.language.select"));

    const active = getActiveLang();

    for (const lang of getOfferedLanguages()) {
        const item = domCreate("button", LANG_POPOVER_ITEM_CLASS, popover);
        item.type = "button";
        item.setAttribute("data-gl-lang", lang.code);
        // textContent, never innerHTML — the label is data, and the glyph is an emoji.
        item.textContent = `${_glyphFor(lang, display)} ${lang.label}`;
        if (lang.code === active) item.setAttribute("aria-current", "true");
        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeChoicePopover();
            switchToLanguage(lang.code);
        });
    }

    return popover;
}

/** Builds the language button (desktop tab strip or mobile toolbar variant). */
export function buildLanguageButton(variant: "desktop" | "mobile"): HTMLButtonElement {
    const { display } = getLanguageSwitcherConfig();
    const btn = domCreate("button", `gl-rp-tab-btn ${LANG_BUTTON_CLASS}`);
    btn.type = "button";
    btn.dataset.variant = variant;

    const active = getOfferedLanguages().find((l) => l.code === getActiveLang());
    btn.textContent = active ? _glyphFor(active, display) : getActiveLang().toUpperCase();

    const label = getLabel("ui.language.button");
    btn.setAttribute("aria-label", label);
    initChoiceButton(btn);
    btn.title = label;

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleChoicePopover(btn, () => _buildPopover(display));
    });

    return btn;
}

/**
 * Inserts the language button at the bottom of the desktop tab strip, above the theme
 * toggle. Idempotent.
 */
export function appendLanguageButtonToTabs(tabs: HTMLElement): void {
    if (tabs.querySelector(`.${LANG_BUTTON_CLASS}`)) return;
    const btn = buildLanguageButton("desktop");
    // Bottom stack reads: …tabs… │ separator │ print │ share │ langue │ theme-toggle
    const themeToggle = tabs.querySelector(".gl-rp-theme-toggle");
    if (themeToggle) tabs.insertBefore(btn, themeToggle);
    else tabs.appendChild(btn);
}

/**
 * Removes every language button this capability injected (teardown counterpart).
 *
 * Queries the whole document rather than a caller-supplied container: the button is
 * injected into containers the capability does not own, from two entry points, and a
 * teardown must not depend on the caller still holding the right one. Removing the node
 * is also what releases its click listener.
 */
export function removeLanguageButtonsFromDocument(): void {
    if (typeof document === "undefined") return;
    closeChoicePopover();
    document.querySelectorAll(`.${LANG_BUTTON_CLASS}`).forEach((btn) => btn.remove());
}
