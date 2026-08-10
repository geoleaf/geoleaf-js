/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf WKT Parser
 * Converts Well-Known Text (WKT) geometry strings to GeoJSON geometry objects.
 *
 * Supported types: Point, LineString, Polygon, MultiPoint, MultiLineString,
 * MultiPolygon, GeometryCollection (2D and 3D/Z variants).
 * Returns null for invalid or unrecognised input — never throws.
 */

// ─── GeoJSON geometry types (minimal, avoids @types/geojson peer dependency) ──

type WktPoint = { type: "Point"; coordinates: number[] };
type WktLineString = { type: "LineString"; coordinates: number[][] };
type WktPolygon = { type: "Polygon"; coordinates: number[][][] };
type WktMultiPoint = { type: "MultiPoint"; coordinates: number[][] };
type WktMultiLineString = { type: "MultiLineString"; coordinates: number[][][] };
type WktMultiPolygon = { type: "MultiPolygon"; coordinates: number[][][][] };
type WktGeometryCollection = {
    type: "GeometryCollection";
    geometries: WktGeometry[];
};

type WktGeometry =
    | WktPoint
    | WktLineString
    | WktPolygon
    | WktMultiPoint
    | WktMultiLineString
    | WktMultiPolygon
    | WktGeometryCollection;

// ─── Internal parser state ───────────────────────────────────────────────────

interface ParseState {
    input: string;
    pos: number;
}

function _peek(s: ParseState): string {
    return s.input[s.pos] ?? "";
}

function _consume(s: ParseState, char: string): boolean {
    if (s.input[s.pos] === char) {
        s.pos++;
        return true;
    }
    return false;
}

function _skipWhitespace(s: ParseState): void {
    while (s.pos < s.input.length && /\s/.test(s.input.charAt(s.pos))) s.pos++;
}

function _readKeyword(s: ParseState): string {
    _skipWhitespace(s);
    const start = s.pos;
    while (s.pos < s.input.length && /[A-Za-z_]/.test(s.input.charAt(s.pos))) s.pos++;
    return s.input.slice(start, s.pos).toUpperCase();
}

function _readNumber(s: ParseState): number | null {
    _skipWhitespace(s);
    const start = s.pos;
    if (s.input[s.pos] === "-" || s.input[s.pos] === "+") s.pos++;
    while (s.pos < s.input.length && /[\d.]/.test(s.input.charAt(s.pos))) s.pos++;
    if (s.pos === start) return null;
    const n = parseFloat(s.input.slice(start, s.pos));
    return isNaN(n) ? null : n;
}

function _readCoordinate(s: ParseState): number[] | null {
    _skipWhitespace(s);
    const x = _readNumber(s);
    if (x === null) return null;
    _skipWhitespace(s);
    const y = _readNumber(s);
    if (y === null) return null;
    // Optional Z
    const saved = s.pos;
    _skipWhitespace(s);
    const next = s.input[s.pos];
    if (next !== undefined && next !== "," && next !== ")" && /[-+\d]/.test(next)) {
        const z = _readNumber(s);
        if (z !== null) return [x, y, z];
    } else {
        s.pos = saved;
    }
    return [x, y];
}

function _readCoordinateList(s: ParseState): number[][] | null {
    _skipWhitespace(s);
    if (!_consume(s, "(")) return null;
    const coords: number[][] = [];
    do {
        _skipWhitespace(s);
        const coord = _readCoordinate(s);
        if (coord === null) return null;
        coords.push(coord);
        _skipWhitespace(s);
    } while (_consume(s, ","));
    _skipWhitespace(s);
    if (!_consume(s, ")")) return null;
    return coords;
}

function _readRingList(s: ParseState): number[][][] | null {
    _skipWhitespace(s);
    if (!_consume(s, "(")) return null;
    const rings: number[][][] = [];
    do {
        _skipWhitespace(s);
        const ring = _readCoordinateList(s);
        if (ring === null) return null;
        rings.push(ring);
        _skipWhitespace(s);
    } while (_consume(s, ","));
    _skipWhitespace(s);
    if (!_consume(s, ")")) return null;
    return rings;
}

// ─── Type parsers ────────────────────────────────────────────────────────────

function _parseEmpty(s: ParseState): boolean {
    const saved = s.pos;
    _skipWhitespace(s);
    const kw = _readKeyword(s);
    if (kw === "EMPTY") return true;
    s.pos = saved;
    return false;
}

function _parsePoint(s: ParseState): WktPoint | null {
    if (_parseEmpty(s)) return { type: "Point", coordinates: [] };
    _skipWhitespace(s);
    if (!_consume(s, "(")) return null;
    _skipWhitespace(s);
    const coord = _readCoordinate(s);
    if (coord === null) return null;
    _skipWhitespace(s);
    if (!_consume(s, ")")) return null;
    return { type: "Point", coordinates: coord };
}

function _parseLineString(s: ParseState): WktLineString | null {
    if (_parseEmpty(s)) return { type: "LineString", coordinates: [] };
    const coords = _readCoordinateList(s);
    if (coords === null) return null;
    return { type: "LineString", coordinates: coords };
}

function _parsePolygon(s: ParseState): WktPolygon | null {
    if (_parseEmpty(s)) return { type: "Polygon", coordinates: [] };
    const rings = _readRingList(s);
    if (rings === null) return null;
    return { type: "Polygon", coordinates: rings };
}

function _parseMultiPoint(s: ParseState): WktMultiPoint | null {
    if (_parseEmpty(s)) return { type: "MultiPoint", coordinates: [] };
    _skipWhitespace(s);
    if (!_consume(s, "(")) return null;
    const points: number[][] = [];
    do {
        _skipWhitespace(s);
        // Support both MULTIPOINT((x y),(x y)) and MULTIPOINT(x y,x y)
        if (_peek(s) === "(") {
            const list = _readCoordinateList(s);
            const only = list?.[0];
            if (!only || list.length !== 1) return null;
            points.push(only);
        } else {
            const coord = _readCoordinate(s);
            if (coord === null) return null;
            points.push(coord);
        }
        _skipWhitespace(s);
    } while (_consume(s, ","));
    _skipWhitespace(s);
    if (!_consume(s, ")")) return null;
    return { type: "MultiPoint", coordinates: points };
}

function _parseMultiLineString(s: ParseState): WktMultiLineString | null {
    if (_parseEmpty(s)) return { type: "MultiLineString", coordinates: [] };
    _skipWhitespace(s);
    if (!_consume(s, "(")) return null;
    const lines: number[][][] = [];
    do {
        _skipWhitespace(s);
        const coords = _readCoordinateList(s);
        if (coords === null) return null;
        lines.push(coords);
        _skipWhitespace(s);
    } while (_consume(s, ","));
    _skipWhitespace(s);
    if (!_consume(s, ")")) return null;
    return { type: "MultiLineString", coordinates: lines };
}

function _parseMultiPolygon(s: ParseState): WktMultiPolygon | null {
    if (_parseEmpty(s)) return { type: "MultiPolygon", coordinates: [] };
    _skipWhitespace(s);
    if (!_consume(s, "(")) return null;
    const polygons: number[][][][] = [];
    do {
        _skipWhitespace(s);
        const rings = _readRingList(s);
        if (rings === null) return null;
        polygons.push(rings);
        _skipWhitespace(s);
    } while (_consume(s, ","));
    _skipWhitespace(s);
    if (!_consume(s, ")")) return null;
    return { type: "MultiPolygon", coordinates: polygons };
}

function _parseGeometryCollection(s: ParseState): WktGeometryCollection | null {
    if (_parseEmpty(s)) return { type: "GeometryCollection", geometries: [] };
    _skipWhitespace(s);
    if (!_consume(s, "(")) return null;
    const geometries: WktGeometry[] = [];
    do {
        _skipWhitespace(s);
        const geom = _parseGeometry(s);
        if (geom === null) return null;
        geometries.push(geom);
        _skipWhitespace(s);
    } while (_consume(s, ","));
    _skipWhitespace(s);
    if (!_consume(s, ")")) return null;
    return { type: "GeometryCollection", geometries };
}

// Forward declaration resolved here
function _parseGeometry(s: ParseState): WktGeometry | null {
    _skipWhitespace(s);
    const keyword = _readKeyword(s);
    // Skip Z/M/ZM qualifiers (e.g. POINT Z (...))
    // NOTE: EMPTY is NOT consumed here — each sub-parser's _parseEmpty() call handles it.
    const saved = s.pos;
    _skipWhitespace(s);
    const qualifier = _readKeyword(s);
    if (qualifier !== "Z" && qualifier !== "M" && qualifier !== "ZM") {
        s.pos = saved;
    }
    switch (keyword) {
        case "POINT":
            return _parsePoint(s);
        case "LINESTRING":
            return _parseLineString(s);
        case "POLYGON":
            return _parsePolygon(s);
        case "MULTIPOINT":
            return _parseMultiPoint(s);
        case "MULTILINESTRING":
            return _parseMultiLineString(s);
        case "MULTIPOLYGON":
            return _parseMultiPolygon(s);
        case "GEOMETRYCOLLECTION":
            return _parseGeometryCollection(s);
        default:
            return null;
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Converts a WKT geometry string to a GeoJSON geometry object.
 *
 * Supports all 7 standardised WKT geometry types (2D and 3D/Z):
 * `Point`, `LineString`, `Polygon`, `MultiPoint`, `MultiLineString`,
 * `MultiPolygon`, `GeometryCollection`.
 *
 * - SRID prefixes (e.g. `SRID=4326;POINT(...)`) are stripped before parsing.
 * - WKT qualifier tokens (`Z`, `M`, `ZM`) are accepted and ignored.
 * - Returns `null` when the input is null, empty, or syntactically invalid.
 * - Never throws.
 *
 * @param wkt - WKT geometry string.
 * @returns A GeoJSON geometry object, or `null` on failure.
 *
 * @example
 * ```typescript
 * wktToGeoJSON("POINT(2.3522 48.8566)")
 * // → { type: "Point", coordinates: [2.3522, 48.8566] }
 *
 * wktToGeoJSON("POINT Z (2.3522 48.8566 35)")
 * // → { type: "Point", coordinates: [2.3522, 48.8566, 35] }
 * ```
 */
export function wktToGeoJSON(wkt: string | null | undefined): WktGeometry | null {
    if (wkt == null) return null;
    const trimmed = wkt.trim();
    if (!trimmed) return null;

    // Strip optional SRID prefix: "SRID=4326;"
    const stripped = trimmed.replace(/^SRID\s*=\s*\d+\s*;\s*/i, "");

    try {
        const state: ParseState = { input: stripped, pos: 0 };
        const result = _parseGeometry(state);
        if (result === null) return null;
        // Ensure full input was consumed (no garbage at the end)
        _skipWhitespace(state);
        if (state.pos < state.input.length) return null;
        return result;
    } catch {
        return null;
    }
}
