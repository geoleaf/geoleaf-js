/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Lazy Chunk — Excel Export
 * Loaded on demand via dynamic import() when the user selects Excel format.
 * Uses the in-house minimal OOXML writer (no third-party xlsx dependency).
 */
import { buildXlsx } from "./xlsx-writer.js";

interface GeoJSONFeature {
    id?: string | number;
    properties?: Record<string, unknown>;
    geometry?: unknown;
}

/**
 * Builds an Excel workbook buffer from an array of GeoJSON features.
 * Properties become columns; geometry is excluded.
 */
export function buildExcelBuffer(features: GeoJSONFeature[]): Uint8Array {
    const allKeys = new Set<string>();
    for (const f of features) {
        if (f.properties) {
            for (const k of Object.keys(f.properties)) allKeys.add(k);
        }
    }
    const keys = Array.from(allKeys);

    const rows: Record<string, unknown>[] = features.map((f) => {
        const row: Record<string, unknown> = {};
        for (const k of keys) {
            const v = f.properties?.[k];
            row[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v;
        }
        return row;
    });

    return buildXlsx(keys, rows, "GeoLeaf Export");
}
