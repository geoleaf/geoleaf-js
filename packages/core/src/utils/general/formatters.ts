/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Formatters pour dates et tailles de fichiers
 * @version 1.3.0
 */

/** Locale applied when a caller does not pass one. */
const DEFAULT_LOCALE = "fr-FR";

type DateStyle = "short" | "medium" | "long" | "full";

interface FormatDateOptions {
    locale?: string;
    style?: DateStyle;
    format?: Intl.DateTimeFormatOptions;
}

/**
 * Formats a date/time for display, in the active locale.
 */
export function formatDateTime(
    date: Date | string | number,
    options: FormatDateOptions = {}
): string {
    const { locale = DEFAULT_LOCALE, style = "medium", format = null } = options;
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) return "";
    const formats: Record<DateStyle, Intl.DateTimeFormatOptions> = {
        short: {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        },
        medium: {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        },
        long: {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        },
        full: {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        },
    };
    const formatOptions = format ?? formats[style] ?? formats.medium;
    return dateObj.toLocaleString(locale, formatOptions);
}

interface FormatFileSizeOptions {
    precision?: number;
    locale?: string;
}

/**
 * Formats a byte count with the largest unit that keeps it readable (B, KB, MB, GB).
 *
 * Use {@link toMB} or {@link toGB} when the unit must be fixed — a table column whose rows
 * must stay comparable, for instance.
 */
export function formatFileSize(
    bytes: number | null | undefined,
    options: FormatFileSizeOptions = {}
): string {
    const { precision = 2, locale = DEFAULT_LOCALE } = options;
    if (bytes == null || isNaN(bytes) || bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const k = 1024;
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    const value = bytes / Math.pow(k, i);
    const formatted = value.toLocaleString(locale, {
        minimumFractionDigits: i === 0 ? 0 : precision,
        maximumFractionDigits: i === 0 ? 0 : precision,
    });
    return `${formatted} ${units[i]}`;
}

/**
 * Formats a byte count in gigabytes, always — unlike {@link formatFileSize}, the unit is fixed.
 *
 * @param bytes - Byte count; null or undefined yields a zero-valued string.
 * @param precision - Decimal places. Defaults to `2`.
 * @returns The formatted value, unit included.
 */
export function toGB(bytes: number | null | undefined, precision: number = 2): string {
    if (!bytes || bytes === 0) return "0";
    return (bytes / 1024 / 1024 / 1024).toFixed(precision);
}

/**
 * Formats a byte count in megabytes, always — unlike {@link formatFileSize}, the unit is fixed.
 *
 * @param bytes - Byte count; null or undefined yields a zero-valued string.
 * @param precision - Decimal places. Defaults to `1`.
 * @returns The formatted value, unit included.
 */
export function toMB(bytes: number | null | undefined, precision: number = 1): string {
    if (!bytes || bytes === 0) return "0";
    return (bytes / 1024 / 1024).toFixed(precision);
}
