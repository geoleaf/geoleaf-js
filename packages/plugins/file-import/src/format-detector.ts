/*!
 * GeoLeaf File Import Plugin — Format Detector
 * Detects file format by extension and routes to the appropriate converter.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { IFileConverter } from "./converters/i-converter.js";
import { gpxConverter } from "./converters/gpx-converter.js";
import { kmlConverter } from "./converters/kml-converter.js";
import { csvConverter } from "./converters/csv-converter.js";
import { topojsonConverter } from "./converters/topojson-converter.js";

// ─── Built-in registry ───────────────────────────────────────────────────────

const _registry = new Map<string, IFileConverter>([
    [".gpx", gpxConverter],
    [".kml", kmlConverter],
    [".kmz", kmlConverter], // KMZ handled separately in public-api via KMZ extractor
    [".csv", csvConverter],
    [".tsv", csvConverter],
    [".topojson", topojsonConverter],
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a custom converter for a file extension.
 * @param ext - The file extension including dot (e.g. ".shp").
 * @param converter - The converter implementing IFileConverter.
 */
export function registerConverter(ext: string, converter: IFileConverter): void {
    _registry.set(ext.toLowerCase(), converter);
}

/**
 * Detect the appropriate converter for a file by its name/extension.
 * @param fileName - The file name (e.g. "track.gpx").
 * @returns The converter, or null if format is not supported.
 */
export function detectConverter(fileName: string): IFileConverter | null {
    const dot = fileName.lastIndexOf(".");
    if (dot === -1) return null;
    const ext = fileName.substring(dot).toLowerCase();
    return _registry.get(ext) ?? null;
}

/**
 * Check if a file extension corresponds to a KMZ file.
 */
export function isKmz(fileName: string): boolean {
    return fileName.toLowerCase().endsWith(".kmz");
}

/**
 * Get the list of supported file extensions.
 */
export function getSupportedExtensions(): string[] {
    return [..._registry.keys()];
}
