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

/** Marker + idempotency class of the button. */
export const LANG_BUTTON_CLASS = "gl-rp-lang-btn";
/** Popover root class. */
const LANG_POPOVER_CLASS = "gl-lang-popover";
/** One row of the popover. */
const LANG_POPOVER_ITEM_CLASS = "gl-lang-popover__item";

let _openPopover: HTMLElement | null = null;
let _outsideHandler: ((e: Event) => void) | null = null;

/** Renders a language as flag or code, per `display`. */
function _glyphFor(lang: LanguageEntry, display: "flag" | "code"): string {
    return display === "code" ? lang.code.toUpperCase() : lang.flag;
}

/** Closes the popover and releases its document-level listener. Module-local. */
function closeLanguagePopover(): void {
    if (_outsideHandler && typeof document !== "undefined") {
        document.removeEventListener("click", _outsideHandler, true);
        document.removeEventListener("keydown", _outsideHandler, true);
    }
    _outsideHandler = null;
    _openPopover?.remove();
    _openPopover = null;
}

/** Builds the popover listing the offered languages. */
function _buildPopover(anchor: HTMLElement, display: "flag" | "code"): HTMLElement {
    const popover = domCreate("div", LANG_POPOVER_CLASS);
    popover.setAttribute("role", "menu");
    popover.setAttribute("aria-label", getLabel("aria.language.select"));

    const active = getActiveLang();

    for (const lang of getOfferedLanguages()) {
        const item = domCreate("button", LANG_POPOVER_ITEM_CLASS, popover);
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.setAttribute("data-gl-lang", lang.code);
        // textContent, never innerHTML — the label is data, and the glyph is an emoji.
        item.textContent = `${_glyphFor(lang, display)} ${lang.label}`;
        if (lang.code === active) item.setAttribute("aria-current", "true");
        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeLanguagePopover();
            switchToLanguage(lang.code);
        });
    }

    anchor.parentElement?.appendChild(popover);
    return popover;
}

/** Opens the popover, wiring outside-click and Escape to close it. */
function _openFor(btn: HTMLElement, display: "flag" | "code"): void {
    if (_openPopover) {
        closeLanguagePopover();
        return;
    }
    const popover = _buildPopover(btn, display);
    _openPopover = popover;

    _outsideHandler = (e: Event) => {
        if (e.type === "keydown") {
            if ((e as KeyboardEvent).key !== "Escape") return;
            closeLanguagePopover();
            btn.focus(); // returning focus is what makes Escape usable by keyboard
            return;
        }
        if (popover.contains(e.target as Node) || btn.contains(e.target as Node)) return;
        closeLanguagePopover();
    };
    // Capture phase: the map swallows bubbling clicks on some surfaces.
    document.addEventListener("click", _outsideHandler, true);
    document.addEventListener("keydown", _outsideHandler, true);
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
    btn.setAttribute("aria-haspopup", "menu");
    btn.title = label;

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        _openFor(btn, display);
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
    closeLanguagePopover();
    document.querySelectorAll(`.${LANG_BUTTON_CLASS}`).forEach((btn) => btn.remove());
}
