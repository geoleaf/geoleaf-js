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

/**
 * Registers a custom export format.
 * Overwrites any existing registration for the same format identifier.
 *
 * @param format - Case-insensitive format identifier (e.g. `"png"`, `"webp"`).
 * @param fn - Exporter function that receives the composed canvas and returns a Blob.
 */
export function registerExporter(format: string, fn: ExporterFn): void {
    _registry.set(format.toLowerCase(), fn);
}

/**
 * Returns the registered ExporterFn for the given format, or `undefined` if none.
 * @internal
 */
export function getExporter(format: string): ExporterFn | undefined {
    return _registry.get(format.toLowerCase());
}
