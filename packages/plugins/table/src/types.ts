/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */
/**
 * Structural types for the Table module (panel, renderer, virtual scroll, sort,
 * selection, highlight, export).
 *
 * Extracted so the 14 table sub-modules share one typed view of the mutable
 * shared state (`tableState`), the layer/feature data they read from the GeoJSON
 * module, the minimal map handle they call, and the render context — without
 * re-declaring `any` locally (roadmap_typage-strict.md, S5 — mirrors
 * `search/search-types.ts` and `poi/core-types.ts`).
 *
 * Feature/layer/config shapes are intentionally permissive
 * (`[key: string]: unknown`) because they arrive from arbitrary user profiles
 * and from the GeoJSON layer registry; narrow at the call site.
 *
 * Map/bounds surfaces are minimal structural interfaces (not the strict
 * `maplibre-gl` types) so the adapter/legacy calls still type-check and so
 * everything erases to nothing at build (zero bundle impact).
 */

import type { SortState } from "./sort.js";

// Re-export so table sub-modules can import every table type from one path.
export type { SortState };

// ─── Feature & geometry ─────────────────────────────────────────────────────

/** A GeoJSON geometry as read by the table (coordinates left permissive). */
export interface TableGeometry {
    type?: string;
    coordinates?: unknown;
    [key: string]: unknown;
}

/**
 * Minimal GeoJSON-feature-like shape the table reads (id, properties, geometry).
 * Permissive on purpose: features come straight from the GeoJSON layer registry.
 */
export interface TableFeature {
    id?: string | number;
    properties?: Record<string, unknown>;
    geometry?: TableGeometry | null;
    [key: string]: unknown;
}

// ─── Column & layer table config ────────────────────────────────────────────

/** A single column descriptor in a layer's `config.table.columns`. */
export interface TableColumnDef {
    /** Dot-path read from each feature (e.g. `"properties.name"`). */
    field: string;
    /** Header label (falls back to `field`). */
    label?: string;
    /** CSS width applied to the `<th>`. */
    width?: string;
    /** When `false`, the column is not sortable. @default true */
    sortable?: boolean;
    /** Cell value formatting hint (`"number"`, `"date"`, …). */
    type?: string;
    [key: string]: unknown;
}

/** Default sort declared in a layer's `config.table.defaultSort`. */
export interface TableDefaultSort {
    field?: string | null;
    direction?: string | null;
    /** Legacy alias for `direction`. */
    order?: string | null;
    [key: string]: unknown;
}

/** The `table` block of a GeoJSON layer's `config`. */
export interface TableLayerTableConfig {
    enabled?: boolean;
    title?: string;
    columns?: TableColumnDef[];
    defaultSort?: TableDefaultSort;
    [key: string]: unknown;
}

/** A GeoJSON layer config carrying an optional `table` block. */
export interface TableLayerConfig {
    table?: TableLayerTableConfig;
    title?: string;
    [key: string]: unknown;
}

/**
 * Structural view of a GeoJSON layer entry as read by the table
 * (label, config, features, visibility). Compatible with `GeoJSONLayerEntry`.
 */
export interface TableLayerData {
    id?: string;
    label?: string;
    config?: TableLayerConfig;
    features?: TableFeature[];
    _visibility?: { current?: boolean; [key: string]: unknown };
    [key: string]: unknown;
}

/** An entry in the list returned by `getAvailableLayers()`. */
export interface TableAvailableLayer {
    id: string;
    label: string;
    config: TableLayerTableConfig;
}

// ─── Module configuration (tableState._config) ──────────────────────────────

/**
 * Table module configuration, merged from defaults, `Config.get("modules.table")`
 * and the `init()` override. The index signature keeps profile-specific options
 * typed as `unknown` (narrow at the call site) rather than `any`.
 */
export interface TableConfig {
    enabled?: boolean;
    /** Show the table toolbar button/tab. Read by the core registry via the slot `profileKey`. Default: `true`. */
    showButton?: boolean;
    defaultVisible?: boolean;
    /**
     * @deprecated Sans effet — le panneau défile en VIRTUEL et ne pagine pas (B-71).
     *
     * La clé était déclarée et portait un défaut (`50`) sans avoir **aucun site de lecture** :
     * `grep -rn "pageSize" src/` ne rendait que sa déclaration et son défaut. Un profil qui la
     * posait n'obtenait ni effet ni avertissement. Le champ reste ici, marqué, plutôt que retiré :
     * le type est publié, et le supprimer casserait la compilation d'un intégrateur qui l'a écrit —
     * le déprécier le lui **dit**, ce que son silence précédent ne faisait pas.
     */
    pageSize?: number;
    maxRowsPerLayer?: number;
    enableExportButton?: boolean;
    exportFormats?: string[];
    virtualScrolling?: boolean;
    defaultHeight?: string;
    minHeight?: string;
    maxHeight?: string;
    resizable?: boolean;
    /** CSV column separator forwarded to export options. */
    csvSeparator?: "," | ";";
    /** Include geometry column in CSV export. */
    csvIncludeGeometry?: boolean;
    [key: string]: unknown;
}

// ─── Map / bounds handles (structural, not maplibre-gl value types) ─────────

/**
 * Minimal structural view of the map handle stored in `tableState._map`.
 * In MapLibre mode it is the adapter-wrapped map; a few methods are legacy
 * Leaflet-style. Permissive — narrow / cast at the boundary.
 */
export interface TableMap {
    /** Subscribe to a map event (called unconditionally by `attachMapEvents`). */
    on(eventName: string, handler: (e: TableMapEvent) => void): void;
    /** Emit an event (guarded by a `typeof === "function"` check before use). */
    fire?(eventName: string, detail?: unknown): void;
    removeLayer?(layerId: string): void;
    addGeoJSONLayer?(id: string, data: unknown, style: unknown): void;
    fitBounds?(bounds: unknown, options?: unknown): void;
    [key: string]: unknown;
}

/** Event object delivered to `map.on(...)` handlers the table subscribes to. */
export interface TableMapEvent {
    layerId?: string;
    visible?: boolean;
    [key: string]: unknown;
}

/** Minimal bounds accumulator (`extend([lat, lng])`) used by highlight zoom. */
export interface TableBounds {
    extend(coord: number[]): void;
    [key: string]: unknown;
}

// ─── Render context ─────────────────────────────────────────────────────────

/** Options object passed to `TableRenderer.render(container, options)`. */
export interface TableRenderOptions {
    layerId: string | null;
    features: TableFeature[];
    selectedIds: Set<string>;
    sortState: SortState;
    config: TableConfig | null;
    [key: string]: unknown;
}

// ─── init() options ─────────────────────────────────────────────────────────

/** Options accepted by `Table.init()`. */
export interface TableInitOptions {
    map: TableMap;
    config?: Partial<TableConfig>;
    [key: string]: unknown;
}

// ─── Global accessors (subset of the GeoLeaf namespace the table reads) ──────

/** The `GeoLeaf.GeoJSON` surface the table depends on. */
export interface TableGeoJSONApi {
    getLayerData?: (layerId: string) => TableLayerData | null | undefined;
    getLayerById?: (layerId: string) => TableLayerData | null | undefined;
    getAllLayers?: () => TableLayerData[];
    [key: string]: unknown;
}

/** The `GeoLeaf.Config` surface the table depends on. */
export interface TableConfigApi {
    get(key: string): unknown;
    [key: string]: unknown;
}

/** The `GeoLeaf._LayerVisibilityManager` surface the table depends on. */
export interface TableVisibilityManager {
    getVisibilityState?: (layerId: string) => { current?: boolean } | null | undefined;
    [key: string]: unknown;
}
