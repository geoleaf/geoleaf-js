/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Shared types for the Layer Selector namespace (LS).
 * LS is built via Object.assign from core, data-fetching, row-rendering, selection-cache.
 */

export interface LayerLike {
    id?: string;
    /** Config carried by a FILE — `layers/<id>/<id>_config.json`, fetched on demand. */
    configFile?: string;
    /**
     * Config carried IN LINE, as `expandLayerTemplates` produces it for every instance of
     * a `layerTemplates` block. Mutually exclusive with `configFile`.
     *
     * ⚠️ Déclarée explicitement depuis B-152 (07/08/2026). Elle tombait dans la traîne
     * `[key: string]: unknown`, donc les trois sites du sélecteur pouvaient l'ignorer sans
     * que le typecheck n'ait rien à en dire — c'est une des raisons pour lesquelles le défaut
     * a vécu. Ne pas la ré-élargir vers la traîne (backlog **B-13**).
     */
    inlineConfig?: Record<string, unknown>;
    layerDir?: string;
    dataFile?: string;
    url?: string;
    [key: string]: unknown;
}

/**
 * The minimum a basemap must expose to be offered for offline caching.
 *
 * Structural on purpose: the selector accepts any basemap-shaped object, so it does not
 * depend on the core's basemap registry.
 */
export interface BasemapLike {
    id?: string;
    label?: string;
    url?: string;
    offline?: boolean;
    offlineBounds?: { north: number; south: number; east: number; west: number };
    cacheMinZoom?: number;
    cacheMaxZoom?: number;
    [key: string]: unknown;
}

/** Geographic bounds for offline tile enumeration. */
export interface SelectionBounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

/**
 * Download zone for vector basemaps (S3): bbox + zoom ceiling. Fed to the
 * StyleResolver to enumerate .pbf tiles, glyphs and sprite for offline use.
 */
export interface VectorZone {
    bounds: SelectionBounds;
    cacheMinZoom: number;
    cacheMaxZoom: number;
    /** Human-readable source of the bbox ("view" | "profile"). */
    source?: string;
}

/**
 * A previously saved layer/basemap selection, restored when the panel remounts.
 *
 * Without it the user's choice would reset on every open — the panel is destroyed and rebuilt
 * rather than hidden.
 */
export interface SavedSelection {
    layers?: string[];
    basemaps?: string[];
    styles?: Record<string, string>;
    includeTiles?: boolean;
    timestamp?: number;
    totalEstimatedSize?: number;
    vectorZone?: VectorZone;
}

/**
 * One tracked listener, kept so the selector can release all of them on teardown.
 *
 * The panel is rebuilt on each open; untracked listeners would accumulate one set per open.
 */
// ⚠️ Non exportée depuis la tâche 8.8 (compteur C1) : le type n'est nommé qu'ici, par le champ
// `_eventListeners` ci-dessous. L'`export` n'avait aucun consommateur — classe A.
interface EventListenerEntry {
    element: EventTarget;
    event: string;
    handler: (e?: Event) => void;
}

/** Estimate result for basemap size */
export interface BasemapSizeEstimate {
    tileCount: number;
    estimatedSize: number;
}

/**
 * Full Layer Selector API (LS namespace).
 * Used to type the object that is mutated by Object.assign across modules.
 */
export interface LayerSelectorAPI {
    _control: unknown;
    _selectAllCheckbox: HTMLInputElement | null;
    _layersContent: HTMLElement | null;
    _eventListeners: EventListenerEntry[];
    _layers: LayerLike[];
    _basemaps: BasemapLike[];

    init(control: unknown, layersContent: HTMLElement): void;
    populate(): Promise<void>;
    cleanup(): void;

    loadSelection(profileId: string): Promise<SavedSelection | null>;
    saveSelection(): Promise<void>;
    handleSelectAllChange(): Promise<void>;
    updateSelectAllCheckbox(): void;
    updateWarning(): Promise<void>;

    getLayerGeometryType(layer: LayerLike): Promise<string | null>;
    getLayerLabel(layer: LayerLike): Promise<string | null>;
    estimateLayerSize(layer: LayerLike): Promise<number>;
    estimateBasemapSize(basemap: BasemapLike): BasemapSizeEstimate;
    latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number };

    _createTableHeader(table: HTMLTableElement): void;
    createLayerRow(
        tbody: HTMLTableSectionElement,
        layer: LayerLike,
        savedSelection: SavedSelection | null,
        profileCacheEnabled?: boolean
    ): Promise<void>;
    createBasemapRow(
        tbody: HTMLTableSectionElement,
        basemap: BasemapLike,
        savedSelection: SavedSelection | null,
        tileCacheEnabled?: boolean
    ): Promise<void>;
    createStyleSelector(
        parentEl: HTMLElement,
        layer: LayerLike,
        savedSelection: SavedSelection | null
    ): Promise<void>;

    isLayerCached(layer: LayerLike): Promise<boolean>;
    isBasemapCached(basemap: BasemapLike): Promise<boolean>;
    refreshCacheIcons(): Promise<void>;
}
