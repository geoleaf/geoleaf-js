/*!
 * GeoLeaf Core — Legend runtime types
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */
/**
 * Structural types for the Legend module (generator + API + control).
 *
 * Extracted so `legend-generator.ts`, `public-api.ts` and `legend-control.ts`
 * share one typed view of the style JSON, the taxonomy, and the few control
 * instance shapes they pass around — without re-declaring `any` locally
 * (mirrors `search/search-types.ts`).
 *
 * All style/taxonomy shapes are intentionally permissive
 * (`[key: string]: unknown`) because they arrive from arbitrary user profiles
 * and from style files loaded over HTTP; narrow at the call site. Symbol bags
 * stay `Record<string, unknown>` because the UI symbol renderer reads them
 * dynamically by key.
 *
 * Leaf module: it imports NO `kernel/ui/` types (cycle risk).
 */

// `TaxonomyCategory` / `TaxonomyFieldMappings`: canonical definitions live in the
// taxonomy capability. Imported for local use (`TaxonomyData`) and re-exported so
// the legend readers (`legend-generator`) keep their import path. Legend consumes
// the capability's `svgId`-only category shape — the single source of truth, both
// for the type and for the case-insensitive matching (`resolveCategoryKey`).
import type { TaxonomyCategory, TaxonomyFieldMappings } from "../taxonomy/types.js";
export type { TaxonomyCategory, TaxonomyFieldMappings };

// ─── Style file (style JSON loaded per layer) ───────────────────────────────

/** A `styleRules[].when` predicate (field/value matcher). */
export interface StyleRuleWhen {
    field?: string;
    value?: string | number;
}

/** A `styleRules[].condition` predicate (taxonomy id matcher). */
interface StyleRuleCondition {
    categoryId?: string;
    subCategoryId?: string;
    category?: string;
    subCategory?: string;
}

/** Legend metadata attached to a style or a single style rule. */
export interface StyleLegendMeta {
    label?: string;
    order?: number;
    description?: string;
}

/**
 * One entry in `styleData.styleRules`. The optional `label` carries the
 * backward-compat form where a rule exposed its label directly (older formats).
 */
export interface StyleRule {
    style?: Record<string, unknown>;
    legend?: StyleLegendMeta;
    label?: string;
    when?: StyleRuleWhen;
    condition?: StyleRuleCondition;
    [key: string]: unknown;
}

/** A parsed style file (`layers/<id>/styles/<file>.json`). */
export interface StyleData {
    id?: string;
    label?: string;
    description?: string;
    style?: Record<string, unknown>;
    legend?: StyleLegendMeta;
    styleRules?: StyleRule[];
    [key: string]: unknown;
}

// ─── Taxonomy (categories + icons) ──────────────────────────────────────────
// `TaxonomyCategory` is imported from the taxonomy capability (above): its
// `svgId`-only shape is the single vocabulary. The legacy `icon`/`iconId` fields
// are gone — every shipped profile already declares `svgId` (S4 P1).

/** Parsed taxonomy data (categories + icon prefix). */
export interface TaxonomyData {
    categories?: Record<string, TaxonomyCategory>;
    icons?: { symbolPrefix?: string; showOnMap?: boolean; [key: string]: unknown };
    /**
     * Attribute → category/subcategory mapping, keyed by field then by value
     * (e.g. `{ fclass: { museum: { categoryId, subCategoryId } } }`). Declared per
     * profile in the taxonomy config so the core carries no domain data (RM-P2 #2).
     */
    fieldMappings?: TaxonomyFieldMappings;
    [key: string]: unknown;
}

// ─── Generated legend data (public output of the generator) ─────────────────

/** A single legend entry produced from a style rule. */
export interface LegendItemData {
    label: string;
    order: number;
    description?: string;
    symbol: Record<string, unknown>;
}

/** The full legend structure generated for one style file. */
export interface LegendData {
    version: string;
    id?: string;
    title: string;
    description: string;
    sections: { title: string; items: LegendItemData[] }[];
}

// ─── Control instance (private shape passed around legend-api/control) ──────

/**
 * Minimal structural view of the legend control instance as referenced from
 * `public-api.ts` — only the members the API guards/calls are typed; the rest
 * (the full builder surface in `legend-control.ts`) is carried as `unknown`.
 */
export interface LegendControlLike {
    _container?: HTMLElement;
    hide?: () => void;
    updateMultiLayerContent?: (arr: unknown[]) => void;
    addTo?: (map: unknown) => unknown;
    remove?: () => void;
    [key: string]: unknown;
}

/**
 * Generation-counter slot stamped onto the control instance to discard stale
 * async sprite-load callbacks (`legend-control.ts`).
 */
export interface RenderGenHolder {
    _renderGen?: number;
}

// ─── Module config (`modules.legend`) ───────────────────────────────────────

/**
 * The `modules.legend` config block (S10 F2 — migrated from `ui.showLegend` +
 * `legendConfig`). Read via `getLegendConfig()`; mirrors the capability
 * `configSchema` in `legend-capability.ts`. `enabled` is opt-out. `collapsible`
 * is not exposed here — it is a fixed control constant, not a profile setting.
 */
export interface LegendModuleConfig {
    /** Enable the legend (opt-out — active unless a profile sets `false`). */
    enabled: boolean;
    /** Legend panel title. */
    title?: string;
    /** Legend control position on the map. */
    position?: string;
    /** Whether the legend starts collapsed. */
    collapsedByDefault?: boolean;
}
