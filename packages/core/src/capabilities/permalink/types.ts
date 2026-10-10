/*!
 * GeoLeaf Core – Permalink / Shared Types Hub
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Central type hub for the Permalink module (§1.3). Holds the serializable
 * {@link PermalinkState} plus the narrow structural interfaces used to type the
 * runtime `GeoLeaf.*` accessors (the `GeoLeaf.Filter` serialisation contract and
 * the theme selector) without resorting to `any`.
 *
 * Only the members actually read across the cluster are declared — the loose
 * shapes intentionally keep optional methods so the defensive `?.` call sites in
 * `permalink-sync.ts` stay sound.
 *
 * @see permalink-sync for capture / sync logic
 * @see permalink-restore for the apply-side restoration helpers
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";

// ── Serializable state ──────────────────────────────────────────────────────────

/**
 * Snapshot of the serializable map state.
 * All fields except `lat`, `lng`, `zoom` are optional.
 */
export interface PermalinkState {
    /** Map centre latitude [-90, 90]. */
    lat: number;
    /** Map centre longitude [-180, 180]. */
    lng: number;
    /** Map zoom level [0, 28]. */
    zoom: number;
    /** List of layer IDs that the user has explicitly hidden. */
    layers?: string[];
    /** List of layer IDs that the user has manually shown (not part of the active theme). */
    shownLayers?: string[];
    /** Active text filter value. */
    filter?: string;
    /** Active taxonomy filter — flat category + sub-category value set (`gl_cats`). */
    categories?: string[];
    /** Active tag filter (list of selected tag values). */
    tags?: string[];
    /** Minimum rating filter (0 = no filter). */
    rating?: number;
    /** Active data theme ID (e.g. "tourism", "administration"). */
    theme?: string;
    /**
     * Active filter, ONE ENTRY PER FIELD — keyed by the field's descriptor id
     * (`modules.filter.fields[].id`), valued in the URL's own grammar: a `text` field's
     * query, `a,b,c` for a `tag` or `taxonomy` field, `min..max` for a `range`. A taxonomy
     * field's checked sub-categories ride under `<id>.sub`, as `category/sub-category` pairs.
     *
     * This is what a permalink WRITES since 3.15.0 (`gl_f.<id>` parameters). The four members
     * above it — `filter`, `categories`, `tags`, `rating` — are the former by-kind slots:
     * still read from a link that carries them, never captured any more.
     *
     * ⚠️ Raw strings, on purpose: the kind of a field is not in the URL, so an entry can only
     * be read FOR a descriptor (`permalink-field-filters.ts`). When this member is present,
     * the by-kind slots are ignored on restore.
     */
    fieldFilters?: Record<string, string>;
}

// ── Runtime accessor shapes (narrowed `GeoLeaf.*` surface) ───────────────────────

/**
 * Serialised filter field — the subset of `GeoLeaf.Filter`'s `SerializedFilterField`
 * permalink reads (capture) and writes (restore). Only the payload matching `kind`
 * is present.
 */
export interface PermalinkFilterField {
    id: string;
    kind: string;
    values?: string[];
    /** Checked sub-categories of a `taxonomy` field, each with the category it sits under. */
    subValues?: Array<{ value: string; category: string }>;
    text?: string;
    range?: { min?: number; max?: number };
    bool?: boolean;
    proximity?: { center: { lat: number; lng: number }; radiusKm: number };
}

/** Serialised filter state exchanged with `GeoLeaf.Filter.getActiveFilter`/`applyFilter`. */
export interface PermalinkFilterState {
    fields: PermalinkFilterField[];
}

/** Field descriptor subset read from `GeoLeaf.Filter.getConfig()` for restore mapping. */
export interface PermalinkFilterConfig {
    fields?: Array<{ id: string; kind: string }>;
}

/**
 * Narrow structural view of `GeoLeaf.Filter` — the S13 serialisation contract that
 * replaces the former DOM scraping + `_UIFilterPanel*` ghost-injection. Methods are
 * optional (guarded with `?.` at the call sites).
 */
export interface FilterLike {
    getActiveFilter?: () => PermalinkFilterState;
    getConfig?: () => PermalinkFilterConfig;
    applyFilter?: (state: PermalinkFilterState) => void;
}

/**
 * Narrow structural view of `GeoLeaf.ThemeSelector`.
 *
 * PROMOTED to `global.d.ts` as `GeoLeafThemeSelector` (B.25) — the surface is public
 * enough to belong with the other typed members of `GeoLeafGlobal`, and keeping a
 * second copy here is how the two drifted: this one declared
 * `getCurrentTheme?: () => string | undefined` while the selector returns
 * `_state.currentTheme`, typed `string | null` (theme-selector-state.ts). Alias, so
 * every existing use site keeps its name.
 */
export type ThemeSelectorLike = GeoLeafThemeSelector;

/**
 * Subset of the global `GeoLeaf` namespace the permalink module reaches into.
 * Members fall in the `unknown` tail of `GeoLeafGlobal`, so they are re-typed
 * here through structural lookups rather than widened to `any`.
 */
export interface PermalinkGeoLeaf {
    Filter?: FilterLike;
    ThemeSelector?: ThemeSelectorLike;
}

/**
 * Returns the global `GeoLeaf` namespace narrowed to the permalink-relevant
 * surface ({@link PermalinkGeoLeaf}). These members live in the `unknown` tail
 * of `GeoLeafGlobal`; this single structural view replaces the former
 * `(globalThis as any).GeoLeaf` accessors. Returns `undefined` before boot.
 */
export function getPermalinkGeoLeaf(): PermalinkGeoLeaf | undefined {
    return getGeoLeaf() as PermalinkGeoLeaf | undefined;
}
