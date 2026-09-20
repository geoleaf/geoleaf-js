/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table - Virtual Scroll
 * Renders only visible rows + a buffer for large datasets (> VIRTUAL_THRESHOLD rows).
 */

import { $create } from "./utils/dom-helpers.js";
import { clearElementFast } from "@geoleaf/host-runtime";
import { events as _events } from "./utils/events.js";
import { _eventCleanups } from "./event-cleanups.js";

// The 3 virtual-scroll constants lived in `table-renderer-utils.ts`, whose
// catch-all name covered four subjects. They are here, at their only real
// place of use: `VIRTUAL_THRESHOLD` is read by `renderer.ts` to decide
// whether to enable this mode, the other two serve only this file.
/** Row height, in pixels — drives the window computation and the top/bottom spacers. */
const VIRTUAL_ROW_HEIGHT = 32;
/** Extra rows rendered on either side of the visible window. */
const VIRTUAL_BUFFER = 20;
/** Beyond this row count, rendering switches to virtual scrolling. */
export const VIRTUAL_THRESHOLD = 150;
import type { TableColumnDef, TableLayerTableConfig } from "./types.js";
import type { TableRow } from "./view-model.js";

type CreateRowFn = (
    row: TableRow,
    columns: TableColumnDef[],
    selectedIds: Set<string>
) => HTMLElement;

interface VirtualState {
    rows: TableRow[];
    columns: TableColumnDef[];
    selectedIds: Set<string>;
    layerConfig: TableLayerTableConfig | null;
    createRowFn: CreateRowFn;
}

/** @type {WeakMap<HTMLElement, VirtualState>} */
const _virtualState = new WeakMap<HTMLElement, VirtualState>();

/**
 * Registers virtual scroll state for a container.
 * Must be called right after createTableBodyVirtual() and before setupVirtualScroll().
 */
export function initVirtualState(
    container: HTMLElement,
    rows: TableRow[],
    columns: TableColumnDef[],
    selectedIds: Set<string>,
    layerConfig: TableLayerTableConfig | null,
    createRowFn: CreateRowFn
): void {
    _virtualState.set(container, { rows, columns, selectedIds, layerConfig, createRowFn });
}

/**
 * Creates a fixed-height tbody for virtual scrolling.
 * Only the initially visible window is populated; subsequent rows are rendered on scroll.
 *
 * ⚠️ The height is that of the **visible** row set, not of the layer: a search narrows the
 * set, and a height left at the unfiltered count would leave the user scrolling through
 * emptiness. It was posed once, at first render, until this change.
 *
 * @param rows - Every visible row, feature and identity together
 * @param columns - Column config
 * @param selectedIds - Selected IDs
 * @param createRowFn - Row factory from the main renderer
 */
export function createTableBodyVirtual(
    rows: TableRow[],
    columns: TableColumnDef[],
    selectedIds: Set<string>,
    createRowFn: CreateRowFn
): HTMLElement {
    const tbody = $create("tbody") as HTMLElement;
    tbody.setAttribute("data-virtual", "true");
    tbody.style.height = rows.length * VIRTUAL_ROW_HEIGHT + "px";
    updateVirtualRows(tbody, rows, columns, selectedIds, 0, createRowFn);
    return tbody;
}

/**
 * Fills tbody with a top spacer, visible rows, and a bottom spacer based on scrollTop.
 * @param {HTMLElement} tbody - Virtual tbody element
 * @param rows - Every visible row, feature and identity together
 * @param columns - Column config
 * @param selectedIds - Selected IDs
 * @param scrollTop - Current scroll position of the wrapper
 * @param createRowFn - Row factory from the main renderer
 */
export function updateVirtualRows(
    tbody: HTMLElement,
    rows: TableRow[],
    columns: TableColumnDef[],
    selectedIds: Set<string>,
    scrollTop: number,
    createRowFn: CreateRowFn
): void {
    const wrapper = tbody.closest(".gl-table-panel__wrapper");
    const clientHeight = wrapper ? wrapper.clientHeight : 400;
    const total = rows.length;
    const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_BUFFER);
    const endIndex = Math.min(
        total,
        Math.ceil((scrollTop + clientHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_BUFFER
    );
    const windowRows = rows.slice(startIndex, endIndex);
    const colCount = columns && columns.length ? columns.length + 1 : 2;

    clearElementFast(tbody);

    const fragment = document.createDocumentFragment();

    if (startIndex > 0) {
        const spacerTop = $create("tr", { className: "gl-table-panel__spacer" });
        const tdTop = $create("td", { colSpan: colCount });
        tdTop.style.height = startIndex * VIRTUAL_ROW_HEIGHT + "px";
        spacerTop.appendChild(tdTop);
        fragment.appendChild(spacerTop);
    }

    windowRows.forEach((row: TableRow) => {
        const tr = createRowFn(row, columns, selectedIds);
        tr.style.height = VIRTUAL_ROW_HEIGHT + "px";
        fragment.appendChild(tr);
    });

    if (endIndex < total) {
        const spacerBottom = $create("tr", { className: "gl-table-panel__spacer" });
        const tdBottom = $create("td", { colSpan: colCount });
        tdBottom.style.height = (total - endIndex) * VIRTUAL_ROW_HEIGHT + "px";
        spacerBottom.appendChild(tdBottom);
        fragment.appendChild(spacerBottom);
    }

    tbody.appendChild(fragment);
}

/**
 * Attaches a passive scroll listner to the table wrapper.
 * On each scroll, re-renders the visible window of rows.
 * @param {HTMLElement} container - Tabthe module container
 */
export function setupVirtualScroll(container: HTMLElement): void {
    const wrapper = container.querySelector(".gl-table-panel__wrapper");
    const table = container.querySelector(".gl-table-panel__table");
    if (!wrapper || !table) return;

    const tbody = table.querySelector("tbody[data-virtual=true]") as HTMLElement | null;
    if (!tbody) return;

    const onScroll = () => {
        const state = _virtualState.get(container);
        if (!state) return;
        updateVirtualRows(
            tbody,
            state.rows,
            state.columns,
            state.selectedIds,
            wrapper.scrollTop,
            state.createRowFn
        );
    };

    _eventCleanups.push(
        _events.on(wrapper, "scroll", onScroll, { passive: true }, "TableRenderer.virtualScroll")
    );
}
