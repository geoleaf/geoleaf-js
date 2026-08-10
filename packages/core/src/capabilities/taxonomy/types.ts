/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Taxonomy capability — public types.
 *
 * Scope (v3): taxonomy owns the POINT SYMBOL and nothing else — the icon, its
 * colour, its marker disc (fill / stroke) and the colour of the category /
 * sub-category pill badges in feature-info. Geometry colour (polygon fill,
 * line stroke, and a point's business colour) belongs to the layer's
 * `styleRules`, as does the point's SIZE (`circle-radius`).
 */
"use strict";

/**
 * The marker disc drawn under a point's icon.
 *
 * Deliberately carries no radius: a marker is declared per CATEGORY, while a
 * single category is bound to several layers whose radii differ — a radius here
 * would flatten them all. Size stays with the layer style.
 */
interface TaxonomyMarker {
    /** Disc fill colour → `circle-color`. */
    fill?: string;
    /** Disc border colour → `circle-stroke-color`. */
    stroke?: string;
    /** Disc border width → `circle-stroke-width`. `0` is a valid, preserved value. */
    strokeWidth?: number;
}

/**
 * A single category entry: maps one column value to its symbol.
 *
 * `marker` is tri-state:
 * - **absent** — taxonomy overrides nothing; the layer style keeps the point.
 * - **an object** — the disc is painted with these colours.
 * - **`false`** — a bare icon: no disc, no border.
 */
export interface TaxonomyCategory {
    /** Sprite symbol id (the `<symbol id>` inside the profile sprite), WITHOUT the prefix. */
    svgId?: string;
    /** Glyph tint. Absent → white (the historical hard-coded raster colour). */
    iconColor?: string;
    /** The marker disc under the icon — see the tri-state note above. */
    marker?: TaxonomyMarker | false;
    /** Human-readable label (consumed by legend/filter). */
    label?: string;
    /** Optional second-level categories keyed by sub-category value. */
    subcategories?: Record<string, TaxonomyCategory>;
}

/**
 * Attribute value → `{ categoryId, subCategoryId }` mapping, grouped by feature
 * field name. Translates a raw source attribute value (e.g. `fclass: "museum"`)
 * to a taxonomy category / sub-category pair, so a legend style rule keyed on the
 * raw attribute can resolve the taxonomy icon. Domain data lives in the profile.
 */
export type TaxonomyFieldMappings = Record<
    string,
    Record<string, { categoryId: string; subCategoryId: string }>
>;

/**
 * A named, reusable taxonomy: the column it reads (`categoryField`, required)
 * plus a direct `value → symbol` table. Referenced by one or more layers.
 */
export interface TaxonomyDef {
    /** Feature property holding the category value (required — explicit binding). */
    categoryField: string;
    /** Optional feature property holding the sub-category value. */
    subCategoryField?: string;
    /** Direct `value → symbol` table. */
    categories: Record<string, TaxonomyCategory>;
    /**
     * Optional raw-value → category/sub-category translation table (grouped by
     * feature field), for legend style rules keyed on a raw source attribute
     * rather than the resolved `categoryField`. Consumed by the legend generator.
     */
    fieldMappings?: TaxonomyFieldMappings;
}

/**
 * Per-layer binding: which named taxonomy a layer uses, with an optional
 * per-layer field override (e.g. a layer keyed on a different column).
 */
interface TaxonomyLayerBinding {
    /** Name of the taxonomy under `taxonomies` to apply to this layer. */
    use: string;
    /** Overrides the taxonomy's `categoryField` for this layer. */
    categoryField?: string;
    /** Overrides the taxonomy's `subCategoryField` for this layer. */
    subCategoryField?: string;
}

/** Sprite / icon config (single source of truth for POI icon rendering). */
export interface TaxonomyIconsConfig {
    /** URL of the profile sprite SVG (relative to the deployment). */
    spriteUrl?: string;
    /**
     * Prefix prepended to `svgId` to form the `<symbol>` id. Do NOT repeat it
     * inside `svgId` — that yields a doubled, non-existent id.
     */
    symbolPrefix?: string;
    /** `svgId` used when a category resolves no icon of its own. */
    defaultIcon?: string;
    /** MapLibre `icon-size` of the symbol sub-layer. Absent → `0.5`. */
    iconSize?: number;
    /**
     * Whether category icons are shown on the map / in the legend. Absent means
     * "on" (the legend's `shouldUseIcons` gate treats `!== false` as enabled).
     */
    showOnMap?: boolean;
}

/** A feature-info render surface that can display taxonomy decorations. */
export type TaxonomySurface = "popup" | "tooltip" | "sidepanel";

/** Per-surface toggles for the category / sub-category decorations. */
interface TaxonomySurfaceRender {
    /** Show the category icon next to the title on this surface. */
    showIconCategory?: boolean;
    /** Show the sub-category icon next to the title on this surface. */
    showIconSubcategory?: boolean;
    /** Colour the category / sub-category pill badges on this surface. */
    colorBadges?: boolean;
}

/**
 * Rendering config for the feature-info surfaces. Each flag defaults to `false`
 * (absent → off), so surfaces stay as they are until a profile opts in. Consumed
 * by the `feature-info` capability through the `GeoLeaf.Taxonomy` seam — taxonomy
 * owns the config + decision, feature-info owns the DOM.
 */
interface TaxonomyRenderConfig {
    /** Click popup surface. */
    popup?: TaxonomySurfaceRender;
    /** Hover tooltip surface. */
    tooltip?: TaxonomySurfaceRender;
    /** Selection side-panel surface. */
    sidepanel?: TaxonomySurfaceRender;
}

/** The full `modules.taxonomy` config block. */
export interface TaxonomyConfig {
    /**
     * Master gate — OPT-OUT: absent means enabled. Only an explicit `false`
     * silences the capability (icons, marker, badges, legend icons, filter).
     */
    enabled: boolean;
    /** Sprite / icon config shared by all taxonomies. */
    icons?: TaxonomyIconsConfig;
    /** Named, reusable taxonomies. */
    taxonomies?: Record<string, TaxonomyDef>;
    /** Per-layer bindings (which layers use which taxonomy). */
    layers?: Record<string, TaxonomyLayerBinding>;
    /** Rendering toggles for the feature-info surfaces. */
    render?: TaxonomyRenderConfig;
}

/**
 * Resolved icon for a single feature, for the MAP.
 *
 * ⚠ `symbolId` lives in the MapLibre ATLAS id-space: it carries a `--<tint>`
 * suffix when a colour is resolved. The DOM id-space (`<use href="#…">`, used by
 * feature-info) is a different one — see `resolveTitleIcon`, which returns the
 * RAW id. Mixing them up makes icons silently vanish from the map.
 */
export interface ResolvedIcon {
    /** Whether an icon should be shown for this feature. */
    useIcon: boolean;
    /** Resolved sprite symbol id (unprefixed, untinted), or `null`. */
    iconId: string | null;
    /** Resolved MapLibre image id (`symbolPrefix + iconId` [+ `--tint`]), or `null`. */
    symbolId: string | null;
}

/** One (icon × tint) pair to register as a MapLibre image. */
export interface TaxonomyIconVariant {
    /** Sprite symbol id, unprefixed — used to find the `<symbol>` in the DOM. */
    svgId: string;
    /** The MapLibre image id to register (prefixed + tint-suffixed). */
    symbolId: string;
    /** The tint to rasterise the glyph with. */
    color: string;
}

/** Validated colours for one category / sub-category pill badge. */
export interface ResolvedBadgeStyle {
    /** Pill background. */
    background: string;
    /** Pill border. */
    border: string;
    /** Pill text colour, picked for contrast against `background`. */
    text: string;
}
