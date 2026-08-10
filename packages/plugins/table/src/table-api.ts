/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table API - Orchestrator and public API.
 * Wires together table-state, table-layer, table-highlight and table-selection sub-modules.
 */
/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "@geoleaf/host-runtime";
import { tableState, fireEvent, _g } from "./table-state.js";
import {
    getLayerFeatures,
    getAvailableLayers,
    getAvailableVisibleLayers,
    attachMapEvents,
} from "./table-layer.js";
import {
    clearHighlightLayers,
    highlightSelection,
    extendBoundsFromGeometry,
} from "./table-highlight.js";
import {
    setSelection,
    clearSelection,
    getSelectedIds,
    zoomToSelection,
    exportSelection,
    exportLayerAll,
} from "./table-selection.js";
import { getNestedValue } from "@geoleaf/host-runtime";
import { sortInPlace, nextSortState } from "./sort.js";
import { resolveFeatureId } from "./export.js";
import { TablePanel as _TablePanel } from "./panel.js";
import { TableRenderer as _TableRenderer } from "./renderer.js";
import { TableContract } from "./table-seam.js";
import { getPluginConfig } from "./config.js";
import type { ExportFormat, ExportOptions } from "./export.js";
import type {
    TableBounds,
    TableConfig,
    TableFeature,
    TableGeoJSONApi,
    TableGeometry,
    TableInitOptions,
    TableLayerData,
} from "./types.js";

function applySorting(): void {
    sortInPlace(tableState._cachedData, tableState._sortState, (o: unknown, p: string) =>
        getNestedValue(o as object | null | undefined, p)
    );
    Log.debug(
        "[Table] Sort applied:",
        tableState._sortState.field,
        tableState._sortState.direction
    );
}

/**
 * Reflects the table's open/closed state onto its two trigger buttons so they look
 * active like the native UI controls. Both buttons live in the DOM at every viewport
 * (the desktop tab strip is built unconditionally and hidden by CSS under 1440px),
 * so syncing both also covers the mobile→desktop resize case.
 *
 * - Desktop vertical tab "Tableau" (`[data-gl-desktop-tab="table"]`): a dedicated
 *   `gl-table-tab-active` class (styled in the plugin CSS) — NOT the core `gl-is-active`,
 *   which `_closeAllTabs` strips whenever a native tab is clicked.
 * - Mobile pill icon (`[data-gl-sheet="table"]`): the core `gl-map-toolbar__btn--active`
 *   class, which no core handler touches for this button.
 */
function _syncTriggerButtons(active: boolean): void {
    if (typeof document === "undefined") return;
    const deskTab = document.querySelector<HTMLElement>('[data-gl-desktop-tab="table"]');
    if (deskTab) {
        deskTab.classList.toggle("gl-table-tab-active", active);
        deskTab.setAttribute("aria-selected", active ? "true" : "false");
    }
    const pill = document.querySelector<HTMLElement>('[data-gl-sheet="table"]');
    if (pill) {
        pill.classList.toggle("gl-map-toolbar__btn--active", active);
        pill.setAttribute("aria-expanded", active ? "true" : "false");
    }
    document.body.classList.toggle("gl-table-open", active);
}

const TableModule = {
    init(options: TableInitOptions | null | undefined) {
        if (!options || !options.map) {
            Log.error("[Table] init() requires a MapLibre map instance");
            return;
        }
        tableState._map = options.map;
        // Config is read from the `modules.table` namespace via the plugin config
        // reader (defaults merged in), then overridden by any init-time options.
        tableState._config = Object.assign({}, getPluginConfig(), options.config) as TableConfig;
        if (!tableState._config.enabled) {
            Log.info("[Table] Module disabled via configuration");
            return;
        }
        Log.info("[Table] Initialisation du module Table", tableState._config);
        if (_TablePanel && typeof _TablePanel.create === "function") {
            tableState._container = _TablePanel.create(tableState._map, tableState._config);
        } else {
            Log.error("[Table] Module table/panel.js not loaded");
            return;
        }
        if (tableState._config.defaultVisible) {
            this.show();
        }
        attachMapEvents(
            () => this.refresh(),
            (layerId: string) => this.setLayer(layerId)
        );
        // Populate the layer selector immediately: when the panel is built lazily
        // (after `geoleaf:geojson:layers-loaded` already fired), the event-driven
        // refresh would otherwise never run for the already-loaded layers.
        if (_TablePanel && typeof _TablePanel.refreshLayerSelector === "function") {
            _TablePanel.refreshLayerSelector();
        }
        Log.info("[Table] Table module initialized successfully");
    },

    show() {
        if (!tableState._container) {
            Log.warn("[Table] Container not initialized");
            return;
        }
        tableState._container.classList.add("gl-is-visible");
        tableState._isVisible = true;
        _syncTriggerButtons(true);
        fireEvent("table:opened", {});
        Log.debug("[Table] Table shown");
    },

    hide() {
        if (!tableState._container) return;
        clearHighlightLayers();
        tableState._highlightActive = false;
        tableState._container.classList.remove("gl-is-visible");
        tableState._isVisible = false;
        _syncTriggerButtons(false);
        fireEvent("table:closed", {});
        Log.debug("[Table] Table hidden");
    },

    toggle() {
        if (tableState._isVisible) {
            this.hide();
        } else {
            this.show();
        }
    },

    setLayer(layerId: string | null | undefined) {
        Log.debug("[Table] setLayer called with:", layerId);
        if (!layerId) {
            tableState._currentLayerId = null;
            tableState._selectedIds.clear();
            clearHighlightLayers();
            tableState._highlightActive = false;
            tableState._featureIdMap.clear();
            tableState._sortState = { field: null, direction: null };
            tableState._cachedData = [];
            if (_TableRenderer) {
                _TableRenderer.render(tableState._container, {
                    layerId: null,
                    features: [],
                    selectedIds: tableState._selectedIds,
                    sortState: tableState._sortState,
                    config: tableState._config,
                });
            }
            fireEvent("table:layerChanged", { layerId: null });
            Log.debug("[Table] Table cleared (no layer selected)");
            return;
        }
        const layers = getAvailableLayers();
        const layer = layers.find((l) => l.id === layerId);
        if (!layer) {
            Log.warn("[Table] Layer not found or not active for the table:", layerId);
            return;
        }
        tableState._currentLayerId = layerId;
        tableState._selectedIds.clear();
        clearHighlightLayers();
        tableState._highlightActive = false;
        tableState._sortState = { field: null, direction: null };
        const geojson = _g.GeoLeaf.GeoJSON as TableGeoJSONApi | undefined;
        // Faithful to the original direct call: a present GeoJSON module always
        // exposes getLayerData; a missing method would throw here as before.
        const layerData: TableLayerData | null | undefined = geojson
            ? geojson.getLayerData!(layerId)
            : null;
        if (layerData?.config?.table?.defaultSort) {
            const defaultSort = layerData.config.table.defaultSort;
            // Type-only cast — value left untouched (no `?? null` coercion).
            tableState._sortState.field = defaultSort.field as string | null;
            tableState._sortState.direction = defaultSort.direction || defaultSort.order || "asc";
        }
        this.refresh();
        fireEvent("table:layerChanged", { layerId });
        Log.debug("[Table] Layer changed:", layerId);
    },

    refresh() {
        if (!tableState._currentLayerId) {
            Log.debug("[Table] No layer selected, cannot refresh");
            return;
        }
        const features = getLayerFeatures(tableState._currentLayerId);
        tableState._cachedData = features;
        tableState._featureIdMap.clear();
        let syntheticCounter = 0;
        features.forEach((feature: TableFeature, index: number) => {
            const id = resolveFeatureId(feature, syntheticCounter);
            if (id.startsWith("__gl_row_")) syntheticCounter++;
            tableState._featureIdMap.set(id, index);
        });
        Log.debug("[Table] Features retrieved:", features.length);
        if (tableState._sortState.field && tableState._sortState.direction) {
            applySorting();
        }
        if (_TableRenderer && typeof _TableRenderer.render === "function") {
            _TableRenderer.render(tableState._container, {
                layerId: tableState._currentLayerId,
                features: tableState._cachedData,
                selectedIds: tableState._selectedIds,
                sortState: tableState._sortState,
                config: tableState._config,
            });
        } else {
            Log.error("[Table] Renderer non disponible");
        }
        Log.debug("[Table] Data refreshed:", features.length, "entities");
    },

    sortByField(field: string) {
        tableState._sortState = nextSortState(tableState._sortState, field);
        this.refresh();
        fireEvent("table:sortChanged", tableState._sortState);
    },

    setSelection: (ids: unknown[], add = false) => setSelection(ids, add),
    getSelectedIds: () => getSelectedIds(),
    clearSelection: () => clearSelection(),
    zoomToSelection: () => zoomToSelection(),
    highlightSelection: (active: boolean) => highlightSelection(active),
    exportSelection: (format?: ExportFormat, options?: ExportOptions) =>
        exportSelection(format, options),
    exportLayer: (format?: ExportFormat, options?: ExportOptions) =>
        exportLayerAll(format, options),
};

const Table = TableModule;

// State property forwarding — lets tests access/modify the state via Table._*
// as before the extraction of table-state.ts
Object.defineProperties(TableModule, {
    _map: {
        get: () => tableState._map,
        set: (v: typeof tableState._map) => {
            tableState._map = v;
        },
        configurable: true,
    },
    _container: {
        get: () => tableState._container,
        set: (v: typeof tableState._container) => {
            tableState._container = v;
        },
        configurable: true,
    },
    _config: {
        get: () => tableState._config,
        set: (v: typeof tableState._config) => {
            tableState._config = v;
        },
        configurable: true,
    },
    _currentLayerId: {
        get: () => tableState._currentLayerId,
        set: (v: typeof tableState._currentLayerId) => {
            tableState._currentLayerId = v;
        },
        configurable: true,
    },
    _selectedIds: { get: () => tableState._selectedIds, configurable: true },
    _cachedData: {
        get: () => tableState._cachedData,
        set: (v: typeof tableState._cachedData) => {
            tableState._cachedData = v;
        },
        configurable: true,
    },
    _featureIdMap: { get: () => tableState._featureIdMap, configurable: true },
    _highlightLayers: {
        get: () => tableState._highlightLayers,
        set: (v: typeof tableState._highlightLayers) => {
            tableState._highlightLayers = v;
        },
        configurable: true,
    },
    _highlightActive: {
        get: () => tableState._highlightActive,
        set: (v: typeof tableState._highlightActive) => {
            tableState._highlightActive = v;
        },
        configurable: true,
    },
    _sortState: {
        get: () => tableState._sortState,
        set: (v: typeof tableState._sortState) => {
            tableState._sortState = v;
        },
        configurable: true,
    },
    _isVisible: {
        get: () => tableState._isVisible,
        set: (v: typeof tableState._isVisible) => {
            tableState._isVisible = v;
        },
        configurable: true,
    },
    // Internal methods exposed for tests (previously on Table, now extracted)
    _getLayerFeatures: {
        value: (layerId: string) => getLayerFeatures(layerId),
        configurable: true,
    },
    _getAvailableLayers: { value: () => getAvailableLayers(), configurable: true },
    _getAvailableVisibleLayers: { value: () => getAvailableVisibleLayers(), configurable: true },
    _extendBoundsFromGeometry: {
        value: (bounds: TableBounds, geometry: TableGeometry) =>
            extendBoundsFromGeometry(bounds, geometry),
        configurable: true,
    },
});

TableContract.register(Table, _TablePanel);

export { Table };
