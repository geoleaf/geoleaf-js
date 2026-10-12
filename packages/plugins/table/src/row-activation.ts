/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table — row activation
 *
 * Emits `geoleaf:table:rowActivated` when the user activates a row: a double-click on it,
 * or Enter while the row itself has the focus. The table opens nothing — it states the
 * intention and the subscriber decides what it means.
 *
 * ## Two listeners on the tbody, none on the rows
 *
 * The virtual window re-creates its rows on every scroll. A listener per row would have to
 * be re-attached each time; a delegated one sits on the tbody, which lives as long as the
 * render does, and therefore follows any row without knowing it was re-created. Row
 * selection is wired the same way, for the same reason (`renderer.ts`).
 *
 * ## 🛑 A double-click must leave the selection as it found it
 *
 * A double-click is two clicks, and a row click toggles the selection: left alone, the
 * gesture toggles twice, and on a multiple selection it does not even come back to where it
 * started — the first click replaces the selection by the row, the second clears it.
 *
 * Delaying every click to learn whether a second one follows would make the whole table
 * slower for the sake of one gesture. So the first click still acts at once, the row click
 * handler ignores the second one (`event.detail > 1`), and the activation puts back the
 * selection and the range anchor remembered just before the first click.
 */

import { _eventCleanups } from "./event-cleanups.js";
import { updateToolbarButtonsState } from "./selection-actions.js";
import { fireEvent, tableState } from "./table-state.js";
import { TableContract } from "./table-seam.js";
import { events as _events } from "./utils/events.js";
import * as viewModel from "./view-model.js";

/** The selection as it stood just before a row was clicked. */
interface SelectionSnapshot {
    featureId: string;
    selectedIds: string[];
    anchorId: string | null;
}

let beforeClick: SelectionSnapshot | null = null;

/**
 * Remembers the selection and the range anchor as they stand, on behalf of a row about to
 * be clicked.
 *
 * Called by the row's click handler BEFORE it toggles anything: if that click turns out to
 * open a double-click, this is the state the activation restores.
 *
 * @param featureId - The row being clicked.
 */
export function rememberSelectionBeforeClick(featureId: string): void {
    beforeClick = {
        featureId,
        selectedIds: Array.from(tableState._selectedIds),
        anchorId: viewModel.anchorId(),
    };
}

function sameSelection(ids: string[]): boolean {
    const current = tableState._selectedIds;
    return ids.length === current.size && ids.every((id) => current.has(id));
}

/** Puts back what the first click of a double-click changed, if it changed anything. */
function restoreSelectionBeforeClick(featureId: string): void {
    const snapshot = beforeClick;
    beforeClick = null;
    if (!snapshot || snapshot.featureId !== featureId) return;

    if (!sameSelection(snapshot.selectedIds)) {
        if (snapshot.selectedIds.length > 0) {
            TableContract.setSelection(snapshot.selectedIds, false);
        } else {
            TableContract.clearSelection();
        }
        updateToolbarButtonsState();
    }
    viewModel.setAnchor(snapshot.anchorId);
}

/** The data row an event started in, or null — spacers and the checkbox cell yield null. */
function activatableRow(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    if (target.closest(".gl-table-panel__td--checkbox")) return null;
    return target.closest<HTMLElement>("tr[data-feature-id]");
}

function emitRowActivated(featureId: string): void {
    const row = viewModel.rowById(featureId);
    if (!row) return;
    fireEvent("geoleaf:table:rowActivated", {
        layerId: tableState._currentLayerId,
        featureId,
        properties: { ...(row.feature.properties ?? {}) },
    });
}

/**
 * Wires row activation on a table body — double-click, and Enter on a focused row.
 *
 * Call it once per rendered tbody. Both teardowns land in the shared cleanup registry, so
 * they leave with every other listener of the render: before a re-render, and on destroy.
 *
 * @param tbody - The body whose rows can be activated.
 */
export function attachRowActivation(tbody: HTMLElement): void {
    const onDoubleClick = (e: Event) => {
        const tr = activatableRow(e.target);
        const featureId = tr?.getAttribute("data-feature-id");
        if (!featureId) return;
        restoreSelectionBeforeClick(featureId);
        emitRowActivated(featureId);
    };

    const onKeyDown = (e: Event) => {
        const key = e as KeyboardEvent;
        if (key.key !== "Enter" || key.repeat) return;
        // Only when the ROW holds the focus: Enter typed in the row's checkbox belongs to
        // the checkbox.
        const tr = activatableRow(key.target);
        if (!tr || tr !== key.target) return;
        const featureId = tr.getAttribute("data-feature-id");
        if (!featureId) return;
        emitRowActivated(featureId);
    };

    _eventCleanups.push(
        _events.on(tbody, "dblclick", onDoubleClick, false, "TableRenderer.rowActivate"),
        _events.on(tbody, "keydown", onKeyDown, false, "TableRenderer.rowActivateKey")
    );
}
