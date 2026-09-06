/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * desktop-panel-theme.ts
 *
 * Theme toggle button helpers for the desktop side panel.
 * Extracted from desktop-panel.ts to keep it within the 700-line limit.
 */

import { getLabel } from "../../../utils/i18n/i18n.js";
import { _UITheme } from "../theme.js";
import { DOMSecurity } from "../../security/dom-security.js";

// SVG paths for sun/moon icons (same as control-theme-toggle.ts)
const _SVG_SUN =
    "M12 3v1m0 16v1M4.22 4.22l.7.7m12.16 12.16.7.7M3 12h1m16 0h1M4.92 19.07l.7-.7M18.36 5.64l.7-.7M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7z";
const _SVG_MOON = "M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z";

/**
 * Builds the theme-toggle button for one layout.
 *
 * The two variants differ in markup and class names, not in behaviour — both end up calling
 * the same toggle. Kept as one function so the two cannot drift apart.
 *
 * @param variant - Which layout the button is for.
 * @returns The button, not yet attached.
 */
export function buildThemeToggleBtn(variant: "desktop" | "mobile"): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gl-rp-tab-btn gl-rp-theme-toggle";
    btn.dataset.variant = variant;
    const opts = { stroke: "currentColor", strokeWidth: "2", fill: "none" };
    const svgSun = DOMSecurity.createSVGIcon(18, 18, _SVG_SUN, opts);
    svgSun.classList.add("gl-rp-theme-icon--sun");
    const svgMoon = DOMSecurity.createSVGIcon(18, 18, _SVG_MOON, opts);
    svgMoon.classList.add("gl-rp-theme-icon--moon");
    btn.appendChild(svgSun);
    btn.appendChild(svgMoon);

    const _syncBtn = () => {
        const isDark = _UITheme.getCurrentTheme() === _UITheme.THEME_DARK;
        (svgSun as unknown as HTMLElement).style.display = isDark ? "block" : "none";
        (svgMoon as unknown as HTMLElement).style.display = isDark ? "none" : "block";
        const label = isDark
            ? getLabel("aria.theme.toggle_to_light")
            : getLabel("aria.theme.toggle_to_dark");
        btn.setAttribute("aria-label", label);
        btn.title = label;
    };

    _syncBtn();

    btn.addEventListener("click", () => {
        _UITheme.toggleTheme();
    });

    if (typeof globalThis !== "undefined" && globalThis.addEventListener) {
        globalThis.addEventListener("geoleaf:ui-theme-changed", _syncBtn as EventListener);
    }

    return btn;
}

/**
 * Appends the tab strip separator, once. Never conditional.
 *
 * The name says "theme", but the node stopped belonging to the theme toggle: it is the strip's
 * layout anchor, and it must be appended even when the toggle is hidden.
 *
 * - This separator carries the only `margin-top: auto` in the strip, and that margin is what
 *   pushes the bottom icon stack against the bottom edge. Drop it — or hide it with
 *   `display: none`, which generates no box — and tabs and icons bunch up together at the
 *   top, with the whole lower half of the strip empty.
 *
 *   ⚠️ **This paragraph used to open with "`.gl-rp-tabs` is a flex column WITH
 *   `justify-content: center`", and read the margin as what CANCELLED that centring.** True
 *   when it was written; the strip is `flex-start` now. The centring was itself a defect —
 *   an overflow in a centred column is split evenly between both ends, so a strip too tall
 *   for the viewport lost its first tab AND its last icon, cut by `body { overflow: hidden }`
 *   with no scrollbar. The separator's job survives the change; the reason given for it did
 *   not.
 * - Two consumers anchor on it and never look at the toggle: the `"tab"` variant inserted by
 *   `appendRegistryTabButtons` and the registered-pane sync in the desktop panel.
 *
 * @param tabs - The tab strip element.
 */
export function appendTabsSeparator(tabs: HTMLElement): void {
    if (tabs.querySelector(".gl-rp-theme-separator")) return;
    const separator = document.createElement("div");
    separator.className = "gl-rp-theme-separator";
    tabs.appendChild(separator);
}

/**
 * Appends the desktop theme toggle to a tab strip, once.
 *
 * Guarded against duplicates: the tab strip is rebuilt whenever the registry changes, and a
 * second toggle would both render twice and double-fire the theme change.
 *
 * ⚠️ Appends the button ONLY. The separator is a layout anchor with its own lifetime and is
 * posted unconditionally by {@link appendTabsSeparator} — call that one first, and call it
 * even when this one is gated off by `ui.showPanelThemeToggle`.
 *
 * @param tabs - The tab strip element.
 */
export function appendThemeToggleToTabs(tabs: HTMLElement): void {
    if (tabs.querySelector(".gl-rp-theme-toggle")) return;
    tabs.appendChild(buildThemeToggleBtn("desktop"));
}
