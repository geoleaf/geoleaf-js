/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Taxonomy capability — icon tinting.
 *
 * MapLibre cannot recolour an arbitrary sprite: `icon-color` only affects SDF
 * images. But GeoLeaf does not use a MapLibre sprite at all — it rasterises each
 * `<symbol>` itself onto a canvas and pushes it with `map.addImage()`, baking
 * `currentColor` to white. So the cheapest recolouring is to rasterise ONCE PER
 * TINT and register one image per (icon × tint) pair. No SDF, no extra layer, and
 * multi-colour sprites keep their explicit fills (only `currentColor` is tinted).
 *
 * The tint becomes part of the image id:
 *
 *     symbolPrefix + svgId                 ← no icon colour declared
 *     symbolPrefix + svgId + "--" + key    ← an icon colour resolved
 *
 * **Invariant — no tint, no suffix.** Profiles that declare no icon colour keep
 * byte-identical symbol ids, so nothing about their rendering shifts. Breaking
 * this makes `icon-image` point at ids that were never registered, and the icons
 * vanish from the map without a single test going red.
 *
 * ⚠ This id-space is the MapLibre ATLAS one. The DOM id-space (`<use href="#…">`,
 * used by feature-info) is separate and always RAW — see `resolveTitleIcon`.
 */
"use strict";

import type { TaxonomyCategory } from "./types.js";

/** Separator between a symbol id and its tint key. */
const TINT_SEPARATOR = "--";

/**
 * Resolves the glyph tint for a feature: sub-category first, then category.
 * Returns `null` when neither declares one — the raster then falls back to white,
 * which is what the pipeline has always produced.
 *
 * @param category - The resolved category entry, if any.
 * @param sub - The resolved sub-category entry, if any.
 */
export function resolveIconTint(
    category: TaxonomyCategory | null,
    sub: TaxonomyCategory | null
): string | null {
    const tint = sub?.iconColor ?? category?.iconColor;
    return typeof tint === "string" && tint.length > 0 ? tint : null;
}

/**
 * Turns a CSS colour into a key safe for a MapLibre image id.
 *
 * Runs of non-alphanumeric characters collapse to a single `-`, so the key can
 * never itself contain the `--` separator: `#6A1B9A` → `6a1b9a`,
 * `rgb(255, 0, 0)` → `rgb-255-0-0`. Collapsing runs (rather than stripping them)
 * keeps distinct colours distinct — stripping would fold `rgb(255,0,0)` and
 * `rgb(25,50,0)` onto the same key.
 *
 * @param color - Any CSS colour string.
 * @returns The id-safe key, or `null` when nothing usable remains.
 */
export function tintKey(color: string): string | null {
    const key = color
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return key.length > 0 ? key : null;
}

/**
 * Appends a tint to a symbol id — or returns it untouched when there is no tint.
 * The single place the "no tint, no suffix" invariant is enforced.
 *
 * @param symbolId - The prefixed symbol id (`symbolPrefix + svgId`).
 * @param tint - The resolved icon colour, or `null`.
 */
export function tintedSymbolId(symbolId: string, tint: string | null): string {
    if (!tint) return symbolId;
    const key = tintKey(tint);
    return key ? symbolId + TINT_SEPARATOR + key : symbolId;
}
