/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

"use strict";

import type { NormalizedTheme, ValidatedThemesConfig } from "../../kernel/themes/index.js";

/**
 * Primary theme threshold beyond which the bar switches to compact mode.
 * Configurable via config.primaryThemes.compactThreshold (Phase 4).
 */
export const PRIMARY_COMPACT_THRESHOLD = 5;

/** A single theme entry as consumed by the selector UI. */
export type ThemeEntry = NormalizedTheme;

/** Theme selector config block (from themes.json `config`). */
export type ThemeSelectorConfig = ValidatedThemesConfig["config"];

/** Shared mutable state shape of the ThemeSelector module. */
interface ThemeSelectorState {
    initialized: boolean;
    profileId: string | null;
    config: ThemeSelectorConfig | null;
    themes: ThemeEntry[];
    primaryThemes: ThemeEntry[];
    secondaryThemes: ThemeEntry[];
    currentTheme: string | null;
    // UI references
    primaryContainer: HTMLElement | null;
    secondaryContainer: HTMLElement | null;
    dropdown: HTMLSelectElement | null;
    // Event listener cleanup tracking
    _eventCleanups: Array<() => void>;
    // Compact mode – DOM references (Phase 4)
    primaryScrollEl: HTMLElement | null;
    primaryScrollNavPrev: HTMLButtonElement | null;
    primaryScrollNavNext: HTMLButtonElement | null;
}

/**
 * Shared state of the module ThemeSelector
 */
export const _state: ThemeSelectorState = {
    initialized: false,
    profileId: null,
    config: null,
    themes: [],
    primaryThemes: [],
    secondaryThemes: [],
    currentTheme: null,
    // UI references
    primaryContainer: null,
    secondaryContainer: null,
    dropdown: null,
    // Event listener cleanup tracking
    _eventCleanups: [],
    // Compact mode – DOM references (Phase 4)
    primaryScrollEl: null,
    primaryScrollNavPrev: null,
    primaryScrollNavNext: null,
};
