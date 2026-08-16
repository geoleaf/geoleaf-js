/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Module Theme Selector — Orchestrator
 * Global theme selector (primary + secondary)
 *
 * DEPENDENCIES:
 * - Native DOM events
 * - GeoLeaf.Log (optional)
 * - `ThemeLoader` / `ThemeApplierCore` — ESM imports through the `kernel/themes/` barrel.
 *   ⚠️ NOT namespace keys: `GeoLeaf._ThemeLoader` and `GeoLeaf._ThemeApplier` were removed at
 *   API S4.3 (see `globals/globals.ui.ts`, the B7 block). This header announced them for a
 *   month after the fact — no gate reads a `DEPENDENCIES:` block, so nothing contradicted it.
 * - `Config` (`kernel/config/config-primitives.js`), ESM too — and only its `ui` block, through
 *   the `ConfigLike` narrowing below.
 *   ⚠️ This header also claimed `GeoLeaf.Core.getActiveProfile()`, which is false TWICE: `Core`
 *   has no such member, and **this file makes no such call at all**. The profile id is read by
 *   `./lifecycle.ts`, off `GeoLeaf.Config.getActiveProfileId()`.
 *
 * EXPOSE:
 * - GeoLeaf.ThemeSelector
 *
 * @public
 */

import { Log } from "../../utils/log/index.js";
import { Config } from "../../kernel/config/config-primitives.js";
import { ThemeApplierCore, ThemeLoader, type ThemeConfig } from "../../kernel/themes/index.js";
import { _state, type ThemeEntry, type ThemeSelectorConfig } from "./theme-selector-state.js";
import { createPrimaryUI, updateUIStatePrimary } from "./theme-selector-primary.js";
import { createSecondaryUI, updateUIStateSecondary } from "./theme-selector-secondary.js";

/** Options accepted by `ThemeSelector.init`. */
interface ThemeSelectorInitOptions {
    profileId: string;
    primaryContainer?: HTMLElement | null;
    secondaryContainer?: HTMLElement | null;
}

/** Validated themes config returned by `ThemeLoader.loadThemesConfig`. */
interface LoadedThemesConfig {
    config: ThemeSelectorConfig;
    themes: ThemeEntry[];
    defaultTheme: string | null;
}

/** Subset of `Config` consumed by the selector (`ui` block read only). */
interface ConfigLike {
    get?(key: string): unknown;
}
const _Config = Config as ConfigLike;

/**
 * Module Theme Selector
 * @namespace ThemeSelector
 * @public
 */
const ThemeSelector = {
    /**
     * Initializes the theme selector
     * @param {Object} options - Initialization options
     * @param {string} options.profileId - ID of the profile
     * @param {HTMLElement} [options.primaryContainer] - Container for the primary buttons
     * @param {HTMLElement} [options.secondaryContainer] - Container for the secondary dropdown
     * @returns {Promise<void>}
     */
    init(options: ThemeSelectorInitOptions) {
        if (!options || !options.profileId) {
            return Promise.reject(new Error("profileId required for ThemeSelector.init"));
        }

        if (Log) Log.debug("[ThemeSelector] Initializing for profile:", options.profileId);

        _state.profileId = options.profileId;
        _state.primaryContainer = options.primaryContainer || null;
        _state.secondaryContainer = options.secondaryContainer || null;

        // Load the themes configuration
        return ThemeLoader.loadThemesConfig(options.profileId)
            .then((themesConfig: LoadedThemesConfig) => {
                _state.config = themesConfig.config;
                _state.themes = themesConfig.themes;
                _state.primaryThemes = themesConfig.themes.filter((t) => t.type === "primary");
                _state.secondaryThemes = themesConfig.themes.filter((t) => t.type === "secondary");
                _state.currentTheme = themesConfig.defaultTheme;

                if (Log)
                    Log.debug("[ThemeSelector] Configuration loaded:", {
                        total: _state.themes.length,
                        primary: _state.primaryThemes.length,
                        secondary: _state.secondaryThemes.length,
                    });

                // Create the UI
                this._createUI();

                // Mark as initialized BEFORE reflecting the theme
                _state.initialized = true;

                // F2 (S8): the DEFAULT theme is applied by ThemeEngineModule (kernel),
                // decoupled from this selector UI. Here we only REFLECT the active theme
                // in the switch UI (no apply) — `setTheme` stays for user-driven switches.
                if (_state.currentTheme) this._updateUIState(_state.currentTheme);
            })
            .then(() => {
                if (Log) Log.debug("[ThemeSelector] Initialization complete");
                // Emit the theme loading completion event
                const event = new CustomEvent("geoleaf:themes:ready", {
                    detail: { time: Date.now() },
                });
                document.dispatchEvent(event);
            })
            .catch((err) => {
                if (Log) Log.warn("[ThemeSelector] Initialization error:", (err as Error).message);
                // Emit event even in case of error
                const event = new CustomEvent("geoleaf:themes:ready", {
                    detail: { time: Date.now(), error: (err as Error).message },
                });
                document.dispatchEvent(event);
                throw err;
            });
    },

    /**
     * Creates the user interface
     * @private
     */
    _createUI() {
        // Late render gate on the MERGED config — opt-in (=== true): the profile's
        // modules.theme-selector.enabled is present here (loadActiveProfileResources has run),
        // keeping the double layer with the opt-out boot gate. Migrated from ui.showThemeSelector (S8/F3).
        const modulesCfg = (_Config?.get?.("modules") ?? null) as {
            "theme-selector"?: { enabled?: boolean };
        } | null;
        const enabled = modulesCfg?.["theme-selector"]?.enabled === true;

        if (!enabled) {
            if (Log)
                Log.debug(
                    "[ThemeSelector] modules.theme-selector.enabled not true, UI not created"
                );
            return;
        }

        // Create the primary themes UI
        if (_state.config!.primaryThemes.enabled && _state.primaryContainer) {
            createPrimaryUI((id: string) => this.setTheme(id));
        }

        // Create the secondary themes UI
        if (_state.config!.secondaryThemes.enabled && _state.secondaryContainer) {
            createSecondaryUI(
                (id: string) => this.setTheme(id),
                () => this.nextTheme(),
                () => this.previousTheme()
            );
        }
    },

    /**
     * Activates a theme by its ID
     * @param {string} themeId - ID of the theme
     * @returns {Promise<void>}
     */
    setTheme(themeId: string | null): Promise<void> {
        if (!_state.initialized) {
            return Promise.reject(new Error("ThemeSelector not initialized"));
        }

        const theme = _state.themes.find((t) => t.id === themeId);
        if (!theme) {
            return Promise.reject(new Error(`Theme not found: ${themeId}`));
        }

        if (Log) Log.debug("[ThemeSelector] setTheme:", themeId);

        // Apply the theme
        // `theme` (loader's NormalizedTheme) and the applier's ThemeConfig describe the
        // same entity; their `layers` element types differ (unknown[] vs ThemeLayerConfig[]).
        return ThemeApplierCore.applyTheme(theme as ThemeConfig)
            .then(() => {
                _state.currentTheme = themeId;

                // Update the UI (themeId matched theme.id above → a string)
                this._updateUIState(themeId as string);

                if (Log) Log.debug("[ThemeSelector] Theme activated:", themeId);
            })
            .catch((err: unknown) => {
                if (Log)
                    Log.warn("[ThemeSelector] Theme activation error:", (err as Error).message);
                throw err;
            });
    },

    /**
     * Updates the visual state of the UI after a theme change
     * @param {string} themeId - ID of the active theme
     * @private
     */
    _updateUIState(themeId: string) {
        updateUIStatePrimary(themeId);
        updateUIStateSecondary(themeId);
    },

    /**
     * Activates the next secondary theme
     */
    nextTheme() {
        if (!_state.initialized || _state.secondaryThemes.length === 0) {
            return;
        }

        const currentIsSecondary = _state.secondaryThemes.some((t) => t.id === _state.currentTheme);
        let nextIndex = 0;

        if (currentIsSecondary) {
            const currentIndex = _state.secondaryThemes.findIndex(
                (t) => t.id === _state.currentTheme
            );
            nextIndex = (currentIndex + 1) % _state.secondaryThemes.length;
        }

        const nextTheme = _state.secondaryThemes[nextIndex];
        if (nextTheme) {
            this.setTheme(nextTheme.id).catch((e: unknown) =>
                Log?.error("[ThemeSelector] Failed to apply next theme:", e)
            );
        }
    },

    /**
     * Activates the previous secondary theme
     */
    previousTheme() {
        if (!_state.initialized || _state.secondaryThemes.length === 0) {
            return;
        }

        const currentIsSecondary = _state.secondaryThemes.some((t) => t.id === _state.currentTheme);
        let prevIndex = _state.secondaryThemes.length - 1;

        if (currentIsSecondary) {
            const currentIndex = _state.secondaryThemes.findIndex(
                (t) => t.id === _state.currentTheme
            );
            prevIndex =
                (currentIndex - 1 + _state.secondaryThemes.length) % _state.secondaryThemes.length;
        }

        const prevTheme = _state.secondaryThemes[prevIndex];
        if (prevTheme) {
            this.setTheme(prevTheme.id).catch((e: unknown) =>
                Log?.error("[ThemeSelector] Failed to apply previous theme:", e)
            );
        }
    },

    /**
     * Returns the currently active theme
     * @returns {string|null}
     */
    getCurrentTheme() {
        return _state.currentTheme;
    },

    /**
     * Returns all themes
     * @returns {Array}
     */
    getThemes() {
        return _state.themes;
    },

    /**
     * Returns the primary themes
     * @returns {Array}
     */
    getPrimaryThemes() {
        return _state.primaryThemes;
    },

    /**
     * Returns the secondary themes
     * @returns {Array}
     */
    getSecondaryThemes() {
        return _state.secondaryThemes;
    },

    /**
     * Checks if the module is initialized
     * @returns {boolean}
     */
    isInitialized() {
        return _state.initialized;
    },

    /**
     * Cleanup method for event listeners
     * Call this when destroying the theme selector
     */
    destroy() {
        if (Log) Log.debug("[ThemeSelector] Cleaning up event listeners");

        if (_state._eventCleanups) {
            _state._eventCleanups.forEach((cleanup) => {
                if (typeof cleanup === "function") {
                    cleanup();
                }
            });
            _state._eventCleanups = [];
        }

        // Clear DOM/data references so a destroy → recreate cycle never operates on
        // detached nodes from the previous instance (roadmap cleanup Sprint 3, PA-2).
        _state.profileId = null;
        _state.config = null;
        _state.themes = [];
        _state.primaryThemes = [];
        _state.secondaryThemes = [];
        _state.currentTheme = null;
        _state.primaryContainer = null;
        _state.secondaryContainer = null;
        _state.dropdown = null;
        _state.primaryScrollEl = null;
        _state.primaryScrollNavPrev = null;
        _state.primaryScrollNavNext = null;

        _state.initialized = false;
    },
};

export { ThemeSelector };
