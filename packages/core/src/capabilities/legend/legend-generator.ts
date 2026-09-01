/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Module Legend Generator
 * Generates legend data from per-layer style files.
 *
 * DEPENDENCIES:
 * - GeoLeaf.Log (optional)
 *
 * EXPOSE:
 * - GeoLeaf._LegendGenerator
 */

import { Log } from "../../utils/log/index.js";
import { compareByOrder } from "../../utils/general/utils-base.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { DEFAULT_FEATURE_COLOR } from "../../utils/constants/constants.js";
// Single source of truth for case-insensitive category/sub-category matching
// (S4 P1). Legend used to carry its own `_findKeyCI`, which could drift from the
// taxonomy resolver — two matchers for one taxonomy. `resolveCategoryKey` is a
// pure key matcher: it takes no part in the icon id-space, so legend keeps
// applying the RAW `symbolPrefix + svgId` (DOM `<use>`), never the tinted atlas id.
// `resolveCategoryEntry` is the same idea one level up (B.36a): the `sub.svgId →
// cat.svgId` PRIORITY was re-implemented here too. It is id-space neutral as well — it
// returns the category ENTRIES, leaving the caller to build the id.
// ⚠ `resolvePoiIcon` is NOT a substitute for either: it returns the TINTED atlas id and
// appends the `icons.defaultIcon` fallback, so the legend would paint a default icon
// where it paints none today, under an id `<use href="#…">` cannot resolve.
import { resolveCategoryEntry, resolveCategoryKey } from "../taxonomy/resolver.js";
import { LEGEND_TAXONOMY_REF } from "./constants.js";
import type {
    LegendData,
    LegendItemData,
    StyleData,
    StyleLegendMeta,
    StyleRule,
    TaxonomyCategory,
    TaxonomyData,
    TaxonomyFieldMappings,
} from "./types.js";

// Re-export the public legend data shapes so existing importers
// (`./legend-generator.js`) keep resolving them unchanged.
export type { LegendData, LegendItemData };

function _findSubcategoryIcon(
    categories: Record<string, TaxonomyCategory>,
    value: string | number,
    symbolPrefix: string
): string | null {
    // Cross-category scan: the sub-category value is matched without knowing its
    // parent category — legend-specific, so the loop stays here (the resolver's
    // resolveCategoryEntry needs the category first). Only the case-insensitive
    // key MATCHING is delegated to the taxonomy resolver.
    // ⚠ TWIN, NOT DUPLICATE of `_inferCategoryId` (B.36c). Same shape, different stop
    // rule: this one scans on until a matching sub-category actually carries an `svgId`
    // (its job is to RETURN an icon); `_inferCategoryId` stops at the first key match
    // (its job is to NAME a parent). On a table where two categories declare the same
    // sub-category key and only the second has an icon they answer differently — which
    // is what makes channel 2 of `_applyPointIcon` load-bearing. Pinned by "(c) the two
    // cross-category scans are NOT interchangeable" in legend-generator-branches.test.js.
    for (const categoryKey in categories) {
        const subcategories = categories[categoryKey]?.subcategories;
        if (!subcategories) continue;
        const subKey = resolveCategoryKey(subcategories, value);
        const subIcon = subKey ? subcategories[subKey]?.svgId : null;
        if (subIcon) return symbolPrefix + subIcon;
    }
    return null;
}

function _findCategoryIcon(
    categories: Record<string, TaxonomyCategory>,
    value: string | number,
    symbolPrefix: string
): string | null {
    const catKey = resolveCategoryKey(categories, value);
    const icon = catKey ? categories[catKey]?.svgId : null;
    if (icon) return symbolPrefix + icon;
    return null;
}

function _buildFallbackItem(
    items: LegendItemData[],
    styleData: StyleData,
    geometryType: string,
    taxonomyData: TaxonomyData | null | undefined,
    symbolPrefix: string
): void {
    if (items.length !== 0 || !styleData.style || !styleData.legend) return;
    const item = generateLegendItem(
        styleData.style,
        styleData.legend,
        geometryType,
        null,
        null,
        taxonomyData,
        symbolPrefix
    );
    if (item) items.push(item);
}

function _buildSymbolForGeometry(
    geometryType: string,
    mergedStyle: Record<string, unknown>,
    rule: StyleRule | null,
    taxonomyData: TaxonomyData | null | undefined,
    symbolPrefix: string
): Record<string, unknown> {
    switch (geometryType) {
        case "point":
            return generatePointSymbol(mergedStyle, rule, taxonomyData, symbolPrefix);
        case "line":
            return generateLineSymbol(mergedStyle);
        case "polygon":
            return generatePolygonSymbol(mergedStyle);
        default:
            Log?.warn("[LegendGenerator] Unrecognized geometry type:", geometryType);
            return generatePointSymbol(mergedStyle, rule, taxonomyData, symbolPrefix);
    }
}

const _FIELD_CATEGORY_MAP: Record<string, "categoryId" | "subCategoryId"> = {
    "properties.categoryId": "categoryId",
    categoryId: "categoryId",
    "properties.category": "categoryId",
    category: "categoryId",
    "properties.subCategoryId": "subCategoryId",
    subCategoryId: "subCategoryId",
    "properties.subCategory": "subCategoryId",
    subCategory: "subCategoryId",
};

function _resolveIdsFromWhen(
    rule: StyleRule,
    fieldMappings: TaxonomyFieldMappings | null | undefined
): {
    categoryId: string | null;
    subCategoryId: string | null;
} {
    const ids = { categoryId: null as string | null, subCategoryId: null as string | null };
    if (!(rule.when?.field && rule.when.value !== undefined)) return ids;
    const f = rule.when.field;
    const v = rule.when.value;
    // Config-declared attribute → category mapping (e.g. OSM `fclass` → category).
    // Externalized from the core to the profile taxonomy config (RM-P2 #2) — the
    // core no longer hardcodes any domain (tourism) data.
    const field = f.startsWith("properties.") ? f.slice("properties.".length) : f;
    const mapping = fieldMappings?.[field]?.[v as string];
    if (mapping) {
        ids.categoryId = mapping.categoryId;
        ids.subCategoryId = mapping.subCategoryId;
        return ids;
    }
    const key = _FIELD_CATEGORY_MAP[f];
    if (key) ids[key] = v as string;
    return ids;
}

function _resolveIdsFromCondition(rule: StyleRule): {
    categoryId: string | null;
    subCategoryId: string | null;
} {
    let categoryId: string | null = null;
    let subCategoryId: string | null = null;
    if (!rule.condition) return { categoryId, subCategoryId };
    if (rule.condition.categoryId !== undefined) categoryId = rule.condition.categoryId;
    if (rule.condition.subCategoryId !== undefined) subCategoryId = rule.condition.subCategoryId;
    if (rule.condition.category !== undefined) categoryId = rule.condition.category;
    if (rule.condition.subCategory !== undefined) subCategoryId = rule.condition.subCategory;
    return { categoryId, subCategoryId };
}

function _inferCategoryId(
    categoriesConfig: Record<string, TaxonomyCategory>,
    subCategoryId: string | null
): string | null {
    if (!subCategoryId) return null;
    // ⚠ TWIN, NOT DUPLICATE of `_findSubcategoryIcon` (B.36c) — see the note there. This
    // loop stops at the FIRST category declaring the key, icon or not: a sub-category
    // without an icon still has a parent, whose icon `_resolveIconId` falls back to.
    // Requiring an `svgId` here would silently re-parent sub-categories.
    for (const [catKey, cat] of Object.entries(categoriesConfig)) {
        const subs = cat.subcategories;
        if (subs && resolveCategoryKey(subs, subCategoryId)) return catKey;
    }
    return null;
}

function _resolveIconId(
    categoriesConfig: Record<string, TaxonomyCategory>,
    categoryId: string | null,
    subCategoryId: string | null
): string | null {
    if (!categoryId) return null;
    // B.36a — the lookup AND the `sub → cat` priority both come from the resolver now.
    // `categoryField` is inert for this call: the resolver reads it only when it has to
    // EXTRACT values off a feature, and the legend arrives with both values already
    // resolved from the style rule (`when` / `condition` / `fieldMappings`).
    const { category, sub } = resolveCategoryEntry(
        { categoryField: "", categories: categoriesConfig },
        categoryId,
        subCategoryId
    );
    if (!category) return null;
    // svgId only (S4 P1). Parent-category fallback preserved: sub → category icon.
    return sub?.svgId || category.svgId || null;
}

function _resolveRadius(style: Record<string, unknown>): number {
    const r = (style.radius as number) || (style.size as number);
    return r || 6;
}

function _resolveFirstDefined(v1: unknown, v2: unknown, fallback: number): number {
    if (v1 !== undefined) return v1 as number;
    if (v2 !== undefined) return v2 as number;
    return fallback;
}

function _resolveCircleColors(
    style: Record<string, unknown>,
    fill: Record<string, unknown>,
    stroke: Record<string, unknown>
): { fillColor: string; color: string } {
    return {
        fillColor:
            (style.fillColor as string) ||
            (style.color as string) ||
            (fill.color as string) ||
            DEFAULT_FEATURE_COLOR,
        color: (style.color as string) || (stroke.color as string) || "#ffffff",
    };
}

function _buildPointSymbolBase(style: Record<string, unknown>): Record<string, unknown> {
    const fill = (style.fill as Record<string, unknown>) || {};
    const stroke = (style.stroke as Record<string, unknown>) || {};
    const colors = _resolveCircleColors(style, fill, stroke);
    return {
        type: "circle",
        radius: _resolveRadius(style),
        fillColor: colors.fillColor,
        fillOpacity: _resolveFirstDefined(style.fillOpacity, fill.opacity, 1),
        color: colors.color,
        weight: (style.weight as number) || (stroke.widthPx as number) || 2,
        opacity: _resolveFirstDefined(style.opacity, stroke.opacity, 1),
    };
}

function _applyIconFromRule(
    symbol: Record<string, unknown>,
    rule: StyleRule,
    symbolPrefix: string,
    taxonomyData: TaxonomyData | null | undefined
): boolean {
    if (!shouldUseIcons()) return false;
    const res = resolveRuleIcons(rule, taxonomyData);
    if (!res.useIcon || !res.iconId) return false;
    const base = res.iconId.startsWith("#")
        ? res.iconId
        : symbolPrefix
          ? symbolPrefix + res.iconId
          : "#sprite-" + res.iconId;
    symbol.icon = base;
    symbol.iconColor = "#ffffff";
    Log?.debug(`[LegendGenerator] Icon resolved from config: ${base}`);
    return true;
}

function _applyPointIcon(
    symbol: Record<string, unknown>,
    style: Record<string, unknown>,
    rule: StyleRule | null,
    taxonomyData: TaxonomyData | null | undefined,
    symbolPrefix: string
): void {
    if (style.useIcon && style.iconId) {
        symbol.icon = style.iconId;
        symbol.iconColor = "#ffffff";
        Log?.debug(`[LegendGenerator] Icon found in style: ${style.iconId}`);
        return;
    }
    // Two COMPLEMENTARY channels, in priority order (B.36b/c). Channel 1 covers the
    // `properties.*` / bare spellings of `_FIELD_CATEGORY_MAP`, `rule.condition` and the
    // config-declared `fieldMappings`; channel 2 covers the `attributes.*` spellings —
    // undeclared by channel 1 — and the svgId-seeking scan. Both read the same table
    // through `_getCategories` now. Dropping either loses icons (pinned in tests).
    if (rule && _applyIconFromRule(symbol, rule, symbolPrefix, taxonomyData)) return;
    if (!symbol.icon && rule && taxonomyData && shouldUseIcons()) {
        const icon = getIconFromTaxonomy(rule, taxonomyData, symbolPrefix);
        if (icon) {
            symbol.icon = icon;
            symbol.iconColor = "#ffffff";
            Log?.debug("[LegendGenerator] Taxonomy icon added:", icon);
        }
    }
}

function _buildLineBase(style: Record<string, unknown>): {
    symbol: Record<string, unknown>;
    stroke: Record<string, unknown>;
    casing: Record<string, unknown>;
} {
    const stroke = (style.stroke as Record<string, unknown>) || {};
    const casing = (style.casing as Record<string, unknown>) || {};
    const symbol: Record<string, unknown> = {
        type: "line",
        color: (stroke.color as string) || (style.color as string) || DEFAULT_FEATURE_COLOR,
        width: (stroke.widthPx as number) || (style.weight as number) || 3,
        style: "solid",
    };
    return { symbol, stroke, casing };
}

function _applyCasingLine(symbol: Record<string, unknown>, casing: Record<string, unknown>): void {
    if ((casing.enabled as boolean) && casing.color) {
        symbol.outlineColor = casing.color;
        symbol.outlineWidth = Math.max(0.5, ((casing.widthPx as number) || 1) * 0.4);
        symbol.outlineOpacity = casing.opacity ?? 1;
    }
}

function _applyLineDash(
    symbol: Record<string, unknown>,
    style: Record<string, unknown>,
    stroke: Record<string, unknown>
): void {
    const dashArray = (style.dashArray as string) || (stroke.dashArray as string);
    if (!dashArray) return;
    symbol.dashArray = dashArray;
    if (dashArray === "5, 5" || dashArray === "10, 10") {
        symbol.style = "dashed";
    } else if (dashArray === "1, 3" || dashArray === "2, 4") {
        symbol.style = "dotted";
    }
}

function _buildPolygonBase(
    fill: Record<string, unknown>,
    stroke: Record<string, unknown>,
    style: Record<string, unknown>
): Record<string, unknown> {
    return {
        type: "polygon",
        fillColor:
            (style.fillColor as string) ||
            (style.color as string) ||
            (fill.color as string) ||
            DEFAULT_FEATURE_COLOR,
        color: (style.color as string) || (stroke.color as string) || "#333",
        weight: (style.weight as number) || (stroke.widthPx as number) || 1,
    };
}

function _applyPolygonDecorations(
    symbol: Record<string, unknown>,
    fill: Record<string, unknown>,
    style: Record<string, unknown>,
    stroke: Record<string, unknown>
): void {
    applyOpacityProperties(symbol, style, ["fillOpacity"]);
    if (fill.opacity !== undefined) symbol.opacity = fill.opacity;
    if (style.opacity !== undefined) symbol.opacity = style.opacity;
    const dashArray = (style.dashArray as string) || (stroke.dashArray as string);
    if (dashArray) symbol.dashArray = dashArray;
    if (style.fillPattern) symbol.fillPattern = style.fillPattern;
    if (style.hatch) symbol.hatch = style.hatch;
}

/**
 * Spellings channel 2 owns — the `attributes.*` family, which {@link _FIELD_CATEGORY_MAP}
 * (channel 1) deliberately does not declare.
 *
 * ⚠️ The two channels are disjoint BY DESIGN, but the split used to be uneven inside this
 * family: the two predicates below hard-coded `attributes.categoryId` and
 * `attributes.subCategoryId` and stopped there, so `attributes.category` and
 * `attributes.subCategory` were declared by NEITHER channel — channel 1 does not know the
 * prefix, channel 2 did not know the suffix-less form. Measured 15/08/2026 across the 12
 * spellings: 10 resolved, those 2 did not. The `properties.*` family has
 * always accepted both forms; there was never a reason for `attributes.*` to accept one.
 *
 * Enumerated in a table rather than re-hard-coded, so the two families stay comparable at
 * a glance — an asymmetry is what this defect was.
 */
const _ATTRIBUTE_FIELD_KIND: Record<string, "categoryId" | "subCategoryId"> = {
    "attributes.categoryId": "categoryId",
    "attributes.category": "categoryId",
    "attributes.subCategoryId": "subCategoryId",
    "attributes.subCategory": "subCategoryId",
};

function _isSubCategoryField(field: string | undefined): boolean {
    return (
        field === "properties.subCategoryId" ||
        _ATTRIBUTE_FIELD_KIND[field ?? ""] === "subCategoryId"
    );
}

function _isCategoryIdField(field: string | undefined): boolean {
    return field === "properties.categoryId" || _ATTRIBUTE_FIELD_KIND[field ?? ""] === "categoryId";
}

function _isKnownTaxonomyField(
    field: string | undefined,
    isSubCategory: boolean,
    isCategoryId: boolean
): boolean {
    return (
        isSubCategory ||
        isCategoryId ||
        field === "fclass" ||
        field === "properties.fclass" ||
        !!_FIELD_CATEGORY_MAP[field ?? ""]
    );
}

function getIconFromTaxonomy(
    rule: StyleRule,
    taxonomyData: TaxonomyData | null | undefined,
    symbolPrefix: string
): string | null {
    if (!rule.when || !taxonomyData?.categories) {
        Log?.debug("[LegendGenerator] Insufficient data to retrieve icon:", {
            hasRule: !!rule.when,
            hasTaxonomy: !!taxonomyData,
            hasCategories: !!(taxonomyData && taxonomyData.categories),
        });
        return null;
    }

    const field = rule.when.field;
    const value = rule.when.value ?? "";
    const categories = taxonomyData.categories;
    Log?.debug(`[LegendGenerator] Looking for icon for ${field}=${value}`);

    const isSubCategory = _isSubCategoryField(field);
    const isCategoryId = _isCategoryIdField(field);

    if (isSubCategory) {
        const iconId = _findSubcategoryIcon(categories, value, symbolPrefix);
        if (iconId) {
            Log?.debug(`[LegendGenerator] Icon found (subcat): ${iconId}`);
            return iconId;
        }
    }
    if (isCategoryId) {
        const iconId = _findCategoryIcon(categories, value, symbolPrefix);
        if (iconId) {
            Log?.debug(`[LegendGenerator] Icon found (cat): ${iconId}`);
            return iconId;
        }
    }

    const isKnownTaxonomyField = _isKnownTaxonomyField(field, isSubCategory, isCategoryId);
    if (isKnownTaxonomyField) {
        Log?.warn(`[LegendGenerator] No icon found for ${field}=${value}`);
    } else {
        Log?.debug(
            `[LegendGenerator] Field "${field}" is not a taxonomy field — icon lookup skipped`
        );
    }
    return null;
}

function shouldUseIcons(): boolean {
    // D2: severed from the former POI-shared style state. The former gate 1 (the
    // profile-global `showIconsOnMap`) was true for every shipped profile — none
    // sets it globally — so the effective gate is the icons config below. Per-layer
    // control is intentionally NOT (re)introduced here: it would flip the two
    // layers that set `showIconsOnMap:false` (armoires,
    // sites_de_conservation_wdpa), a behaviour change out of scope for D2.
    // Reads the taxonomy capability's `modules.taxonomy.icons` via the seam
    // (in-core successor of the former legacy profile icons gate); absent → on.
    try {
        const iconsConfig = getGeoLeaf()?.Taxonomy?.getIcons?.() ?? null;
        return iconsConfig != null && iconsConfig.showOnMap !== false;
    } catch {
        return false;
    }
}

/**
 * Generates the legend data from a style file.
 */
function generateLegendFromStyle(
    styleData: StyleData | null | undefined,
    geometryType: string,
    taxonomyData: TaxonomyData | null | undefined
): LegendData | null {
    if (!styleData) {
        Log?.warn("[LegendGenerator] Missing style data");
        return null;
    }

    const legendData: LegendData = {
        version: "1.2.0",
        ...(styleData.id !== undefined && { id: styleData.id }),
        title: styleData.label || "Sans titre",
        description: styleData.description || "",
        sections: [],
    };

    const items: LegendItemData[] = [];
    // Generic core: no domain-specific default prefix (RM-P2 #2). Profiles declare
    // their own `icons.symbolPrefix` in the taxonomy config.
    const symbolPrefix = taxonomyData?.icons?.symbolPrefix || "";

    if (Array.isArray(styleData.styleRules) && styleData.styleRules.length > 0) {
        styleData.styleRules.forEach((rule) => {
            // Accept rule.legend or fall back to rule.label (backward-compat with older style formats)
            const legendMeta: StyleLegendMeta | null =
                rule.legend ?? (rule.label ? { label: rule.label } : null);
            if (!legendMeta) {
                Log?.debug("[LegendGenerator] Rule without legend property (skipped):", rule);
                return;
            }

            const item = generateLegendItem(
                rule.style,
                legendMeta,
                geometryType,
                styleData.style ?? null,
                rule,
                taxonomyData,
                symbolPrefix
            );

            if (item) {
                items.push(item);
            }
        });

        items.sort(compareByOrder);
    }

    _buildFallbackItem(items, styleData, geometryType, taxonomyData, symbolPrefix);

    if (items.length > 0) {
        legendData.sections.push({
            title: "",
            items,
        });
    }

    return legendData;
}

function generateLegendItem(
    style: Record<string, unknown> | undefined,
    legend: { label?: string; order?: number; description?: string },
    geometryType: string,
    baseStyle: Record<string, unknown> | null,
    rule: StyleRule | null,
    taxonomyData: TaxonomyData | null | undefined,
    symbolPrefix: string
): LegendItemData | null {
    if (!style || !legend) {
        return null;
    }

    const mergedStyle = baseStyle ? Object.assign({}, baseStyle, style) : style;

    const item: LegendItemData = {
        label: legend.label || "Sans label",
        order: legend.order ?? 999,
        symbol: {},
    };

    if (legend.description) {
        item.description = legend.description;
    }

    item.symbol = _buildSymbolForGeometry(
        geometryType,
        mergedStyle,
        rule,
        taxonomyData,
        symbolPrefix
    );

    return item;
}

function applyOpacityProperties(
    symbol: Record<string, unknown>,
    style: Record<string, unknown>,
    opacityProps: string[]
): void {
    opacityProps.forEach((prop) => {
        if (style[prop] !== undefined) {
            symbol[prop] = style[prop];
        }
    });
}

/**
 * The category table both icon channels of {@link _applyPointIcon} resolve against.
 *
 * B.36b — there used to be TWO independent ways in: this function read
 * `GeoLeaf.Taxonomy.getCategories()` straight from the seam while `getIconFromTaxonomy`
 * read `taxonomyData.categories`, the bag `Legend._loadTaxonomy` builds from that very
 * call. Same table, two doors, nothing keeping them in step.
 *
 * The BAG is the authority: the generator's declared input, what channel 2 already used,
 * and in the running app the seam's own return value (`_loadTaxonomy` assigns it
 * verbatim). The seam read survives ONLY as the fallback for callers passing no bag —
 * `GeoLeaf._LegendGenerator.generateLegendFromStyle(style, geom, null)` is a documented
 * global entry point and it resolved icons before this change. An empty bag falls back
 * too, matching the pre-existing `length === 0 → null` normalisation.
 */
function _getCategories(
    taxonomyData: TaxonomyData | null | undefined
): Record<string, TaxonomyCategory> | null {
    const fromBag = taxonomyData?.categories;
    if (fromBag && Object.keys(fromBag).length > 0) return fromBag;
    // F5: taxonomy read from the in-core taxonomy capability (`GeoLeaf.Taxonomy`), the
    // named taxonomy in `modules.taxonomy` — no longer the legacy core taxonomy
    // accessor. The capability carries icons under `svgId`.
    const cfg = getGeoLeaf()?.Taxonomy?.getCategories?.(LEGEND_TAXONOMY_REF);
    if (!cfg || Object.keys(cfg).length === 0) return null;
    return cfg;
}

function resolveRuleIcons(
    rule: StyleRule,
    taxonomyData: TaxonomyData | null | undefined
): { useIcon: boolean; iconId: string | null } {
    if (!shouldUseIcons()) return { useIcon: false, iconId: null };
    const categoriesConfig = _getCategories(taxonomyData);
    if (!categoriesConfig) return { useIcon: false, iconId: null };

    let { categoryId, subCategoryId } = _resolveIdsFromWhen(rule, taxonomyData?.fieldMappings);
    if (!categoryId && !subCategoryId) {
        ({ categoryId, subCategoryId } = _resolveIdsFromCondition(rule));
    }

    if (subCategoryId && !categoryId) {
        categoryId = _inferCategoryId(categoriesConfig, subCategoryId);
    }

    if (!categoryId && !subCategoryId) return { useIcon: false, iconId: null };
    const iconId = _resolveIconId(categoriesConfig, categoryId, subCategoryId);
    return { useIcon: iconId !== null, iconId };
}

function generatePointSymbol(
    style: Record<string, unknown>,
    rule: StyleRule | null,
    taxonomyData: TaxonomyData | null | undefined,
    symbolPrefix: string
): Record<string, unknown> {
    const symbol = _buildPointSymbolBase(style);
    _applyPointIcon(symbol, style, rule, taxonomyData, symbolPrefix);
    return symbol;
}

function generateLineSymbol(style: Record<string, unknown>): Record<string, unknown> {
    const { symbol, stroke, casing } = _buildLineBase(style);
    _applyCasingLine(symbol, casing);
    if (stroke.opacity !== undefined) {
        symbol.opacity = stroke.opacity;
    }
    _applyLineDash(symbol, style, stroke);
    return symbol;
}

function generatePolygonSymbol(style: Record<string, unknown>): Record<string, unknown> {
    const fill = (style.fill as Record<string, unknown>) || {};
    const stroke = (style.stroke as Record<string, unknown>) || {};
    const symbol = _buildPolygonBase(fill, stroke, style);
    _applyPolygonDecorations(symbol, fill, style, stroke);
    return symbol;
}

const LegendGenerator = {
    generateLegendFromStyle,
    generateLegendItem,
};
export { LegendGenerator };
