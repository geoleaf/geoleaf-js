/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Table (module ↔ UI decoupling boundary)
 *
 * Pure ESM interface that lets the UI submodules (panel.ts, renderer.ts,
 * selection-actions.ts) call into the Table module without importing the
 * `table-api.ts` facade directly — a direct import would create a cycle, since
 * the facade already statically imports `panel.ts` to build the panel.
 *
 * Cycle avoided:
 *   table-api.ts → panel.ts     (static import — the facade builds the panel)
 *   panel.ts     → contract.ts  (registration pattern — no back-import)
 *   table-api.ts registers the live module into the contract at load time.
 *
 * Usage (panel.ts / renderer.ts / selection-actions.ts):
 *   import { TableContract } from "./table-seam.js";
 *   TableContract.setLayer(layerId);   // guarded no-op until the module registers
 *
 * Registration (table-api.ts):
 *   TableContract.register(Table, _TablePanel);
 */

/**
 * Structural view of the Table module facade registered via {@link register}.
 *
 * All members are optional: the contract guards each call with a runtime
 * `typeof … === "function"` check, so the registered object may expose only a
 * subset (or a forward-compat superset). Param types mirror the underlying
 * `table-api.ts` signatures so callers compile against the same shapes.
 */
interface TableInstanceLike {
    setLayer?(layerId: string | null | undefined): void;
    zoomToSelection?(): void;
    highlightSelection?(active: boolean): void;
    exportSelection?(format?: string, options?: object): void;
    exportLayer?(format?: string, options?: object): void;
    toggle?(): void;
    show?(): void;
    getSelectedIds?(): string[];
    setSelection?(ids: string[], fireEvent?: boolean): void;
    clearSelection?(): void;
    sortByField?(field: string): void;
}

/**
 * Structural view of the Table panel registered alongside the module.
 * Only `updateToolbarButtons` is consumed through this contract.
 */
interface TablePanelLike {
    updateToolbarButtons?(selectedCount: number): void;
}

let _table: TableInstanceLike | null = null;
let _panel: TablePanelLike | null = null;

/**
 * Interface contract for the Table module.
 * Lets the UI submodules call the Table methods without importing the
 * `table-api.ts` facade (which would create a cycle).
 * @namespace TableContract
 */
const TableContract = {
    /**
     * Registers the Table instance (called by table-api.ts at load time).
     * @param {TableInstanceLike} tableInstance
     * @param {TablePanelLike} [panelInstance]
     */
    register(tableInstance: TableInstanceLike, panelInstance?: TablePanelLike) {
        _table = tableInstance;
        if (panelInstance) _panel = panelInstance;
    },

    /**
     * Returns true if the Table module is available.
     * @returns {boolean}
     */
    isAvailable() {
        return !!_table;
    },

    /**
     * @param {string} layerId
     */
    setLayer(layerId: string) {
        if (_table && typeof _table.setLayer === "function") {
            _table.setLayer(layerId);
        }
    },

    /**
     * Zooms to the current selection.
     */
    zoomToSelection() {
        if (_table && typeof _table.zoomToSelection === "function") {
            _table.zoomToSelection();
        }
    },

    /**
     * @param {boolean} active
     */
    highlightSelection(active: boolean) {
        if (_table && typeof _table.highlightSelection === "function") {
            _table.highlightSelection(active);
        }
    },

    /**
     * Exports selected features in the given format (default: 'geojson').
     * @param {string} [format] - 'geojson' | 'csv' | 'kml' | 'gpx' | 'excel'
     * @param {object} [options] - ExportOptions (csvSeparator, csvIncludeGeometry)
     */
    exportSelection(format?: string, options?: object) {
        if (_table && typeof _table.exportSelection === "function") {
            _table.exportSelection(format, options);
        }
    },

    /**
     * Exports all features of the active layer in the given format (default: 'geojson').
     * @param {string} [format] - 'geojson' | 'csv' | 'kml' | 'gpx' | 'excel'
     * @param {object} [options] - ExportOptions (csvSeparator, csvIncludeGeometry)
     */
    exportLayerAll(format?: string, options?: object) {
        if (_table && typeof _table.exportLayer === "function") {
            _table.exportLayer(format, options);
        }
    },

    /**
     * Toggles the table visibility.
     */
    toggle() {
        if (_table && typeof _table.toggle === "function") {
            _table.toggle();
        }
    },

    /**
     * Displays the table.
     */
    show() {
        if (_table && typeof _table.show === "function") {
            _table.show();
        }
    },

    // ── Selection API ──

    /**
     * @returns {string[]}
     */
    getSelectedIds() {
        if (_table && typeof _table.getSelectedIds === "function") {
            return _table.getSelectedIds();
        }
        return [];
    },

    /**
     * @param {string[]} ids
     * @param {boolean} [fireEvent]
     */
    setSelection(ids: string[], fireEvent?: boolean) {
        if (_table && typeof _table.setSelection === "function") {
            _table.setSelection(ids, fireEvent);
        }
    },

    /**
     * Clear the selection.
     */
    clearSelection() {
        if (_table && typeof _table.clearSelection === "function") {
            _table.clearSelection();
        }
    },

    /**
     * @param {string} field
     */
    sortByField(field: string) {
        if (_table && typeof _table.sortByField === "function") {
            _table.sortByField(field);
        }
    },

    /**
     * Updates the panel toolbar buttons.
     * @param {number} selectedCount
     */
    updateToolbarButtons(selectedCount: number) {
        if (_panel && typeof _panel.updateToolbarButtons === "function") {
            _panel.updateToolbarButtons(selectedCount);
        }
    },
};

export { TableContract };
