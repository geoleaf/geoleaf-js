/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table – Export Utilities
 * Pure export helpers: GeoJSON (existing), CSV, KML, GPX, Excel (lazy).
 */

import { resolveFeatureId, _str } from "./feature-id.js";

// Re-exported so `import { resolveFeatureId } from "./export.js"` keeps working
// for `table-api` and the existing test suites; the implementation is shared
// with the renderer to keep DOM ids and `_featureIdMap` keys in one space.
export { resolveFeatureId };

interface GeoJSONFeature {
    id?: string | number;
    properties?: Record<string, unknown>;
    geometry?: unknown;
}

/** Arbitrarily-nested coordinate array (Point → MultiPolygon). */
type Coordinates = number[] | number[][] | number[][][] | number[][][][];

/** Minimal geometry shape read by the KML/GPX writers. */
interface ExportGeometry {
    type?: string;
    coordinates?: Coordinates;
}

/** Supported export formats. */
export type ExportFormat = "geojson" | "csv" | "kml" | "gpx" | "excel";

/** Options for tabular formats. */
export interface ExportOptions {
    /** CSV column separator. Default: ','. */
    csvSeparator?: "," | ";";
    /** Include geometry as a JSON column in CSV. Default: false. */
    csvIncludeGeometry?: boolean;
}

/**
 * Builds a GeoJSON FeatureCollection from an array of features.
 */
export function buildGeoJSONCollection(features: GeoJSONFeature[]): {
    type: string;
    features: unknown[];
} {
    return {
        type: "FeatureCollection",
        features: features.map((f) => ({
            type: "Feature",
            properties: f.properties || {},
            geometry: f.geometry || null,
        })),
    };
}

/** Generic browser file download. */
export function downloadFile(
    content: string | Uint8Array,
    filename: string,
    mimeType: string
): void {
    const part: BlobPart = typeof content === "string" ? content : (content.buffer as ArrayBuffer);
    const blob = new Blob([part], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Backward-compatible GeoJSON download (selection). */
export function downloadGeoJSON(geojson: unknown, layerId?: string): void {
    const json = JSON.stringify(geojson, null, 2);
    downloadFile(json, (layerId || "export") + "_selection.geojson", "application/geo+json");
}

/** Builds a CSV string with UTF-8 BOM (Excel Windows compatibility). */
export function buildCSV(features: GeoJSONFeature[], options?: ExportOptions): string {
    const sep = options?.csvSeparator ?? ",";
    const includeGeom = options?.csvIncludeGeometry ?? false;

    const allKeys = new Set<string>();
    for (const f of features) {
        if (f.properties) {
            for (const k of Object.keys(f.properties)) allKeys.add(k);
        }
    }
    const keys = Array.from(allKeys);
    if (includeGeom) keys.push("__geometry");

    const escCsv = (v: unknown): string => {
        const s = _str(v);
        if (s.includes(sep) || s.includes('"') || s.includes("\n")) {
            return '"' + s.replaceAll('"', '""') + '"';
        }
        return s;
    };

    const rows: string[] = [keys.map(escCsv).join(sep)];
    for (const f of features) {
        rows.push(
            keys
                .map((k) => {
                    if (k === "__geometry") {
                        return escCsv(f.geometry ? JSON.stringify(f.geometry) : "");
                    }
                    return escCsv(f.properties?.[k]);
                })
                .join(sep)
        );
    }
    // \uFEFF = UTF-8 BOM
    return "﻿" + rows.join("\r\n");
}

/** Escapes XML special chars (incl. quotes) for KML text/attribute content. */
function _escKmlXml(s: string): string {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

/** Serializes a coordinate ring to a KML "lon,lat[,alt] …" string. */
function _kmlCoordStr(ring: number[][]): string {
    return ring
        .map((c) => {
            const z = c[2] == null ? "" : "," + c[2];
            return `${c[0]},${c[1]}${z}`;
        })
        .join(" ");
}

/** Renders a single KML <Polygon> from its rings (outer + optional holes). */
function _kmlPolygon(rings: number[][][]): string {
    const outerCoords = _kmlCoordStr(rings[0] ?? []);
    const inner = rings
        .slice(1)
        .map((r: number[][]) => {
            const innerCoords = _kmlCoordStr(r);
            return `<innerBoundaryIs><LinearRing><coordinates>${innerCoords}</coordinates></LinearRing></innerBoundaryIs>`;
        })
        .join("");
    return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${outerCoords}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon>`;
}

/** Converts a single geometry to its KML element string (empty if unsupported). */
function _geomToKml(geom: ExportGeometry | null | undefined): string {
    if (!geom) return "";
    const { type } = geom;
    if (type === "Point") {
        const co = geom.coordinates as number[];
        const z = co[2] == null ? "" : "," + co[2];
        return `<Point><coordinates>${co[0]},${co[1]}${z}</coordinates></Point>`;
    }
    if (type === "LineString")
        return `<LineString><coordinates>${_kmlCoordStr(geom.coordinates as number[][])}</coordinates></LineString>`;
    if (type === "Polygon") return _kmlPolygon(geom.coordinates as number[][][]);
    if (type === "MultiPoint") {
        const co = geom.coordinates as number[][];
        const points = co
            .map((c: number[]) => `<Point><coordinates>${c[0]},${c[1]}</coordinates></Point>`)
            .join("");
        return `<MultiGeometry>${points}</MultiGeometry>`;
    }
    if (type === "MultiLineString") {
        const co = geom.coordinates as number[][][];
        const lines = co
            .map((ls: number[][]) => {
                const coords = _kmlCoordStr(ls);
                return `<LineString><coordinates>${coords}</coordinates></LineString>`;
            })
            .join("");
        return `<MultiGeometry>${lines}</MultiGeometry>`;
    }
    if (type === "MultiPolygon") {
        const co = geom.coordinates as number[][][][];
        const polys = co
            .map((poly: number[][][]) => {
                const outerCoords = _kmlCoordStr(poly[0] ?? []);
                return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${outerCoords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
            })
            .join("");
        return `<MultiGeometry>${polys}</MultiGeometry>`;
    }
    return "";
}

/** Builds a KML string from features (no external dependency). */
export function buildKML(features: GeoJSONFeature[], layerId?: string): string {
    const placemarks = features
        .map((f, i) => {
            const name = _escKmlXml(resolveFeatureId(f, i));
            const desc = Object.entries(f.properties || {})
                .map(([k, v]) => `${k}: ${_str(v)}`)
                .join("\n");
            return `  <Placemark>\n    <name>${name}</name>\n    <description><![CDATA[${desc}]]></description>\n    ${_geomToKml(f.geometry as ExportGeometry | null | undefined)}\n  </Placemark>`;
        })
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n  <name>${_escKmlXml(layerId || "GeoLeaf Export")}</name>\n${placemarks}\n</Document>\n</kml>`;
}

/** Escapes XML special chars for GPX text content. */
function _escGpxXml(s: string): string {
    return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Serializes a coordinate to a GPX <trkpt>. */
function _gpxTrkpt(c: number[]): string {
    const ele = c[2] == null ? "" : `<ele>${c[2]}</ele>`;
    return `      <trkpt lat="${c[1]}" lon="${c[0]}">${ele}</trkpt>`;
}

/**
 * Builds the GPX element (wpt / trk / rte) for one feature.
 * Polygon / MultiPolygon / MultiPoint are exported as a route over the exterior ring.
 */
function _gpxElementForFeature(geom: ExportGeometry, name: string, desc: string): string {
    const { type } = geom;

    if (type === "Point") {
        const co = geom.coordinates as number[];
        return `  <wpt lat="${co[1]}" lon="${co[0]}">\n    <name>${name}</name>\n    <desc>${desc}</desc>\n  </wpt>`;
    }
    if (type === "LineString") {
        const co = geom.coordinates as number[][];
        return `  <trk>\n    <name>${name}</name>\n    <desc>${desc}</desc>\n    <trkseg>\n${co.map(_gpxTrkpt).join("\n")}\n    </trkseg>\n  </trk>`;
    }
    if (type === "MultiLineString") {
        const co = geom.coordinates as number[][][];
        const segs = co
            .map(
                (seg: number[][]) => `    <trkseg>\n${seg.map(_gpxTrkpt).join("\n")}\n    </trkseg>`
            )
            .join("\n");
        return `  <trk>\n    <name>${name}</name>\n    <desc>${desc}</desc>\n${segs}\n  </trk>`;
    }

    let ring: number[][];
    if (type === "MultiPolygon") {
        ring = (geom.coordinates as number[][][][])[0]?.[0] ?? [];
    } else if (type === "Polygon") {
        ring = (geom.coordinates as number[][][])[0] ?? [];
    } else {
        ring = geom.coordinates as number[][];
    }
    const rtepts = ring
        .map((c: number[]) => `    <rtept lat="${c[1]}" lon="${c[0]}"></rtept>`)
        .join("\n");
    return `  <rte>\n    <name>${name}</name>\n    <desc>${desc}</desc>\n${rtepts}\n  </rte>`;
}

/** Builds a GPX string from features (no external dependency). */
export function buildGPX(features: GeoJSONFeature[], layerId?: string): string {
    const elements: string[] = [];
    for (const [i, f] of features.entries()) {
        const geom = f.geometry as ExportGeometry | null | undefined;
        if (!geom) continue;
        const name = _escGpxXml(resolveFeatureId(f, i));
        const desc = _escGpxXml(JSON.stringify(f.properties || {}));
        elements.push(_gpxElementForFeature(geom, name, desc));
    }

    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GeoLeaf" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${_escGpxXml(layerId || "GeoLeaf Export")}</name></metadata>\n${elements.join("\n")}\n</gpx>`;
}

/**
 * Orchestrates download for all formats.
 * Excel is loaded lazily from the export-excel chunk.
 */
export async function downloadFeatures(
    features: GeoJSONFeature[],
    format: ExportFormat,
    layerId: string,
    suffix: string,
    options?: ExportOptions
): Promise<void> {
    const base = (layerId || "export") + "_" + suffix;
    switch (format) {
        case "geojson":
            downloadFile(
                JSON.stringify(buildGeoJSONCollection(features), null, 2),
                base + ".geojson",
                "application/geo+json"
            );
            break;
        case "csv":
            downloadFile(buildCSV(features, options), base + ".csv", "text/csv;charset=utf-8;");
            break;
        case "kml":
            downloadFile(
                buildKML(features, layerId),
                base + ".kml",
                "application/vnd.google-earth.kml+xml"
            );
            break;
        case "gpx":
            downloadFile(buildGPX(features, layerId), base + ".gpx", "application/gpx+xml");
            break;
        case "excel": {
            const mod = await import("./lazy/export-excel.js");
            const data = mod.buildExcelBuffer(features);
            downloadFile(
                data,
                base + ".xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            break;
        }
    }
}
