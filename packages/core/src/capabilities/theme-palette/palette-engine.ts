/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-palette capability — the engine.
 *
 * Applying a palette is a single attribute write on `<html>`: the stylesheets are
 * already in the bundle (they enter through the JS module graph, via `install.ts`), so
 * NO network round-trip sits between the write and the repaint. That is what makes this
 * the only one of the three selector capabilities that switches **without reloading**.
 */
"use strict";

import { Log } from "../../utils/log/index.js";
import { getPalettes, getThemePaletteConfig } from "./config.js";

/** localStorage key holding the user's standing palette choice. */
export const PALETTE_STORAGE_KEY = "gl-palette";

/** The palette that means "kernel tokens as-is" — represented by the ABSENCE of the attribute. */
const DEFAULT_PALETTE_ID = "default";

/** Event emitted after a palette change, for consumers that mirror the accent. */
const PALETTE_CHANGED_EVENT = "geoleaf:palette-changed";

/** Reads the stored palette id, or `null`. Never throws (private browsing). */
function _readStored(): string | null {
    try {
        return localStorage.getItem(PALETTE_STORAGE_KEY) || null;
    } catch {
        return null;
    }
}

/**
 * Resolves the palette to apply at boot: stored choice → configured default →
 * `"default"`. An unknown id falls back rather than leaving the UI on a palette with no
 * stylesheet.
 */
export function resolveInitialPalette(): string {
    const known = new Set(getPalettes().map((p) => p.id));
    const stored = _readStored();
    if (stored && known.has(stored)) return stored;
    const configured = getThemePaletteConfig().default;
    if (configured && known.has(configured)) return configured;
    return DEFAULT_PALETTE_ID;
}

/** Returns the currently applied palette id. */
export function getPalette(): string {
    if (typeof document === "undefined") return DEFAULT_PALETTE_ID;
    return document.documentElement.dataset.glPalette || DEFAULT_PALETTE_ID;
}

/**
 * Applies `id`, persists it and announces the change.
 *
 * @param id - Palette id. `"default"` REMOVES the attribute (the kernel tokens are the
 *             default palette; a `data-gl-palette="default"` block does not exist).
 * @param persist - `false` when applying the boot-resolved value, so reading a stored
 *                  preference does not immediately rewrite it.
 */
export function applyPalette(id: string, persist = true): void {
    if (typeof document === "undefined") return;

    const known = new Set(getPalettes().map((p) => p.id));
    if (!known.has(id)) {
        Log?.warn?.("[ThemePalette] Unknown palette, ignored:", id);
        return;
    }

    const root = document.documentElement;
    if (id === DEFAULT_PALETTE_ID) delete root.dataset.glPalette;
    else root.dataset.glPalette = id;

    if (persist) {
        try {
            localStorage.setItem(PALETTE_STORAGE_KEY, id);
        } catch (e) {
            // Private browsing: the palette applies to this session, it is just not kept.
            Log?.warn?.("[ThemePalette] Unable to persist palette choice:", e);
        }
    }

    try {
        document.dispatchEvent(new CustomEvent(PALETTE_CHANGED_EVENT, { detail: { palette: id } }));
    } catch {
        // A missing CustomEvent constructor must not break the palette switch itself.
    }
}
