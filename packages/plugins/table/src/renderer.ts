/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table - Renderer Module (orchestrator)
 * Renders columns, rows and pagination with virtual scrolling.
 *
 * Sub-modules:
 *  - feature-id.ts / format-value.ts / event-cleanups.ts — identité, formatage, teardowns
 *  - table-renderer-virtual-scroll.ts — virtual scrolling for large datasets
 *  - selection-actions.ts  — row selection logic (single, multi, range, toggle-all)
 */

import { Log } from "@geoleaf/host-runtime";
import { $create } from "./utils/dom-helpers.js";
import { getNestedValue } from "@geoleaf/host-runtime";
import { clearElementFast } from "@geoleaf/host-runtime";
import { _g } from "./table-state.js";
import { events as _events } from "./utils/events.js";
import { TableContract } from "./table-seam.js";
import { resetSyntheticIdCounter, getFeatureId } from "./feature-id.js";
import { formatValue } from "./format-value.js";
import { _eventCleanups } from "./event-cleanups.js";
import {
    VIRTUAL_THRESHOLD,
    createTableBodyVirtual,
    initVirtualState,
    setupVirtualScroll,
} from "./table-renderer-virtual-scroll.js";
import {
    handleRowSelection,
    toggleAllRows,
    updateToolbarButtonsState,
} from "./selection-actions.js";
import type { EventCleanup } from "./event-cleanups.js";
import type {
    SortState,
    TableColumnDef,
    TableFeature,
    TableLayerTableConfig,
    TableRenderOptions,
} from "./types.js";

/** Public surface of the table renderer object. */
interface TableRendererApi {
    _eventCleanups: EventCleanup[];
    _flushEventCleanups(): void;
    destroy(): void;
    render(container: HTMLElement | null, options: TableRenderOptions): void;
    updateSelection(container: HTMLElement | null, selectedIds: Set<string>): void;
    [key: string]: unknown;
}

const _TableRenderer = {} as TableRendererApi;
// Exposes the shared cleanup array on the object for backward compatibility
_TableRenderer._eventCleanups = _eventCleanups;

/**
 * Flush all tracked event cleanups (called before re-render and on destroy).
 */
_TableRenderer._flushEventCleanups = function () {
    const cleanups = _eventCleanups;
    for (let i = 0; i < cleanups.length; i++) {
        const item = cleanups[i];
        if (typeof item === "function") {
            try {
                item();
            } catch (_e) {
                /* ignore */
            }
        } else if (typeof item === "number") {
            try {
                _events?.off(item);
            } catch (_e) {
                /* ignore */
            }
        }
    }
    cleanups.length = 0;
};

/**
 * Destroy the table renderer and clean up all event listners.
 */
_TableRenderer.destroy = function () {
    this._flushEventCleanups();
};

function _getLayerTableConfig(layerId: string): TableLayerTableConfig | null {
    const layerData = _g.GeoLeaf.GeoJSON?.getLayerById?.(layerId);
    return (layerData?.config?.table as TableLayerTableConfig | undefined) ?? null;
}

function _renderTableBody(
    container: HTMLElement,
    features: TableFeature[],
    columns: TableColumnDef[],
    selectedIds: Set<string>,
    layerConfig: TableLayerTableConfig | null,
    table: HTMLElement
): void {
    if (features.length > VIRTUAL_THRESHOLD) {
        const tbody = createTableBodyVirtual(features, columns, selectedIds, createTableRow);
        table.appendChild(tbody);
        initVirtualState(container, features, columns, selectedIds, layerConfig, createTableRow);
        setupVirtualScroll(container);
    } else {
        const tbody = createTableBody(features, columns, selectedIds);
        table.appendChild(tbody);
    }
}

/**
 * Renders the table with the provided data.
 * @param {HTMLElement} container - Table container
 * @param {Object} options - Render options
 * @param {string} options.layerId - Layer ID
 * @param {Array} options.features - Features to display
 * @param {Set} options.selectedIds - IDs of the selected entities
 * @param {Object} options.sortState - Sort state
 */
_TableRenderer.render = function (container: HTMLElement | null, options: TableRenderOptions) {
    Log.debug("[TableRenderer] render() - Start, options:", options);

    if (!container) {
        Log.error("[TableRenderer] Conteneur invalide");
        return;
    }

    // Flush previous event cleanups before re-render
    _TableRenderer._flushEventCleanups();

    // Reset the synthetic-ID counter on each render
    resetSyntheticIdCounter();

    const { layerId, features, selectedIds, sortState } = options;
    Log.debug(
        "[TableRenderer] render() - layerId:",
        layerId,
        "features:",
        features ? features.length : 0
    );

    const table = container.querySelector<HTMLElement>(".gl-table-panel__table");
    if (!table) {
        Log.error("[TableRenderer] Table element not found");
        return;
    }

    // If no layerId, empty the table
    if (!layerId) {
        // SAFE: Empty string to clear the content
        clearElementFast(table);
        Log.debug("[TableRenderer] Table cleared (no layer selected)");
        return;
    }

    // Retrieve the layer config
    const layerConfig = _getLayerTableConfig(layerId);

    if (!layerConfig?.columns) {
        Log.warn("[TableRenderer] No column configuration for", layerId);
        // SAFE: Empty string to clear the content
        clearElementFast(table);
        return;
    }

    Log.debug("[TableRenderer] Colonnes:", layerConfig.columns);

    // Empty the table before rebuilding
    clearElementFast(table);

    // Create the thead
    const thead = createTableHead(layerConfig.columns, sortState);
    table.appendChild(thead);

    _renderTableBody(container, features, layerConfig.columns, selectedIds, layerConfig, table);

    Log.debug("[TableRenderer] Tableau rendu:", features.length, "lines");
};

function _buildCheckboxTh(): HTMLElement {
    const thCheckbox = $create("th", {
        className: "gl-table-panel__th gl-table-panel__th--checkbox",
    }) as HTMLElement;
    const checkboxAll = $create("input", {
        type: "checkbox",
        className: "gl-table-panel__checkbox-all",
        title: "Select all / Deselect all",
    }) as HTMLInputElement;
    const checkboxAllHandler = (e: Event) => {
        toggleAllRows((e.target as HTMLInputElement).checked);
    };
    if (_events) {
        _eventCleanups.push(
            _events.on(
                checkboxAll,
                "change",
                checkboxAllHandler,
                false,
                "TableRenderer.checkboxAll"
            )
        );
    } else {
        checkboxAll.addEventListener("change", checkboxAllHandler);
    }
    thCheckbox.appendChild(checkboxAll);
    return thCheckbox;
}

function _buildSortableTh(col: TableColumnDef, sortState: SortState): HTMLElement {
    const th = $create("th", { className: "gl-table-panel__th" }) as HTMLElement;
    th.textContent = col.label || col.field;
    if (col.width) {
        th.style.width = col.width;
    }
    const isSortable = col.sortable !== false;
    if (isSortable) {
        th.classList.add("gl-table-panel__th--sortable");
        th.setAttribute("data-field", col.field);
        const sortIcon = $create("span", { className: "gl-table-panel__sort-icon" }) as HTMLElement;
        if (sortState.field === col.field) {
            if (sortState.direction === "asc") {
                sortIcon.textContent = " \u25b2"; // ▲
                th.classList.add("is-sorted-asc");
            } else if (sortState.direction === "desc") {
                sortIcon.textContent = " \u25bc"; // ▼
                th.classList.add("is-sorted-desc");
            }
        } else {
            sortIcon.textContent = " \u2195"; // ↕
        }
        th.appendChild(sortIcon);
        const sortHandler = () => {
            TableContract.sortByField(col.field);
        };
        if (_events) {
            _eventCleanups.push(_events.on(th, "click", sortHandler, false, "TableRenderer.sort"));
        } else {
            th.addEventListener("click", sortHandler);
        }
    }
    return th;
}

/**
 * Creates the table header (thead).
 * @param {Array} columns - Columns configuration
 * @param {Object} sortState - Current sort state
 * @returns {HTMLElement}
 * @private
 */
function createTableHead(columns: TableColumnDef[], sortState: SortState): HTMLElement {
    const thead = $create("thead") as HTMLElement;
    const tr = $create("tr") as HTMLElement;
    tr.appendChild(_buildCheckboxTh());
    columns.forEach((col: TableColumnDef) => {
        tr.appendChild(_buildSortableTh(col, sortState));
    });
    thead.appendChild(tr);
    return thead;
}

/**
 * Creates the table body (tbody).
 * @param {Array} features - Features to display
 * @param {Array} columns - Columns configuration
 * @param {Set} selectedIds - Selected IDs
 * @returns {HTMLElement}
 * @private
 */
function createTableBody(
    features: TableFeature[],
    columns: TableColumnDef[],
    selectedIds: Set<string>
): HTMLElement {
    Log.debug("[TableRenderer] createTableBody() - features:", features.length);

    const tbody = $create("tbody") as HTMLElement;

    // Use DocumentFragment for batch DOM operations
    const fragment = document.createDocumentFragment();

    features.forEach((feature: TableFeature) => {
        const tr = createTableRow(feature, columns, selectedIds);
        fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);

    Log.debug("[TableRenderer] tbody created with", tbody.children.length, "rows");
    return tbody;
}

function _buildRowCheckboxTd(featureId: string): HTMLElement {
    const tdCheckbox = $create("td", {
        className: "gl-table-panel__td gl-table-panel__td--checkbox",
    }) as HTMLElement;
    const checkbox = $create("input", {
        type: "checkbox",
        className: "gl-table-panel__checkbox",
    }) as HTMLInputElement;
    const checkboxHandler = (e: Event) => {
        handleRowSelection(featureId, (e.target as HTMLInputElement).checked, false, true, true);
    };
    if (_events) {
        _eventCleanups.push(
            _events.on(checkbox, "change", checkboxHandler, false, "TableRenderer.checkbox")
        );
    } else {
        checkbox.addEventListener("change", checkboxHandler);
    }
    tdCheckbox.appendChild(checkbox);
    return tdCheckbox;
}

function _attachRowClickEvent(tr: HTMLElement, featureId: string): void {
    const rowClickHandler = (e: MouseEvent) => {
        if ((e.target as HTMLElement).getAttribute?.("type") === "checkbox") return;
        const currentState = tr.classList.contains("gl-is-selected");
        handleRowSelection(featureId, !currentState, e.shiftKey, e.ctrlKey || e.metaKey);
    };
    if (_events) {
        _eventCleanups.push(
            _events.on(
                tr,
                "click",
                rowClickHandler as EventListener,
                false,
                "TableRenderer.rowClick"
            )
        );
    } else {
        tr.addEventListener("click", rowClickHandler);
    }
}

/**
 * Creates a table row.
 * @param {Object} feature - GeoJSON feature
 * @param {Array} columns - Columns configuration
 * @param {Set} selectedIds - Selected IDs
 * @returns {HTMLElement}
 * @private
 */
function createTableRow(
    feature: TableFeature,
    columns: TableColumnDef[],
    selectedIds: Set<string>
): HTMLElement {
    const tr = $create("tr") as HTMLElement;
    const featureId = getFeatureId(feature);
    tr.setAttribute("data-feature-id", featureId);
    if (selectedIds.has(String(featureId))) {
        tr.classList.add("gl-is-selected");
    }
    const tdCheckbox = _buildRowCheckboxTd(featureId);
    const checkbox = tdCheckbox.querySelector(".gl-table-panel__checkbox") as HTMLInputElement;
    if (checkbox) checkbox.checked = selectedIds.has(String(featureId));
    tr.appendChild(tdCheckbox);
    columns.forEach((col: TableColumnDef) => {
        const td = $create("td", { className: "gl-table-panel__td" }) as HTMLElement;
        const value = getNestedValue(feature, col.field);
        td.textContent = formatValue(value, col.type);
        if (col.type === "number") {
            td.classList.add("gl-table-panel__td--number");
        }
        tr.appendChild(td);
    });
    _attachRowClickEvent(tr, featureId);
    return tr;
}

/**
 * Updates the visual selection in the table without re-rendering all rows.
 * @param {HTMLElement} container - Table container
 * @param {Set} selectedIds - Selected IDs
 */
_TableRenderer.updateSelection = function (
    container: HTMLElement | null,
    selectedIds: Set<string>
) {
    // Behaviour preserved: a null container throws at the first access, as before.
    const tbody = container!.querySelector(".gl-table-panel__table tbody");
    if (!tbody) return;

    const rows = tbody.querySelectorAll("tr");

    rows.forEach((row: Element) => {
        const id = row.getAttribute("data-feature-id");
        const isSelected = selectedIds.has(String(id));

        row.classList.toggle("gl-is-selected", isSelected);

        const checkbox = row.querySelector(".gl-table-panel__checkbox") as HTMLInputElement | null;
        if (checkbox) {
            checkbox.checked = isSelected;
        }
    });

    // Update the "select all" checkbox
    const checkboxAll = container!.querySelector(
        ".gl-table-panel__checkbox-all"
    ) as HTMLInputElement | null;
    if (checkboxAll) {
        // Count only feature rows (rows with data-feature-id) to exclude virtual-scroll spacers
        const totalRows = tbody.querySelectorAll("tr[data-feature-id]").length;
        const selectedCount = selectedIds.size;
        checkboxAll.checked = totalRows > 0 && selectedCount === totalRows;
        checkboxAll.indeterminate = selectedCount > 0 && selectedCount < totalRows;
    }

    updateToolbarButtonsState();
};

const TableRenderer = _TableRenderer;
export { TableRenderer };
