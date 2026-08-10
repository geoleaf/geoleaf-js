/*!
 * @geoleaf-plugins/editor — Internal geodesic helpers (no external dependencies)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Geometry } from "geojson";
import type { FieldConfig } from "@geoleaf/field-renderer";

const EARTH_R = 6_371_000; // meters

function _toRad(d: number): number {
    return (d * Math.PI) / 180;
}

/**
 * Haversine distance between two [lng, lat] coordinates, in meters.
 */
export function haversineDistance(a: [number, number], b: [number, number]): number {
    const dLat = _toRad(b[1] - a[1]);
    const dLng = _toRad(b[0] - a[0]);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(_toRad(a[1])) * Math.cos(_toRad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Total path length of a coordinate array, in meters.
 */
export function haversineLength(coords: [number, number][]): number {
    let total = 0;
    // Pairwise walk rather than an indexed loop: iterating the values carries the element type
    // instead of re-deriving it from an index the compiler cannot bound (qualite Q5).
    let prev: [number, number] | undefined;
    for (const cur of coords) {
        if (prev) total += haversineDistance(prev, cur);
        prev = cur;
    }
    return total;
}

/**
 * Approximate polygon area using the Shoelace formula projected onto WGS-84, in m².
 * Suitable for small-to-medium polygons; error grows with size and polar latitude.
 */
export function shoelaceArea(coords: [number, number][]): number {
    if (coords.length < 3) return 0;
    const latMid = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const mPerDeg = (Math.PI * EARTH_R) / 180;
    const mPerLng = mPerDeg * Math.cos(_toRad(latMid));
    let area = 0;
    const n = coords.length;
    for (const [i, [x0, y0]] of coords.entries()) {
        const next = coords[(i + 1) % n];
        // Unreachable: (i + 1) % n is always a valid index of coords (qualite Q5).
        if (!next) continue;
        const [x1, y1] = next;
        area += x0 * mPerLng * y1 * mPerDeg - x1 * mPerLng * y0 * mPerDeg;
    }
    return Math.abs(area / 2);
}

/**
 * Centroid of a coordinate array (simple mean, sufficient for small geometries).
 */
export function centroid(coords: [number, number][]): [number, number] {
    const n = coords.length;
    return [coords.reduce((s, c) => s + c[0], 0) / n, coords.reduce((s, c) => s + c[1], 0) / n];
}

/** Total vertex count of a GeoJSON geometry. */
export function vertexCount(geometry: Geometry): number {
    switch (geometry.type) {
        case "Point":
            return 1;
        case "LineString":
            return geometry.coordinates.length;
        case "Polygon":
            return geometry.coordinates.reduce((s, r) => s + r.length, 0);
        case "MultiPoint":
            return geometry.coordinates.length;
        case "MultiLineString":
            return geometry.coordinates.reduce((s, l) => s + l.length, 0);
        case "MultiPolygon":
            return geometry.coordinates.reduce(
                (s, p) => s + p.reduce((s2, r) => s2 + r.length, 0),
                0
            );
        case "GeometryCollection":
            return geometry.geometries.reduce((s, g) => s + vertexCount(g), 0);
        default:
            return 0;
    }
}

type GeoComputeKind = "length" | "area" | "centroid" | "vertices";

/**
 * Dispatcher for computed field values (used by field-renderer-bridge for `computed` fields).
 * Returns number for length/area/vertices, [lng, lat] for centroid, null on unsupported combination.
 */
export function geoCompute(
    kind: GeoComputeKind,
    geometry: Geometry
): number | [number, number] | null {
    if (kind === "vertices") return vertexCount(geometry);
    const coords = _firstRing(geometry);
    if (!coords.length) return null;
    if (kind === "centroid") return centroid(coords);
    if (kind === "length") return haversineLength(coords);
    if (kind === "area" && geometry.type === "Polygon")
        return shoelaceArea(geometry.coordinates[0] as [number, number][]);
    return null;
}

/** Maps a `FieldConfig.computed` token to the {@link geoCompute} dispatcher kind. */
const _COMPUTED_KIND: Readonly<Record<string, GeoComputeKind>> = {
    "geometry.length": "length",
    "geometry.area": "area",
    "geometry.centroid": "centroid",
    "geometry.vertexCount": "vertices",
};

/**
 * Resolves every `computed` field of `schema` against `geometry`.
 *
 * This is the producer the `computed` contract had been missing: field-renderer
 * declares the four `geometry.*` tokens and renders such fields read-only, but
 * until PLUGINS S4 nothing ever calculated a value, so a documented feature
 * rendered permanently blank. Passed to the modal as `ModalOpenOptions
 * .computeValues`, which re-invokes it whenever it rebuilds the field bridge.
 *
 * Returns raw values — metres, m², a `[lng, lat]` pair, a vertex count — and
 * leaves presentation to the field's own type. Fields whose token is unknown, or
 * whose geometry cannot answer it (an area on a LineString), are omitted rather
 * than set to null, so the field simply stays empty.
 */
export function applyComputedFields(
    schema: FieldConfig[],
    geometry: Geometry
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of schema) {
        if (!field.computed) continue;
        const kind = _COMPUTED_KIND[field.computed];
        if (!kind) continue;
        const value = geoCompute(kind, geometry);
        if (value !== null) out[field.id] = value;
    }
    return out;
}

function _firstRing(geometry: Geometry): [number, number][] {
    switch (geometry.type) {
        case "Point":
            return [geometry.coordinates as [number, number]];
        case "LineString":
            return geometry.coordinates as [number, number][];
        case "Polygon":
            return geometry.coordinates[0] as [number, number][];
        default:
            return [];
    }
}
