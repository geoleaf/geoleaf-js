/*!
 * GeoLeaf Core – Core / Theme
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";

// Narrow view of the global `GeoLeaf` namespace members read by this facade.
interface CoreThemeGlobal {
    GeoLeaf?: {
        UI?: {
            applyTheme?(theme: string, persist?: boolean): void;
            getCurrentTheme?(): string;
        };
    };
}

// ES2022 target + Node >= 18: globalThis is always defined.
const _g = globalThis as unknown as CoreThemeGlobal;

const THEME_LIGHT = "light";
const THEME_DARK = "dark";

/**
 * Applies the theme class to document.body.
 *
 * Fallback path only — used when the canonical UI theme engine (`_UITheme`)
 * has not been loaded. It writes the body class and nothing else.
 *
 * @param theme - "light" | "dark"
 */
function _applyThemeToBody(theme: string) {
    const body = document.body;
    if (!body) {
        Log.warn("[GeoLeaf.Core] document.body not found");
        return;
    }
    body.classList.remove("gl-theme-light", "gl-theme-dark");
    body.classList.add(theme === THEME_DARK ? "gl-theme-dark" : "gl-theme-light");
}

/**
 * Reads the theme back from the body class.
 *
 * Fallback path only. Defaults to "light" — the historical `Core` default,
 * deliberately NOT aligned on `_UITheme.getCurrentTheme()` which defaults to
 * "dark". Aligning them would silently change behaviour when UI is absent.
 *
 * @returns "light" | "dark"
 */
function _readThemeFromBody(): string {
    const body = document.body;
    if (body?.classList.contains("gl-theme-dark")) return THEME_DARK;
    return THEME_LIGHT;
}

/**
 * Sets and applies the active theme.
 *
 * Delegates to the canonical UI theme engine (`_UITheme.applyTheme`) when it is
 * loaded, so that localStorage persistence, the `#geoleaf-map` container class
 * (fullscreen support), the toggle button's `aria-pressed` state and the
 * `geoleaf:ui-theme-changed` event all stay in sync. Falls back to a plain body
 * class swap when `GeoLeaf.UI` is absent.
 *
 * @param theme - "light" | "dark"
 */
export function setTheme(theme: string) {
    if (!theme || (theme !== THEME_LIGHT && theme !== THEME_DARK)) {
        Log.warn("[GeoLeaf.Core] setTheme() ignored an invalid theme:", theme);
        return;
    }

    // NOTE: intentionally NOT routed through `applyThemeSafe()` in map-container.ts,
    // despite the near-identical guard. That helper is the boot-time seam: it
    // forwards `options.theme` UNVALIDATED so custom theme names reach the UI
    // engine. This is the public API seam: it validates to "light" | "dark" and
    // needs to know whether delegation happened in order to fall back. Merging
    // the two would reject custom themes at boot.
    try {
        if (typeof _g.GeoLeaf?.UI?.applyTheme === "function") {
            _g.GeoLeaf.UI.applyTheme(theme);
            return;
        }
    } catch (err) {
        Log.warn("[GeoLeaf.Core] Error delegating theme to GeoLeaf.UI:", err);
    }

    _applyThemeToBody(theme);
}

/**
 * Returns the active theme.
 *
 * Reads through to the canonical UI theme engine when available, so the value
 * reflects theme changes made by the toggle button, `GeoLeaf.setTheme()` or the
 * boot sequence. Falls back to the body class when `GeoLeaf.UI` is absent.
 *
 * @returns "light" | "dark"
 */
export function getTheme(): string {
    try {
        if (typeof _g.GeoLeaf?.UI?.getCurrentTheme === "function") {
            return _g.GeoLeaf.UI.getCurrentTheme();
        }
    } catch (err) {
        Log.warn("[GeoLeaf.Core] Error reading theme from GeoLeaf.UI:", err);
    }

    return _readThemeFromBody();
}
