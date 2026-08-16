/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter capability — public types.
 *
 * Generic attribute filter (S5): a side-panel that restricts feature display by
 * attribute content, geometry-agnostic (point/line/polygon) and multi-source. A
 * declarative per-field descriptor states which fields are filterable and how.
 * Config lives under `modules.filter`. See `CDC_capacite-filter.md` v1.0.1.
 *
 * F0 introduces the config-model types only; the predicate engine (F1) and the
 * mapping-driven panel (F2) extend these.
 */

import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";

/**
 * How a field is filtered.
 * - `taxonomy` — hierarchical value set from `GeoLeaf.Taxonomy` + `fieldMappings`.
 * - `tag` — flat value set (taxonomy in flat form).
 * - `range` — numeric min/max.
 * - `text` — substring over `searchFields`.
 * - `boolean` — truthiness of a field.
 * - `proximity` — haversine distance ≤ radius.
 */
export type FilterKind = "taxonomy" | "tag" | "range" | "text" | "boolean" | "proximity";

/**
 * One filterable-field descriptor. Common attributes plus kind-specific ones
 * (narrowed by the engine in F1). See CDC §3.2.
 */
export interface FilterFieldDescriptor {
    /** Stable id (state, permalink, DOM `data-gl-filter-id`). */
    id: string;
    /** Filter kind. */
    kind: FilterKind;
    /** Panel label. */
    label?: string;
    /**
     * Layers this field filters. **Absent ⟹ all layers.** **Present ⟹ only these
     * layers**; a layer not listed is not filtered by this field (opt-in scope).
     */
    layers?: string[];

    // ── kind-specific (optional) ──────────────────────────────────────────────
    /** Attribute field to test (`taxonomy`/`tag`/`range`/`boolean`). */
    field?: string;
    /** Named taxonomy to read options from (`taxonomy`). */
    taxonomyRef?: string;
    /** Sub-category attribute field (`taxonomy`). */
    subField?: string;
    /** Tag options: `"auto"` (distinct values from data) or a declared list (`tag`). */
    options?: "auto" | string[];
    /** Attribute fields scanned for the substring (`text`). */
    searchFields?: string[];
    /** Input placeholder (`text`). */
    placeholder?: string;
    /** Numeric bounds/step (`range`). */
    min?: number;
    max?: number;
    step?: number;
    /** Proximity radius bounds/step/default, in the profile's distance unit (`proximity`). */
    radiusMin?: number;
    radiusMax?: number;
    radiusStep?: number;
    radiusDefault?: number;
    /** Proximity control labels (`proximity`). */
    buttonLabel?: string;
    instructionText?: string;
}

/** Panel action labels. */
export interface FilterActionsConfig {
    applyLabel?: string;
    resetLabel?: string;
}

/** The full `modules.filter` config block. */
export interface FilterConfig {
    /**
     * Capability gate — the filter is inert when `false`. Opt-out
     * (`enableWhenAbsent: true`): absent → active, preserving the pre-migration
     * default-on behaviour of `ui.showFilterPanel`.
     */
    enabled: boolean;
    /** Panel title (was `searchConfig.title`). */
    title?: string;
    // NOTE (B.22) — no `searchPlaceholder`. The migration from `searchConfig` carried the
    // key over, but the S5 panel is entirely field-driven: `renderFilterPanel` builds a
    // title, one control per `fields[]` descriptor and the action footer, and the ONLY
    // search input is the `kind:"text"` control, which takes its own
    // `FilterFieldDescriptor.placeholder` (panel/render.ts:147). There is no global search
    // box for a global placeholder to fill, so the key had 0 read sites in the whole repo
    // while 8 shipped profiles + the reference fixture wrote it. Use `fields[].placeholder`.
    /** Filterable-field descriptors (was `searchConfig.filters[]`, generalised). */
    fields?: FilterFieldDescriptor[];
    /** Apply/reset labels (was `searchConfig.actions`). */
    actions?: FilterActionsConfig;
}

// ── Serialisation contract (S13) ─────────────────────────────────────────────

/**
 * One field's serialisable selection — the DOM-free, engine-agnostic form of an
 * `ActiveField`, keyed by descriptor `id`+`kind`. This is the stable shape the
 * `permalink` capability persists to / restores from the URL, replacing the former
 * DOM scraping + ghost-injection. Only the payload matching `kind` is present.
 */
export interface SerializedFilterField {
    /** Descriptor id (`modules.filter.fields[].id`). */
    id: string;
    /** Filter kind. */
    kind: FilterKind;
    /** Selected values — `taxonomy` (categories + sub-categories, flat) / `tag`. */
    values?: string[];
    /** Search query — `text`. */
    text?: string;
    /** Numeric bounds — `range`. */
    range?: { min?: number; max?: number };
    /** Toggle — `boolean`. */
    bool?: boolean;
    /** Center + radius **in kilometres** — `proximity`. */
    proximity?: { center: { lat: number; lng: number }; radiusKm: number };
}

/** The full serialisable filter state (only constrained fields are present). */
export interface SerializedFilterState {
    fields: SerializedFilterField[];
}

/** Proximity sub-API surface exposed on `GeoLeaf.Filter.proximity` (S13). */
export interface FilterProximityApi {
    /** Updates the active proximity radius (km); memoised if no circle exists yet. */
    setRadius(radiusKm: number): void;
    /** Toggles the toolbar-driven proximity search; returns the new active state. */
    toggle(map: IMapAdapter, radiusKm?: number, options?: { onPointPlaced?: () => void }): boolean;
}

/**
 * Public `GeoLeaf.Filter` surface (S13). Read helpers + the serialisation contract
 * consumed by permalink, plus the imperative helpers consumed by the mobile toolbar
 * / desktop control-builder (replacing the removed `_UIFilterPanel*` globals).
 */
export interface FilterPublicApi {
    /** `true` when the filter is enabled (`modules.filter.enabled !== false`). */
    isEnabled(): boolean;
    /** The resolved `modules.filter` config (merged over defaults). */
    getConfig(): FilterConfig;
    /** Reads the active filter as a serialisable state (permalink capture). */
    getActiveFilter(): SerializedFilterState;
    /** Restores a serialised state: reflects it in the panel and applies it (no ghost DOM). */
    applyFilter(state: SerializedFilterState): void;
    /** Re-applies the current panel state (e.g. after a proximity radius change). */
    applyNow(): void;
    /** Clears every panel control and re-applies (reset button). */
    reset(): void;
    /** `true` when at least one field is constrained (tab indicator). */
    hasActiveFilters(): boolean;
    /** Proximity sub-API (replaces `_UIFilterPanelProximity`). */
    proximity: FilterProximityApi;
}
