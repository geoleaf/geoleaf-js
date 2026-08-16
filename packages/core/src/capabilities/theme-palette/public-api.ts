/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-palette capability — public API surface.
 * Mounted on `GeoLeaf.ThemePalette` via `api/geoleaf.theme-palette.ts`.
 */

import {
    getPalettes,
    getThemePaletteConfig,
    type PaletteEntry,
    type ThemePaletteCapabilityConfig,
} from "./config.js";
import { applyPalette, getPalette } from "./palette-engine.js";

/** The object mounted on `GeoLeaf.ThemePalette`. */
export interface ThemePalettePublicApi {
    /** Palettes offered by the selector. */
    list(): PaletteEntry[];
    /** Currently applied palette id. */
    get(): string;
    /** Applies a palette immediately (no reload) and persists it. */
    set(id: string): void;
    /** `true` when the selector button is enabled. */
    isEnabled(): boolean;
    /** The resolved `modules.theme-palette` config. */
    getConfig(): ThemePaletteCapabilityConfig;
}

/** Builds the object mounted on `GeoLeaf.ThemePalette`. */
export function buildPublicApi(): ThemePalettePublicApi {
    return {
        list: (): PaletteEntry[] => getPalettes(),
        get: (): string => getPalette(),
        set: (id: string): void => applyPalette(id),
        isEnabled: (): boolean => getThemePaletteConfig().enabled === true,
        getConfig: (): ThemePaletteCapabilityConfig => getThemePaletteConfig(),
    };
}
