/*!
 * GeoLeaf Storage — Sizes, as the user reads them
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The single size formatter of the offline window: bytes as the active language writes them
 * (« 18,07 Mo » in French, « 18.07 MB » in English), through `Intl.NumberFormat` units.
 */

import { getActiveLang } from "@geoleaf/host-runtime";

/** Units by magnitude — Intl's sanctioned simple units, translated by the engine (« Mo », « MB »). */
const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

/**
 * A byte count in the ACTIVE language: its decimal mark and its unit symbol.
 *
 * 🛑 The window wrote « 18.07 MB » in a French interface — a point for a comma, and the English
 * symbol. `Intl.NumberFormat` with a `unit` style speaks the language (« 18,07 Mo »); an engine
 * without unit support falls back to the number and the English symbol, never to nothing.
 *
 * @param bytes - The size. Negative or not finite: `0`.
 * @param digits - Fraction digits at most. Default 2.
 * @returns The formatted size, unit chosen by magnitude (bytes up to gigabytes).
 * @example formatSize(18_948_000) // "18,07 Mo" in French
 */
export function formatSize(bytes: number, digits = 2): string {
    let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    let i = 0;
    while (value >= 1024 && i < UNITS.length - 1) {
        value /= 1024;
        i++;
    }
    const unit = UNITS[i] ?? "byte";
    try {
        return new Intl.NumberFormat(getActiveLang() || undefined, {
            style: "unit",
            unit,
            unitDisplay: "short",
            maximumFractionDigits: i === 0 ? 0 : digits,
        }).format(value);
    } catch {
        const symbol = { byte: "B", kilobyte: "KB", megabyte: "MB", gigabyte: "GB" }[unit];
        return `${value.toFixed(i === 0 ? 0 : digits)} ${symbol}`;
    }
}
