/*!
 * @geoleaf-plugins/print — Exporter format registry
 *
 * Stores a mapping from format identifiers (e.g. "jpg", "pdf", "png")
 * to their corresponding ExporterFn implementations.
 *
 * The registry is pre-seeded with the built-in jpg and pdf exporters.
 * Additional formats can be added via GeoLeaf.Print.registerExporter().
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { ExporterFn } from "./types.js";
import { imageExporterFn } from "./exporters/image-exporter.js";
import { pdfExporterFn } from "./exporters/pdf-exporter.js";

// Pre-seeded with built-in exporters.
const _registry = new Map<string, ExporterFn>([
    ["jpg", imageExporterFn],
    ["pdf", pdfExporterFn],
]);

/** What an exporter declares besides its function: the file extension and the button label. */
export interface ExporterMeta {
    /** File extension, without the dot (e.g. `"png"`). Absent: `.jpg` unless the format is PDF. */
    extension?: string;
    /** Button label, used when the dictionary has no `print.btn.<format>`. */
    label?: string;
}

const _meta = new Map<string, ExporterMeta>([
    ["jpg", { extension: "jpg" }],
    ["pdf", { extension: "pdf" }],
]);

/**
 * Registers a custom export format.
 * Overwrites any existing registration for the same format identifier.
 *
 * @param format - Case-insensitive format identifier (e.g. `"png"`, `"webp"`).
 * @param fn - Exporter function that receives the composed canvas and returns a Blob.
 * @param meta - The file extension and the button label; without an extension the file is
 *   saved as `.jpg`, unless the format is `pdf`.
 */
export function registerExporter(format: string, fn: ExporterFn, meta: ExporterMeta = {}): void {
    _registry.set(format.toLowerCase(), fn);
    _meta.set(format.toLowerCase(), meta);
}

/**
 * Returns what the exporter registered for `format` declared — extension, label — or
 * `undefined` when the format is unknown.
 * @internal
 */
export function getExporterMeta(format: string): ExporterMeta | undefined {
    return _meta.get(format.toLowerCase());
}

/**
 * Returns the registered ExporterFn for the given format, or `undefined` if none.
 * @internal
 */
export function getExporter(format: string): ExporterFn | undefined {
    return _registry.get(format.toLowerCase());
}
