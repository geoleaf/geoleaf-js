/*!
 * GeoLeaf File Import Plugin — CSV Converter
 * Converts CSV/TSV data to GeoJSON FeatureCollection.
 *
 * Uses PapaParse for robust CSV parsing with auto-detected delimiters.
 * Heuristic column detection for lat/lng or WKT geometry.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import Papa from "papaparse";
import type { Feature, Geometry, Point } from "geojson";
import type { IFileConverter, ConvertResult } from "./i-converter.js";
import { emptyFC } from "./i-converter.js";

// ─── Column detection heuristics ──────────────────────────────────────────────

const LAT_PATTERNS = ["lat", "latitude", "y", "lat_y", "coordy"];
const LNG_PATTERNS = ["lng", "lon", "long", "longitude", "x", "lng_x", "lon_x", "coordx"];
const WKT_PATTERNS = ["wkt", "geom", "geometry", "the_geom", "shape"];

interface GeoColumns {
    type: "latlng" | "wkt";
    latCol?: string;
    lngCol?: string;
    wktCol?: string;
}

function _detectGeoColumns(headers: string[]): GeoColumns | null {
    const lower = headers.map((h) => h.toLowerCase().trim());

    // Try lat/lng first
    // Branch on the resolved COLUMN, not on the index: `headers[-1]` is undefined anyway, so
    // this subsumes the `!== -1` test instead of duplicating it (qualite Q5).
    const latCol = headers[lower.findIndex((h) => LAT_PATTERNS.includes(h))];
    const lngCol = headers[lower.findIndex((h) => LNG_PATTERNS.includes(h))];
    if (latCol !== undefined && lngCol !== undefined) {
        return { type: "latlng", latCol, lngCol };
    }

    // Try WKT column
    const wktCol = headers[lower.findIndex((h) => WKT_PATTERNS.includes(h))];
    if (wktCol !== undefined) {
        return { type: "wkt", wktCol };
    }

    return null;
}

// ─── Minimal WKT POINT parser ─────────────────────────────────────────────────

/**
 * Parse a WKT POINT string to a GeoJSON Point geometry.
 * Only supports POINT (no multi-geometry for CSV rows).
 */
function _parseWktPoint(wkt: string): Point | null {
    // PLUGINS S11.3 — justified suppression, not an unexamined one.
    //
    // `safe-regex` (behind this rule) is a STRUCTURAL heuristic: it raises the star height
    // for the optional third-coordinate group `(?:\s+([\d.eE+-]+))?` wrapping a `+`, and
    // reports it without checking whether the quantifiers can actually compete. Here they
    // cannot: `[\d.eE+-]` and `\s` are DISJOINT character sets, so every token boundary is
    // unambiguous — a space can only match `\s`, a digit only the class. Catastrophic
    // backtracking needs two quantifiers that can both claim the same character, and no
    // pair here can. Measured on adversarial inputs (400 KB of `"1 "` repeats, of digits,
    // and of whitespace, all without the closing paren): < 1 ms each, i.e. linear.
    //
    // ⚠️ This justification rests on that disjointness. Adding `\s`, `\w` or `.` to the
    // coordinate class would make the quantifiers overlap and make the rule RIGHT — re-run
    // the timing check before touching the class rather than carrying this comment over.
    // eslint-disable-next-line security/detect-unsafe-regex
    const match = wkt.match(/POINT\s*\(\s*([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s+([\d.eE+-]+))?\s*\)/i);
    if (!match) return null;
    const x = parseFloat(match[1] ?? "");
    const y = parseFloat(match[2] ?? "");
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const z = match[3] ? parseFloat(match[3]) : undefined;
    const coordinates = z != null && Number.isFinite(z) ? [x, y, z] : [x, y];
    return { type: "Point", coordinates };
}

// ─── Main converter ───────────────────────────────────────────────────────────

/** Collects the column names used for geometry so they are excluded from feature properties. */
function _collectGeoColumnNames(geoCols: GeoColumns): Set<string> {
    const names = new Set<string>();
    if (geoCols.latCol) names.add(geoCols.latCol);
    if (geoCols.lngCol) names.add(geoCols.lngCol);
    if (geoCols.wktCol) names.add(geoCols.wktCol);
    return names;
}

/** Builds the geometry for a single CSV row (lat/lng or WKT), pushing a warning on failure. */
function _buildRowGeometry(
    row: Record<string, string>,
    geoCols: GeoColumns,
    rowIndex: number,
    warnings: string[]
): Geometry | null {
    if (geoCols.type === "latlng") {
        const lat = parseFloat(row[geoCols.latCol!] ?? "");
        const lng = parseFloat(row[geoCols.lngCol!] ?? "");
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            warnings.push(`Row ${rowIndex + 1}: invalid coordinates, skipped`);
            return null;
        }
        return { type: "Point", coordinates: [lng, lat] };
    }
    if (geoCols.type === "wkt") {
        const wktVal = row[geoCols.wktCol!];
        if (!wktVal || !wktVal.trim()) {
            warnings.push(`Row ${rowIndex + 1}: empty WKT, skipped`);
            return null;
        }
        const geometry = _parseWktPoint(wktVal.trim());
        if (!geometry) {
            warnings.push(
                `Row ${rowIndex + 1}: unsupported or invalid WKT "${wktVal.trim().substring(0, 50)}", skipped`
            );
            return null;
        }
        return geometry;
    }
    return null;
}

/** Builds feature properties from all non-geographic columns, coercing numeric strings. */
function _buildRowProperties(
    row: Record<string, string>,
    headers: string[],
    geoColumnNames: Set<string>
): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const key of headers) {
        if (geoColumnNames.has(key)) continue;
        const val = row[key];
        if (val === undefined || val === null || val === "") continue;
        // Attempt numeric coercion
        const num = Number(val);
        properties[key] = Number.isFinite(num) && val.trim() !== "" ? num : val;
    }
    return properties;
}

/**
 * CSV/TSV → GeoJSON converter.
 * Auto-detects delimiter via PapaParse, detects lat/lng or WKT columns,
 * builds Point features with all other columns as properties.
 */
export const csvConverter: IFileConverter = {
    formatName: "CSV",

    convert(input: string | ArrayBuffer): ConvertResult {
        const csvString = typeof input === "string" ? input : new TextDecoder().decode(input);

        if (!csvString || csvString.trim().length === 0) {
            return { data: emptyFC(), warnings: ["Empty CSV input"] };
        }

        const warnings: string[] = [];

        try {
            const parsed = Papa.parse<Record<string, string>>(csvString, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false, // Keep as strings for explicit parsing
            });

            if (parsed.errors.length > 0) {
                for (const err of parsed.errors) {
                    warnings.push(`CSV row ${err.row ?? "?"}: ${err.message}`);
                }
            }

            const headers = parsed.meta.fields || [];
            if (headers.length === 0) {
                return { data: emptyFC(), warnings: ["No headers found in CSV"] };
            }

            const geoCols = _detectGeoColumns(headers);
            if (!geoCols) {
                return {
                    data: emptyFC(),
                    warnings: [
                        "No geographic columns detected. Expected lat/lng columns (lat, latitude, y, lng, lon, longitude, x) or WKT column (wkt, geom, geometry).",
                    ],
                };
            }

            const geoColumnNames = _collectGeoColumnNames(geoCols);

            const features: Feature<Geometry>[] = [];

            for (const [i, rowData] of parsed.data.entries()) {
                const geometry = _buildRowGeometry(rowData, geoCols, i, warnings);
                if (!geometry) continue;

                features.push({
                    type: "Feature",
                    geometry,
                    properties: _buildRowProperties(rowData, headers, geoColumnNames),
                });
            }

            return { data: { type: "FeatureCollection", features }, warnings };
        } catch (err) {
            return {
                data: emptyFC(),
                warnings: [`CSV parsing error: ${(err as Error).message}`],
            };
        }
    },
};
