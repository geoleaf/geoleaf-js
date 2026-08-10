/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table - Selection Manager
 * Row selection logic: single click, Ctrl+click (multi), Shift+click (range), toggle-all.
 */

import { Log } from "@geoleaf/host-runtime";
import { TableContract } from "./table-seam.js";

/**
 * Updates the toolbar buttons state based on the number of selected rows.
 */
export function updateToolbarButtonsState(): void {
    const selectedCount = TableContract.getSelectedIds().length;
    TableContract.updateToolbarButtons(selectedCount);
}

/**
 * Manages the selection of a row (single, multi, range or checkbox).
 * @param {string} featureId - Feature ID
 * @param {boolean} selected - Selected or not
 * @param {boolean} shiftKey - Shift key pressed
 * @param {boolean} ctrlKey - Ctrl/Cmd key pressed
 * @param {boolean} isCheckbox - Whether the action comes from a checkbox
 */
export function handleRowSelection(
    featureId: string,
    selected: boolean,
    shiftKey: boolean,
    ctrlKey: boolean,
    isCheckbox = false
): void {
    Log.debug("[TableRenderer] handleRowSelection - featureId:", featureId, "selected:", selected);

    const currentSelection = TableContract.getSelectedIds();

    if (shiftKey && currentSelection.length > 0) {
        // Range selection (Shift+click)
        Log.debug("[TableRenderer] SHIFT mode - Range selection");
        selectRange(featureId);
    } else if (ctrlKey || isCheckbox) {
        // Multi-selection (Ctrl+click or checkbox)
        Log.debug(
            "[TableRenderer] MULTI mode - Multi-selection" +
                (isCheckbox ? " (checkbox)" : " (Ctrl)")
        );
        if (selected) {
            const newSelection = [...currentSelection, featureId];
            TableContract.setSelection(newSelection, false);
        } else {
            const newSelection = currentSelection.filter((id: string) => id !== featureId);
            TableContract.setSelection(newSelection, false);
        }
    } else {
        // Single selection
        Log.debug("[TableRenderer] SIMPLE mode - Single selection");
        if (selected) {
            TableContract.setSelection([featureId], false);
        } else {
            TableContract.clearSelection();
        }
    }

    updateToolbarButtonsState();
}

/**
 * Selects a range of rows (Shift+click) between the last selection and the target.
 * @param {string} targetId - Target feature ID
 */
export function selectRange(targetId: string): void {
    const tbody = document.querySelector(".gl-table-panel__table tbody");
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll("tr"));
    const currentSelection = TableContract.getSelectedIds();
    const lastSelected = currentSelection[currentSelection.length - 1];

    const targetIndex = rows.findIndex((r) => r.getAttribute("data-feature-id") === targetId);
    const lastIndex = rows.findIndex((r) => r.getAttribute("data-feature-id") === lastSelected);

    if (targetIndex === -1 || lastIndex === -1) return;

    const start = Math.min(targetIndex, lastIndex);
    const end = Math.max(targetIndex, lastIndex);

    const rangeIds = [];
    for (let i = start; i <= end; i++) {
        const id = rows[i]?.getAttribute("data-feature-id");
        if (id) rangeIds.push(id);
    }

    TableContract.setSelection(rangeIds, false);
    updateToolbarButtonsState();
}

/**
 * Toggles all rows via the "select all" checkbox.
 * @param {boolean} checked - Checkbox state
 */
export function toggleAllRows(checked: boolean): void {
    const tbody = document.querySelector(".gl-table-panel__table tbody");
    if (!tbody) return;

    const rows = tbody.querySelectorAll("tr");
    const ids: string[] = [];

    rows.forEach((row: Element) => {
        const id = row.getAttribute("data-feature-id");
        if (id) {
            ids.push(id);
            row.classList.toggle("gl-is-selected", checked);
            const checkbox = row.querySelector(
                ".gl-table-panel__checkbox"
            ) as HTMLInputElement | null;
            if (checkbox) checkbox.checked = checked;
        }
    });

    if (checked) {
        TableContract.setSelection(ids, false);
    } else {
        TableContract.clearSelection();
    }

    updateToolbarButtonsState();
}
