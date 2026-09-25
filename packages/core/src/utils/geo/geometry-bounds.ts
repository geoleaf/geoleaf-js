/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Where a GeoJSON geometry is — its bounding box, and one point that stands for it.
 *
 * Two readers need both answers for ANY geometry type: the layer search, whose results must
 * carry a position a geocoding consumer understands (`lat`, `lng`, optional `bounds`), and
 * `GeoLeaf.Layers.focus`, which frames what it found. Nothing in the kernel answered either:
 * the filter's `featureCentroid` returns the FIRST VERTEX — adequate for a proximity test,
 * wrong for framing a polygon.
 *
 * The box is the map adapter's own `GeoLeafBounds`, so it can be handed to `fitBounds` as is.
 */

import type { GeoLeafBounds } from "../../contracts/map-adapter.types.js";

/** Minimal structural view of a GeoJSON geometry — enough to walk its coordinates. */
interface GeometryLike {
    type?: unknown;
    coordinates?: unknown;
    geometries?: unknown;
}

/** Calls `visit` on every `[lng, lat]` pair of a coordinates tree. */
function _walk(coords: unknown, visit: (lng: number, lat: number) => void): void {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        if (Number.isFinite(coords[0]) && Number.isFinite(coords[1])) visit(coords[0], coords[1]);
        return;
    }
    for (const c of coords) _walk(c, visit);
}

/** Calls `visit` on every position of a geometry, collections included. */
function _walkGeometry(geometry: GeometryLike, visit: (lng: number, lat: number) => void): void {
    if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
        for (const g of geometry.geometries as GeometryLike[]) {
            if (g && typeof g === "object") _walkGeometry(g, visit);
        }
        return;
    }
    _walk(geometry.coordinates, visit);
}

/**
 * The bounding box of a geometry, or `null` when it holds no valid position.
 *
 * @param geometry - A GeoJSON geometry (any type, collections included).
 * @returns The box, or `null`.
 * @example
 * geometryBounds({ type: "LineString", coordinates: [[1, 2], [3, 6]] });
 * // { north: 6, south: 2, east: 3, west: 1 }
 */
export function geometryBounds(geometry: unknown): GeoLeafBounds | null {
    if (!geometry || typeof geometry !== "object") return null;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    _walkGeometry(geometry as GeometryLike, (lng, lat) => {
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
    });
    return Number.isFinite(west) ? { north, south, east, west } : null;
}

/**
 * One position that stands for a geometry.
 *
 * A point is itself; a multipoint, its first point; a line, its middle VERTEX — a position
 * that lies on the line, which a route can be drawn to; anything else, the centre of its
 * box. ⚠️ The centre of a concave polygon's box may fall outside it: this answers "where to
 * look", not "a point inside".
 *
 * @param geometry - A GeoJSON geometry.
 * @returns `{ lat, lng }`, or `null` when the geometry holds no valid position.
 * @example
 * representativePoint({ type: "Point", coordinates: [5.5, 45.25] }); // { lat: 45.25, lng: 5.5 }
 */
export function representativePoint(geometry: unknown): { lat: number; lng: number } | null {
    if (!geometry || typeof geometry !== "object") return null;
    const g = geometry as GeometryLike;
    let line: unknown = null;
    if (g.type === "LineString") line = g.coordinates;
    else if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) line = g.coordinates[0];
    if (g.type === "Point" || g.type === "MultiPoint" || Array.isArray(line)) {
        const positions: Array<[number, number]> = [];
        _walk(line ?? g.coordinates, (lng, lat) => positions.push([lng, lat]));
        const pick = g.type === "Point" || g.type === "MultiPoint" ? 0 : positions.length >> 1;
        const p = positions[pick];
        return p ? { lng: p[0], lat: p[1] } : null;
    }
    const box = geometryBounds(geometry);
    return box ? { lat: (box.north + box.south) / 2, lng: (box.east + box.west) / 2 } : null;
}
