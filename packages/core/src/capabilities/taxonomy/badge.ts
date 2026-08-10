/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Taxonomy capability — pill badge colours.
 *
 * Decides the colours of the category / sub-category pill badges that feature-info
 * renders. Taxonomy owns the decision, feature-info owns the DOM.
 *
 * ⚠ **Routed by column name, not by `style`.** A profile's badge fields are not
 * consistently tagged: in `tourism/cultures` the SIDEPANEL badges carry
 * `style: "category"` / `"subcategory"`, but the POPUP badges carry only
 * `field: "properties.categoryId"`. Routing on `style` would silently leave the
 * popup uncoloured. So the field name is compared against the layer binding's own
 * `categoryField` / `subCategoryField` — which taxonomy already knows.
 */
"use strict";

import type {
    ResolvedBadgeStyle,
    TaxonomyCategory,
    TaxonomyConfig,
    TaxonomySurface,
} from "./types.js";
import { resolveFeatureEntry, type TaxonomyFeatureLike } from "./resolver.js";
import { validateColor } from "../../utils/validators/general-validators.js";

/** Text colour on a dark badge. */
const TEXT_ON_DARK = "#ffffff";

/** Text colour on a light badge. */
const TEXT_ON_LIGHT = "#1f2937";

/** Relative-luminance threshold above which a background counts as "light". */
const LIGHT_THRESHOLD = 0.5;

/** Returns the colour if it is a valid CSS colour, else `null`. */
function safeColor(color: unknown): string | null {
    if (typeof color !== "string" || color.length === 0) return null;
    return validateColor(color).valid ? color : null;
}

/**
 * Parses a 3- or 6-digit hex colour into its RGB components.
 * Returns `null` for any other notation — we only need enough to pick a readable
 * text colour, and every shipped palette is hex.
 */
function parseHex(color: string): [number, number, number] | null {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
    if (!hex) return null;
    const full =
        hex.length === 3
            ? hex
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : hex;
    return [
        Number.parseInt(full.slice(0, 2), 16),
        Number.parseInt(full.slice(2, 4), 16),
        Number.parseInt(full.slice(4, 6), 16),
    ];
}

/**
 * Picks a text colour that stays readable on `background`, using WCAG relative
 * luminance. Falls back to white when the background is not hex (we cannot measure
 * it) — the same choice the pills made before this feature existed.
 */
function pickTextColor(background: string): string {
    const rgb = parseHex(background);
    if (!rgb) return TEXT_ON_DARK;

    const [r, g, b] = rgb.map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }) as [number, number, number];

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > LIGHT_THRESHOLD ? TEXT_ON_LIGHT : TEXT_ON_DARK;
}

/** Strips the `properties.` prefix profiles put on badge field names. */
function bareField(field: string): string {
    return field.startsWith("properties.") ? field.slice("properties.".length) : field;
}

/**
 * Resolves the colours of one category / sub-category pill badge.
 *
 * The badge reuses the marker disc's own colours — the pill and the map symbol
 * should read as the same object. A sub-category badge inherits its category's
 * colours when it declares none of its own.
 *
 * @param config - The `modules.taxonomy` config.
 * @param layerId - GeoLeaf layer id.
 * @param feature - Raw feature bag (read for category / sub-category values).
 * @param surface - The feature-info surface being rendered.
 * @param field - The badge field's configured name (e.g. `properties.categoryId`).
 * @returns Validated colours, or `null` when the surface has not opted in, the
 *   field is not a taxonomy column, or no colour resolves.
 */
export function resolveBadgeStyle(
    config: TaxonomyConfig,
    layerId: string,
    feature: TaxonomyFeatureLike,
    surface: TaxonomySurface,
    field: string
): ResolvedBadgeStyle | null {
    if (config.render?.[surface]?.colorBadges !== true) return null;

    const entry = resolveFeatureEntry(config, layerId, feature);
    if (!entry) return null;

    const { binding, category, sub } = entry;
    const name = bareField(field);

    // Which level is this badge showing? Anything that is not one of the layer's
    // taxonomy columns is somebody else's badge — leave it alone.
    let source: TaxonomyCategory | null;
    if (name === binding.categoryField) source = category;
    else if (binding.subCategoryField && name === binding.subCategoryField) source = sub;
    else return null;

    const own = source?.marker;

    // `false` is a deliberate "bare icon": no disc, hence no colours to lend. It is
    // a statement, not an omission, so it does NOT fall back to the category.
    if (own === false) return null;

    // An omission, on the other hand, inherits: a sub-category that declares no
    // marker wears its category's colours, on the map and on the pill alike.
    const parent = category?.marker;
    const marker = own ?? (parent === false ? undefined : parent);
    if (!marker) return null;

    const background = safeColor(marker.fill);
    if (!background) return null;

    const border = safeColor(marker.stroke) ?? background;

    return { background, border, text: pickTextColor(background) };
}
