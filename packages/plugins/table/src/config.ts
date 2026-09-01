/*!
 * @geoleaf-plugins/table — Config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coreConfigGet } from "@geoleaf/host-runtime";
import type { TableConfig } from "./types.js";

/**
 * Built-in defaults, merged under any `modules.table.*` profile overrides.
 * Mirrors the historical core `Table.init()` defaults 1:1.
 */
const DEFAULTS: TableConfig = {
    enabled: true,
    showButton: true,
    defaultVisible: false,
    maxRowsPerLayer: 1000,
    enableExportButton: true,
    virtualScrolling: true,
    defaultHeight: "40%",
    minHeight: "20%",
    maxHeight: "60%",
    resizable: true,
};

/**
 * Reads the table configuration from the `modules.table` namespace of the running
 * core (Plugin Contract v1, INV-CONFIG), merged over the built-in defaults.
 */
export function getPluginConfig(): TableConfig {
    const raw = coreConfigGet<Partial<TableConfig>>("modules.table", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
