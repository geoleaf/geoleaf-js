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
import * as viewModel from "./view-model.js";

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
        // Single selection — and the one gesture that sets the range anchor.
        Log.debug("[TableRenderer] SIMPLE mode - Single selection");
        if (selected) {
            TableContract.setSelection([featureId], false);
            viewModel.setAnchor(featureId);
        } else {
            TableContract.clearSelection();
            viewModel.setAnchor(null);
        }
    }

    updateToolbarButtonsState();
}

/**
 * Selects the range of VISIBLE rows between the anchor and the target (Shift+click).
 *
 * 🛑 Both ends are positions in the view model, never in the DOM. Reading the DOM meant
 * the anchor had to still be rendered: past 150 rows a scroll pushed it out of the window,
 * `findIndex` yielded -1 and the gesture returned silently. And what it called "the
 * anchor" was the last entry of a `Set` — an insertion order, not a user gesture.
 *
 * @param targetId - The row the user shift-clicked.
 */
export function selectRange(targetId: string): void {
    const targetPosition = viewModel.visiblePositionOfId(targetId);
    if (targetPosition === -1) return;

    const anchorPosition = viewModel.anchorVisiblePosition();
    if (anchorPosition === -1) {
        // No anchor — the gesture degrades to a single selection rather than to nothing.
        // Returning silently is what it used to do, and a shift-click that does nothing
        // is indistinguishable from a broken table.
        TableContract.setSelection([targetId], false);
        viewModel.setAnchor(targetId);
        updateToolbarButtonsState();
        return;
    }

    const start = Math.min(anchorPosition, targetPosition);
    const end = Math.max(anchorPosition, targetPosition);
    const visible = viewModel.visibleIds();
    TableContract.setSelection(visible.slice(start, end + 1), false);
    updateToolbarButtonsState();
}

/**
 * Selects or clears every VISIBLE row.
 *
 * 🛑 "Visible" means what the view model shows, not what the DOM holds. Walking the tbody
 * took the rendered window: on a 30 000-row layer "select all" quietly selected a few
 * dozen rows — and it took rows the search had hidden, because it never looked at
 * `display`. Under an active search it now takes the RESULT, which is the only reading
 * the header checkbox can honestly reflect.
 *
 * The DOM is not touched here: `setSelection` runs `TableRenderer.updateSelection`, which
 * owns the classes and the checkboxes. Doing both was two authorities over one state.
 *
 * @param checked - Target state of the header checkbox.
 */
export function toggleAllRows(checked: boolean): void {
    if (checked) {
        TableContract.setSelection(viewModel.visibleIds(), false);
    } else {
        TableContract.clearSelection();
    }
    updateToolbarButtonsState();
}
