/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table — Cell value formatting
 * Renders a raw property value as the string shown in a data cell, according to its
 * declared column type.
 *
 * Split out of `table-renderer-utils.ts` (STRUCT S8, N3).
 */

import { getActiveLang } from "@geoleaf/host-runtime";

/**
 * Formats a value according to its column type.
 * @param {*} value - Value to format
 * @param {string} type - Data type (string, number, date)
 * @returns {string}
 */
export function formatValue(value: unknown, type: string | undefined): string {
    if (value == null || value === "") return "—";
    // Locale comes from the PROFILE, not from a hard-coded "fr-FR" (CAPACITÉS B.26
    // remainder). These are data cells: a quantity or a date shown to an English user
    // must read in English. That is the opposite call from the SCALE DENOMINATOR of
    // `scale-control`/`plugin-print`, where B.26 settled on a locale-independent space —
    // there, `1:250.000` would read as a decimal. Different field, different answer.
    if (type === "number") {
        const num = Number(value);
        if (isNaN(num)) return String(value);
        return num.toLocaleString(getActiveLang());
    }
    if (type === "date") {
        const date = new Date(value as string | number | Date);
        if (isNaN(date.getTime())) return String(value);
        return date.toLocaleDateString(getActiveLang());
    }
    return String(value);
}
