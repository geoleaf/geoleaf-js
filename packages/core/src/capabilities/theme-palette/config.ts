/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-palette capability — config reader.
 *
 * Reads `modules.theme-palette.*` from the core Config singleton and merges it over the
 * built-in defaults (the three shipped palettes). Opt-in: the selector BUTTON stays
 * inert unless `enabled` is `true`, but the configured `default` palette applies either
 * way — an integrator who fixes a brand colour offers no choice at all.
 */
"use strict";

import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** One offered palette. */
export interface PaletteEntry {
    /** Palette id — `"default"` means "no attribute", i.e. the kernel tokens as-is. */
    id: string;
    /** Human-readable name shown in the popover. */
    label: string;
    /** Colour of the swatch dot. */
    swatch: string;
}

/**
 * The palettes shipped with the core.
 *
 * `default` carries NO stylesheet on purpose: it is the absence of the attribute, i.e.
 * `geoleaf-theme.css` untouched. Defining it explicitly would duplicate the kernel
 * tokens and drift from them at the first change.
 */
const BUILT_IN_PALETTES: readonly PaletteEntry[] = [
    { id: "default", label: "Orange", swatch: "#f97316" },
    { id: "green", label: "Vert", swatch: "#16a34a" },
    { id: "blue", label: "Bleu", swatch: "#2563eb" },
];

/** The `modules.theme-palette` capability config block. */
export interface ThemePaletteCapabilityConfig {
    /** Capability gate — the BUTTON is inert unless `true`. Opt-in (default OFF). */
    enabled: boolean;
    /** Palette applied absent a stored choice; also the fixed one when `enabled` is false. */
    default: string;
    /** Offered palettes; empty means the three built-ins. */
    palettes: PaletteEntry[];
}

/** Built-in defaults. `enabled` is `false` — the selector is opt-in. */
const DEFAULTS: ThemePaletteCapabilityConfig = {
    enabled: false,
    default: "default",
    palettes: [],
};

/** Reads `modules.theme-palette.*` merged over the built-in defaults. */
export function getThemePaletteConfig(): ThemePaletteCapabilityConfig {
    const raw =
        _Config.get?.<Partial<ThemePaletteCapabilityConfig>>("modules.theme-palette", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}

/**
 * Returns the palettes to offer: the configured list when it is usable, the built-ins
 * otherwise.
 *
 * Malformed entries are dropped rather than surfaced — an entry without an id would
 * render a swatch that switches to nothing.
 */
export function getPalettes(): PaletteEntry[] {
    const { palettes } = getThemePaletteConfig();
    if (!Array.isArray(palettes) || palettes.length === 0) return [...BUILT_IN_PALETTES];
    const kept = palettes.filter(
        (p): p is PaletteEntry => !!p && typeof p === "object" && typeof p.id === "string" && !!p.id
    );
    return kept.length > 0 ? kept : [...BUILT_IN_PALETTES];
}
