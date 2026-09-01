/*!
 * @geoleaf-plugins/table — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 *
 * Façade only (INV-FACADE): thin wrappers over the Table orchestrator —
 * no business logic here. Mounted on `GeoLeaf.Table` by `entry.ts`.
 *
 * @example
 * GeoLeaf.Table.setLayer("communes");
 * GeoLeaf.Table.exportSelection("csv");
 */

import { Table } from "./table-api.js";
import type { ExportFormat, ExportOptions } from "./export.js";

/**
 * Builds the object mounted on `GeoLeaf.Table`.
 */
export function buildPublicApi() {
    return {
        /** Shows the table panel. */
        show: (): void => Table.show(),
        /** Hides the table panel and clears any highlight overlay. */
        hide: (): void => Table.hide(),
        /** Toggles the table panel visibility. */
        toggle: (): void => Table.toggle(),
        /** Opens (toggles) the panel — invoked by the toolbar `"table"` action. */
        // ⚠️ `open()` TOGGLES, it does not open. On an already-open panel, it
        // closes. Intended for the toolbar action, its only internal caller —
        // but an integrator calling `GeoLeaf.Table.open()` to GUARANTEE an
        // open state gets the opposite every other time. Use `show()` for
        // that. The name is kept because it is in the published surface;
        // fixing it silently would change the click action's behaviour.
        // ✅ Since 13/08/2026, `isOpen()` below makes the workaround POSSIBLE:
        // `if (!GeoLeaf.Table.isOpen()) GeoLeaf.Table.open()`. Before it, the
        // integrator could not test before calling, hence not work around at all.
        open: (): void => Table.toggle(),
        /** Whether the table panel is currently shown — the test `open()` needs. */
        isOpen: (): boolean => Table.isOpen(),
        /** Switches the active layer (pass `null`/`""` to clear). */
        setLayer: (layerId: string | null | undefined): void => Table.setLayer(layerId),
        /** Reloads the current layer's features into the table. */
        refresh: (): void => Table.refresh(),
        /** Cycles the sort state for a field (none → asc → desc → none). */
        sortByField: (field: string): void => Table.sortByField(field),
        /** Selects rows by id (replace, or append when `add` is true). */
        setSelection: (ids: unknown[], add?: boolean): void => Table.setSelection(ids, add),
        /** Returns the currently selected feature ids. */
        getSelectedIds: (): string[] => Table.getSelectedIds(),
        /** Clears the current selection. */
        clearSelection: (): void => Table.clearSelection(),
        /** Fits the map to the bounds of the selected features. */
        zoomToSelection: (): void => Table.zoomToSelection(),
        /** Toggles the map highlight overlay for the selection. */
        highlightSelection: (active: boolean): void => Table.highlightSelection(active),
        /** Exports the selected rows in the given format (default `geojson`). */
        exportSelection: (format?: ExportFormat, options?: ExportOptions): void =>
            Table.exportSelection(format, options),
        /** Exports all rows of the active layer in the given format (default `geojson`). */
        exportLayer: (format?: ExportFormat, options?: ExportOptions): void =>
            Table.exportLayer(format, options),
    };
}
