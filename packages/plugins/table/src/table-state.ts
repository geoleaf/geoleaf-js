/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table – Shared mutable state, utilities.
 */

import type { SortState } from "./sort.js";
import type {
    TableConfig,
    TableConfigApi,
    TableFeature,
    TableGeoJSONApi,
    TableMap,
    TableVisibilityManager,
} from "./types.js";

/** Subset of the `GeoLeaf` global namespace the table reads at runtime. */
interface GeoLeafTableNamespace {
    GeoJSON?: TableGeoJSONApi;
    Config?: TableConfigApi;
    _LayerVisibilityManager?: TableVisibilityManager;
    [key: string]: unknown;
}

/** Structural view of the runtime host carrying the `GeoLeaf` namespace. */
interface TableGlobalHost {
    GeoLeaf?: GeoLeafTableNamespace;
    [key: string]: unknown;
}

const _gRaw: TableGlobalHost = (
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {}
) as TableGlobalHost;
_gRaw.GeoLeaf = _gRaw.GeoLeaf || {};
/**
 * The global host, narrowed so `GeoLeaf` is known to exist.
 *
 * `_gRaw.GeoLeaf` is created just above if absent, which is what makes the cast honest: the
 * namespace is guaranteed present by construction, not merely asserted.
 */
export const _g: TableGlobalHost & { GeoLeaf: GeoLeafTableNamespace } = _gRaw as TableGlobalHost & {
    GeoLeaf: GeoLeafTableNamespace;
};

/**
 * Mutable state shared by the table's modules — map, config, selection, cached rows.
 *
 * A single mutable object rather than passed parameters: the renderer, the lifecycle and the
 * seams all read it, and threading it through every signature would make the module graph
 * depend on call order. ⚠️ It survives a panel rebuild, so a teardown must reset what it
 * holds — a stale `_cachedData` outlives the rows it describes.
 */
export const tableState = {
    _map: null as TableMap | null,
    _config: null as TableConfig | null,
    _currentLayerId: null as string | null,
    _selectedIds: new Set<string>(),
    _cachedData: [] as TableFeature[],
    _featureIdMap: new Map<string, number>(),
    _highlightLayers: [] as string[],
    _highlightActive: false,
    _sortState: { field: null, direction: null } as SortState,
    _container: null as HTMLElement | null,
    _isVisible: false,
};

/** Emits an event on the map and the document DOM. */
export function fireEvent(eventName: string, detail: unknown): void {
    if (tableState._map && typeof tableState._map.fire === "function") {
        tableState._map.fire("geoleaf:" + eventName, detail);
    }
    if (typeof document !== "undefined" && document.dispatchEvent) {
        document.dispatchEvent(new CustomEvent("geoleaf:" + eventName, { detail }));
    }
}

/** Returns the selected features via the ID→index cache mapping. */
export function getSelectedFeatures(): TableFeature[] {
    const result: TableFeature[] = [];
    tableState._selectedIds.forEach((id) => {
        const index = tableState._featureIdMap.get(id);
        if (index != null && tableState._cachedData[index]) {
            result.push(tableState._cachedData[index]);
        }
    });
    return result;
}
