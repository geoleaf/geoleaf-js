/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Taxonomy capability — category resolution.
 *
 * Pure, side-effect-free resolution from the `modules.taxonomy` config:
 * - per-layer binding (which taxonomy + which columns),
 * - case-insensitive category / sub-category lookup,
 * - the two icon resolutions, which live in DIFFERENT id-spaces (see below).
 *
 * ⚠ **Two id-spaces, and mixing them up is silent.**
 * - {@link resolvePoiIcon} feeds `icon-image` → the MapLibre ATLAS. Its `symbolId`
 *   carries the `--<tint>` suffix, because a tinted glyph is a distinct image.
 * - {@link resolveTitleIcon} feeds `<use href="#…">` → the DOM `<symbol>` of the
 *   injected sprite. It must stay RAW: a tinted id points at nothing, and the
 *   glyph silently disappears.
 *
 * Every resolver here honours the `enabled` gate. It is opt-out: only an explicit
 * `false` silences them.
 */
"use strict";

import type {
    TaxonomyConfig,
    TaxonomyDef,
    TaxonomyCategory,
    TaxonomyIconVariant,
    ResolvedIcon,
    TaxonomySurface,
} from "./types.js";
import { resolveIconTint, tintedSymbolId } from "./tint.js";

/** Minimal structural view of a feature/POI as needed for taxonomy resolution. */
export interface TaxonomyFeatureLike {
    /** GeoLeaf layer id the feature belongs to (preferred). */
    layerId?: string;
    /** Legacy POI layer-config carrier (`_layerConfig.id`). */
    _layerConfig?: { id?: string } | null;
    /** GeoLeaf attributes bag. */
    attributes?: Record<string, unknown> | null;
    /** GeoJSON properties bag. */
    properties?: Record<string, unknown> | null;
    [key: string]: unknown;
}

/** A layer's effective binding: its taxonomy + the fields to read. */
interface ResolvedBinding {
    def: TaxonomyDef;
    categoryField: string;
    subCategoryField?: string;
}

/** A feature resolved against its layer's taxonomy. */
interface ResolvedEntry {
    binding: ResolvedBinding;
    category: TaxonomyCategory | null;
    sub: TaxonomyCategory | null;
}

/** Returns the first argument that is a non-empty string, else `null`. */
function firstString(...vals: unknown[]): string | null {
    for (const v of vals) if (typeof v === "string" && v.length > 0) return v;
    return null;
}

/**
 * Reads a feature property by name, checking the top-level object, then
 * `attributes`, then `properties` (the three shapes GeoLeaf features carry).
 */
function readField(feature: TaxonomyFeatureLike, field: string): unknown {
    const top = feature[field];
    if (top !== undefined && top !== null) return top;
    const a = feature.attributes;
    if (a && a[field] !== undefined && a[field] !== null) return a[field];
    const p = feature.properties;
    if (p && p[field] !== undefined && p[field] !== null) return p[field];
    return undefined;
}

/**
 * Case-insensitive lookup of a value in a category table. Tries the exact key,
 * then upper/lower variants, then a full case-folded scan — matching the legacy
 * core taxonomy resolution so migrated profiles behave identically.
 */
export function resolveCategoryKey(
    categories: Record<string, TaxonomyCategory>,
    value: unknown
): string | null {
    if (value === undefined || value === null) return null;
    const key = String(value);
    if (Object.prototype.hasOwnProperty.call(categories, key)) return key;
    const upper = key.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(categories, upper)) return upper;
    const lower = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(categories, lower)) return lower;
    return Object.keys(categories).find((k) => k.toLowerCase() === lower) ?? null;
}

/**
 * Resolves a layer's effective taxonomy binding. Returns `null` when the layer
 * has no binding, references an unknown taxonomy, or resolves no `categoryField`
 * (the field is mandatory — there is no implicit `categoryId` fallback).
 */
export function resolveLayerBinding(
    config: TaxonomyConfig,
    layerId: string
): ResolvedBinding | null {
    const binding = config.layers?.[layerId];
    if (!binding) return null;
    const def = config.taxonomies?.[binding.use];
    if (!def) return null;
    const categoryField = binding.categoryField ?? def.categoryField;
    if (!categoryField) return null;
    const subCategoryField = binding.subCategoryField ?? def.subCategoryField;
    return { def, categoryField, ...(subCategoryField !== undefined && { subCategoryField }) };
}

/**
 * Resolves the category (and matching sub-category) entries for given values.
 */
export function resolveCategoryEntry(
    def: TaxonomyDef,
    categoryValue: unknown,
    subCategoryValue: unknown
): { category: TaxonomyCategory | null; sub: TaxonomyCategory | null } {
    const catKey = resolveCategoryKey(def.categories, categoryValue);
    const category = catKey ? (def.categories[catKey] ?? null) : null;
    let sub: TaxonomyCategory | null = null;
    if (category?.subcategories && subCategoryValue !== undefined && subCategoryValue !== null) {
        const subKey = resolveCategoryKey(category.subcategories, subCategoryValue);
        sub = subKey ? (category.subcategories[subKey] ?? null) : null;
    }
    return { category, sub };
}

/**
 * Resolves a feature against its layer's taxonomy: the binding, plus the category
 * and sub-category entries its column values land on.
 *
 * The single entry point behind `resolvePoiIcon`, `resolveTitleIcon` and the badge
 * resolver — they differ only in what they do with the result.
 *
 * @param config - Resolved taxonomy configuration; a disabled one yields `null`.
 * @param layerId - GeoLeaf layer id, or `null` to read it off the feature.
 * @param feature - The feature whose taxonomy entry is resolved.
 * @returns `null` when taxonomy is disabled, the layer id is unknown, or the layer
 *   is not bound to any taxonomy.
 */
export function resolveFeatureEntry(
    config: TaxonomyConfig,
    layerId: string | null,
    feature: TaxonomyFeatureLike
): ResolvedEntry | null {
    if (config.enabled === false) return null;

    const id =
        layerId ??
        (typeof feature.layerId === "string"
            ? feature.layerId
            : typeof feature._layerConfig?.id === "string"
              ? feature._layerConfig.id
              : null);
    if (!id) return null;

    const binding = resolveLayerBinding(config, id);
    if (!binding) return null;

    const catValue = readField(feature, binding.categoryField);
    const subValue = binding.subCategoryField
        ? readField(feature, binding.subCategoryField)
        : undefined;
    const { category, sub } = resolveCategoryEntry(binding.def, catValue, subValue);

    return { binding, category, sub };
}

/**
 * Resolves the icon a POI point should display on the MAP.
 *
 * Priority: sub-category `svgId` → category `svgId` → `icons.defaultIcon`.
 * The returned `symbolId` lives in the MapLibre ATLAS id-space — it carries a
 * `--<tint>` suffix when an `iconColor` is resolved, and none when it is not
 * (the invariant that keeps existing profiles byte-identical).
 *
 * Returns `{ useIcon: false, … }` when taxonomy is disabled, the layer is unbound,
 * or no icon resolves — the renderer then falls back to a plain marker.
 */
export function resolvePoiIcon(config: TaxonomyConfig, feature: TaxonomyFeatureLike): ResolvedIcon {
    const none: ResolvedIcon = { useIcon: false, iconId: null, symbolId: null };

    const entry = resolveFeatureEntry(config, null, feature);
    if (!entry) return none;

    const { category, sub } = entry;
    const iconId = firstString(sub?.svgId, category?.svgId, config.icons?.defaultIcon);
    if (!iconId) return none;

    const prefix = config.icons?.symbolPrefix ?? "";
    const tint = resolveIconTint(category, sub);
    return { useIcon: true, iconId, symbolId: tintedSymbolId(prefix + iconId, tint) };
}

/**
 * Resolves the sprite `symbolId` of the icon to show next to a feature's TITLE on
 * a feature-info surface (popup / tooltip / side-panel).
 *
 * Priority (like `resolvePoiIcon`): sub-category `svgId` (only if
 * `render[surface].showIconSubcategory`) → category `svgId` (only if
 * `render[surface].showIconCategory`) → `icons.defaultIcon` (if either flag is on).
 *
 * ⚠ Returns the RAW, untinted id — feature-info feeds it to `<use href="#…">`,
 * which resolves against the `<symbol>` elements of the injected sprite, not
 * against the MapLibre atlas. A tinted id here would point at nothing. The glyph
 * takes its colour from `currentColor` instead.
 *
 * Returns `null` when taxonomy is disabled, the layer is unbound, no flag is on for
 * the surface, or no icon resolves.
 */
export function resolveTitleIcon(
    config: TaxonomyConfig,
    layerId: string,
    feature: TaxonomyFeatureLike,
    surface: TaxonomySurface
): string | null {
    const flags = config.render?.[surface];
    if (!flags || (flags.showIconCategory !== true && flags.showIconSubcategory !== true)) {
        return null;
    }

    const entry = resolveFeatureEntry(config, layerId, feature);
    if (!entry) return null;

    const { category, sub } = entry;
    const subIcon = flags.showIconSubcategory === true ? sub?.svgId : null;
    const catIcon = flags.showIconCategory === true ? category?.svgId : null;
    const svgId = firstString(subIcon, catIcon, config.icons?.defaultIcon);
    if (!svgId) return null;
    return (config.icons?.symbolPrefix ?? "") + svgId;
}

/**
 * Enumerates every (icon × tint) pair the config actually references, so the
 * MapLibre adapter can rasterise and register exactly those images.
 *
 * Only pairs a feature could really resolve to — never the cartesian product of
 * every symbol by every colour. Entries with no `iconColor` are omitted: they need
 * no variant, since the untinted image is already registered by the raw sprite pass.
 */
export function resolveIconVariants(config: TaxonomyConfig): TaxonomyIconVariant[] {
    if (config.enabled === false) return [];

    const prefix = config.icons?.symbolPrefix ?? "";
    const variants = new Map<string, TaxonomyIconVariant>();

    const add = (svgId: string | undefined, color: string | null): void => {
        if (!svgId || !color) return;
        const symbolId = tintedSymbolId(prefix + svgId, color);
        if (symbolId === prefix + svgId) return; // tint produced no key — nothing to register
        if (!variants.has(symbolId)) variants.set(symbolId, { svgId, symbolId, color });
    };

    for (const def of Object.values(config.taxonomies ?? {})) {
        for (const cat of Object.values(def.categories ?? {})) {
            const catTint = resolveIconTint(cat, null);
            add(cat.svgId ?? config.icons?.defaultIcon, catTint);

            for (const sub of Object.values(cat.subcategories ?? {})) {
                const subTint = resolveIconTint(cat, sub);
                add(sub.svgId ?? cat.svgId ?? config.icons?.defaultIcon, subTint);
            }
        }
    }

    return Array.from(variants.values());
}
