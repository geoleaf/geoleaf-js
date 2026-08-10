/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Module - Theme Management
 * Dark/light theme handling, persisted to localStorage
 */

import { Log } from "../../utils/log/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";

// ========================================
//   CONSTANTES
// ========================================

const THEME_KEY = "geoleaf_theme";
const THEME_LIGHT = "light";
const THEME_DARK = "dark";

// ========================================
//   STATE INTERNE
// ========================================

/**
 * Single source of truth for the current theme
 * @type {string|null}
 * @private
 */
let _currentTheme: string | null = null;

/** Cleanup function for the active matchMedia listener (auto mode only). */
let _matchMediaUnsubscribe: (() => void) | null = null;

// ========================================
//   FONCTIONS PUBLIQUES
// ========================================

/**
 * Returns the theme current ("light" ou "dark").
 * @returns {string} Theme current
 */
function getCurrentTheme() {
    // Si already en memory, returnner directly
    if (_currentTheme) {
        return _currentTheme;
    }

    // Otherwise fall back to the DOM
    if (document.body.classList.contains("gl-theme-dark")) {
        _currentTheme = THEME_DARK;
        return THEME_DARK;
    }
    if (document.body.classList.contains("gl-theme-light")) {
        _currentTheme = THEME_LIGHT;
        return THEME_LIGHT;
    }

    // Fallback final
    _currentTheme = THEME_DARK;
    return THEME_DARK;
}

/**
 * Applies a theme to <body> and syncs the button.
 * @param {string} theme - "light" ou "dark"
 * @param {boolean} [persist=true] - Write to localStorage. Pass false for auto-detect (system preference).
 */
function applyTheme(theme: string, persist: boolean = true) {
    const normalized = theme === THEME_LIGHT || theme === THEME_DARK ? theme : THEME_DARK;

    Log.debug(
        "[UI.Theme] applyTheme:",
        theme,
        "→",
        normalized,
        persist ? "(persisted)" : "(no-persist)"
    );

    // Update the centralized state BEFORE the DOM
    _currentTheme = normalized;

    // DOM update on body
    document.body.classList.remove("gl-theme-light", "gl-theme-dark");
    document.body.classList.add(normalized === THEME_DARK ? "gl-theme-dark" : "gl-theme-light");

    // Apply the theme to the map container too (needed in fullscreen)
    const mapContainer = document.getElementById("geoleaf-map");
    if (mapContainer) {
        mapContainer.classList.remove("gl-theme-light", "gl-theme-dark");
        mapContainer.classList.add(normalized === THEME_DARK ? "gl-theme-dark" : "gl-theme-light");
    }

    // Local persistence (only when persist was requested)
    if (persist) {
        try {
            localStorage.setItem(THEME_KEY, normalized);
        } catch (_e) {
            // Handle explicitement l'absence de localStorage
            if (Log) Log.warn("[UI.Theme] localStorage not available, theme not persisted.");
        }
    }

    // Sync the button when present
    updateToggleButton(normalized);

    // Global event for other modules
    if (globalThis.dispatchEvent) {
        globalThis.dispatchEvent(
            new CustomEvent("geoleaf:ui-theme-changed", {
                detail: { theme: normalized },
            })
        );
    }
}

// ========================================
//   AUTO-THEME (prefers-color-scheme)
// ========================================

/**
 * Reads the OS/browser color scheme preference.
 * @returns {string} "dark" or "light"
 * @private
 */
function _detectSystemTheme(): string {
    try {
        const mm =
            typeof globalThis !== "undefined" &&
            typeof (globalThis as unknown as Window).matchMedia === "function"
                ? (globalThis as unknown as Window).matchMedia
                : null;
        if (mm?.("(prefers-color-scheme: dark)")?.matches) {
            return THEME_DARK;
        }
    } catch (_e) {
        // matchMedia not available (e.g. SSR or old browser) — fall through
    }
    return THEME_LIGHT;
}

/**
 * Registers a matchMedia listener that tracks OS theme changes in auto mode.
 * The listener is a no-op when the user has set a manual override in localStorage.
 * @private
 */
function _setupMatchMediaListener() {
    // Remove any existing listener before registering a new one
    if (_matchMediaUnsubscribe) {
        _matchMediaUnsubscribe();
        _matchMediaUnsubscribe = null;
    }

    const mm =
        typeof globalThis !== "undefined" &&
        typeof (globalThis as unknown as Window).matchMedia === "function"
            ? (globalThis as unknown as Window).matchMedia
            : null;
    if (!mm) return;

    const mq = mm("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
        // Skip if the user has manually overridden the theme
        let override: string | null = null;
        try {
            override = localStorage.getItem(THEME_KEY);
        } catch (_e) {
            /* ignore */
        }
        if (override === THEME_LIGHT || override === THEME_DARK) {
            Log.debug("[UI.Theme] matchMedia change ignored — user override:", override);
            return;
        }
        Log.debug("[UI.Theme] matchMedia change →", e.matches ? THEME_DARK : THEME_LIGHT);
        applyTheme(e.matches ? THEME_DARK : THEME_LIGHT, false);
    };

    mq.addEventListener("change", handler);
    _matchMediaUnsubscribe = () => mq.removeEventListener("change", handler);
}

/**
 * Initialises the theme according to the profile config value.
 *
 * Precedence, highest first: **stored user choice** → profile `ui.theme` → system
 * `prefers-color-scheme`. None of these paths writes to `localStorage`.
 *
 * ⚠️ **The boot applies a theme, it never chooses one** (backlog B.18). Only an explicit
 * user action — `toggleTheme()` / `applyTheme(x)` — persists. Two boot paths used to
 * persist: the explicit-profile branch here (documented as "persisted") and
 * `initThemeToggle` below. Together they rewrote `geoleaf_theme` on every load, so the
 * user's stored choice was overwritten by the profile's theme and **no chosen theme
 * survived a reload**. The stored choice is now read FIRST, whatever `ui.theme` says.
 *
 * Must be called **before** `initThemeToggle` so the resolved theme is already on the
 * DOM when the toggle button syncs its visual state.
 *
 * @param {string} [themeConfig="auto"] - Value from profile `ui.theme`
 */
function initAutoTheme(themeConfig: string = "auto") {
    const cfg = (themeConfig || "auto").trim().toLowerCase();

    // A stored choice outranks the profile: it is the only value a user actually picked.
    let userOverride: string | null;
    try {
        userOverride = localStorage.getItem(THEME_KEY);
    } catch (_e) {
        userOverride = null;
    }

    if (userOverride === THEME_LIGHT || userOverride === THEME_DARK) {
        Log.debug("[UI.Theme] initAutoTheme: user override →", userOverride);
        applyTheme(userOverride, false);
        // Register the live listener only in auto mode: in explicit mode the profile,
        // not the OS, is the fallback once the override is cleared.
        if (cfg === "auto") _setupMatchMediaListener();
        return;
    }

    if (cfg !== "auto") {
        // Explicit theme from the profile — applied, NOT persisted.
        const normalized = cfg === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
        Log.debug("[UI.Theme] initAutoTheme: explicit theme →", normalized);
        applyTheme(normalized, false);
        return;
    }

    // No override — detect and apply system preference without persisting
    const detected = _detectSystemTheme();
    Log.debug("[UI.Theme] initAutoTheme: system detected →", detected);
    applyTheme(detected, false);
    _setupMatchMediaListener();
}

/**
 * Switches the theme current (light <-> dark).
 */
function toggleTheme() {
    const current = getCurrentTheme();
    const next = current === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    Log.debug("[UI.Theme] toggleTheme:", current, "→", next);
    applyTheme(next);
}

/**
 * Determines the theme initial :
 * 1) localStorage when available
 * 2) the <body> class when already set
 * 3) sinon, "dark"
 * @returns {string} Theme initial
 * @private
 */
function resolveInitialTheme() {
    let stored: string | null;

    try {
        stored = localStorage.getItem(THEME_KEY);
    } catch (_e) {
        stored = null;
    }

    if (stored === THEME_LIGHT || stored === THEME_DARK) {
        return stored;
    }

    const bodyTheme = getCurrentTheme();
    if (bodyTheme === THEME_LIGHT || bodyTheme === THEME_DARK) {
        return bodyTheme;
    }

    return THEME_DARK;
}

/**
 * Retrieves the button de theme in the DOM.
 * Par convention on utilise l'attribut data-gl-role="theme-toggle".
 * @returns {HTMLElement|null}
 * @private
 */
function getToggleButton() {
    return document.querySelector('[data-gl-role="theme-toggle"]');
}

/**
 * Updates the theme button's visual/ARIA state.
 * @param {string} theme - "light" ou "dark"
 * @param overrideBtn - Button to update instead of the one resolved from the DOM. Used at
 *   boot, when the toggle exists but is not yet reachable by its role selector.
 * @private
 */
function updateToggleButton(theme: string, overrideBtn?: Element | null) {
    const btn = overrideBtn === undefined ? getToggleButton() : overrideBtn;
    if (!btn) return;

    const isDark = theme === THEME_DARK;

    btn.setAttribute("data-gl-theme-state", isDark ? "dark" : "light");
    btn.setAttribute("aria-pressed", String(isDark));
    btn.setAttribute(
        "aria-label",
        isDark ? getLabel("aria.theme.toggle_to_light") : getLabel("aria.theme.toggle_to_dark")
    );
    (btn as HTMLElement).title = isDark
        ? getLabel("aria.theme.toggle_to_light")
        : getLabel("aria.theme.toggle_to_dark");
}

/**
 * Initializes theme button handling.
 * @param {object} [options] - Options de configuration
 * @param {string} [options.buttonSelector] - Custom button selector
 * @param {boolean} [options.autoInitOnDomReady] - Si true, attend DOMContentLoaded
 */
function initThemeToggle(options: { buttonSelector?: string; autoInitOnDomReady?: boolean } = {}) {
    const cfg = {
        buttonSelector: options.buttonSelector || '[data-gl-role="theme-toggle"]',
        autoInitOnDomReady:
            typeof options.autoInitOnDomReady === "boolean" ? options.autoInitOnDomReady : false,
    };

    const doInit = () => {
        const initialTheme = resolveInitialTheme();
        Log.debug("[UI.Theme] initThemeToggle:", initialTheme);
        // NOT persisted (B.18): `resolveInitialTheme()` returns a stored value — where
        // re-writing it is a no-op — or a FALLBACK, where writing it would record a
        // choice the user never made. Only `toggleTheme()` persists.
        applyTheme(initialTheme, false);

        const btn = document.querySelector(cfg.buttonSelector);
        if (!btn) {
            Log.debug("[UI.Theme] Theme button not found:", cfg.buttonSelector);
            return;
        }

        Log.debug("[UI.Theme] Theme button found");

        // Accessibility: native <button> or role "button"
        const tag = (btn.tagName || "").toLowerCase();
        if (tag === "button") {
            try {
                (btn as HTMLButtonElement).type = (btn as HTMLButtonElement).type || "button";
            } catch (_e) {
                // Some custom elements may throw
            }
        } else {
            btn.setAttribute("role", "button");
            btn.setAttribute("tabindex", "0");
        }

        // First sync of visual state
        updateToggleButton(initialTheme, btn);

        // Click souris
        btn.addEventListener("click", (evt: Event) => {
            evt.preventDefault();
            toggleTheme();
        });

        // Clavier (Enter / Space)
        (btn as HTMLElement).addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter" || evt.key === " " || evt.key === "Spacebar") {
                evt.preventDefault();
                toggleTheme();
            }
        });
    };
    if (cfg.autoInitOnDomReady) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", doInit, { once: true });
        } else {
            doInit();
        }
    } else {
        doInit();
    }
}

// ========================================
//   EXPORT
// ========================================

const _UITheme = {
    initThemeToggle,
    initAutoTheme,
    toggleTheme,
    applyTheme,
    getCurrentTheme,
    // Exposed constants
    THEME_LIGHT,
    THEME_DARK,
};

// ── ESM Export ──
export { _UITheme };
