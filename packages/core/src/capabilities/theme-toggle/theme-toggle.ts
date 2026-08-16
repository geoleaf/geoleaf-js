/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-toggle capability — runtime control.
 *
 * Adapter-agnostic light/dark theme toggle button. Relocated verbatim from
 * `modules/built-in/ui/control-theme-toggle.ts` (in-core capability
 * reclassification). Drives the kernel theme engine (`_UITheme`, which stays in
 * `kernel/ui/theme.ts`) — this capability only owns the on-map button UI.
 */

import { Log } from "../../utils/log/index.js";
import { DOMSecurity } from "../../kernel/security/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { _UITheme } from "../../kernel/ui/index.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import { blockMapPropagation } from "../../utils/controls/propagation-blocker.js";
import type {
    IMapAdapter,
    GeoLeafControl,
    GeoLeafControlPosition,
} from "../../contracts/map-adapter.contract.js";

// SVG path — sun icon (light mode indicator)
const SVG_SUN =
    "M12 3v1m0 16v1M4.22 4.22l.7.7m12.16 12.16.7.7M3 12h1m16 0h1M4.92 19.07l.7-.7M18.36 5.64l.7-.7M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7z";

// SVG path — crescent moon icon (dark mode indicator)
const SVG_MOON = "M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z";

/** Internal state for the theme toggle control, allowing cleanup on destroy. */
let _controlHandle: GeoLeafControl | null = null;
let _cleanups: (() => void)[] = [];

function _syncState(theme: string, link: HTMLElement, svgSun: SVGElement, svgMoon: SVGElement) {
    const isDark = theme === _UITheme.THEME_DARK;
    // Sun is shown when dark (click → switch to light); moon when light (click → switch to dark)
    svgSun.style.display = isDark ? "block" : "none";
    svgMoon.style.display = isDark ? "none" : "block";
    const ariaLabel = isDark
        ? getLabel("aria.theme.toggle_to_light")
        : getLabel("aria.theme.toggle_to_dark");
    link.title = ariaLabel;
    link.setAttribute("aria-label", ariaLabel);
    link.setAttribute("aria-pressed", String(isDark));
}

function _buildThemeIcons(link: HTMLElement): { svgSun: SVGElement; svgMoon: SVGElement } {
    // SAFE: SVG paths are static hardcoded strings
    const opts = { stroke: "currentColor", strokeWidth: "2", fill: "none" };
    const svgSun = DOMSecurity.createSVGIcon(18, 18, SVG_SUN, opts);
    svgSun.classList.add("gl-theme-toggle-icon--sun");
    const svgMoon = DOMSecurity.createSVGIcon(18, 18, SVG_MOON, opts);
    svgMoon.classList.add("gl-theme-toggle-icon--moon");
    link.appendChild(svgSun);
    link.appendChild(svgMoon);
    return { svgSun, svgMoon };
}

function _buildThemeToggleOnAdd(cleanups: (() => void)[]): HTMLElement {
    const container = domCreate("div", "geoleaf-ctrl-theme-toggle geoleaf-ctrl-group geoleaf-ctrl");
    const link = domCreate("a", "", container);
    link.href = "#";
    link.setAttribute("role", "button");

    const { svgSun, svgMoon } = _buildThemeIcons(link);
    _syncState(_UITheme.getCurrentTheme(), link, svgSun, svgMoon);

    blockMapPropagation(container, cleanups);

    // Toggle on click/keyboard
    const toggleHandler = (e: Event) => {
        e.preventDefault();
        _UITheme.toggleTheme();
    };

    const keydownHandler = (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") toggleHandler(e);
    };

    link.addEventListener("click", toggleHandler);
    link.addEventListener("keydown", keydownHandler);

    cleanups.push(
        () => link.removeEventListener("click", toggleHandler),
        () => link.removeEventListener("keydown", keydownHandler)
    );

    // React to theme changes from any source (auto-detect, toggleTheme, applyTheme)
    const themeChangedHandler = (e: CustomEvent) => {
        const detail = (e as CustomEvent<{ theme?: string }>).detail;
        const theme = detail?.theme || _UITheme.getCurrentTheme();
        _syncState(theme, link, svgSun, svgMoon);
    };

    if (globalThis.addEventListener) {
        globalThis.addEventListener(
            "geoleaf:ui-theme-changed",
            themeChangedHandler as EventListener
        );

        cleanups.push(() =>
            globalThis.removeEventListener(
                "geoleaf:ui-theme-changed",
                themeChangedHandler as EventListener
            )
        );
    }

    return container;
}

/**
 * Adds a light/dark theme toggle button to the map.
 * Mounted by the capability lifecycle when `modules.theme-toggle.enabled` is `true`.
 *
 * @param map - Map adapter instance.
 * @param position - Control position on the map.
 * @returns A destroy function to remove the control and clean up listeners,
 *          or `undefined` if the control could not be created.
 */
function initThemeToggleControl(map: IMapAdapter, position = "topleft"): (() => void) | undefined {
    if (!map) {
        if (Log) Log.warn("[ThemeToggle] initThemeToggleControl: map missing");
        return;
    }

    // Clean up any previous instance
    _destroyThemeToggleControl();

    _cleanups = [];
    const container = _buildThemeToggleOnAdd(_cleanups);
    _controlHandle = map.addControl(container, position as GeoLeafControlPosition);

    if (Log) Log.info("[ThemeToggle] Theme toggle control added to map");

    return _destroyThemeToggleControl;
}

/** Removes the theme toggle control from the map and cleans up all listeners. */
function _destroyThemeToggleControl(): void {
    for (const fn of _cleanups) fn();
    _cleanups = [];
    _controlHandle?.remove();
    _controlHandle = null;
}

export { initThemeToggleControl, _destroyThemeToggleControl };
