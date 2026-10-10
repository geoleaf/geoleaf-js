/*!
 * @geoleaf-plugins/table — Config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coreConfigGet } from "@geoleaf/host-runtime";
import type { TableConfig } from "./types.js";

/** The three keys whose default used to be a `??` fallback where the value is consumed. */
type ExportDefaultedKey = "exportFormats" | "csvSeparator" | "csvIncludeGeometry";

/**
 * Built-in defaults, merged under any `modules.table.*` profile overrides — the ONE place
 * a default of `modules.table` is written. Its first nine keys mirror the historical core
 * `Table.init()` defaults 1:1.
 *
 * Exported for the sites that still take the value from somewhere else than the merged
 * configuration (`buildCSV` called without options, an `init()` override): they fall back
 * on this table rather than on a literal of their own.
 */
export const DEFAULTS: TableConfig & Required<Pick<TableConfig, ExportDefaultedKey>> = {
    enabled: true,
    showButton: true,
    defaultVisible: false,
    maxRowsPerLayer: 30000,
    enableExportButton: true,
    defaultHeight: "40%",
    minHeight: "20%",
    maxHeight: "60%",
    resizable: true,
    exportFormats: ["geojson", "csv", "kml", "gpx", "excel"],
    csvSeparator: ",",
    csvIncludeGeometry: false,
};

/**
 * Reads the table configuration from the `modules.table` namespace of the running
 * core (Plugin Contract v1, INV-CONFIG), merged over the built-in defaults.
 *
 * ⚠️ The two halves of the table do not treat `null` alike, and that is what the plugin has
 * always done: a `null` written for one of the first nine keys replaces the default (a plain
 * spread), while `exportFormats`, `csvSeparator` and `csvIncludeGeometry` keep theirs — they
 * were `??` fallbacks before they entered the table.
 */
export function getPluginConfig(): TableConfig {
    const raw = coreConfigGet<Partial<TableConfig>>("modules.table", {}) ?? {};
    return {
        ...DEFAULTS,
        ...raw,
        exportFormats: raw.exportFormats ?? DEFAULTS.exportFormats,
        csvSeparator: raw.csvSeparator ?? DEFAULTS.csvSeparator,
        csvIncludeGeometry: raw.csvIncludeGeometry ?? DEFAULTS.csvIncludeGeometry,
    };
}
