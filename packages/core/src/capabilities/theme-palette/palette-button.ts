/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-palette capability — button + swatch popover.
 *
 * Same shape as the language switcher (itself modelled on the share button): a
 * `.gl-rp-tab-btn` in the tab strip, opening a popover, closing on outside click or
 * Escape.
 *
 * ⚠️ Class names are string LITERALS, never composed — purgecss scans statically.
 */
"use strict";

import { domCreate, applyCssText } from "../../utils/general/dom-helpers.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { getPalettes } from "./config.js";
import { applyPalette, getPalette } from "./palette-engine.js";

/** Marker + idempotency class of the button. */
export const PALETTE_BUTTON_CLASS = "gl-rp-palette-btn";
const PALETTE_POPOVER_CLASS = "gl-palette-popover";
const PALETTE_ITEM_CLASS = "gl-palette-popover__item";
const PALETTE_SWATCH_CLASS = "gl-palette-popover__swatch";

let _openPopover: HTMLElement | null = null;
let _outsideHandler: ((e: Event) => void) | null = null;

/** Closes the popover and releases its document-level listeners. */
function closePalettePopover(): void {
    if (_outsideHandler && typeof document !== "undefined") {
        document.removeEventListener("click", _outsideHandler, true);
        document.removeEventListener("keydown", _outsideHandler, true);
    }
    _outsideHandler = null;
    _openPopover?.remove();
    _openPopover = null;
}

/** Marks the active row, so the popover reflects a live switch without a rebuild. */
function _syncActive(popover: HTMLElement): void {
    const active = getPalette();
    popover.querySelectorAll<HTMLElement>(`.${PALETTE_ITEM_CLASS}`).forEach((item) => {
        if (item.dataset.glPalette === active) item.setAttribute("aria-current", "true");
        else item.removeAttribute("aria-current");
    });
}

/** Builds the popover of palette swatches. */
function _buildPopover(anchor: HTMLElement): HTMLElement {
    const popover = domCreate("div", PALETTE_POPOVER_CLASS);
    popover.setAttribute("role", "menu");
    popover.setAttribute("aria-label", getLabel("aria.palette.select"));

    for (const palette of getPalettes()) {
        const item = domCreate("button", PALETTE_ITEM_CLASS, popover);
        (item as HTMLButtonElement).type = "button";
        item.setAttribute("role", "menuitem");
        item.dataset.glPalette = palette.id;

        const dot = domCreate("span", PALETTE_SWATCH_CLASS, item);
        // Per-property CSSOM write: NOT subject to the CSP `style-src` directive, unlike
        // a `style` attribute (security roadmap B.5). The swatch colour is config data,
        // so it cannot live in the stylesheet.
        applyCssText(dot, `background:${palette.swatch}`);

        const text = domCreate("span", "", item);
        text.textContent = palette.label; // textContent: the label is data

        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            // No reload: swapping a CSS variable repaints on its own.
            applyPalette(palette.id);
            _syncActive(popover);
        });
    }

    anchor.parentElement?.appendChild(popover);
    _syncActive(popover);
    return popover;
}

/** Opens the popover, wiring outside-click and Escape to close it. */
function _openFor(btn: HTMLElement): void {
    if (_openPopover) {
        closePalettePopover();
        return;
    }
    const popover = _buildPopover(btn);
    _openPopover = popover;

    _outsideHandler = (e: Event) => {
        if (e.type === "keydown") {
            if ((e as KeyboardEvent).key !== "Escape") return;
            closePalettePopover();
            btn.focus();
            return;
        }
        if (popover.contains(e.target as Node) || btn.contains(e.target as Node)) return;
        closePalettePopover();
    };
    document.addEventListener("click", _outsideHandler, true);
    document.addEventListener("keydown", _outsideHandler, true);
}

/** SVG path — a painter's palette glyph, drawn to match the 18px stroke icons around it. */
const SVG_PALETTE =
    "M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H13a1.5 1.5 0 0 1 0-3h3.5A4.5 4.5 0 0 0 21 8.5C21 5.46 16.97 3 12 3z";

/** Builds the palette button (desktop tab strip or mobile toolbar variant). */
export function buildPaletteButton(variant: "desktop" | "mobile"): HTMLButtonElement {
    const btn = domCreate("button", `gl-rp-tab-btn ${PALETTE_BUTTON_CLASS}`) as HTMLButtonElement;
    btn.type = "button";
    btn.dataset.variant = variant;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", SVG_PALETTE);
    svg.appendChild(path);
    btn.appendChild(svg);

    const label = getLabel("ui.palette.button");
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-haspopup", "menu");
    btn.title = label;

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        _openFor(btn);
    });

    return btn;
}

/**
 * Inserts the palette button into the desktop tab strip, immediately before the theme
 * toggle (so it sits next to the light/dark control, as specified). Idempotent.
 */
export function appendPaletteButtonToTabs(tabs: HTMLElement): void {
    if (tabs.querySelector(`.${PALETTE_BUTTON_CLASS}`)) return;
    const btn = buildPaletteButton("desktop");
    const themeToggle = tabs.querySelector(".gl-rp-theme-toggle");
    if (themeToggle) tabs.insertBefore(btn, themeToggle);
    else tabs.appendChild(btn);
}

/** Removes every palette button this capability injected (teardown counterpart). */
export function removePaletteButtonsFromDocument(): void {
    if (typeof document === "undefined") return;
    closePalettePopover();
    document.querySelectorAll(`.${PALETTE_BUTTON_CLASS}`).forEach((btn) => btn.remove());
}
