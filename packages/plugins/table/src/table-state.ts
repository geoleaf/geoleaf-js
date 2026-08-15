/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table – Shared mutable state, utilities.
 */

import type { GeoLeafEventMap } from "@geoleaf/core";

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

/**
 * The nine event names this plugin emits — **derived from `GeoLeafEventMap`, not listed here**.
 *
 * ⚠️ **Deriving is the point, and re-listing would undo it.** A hand-written union would be a
 * second copy of the map, and this repo has measured what two copies of one reader do: they
 * diverge, and the divergence is invisible while both sides stay green. Here the map is the
 * only source — add a `geoleaf:table:*` key there and it becomes emittable; remove one and
 * every site that emits it stops compiling.
 */
export type TableEventName = Extract<keyof GeoLeafEventMap, `geoleaf:table:${string}`>;

/**
 * Emits an event on the map and the document DOM.
 *
 * Takes the **COMPLETE** event name, and a `detail` checked against `GeoLeafEventMap`.
 *
 * 🛑 **Ceci a pris un suffixe jusqu'au 13/08/2026, et ce n'était pas un détail de style.**
 * L'ancienne forme composait `"geoleaf:" + eventName`, donc aucun littéral complet n'existait
 * en source — or les gates d'événements du dépôt relèvent des littéraux sur l'AST. Les neuf
 * noms étaient structurellement invisibles à `EVENT-MAP`, `CONSUMER-CONTRACT` devait les
 * déclarer hors de portée, et deux d'entre eux ont été classés « cassés » chez le consommateur
 * aval sur la foi de cette cécité — alors qu'ils étaient émis ET écoutés.
 *
 * Accepter un `string` nu ici rouvrirait le trou en silence : c'est pourquoi le paramètre est
 * contraint, et pourquoi la contrainte se DÉRIVE de la map plutôt que de se recopier.
 *
 * ⚠️ Les deux bus portent chaque nom — `document` **et** la carte. Un abonné choisit, il ne
 * prend pas les deux, sinon il traite chaque événement en double.
 */
export function fireEvent<K extends TableEventName>(
    eventName: K,
    detail: GeoLeafEventMap[K]
): void {
    if (tableState._map && typeof tableState._map.fire === "function") {
        tableState._map.fire(eventName, detail);
    }
    if (typeof document !== "undefined" && document.dispatchEvent) {
        document.dispatchEvent(new CustomEvent(eventName, { detail }));
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
