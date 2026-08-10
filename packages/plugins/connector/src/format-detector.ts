/*!
 * GeoLeaf Connector — Format Detector
 * Pure function. No side effects. Zero external dependencies.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/** Supported data formats that the connector can intercept or route. */
type DataFormat = "geojson" | "flatgeobuf" | "kml" | "csv" | "pmtiles" | "oapif" | "mvt";

/**
 * Detects the data format from a URL and optional Content-Type header.
 *
 * Used by fetch-interceptor to route MVT/PMTiles requests to the MapLibre bridge
 * instead of the window.fetch monkey-patch.
 *
 * @param url - Request URL (query params are ignored)
 * @param contentType - Optional Content-Type header value
 * @returns Detected DataFormat (defaults to 'geojson' when format is ambiguous)
 */
export function detectFormat(url: string, contentType?: string): DataFormat {
    // Destructure with a default rather than index: String.split always yields at least one
    // element, so the default never fires — it states the invariant instead of asserting it.
    const [u = ""] = url.toLowerCase().split("?");

    // Extension-based detection (highest priority)
    if (u.endsWith(".fgb")) return "flatgeobuf";
    if (u.endsWith(".kml")) return "kml";
    if (u.endsWith(".csv")) return "csv";
    if (u.endsWith(".pmtiles")) return "pmtiles";
    if (u.endsWith(".mvt")) return "mvt";
    if (u.endsWith(".pbf")) return "mvt";

    // OGC API Features — path-based detection
    if (u.includes("/collections/")) return "oapif";

    // Content-Type based detection (fallback)
    if (contentType?.includes("application/flatgeobuf")) return "flatgeobuf";
    if (contentType?.includes("text/csv")) return "csv";
    if (contentType?.includes("application/vnd.google-earth.kml")) return "kml";
    if (contentType?.includes("application/vnd.mapbox-vector-tile")) return "mvt";

    return "geojson";
}
