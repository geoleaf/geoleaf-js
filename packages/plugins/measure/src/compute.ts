/*!
 * @geoleaf-plugins/measure — Compute
 * © 2026 Mattieu Pottier — MIT License
 *
 * Pure geodesic helpers wrapping Turf.js + unit formatters.
 * All functions are stateless and side-effect-free.
 * https://geoleaf.dev
 */
import turfDistance from "@turf/distance";
import turfArea from "@turf/area";
import turfCircle from "@turf/circle";
import turfCentroid from "@turf/centroid";
import { point, polygon } from "@turf/helpers";

import type { DistanceUnit, AreaUnit } from "./types.js";

// ---------------------------------------------------------------------------
// Geodesic calculations
// ---------------------------------------------------------------------------

/**
 * Returns the length (metres) of each segment in a coordinate array.
 * Result has length = coords.length - 1; returns [] if fewer than 2 points.
 */
export function segmentLengths(coords: [number, number][]): number[] {
    if (coords.length < 2) return [];
    const lengths: number[] = [];
    // Pairwise walk: the previous vertex is carried rather than re-read (qualite Q5).
    let prev: [number, number] | undefined;
    for (const cur of coords) {
        if (prev) lengths.push(turfDistance(point(prev), point(cur), { units: "meters" }));
        prev = cur;
    }
    return lengths;
}

/**
 * Returns a copy of `ring` whose first vertex is repeated at the end, unless it already is.
 *
 * Both `area` and `centroid` closed their rings with the same six lines; turf refuses an open
 * ring, so the duplication was load-bearing and stayed unnoticed (qualite Q5).
 */
function _ensureClosedRing(ring: [number, number][]): [number, number][] {
    const r = [...ring];
    const first = r[0];
    const last = r[r.length - 1];
    if (!first || !last) return r;
    if (first[0] !== last[0] || first[1] !== last[1]) r.push([...first]);
    return r;
}

/**
 * Returns `ring` with its first vertex repeated at the end.
 *
 * ⚠️ Distinct from {@link _ensureClosedRing}, which appends only when the ring is open. This one
 * appends unconditionally, which is what a measure session needs: `vertices` never holds the
 * closing vertex, and the segment count downstream is derived from the returned length. Four
 * call sites spelled it `[...verts, verts[0]]`, where the indexed read is what widened
 * (qualite Q5).
 *
 * @param ring Session vertices in `[lng, lat]` order.
 * @returns A new array; an empty input yields an empty output rather than `[undefined]`.
 */
export function withClosingVertex(ring: [number, number][]): [number, number][] {
    const first = ring[0];
    return first === undefined ? [...ring] : [...ring, first];
}

/**
 * True when `coord` repeats the last vertex of `verts`.
 *
 * Every drawing tool swallows a duplicate click this way; the test was written out five times
 * across four files, each spelling `verts[verts.length - 1][0] === coord[0] && …`.
 *
 * @param verts Session vertices, possibly absent when no session is open.
 * @param coord Candidate vertex in `[lng, lat]` order.
 * @returns `true` when the candidate would duplicate the last vertex.
 */
export function isLastVertex(
    verts: [number, number][] | undefined,
    coord: [number, number]
): boolean {
    const last = verts?.at(-1);
    return last !== undefined && last[0] === coord[0] && last[1] === coord[1];
}

/**
 * Sum of all segment lengths (metres).
 * @param coords Vertices in `[lng, lat]` order — the GeoJSON convention, not `[lat, lng]`.
 * @param closed If true, adds the segment from last to first vertex.
 */
export function perimeter(coords: [number, number][], closed: boolean): number {
    if (coords.length < 2) return 0;
    const segs = segmentLengths(coords);
    let total = segs.reduce((s, l) => s + l, 0);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (closed && coords.length > 2 && first && last) {
        total += turfDistance(point(last), point(first), { units: "meters" });
    }
    return total;
}

/**
 * Polygon area in square metres. Accepts the outer ring as coordinate array
 * (need not be closed — the function closes it automatically).
 */
export function area(polygonCoords: [number, number][][]): number {
    return turfArea(polygon(polygonCoords.map(_ensureClosedRing)));
}

/**
 * Approximates a circle as a regular polygon.
 * Returns the outer ring coordinate array (closed).
 */
export function circlePolygon(
    center: [number, number],
    radiusM: number,
    steps: number
): [number, number][][] {
    const feat = turfCircle(point(center), radiusM, { steps, units: "meters" });
    return feat.geometry.coordinates as [number, number][][];
}

/**
 * Returns the centroid [lng, lat] of a polygon outer ring.
 */
export function centroid(coords: [number, number][]): [number, number] {
    const feat = turfCentroid(polygon([_ensureClosedRing(coords)]));
    return feat.geometry.coordinates as [number, number];
}

/**
 * Returns the outer ring of an axis-aligned bounding box (closed polygon).
 * p1 = top-left (HG), p2 = bottom-right (BD).
 */
export function bboxPolygon(p1: [number, number], p2: [number, number]): [number, number][][] {
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    return [
        [
            [Math.min(x1, x2), Math.max(y1, y2)],
            [Math.max(x1, x2), Math.max(y1, y2)],
            [Math.max(x1, x2), Math.min(y1, y2)],
            [Math.min(x1, x2), Math.min(y1, y2)],
            [Math.min(x1, x2), Math.max(y1, y2)],
        ],
    ];
}

// ---------------------------------------------------------------------------
// Unit formatters
// ---------------------------------------------------------------------------

/**
 * Formats a distance in metres to a human-readable string.
 * `"auto"` chooses m below 1 000 m, km above.
 */
export function formatDistance(m: number, unit: DistanceUnit, decimals: number): string {
    switch (unit) {
        case "km":
            return `${_round(m / 1000, decimals)} km`;
        case "m":
            return `${_round(m, decimals)} m`;
        case "auto":
        default:
            return m < 1000 ? `${_round(m, decimals)} m` : `${_round(m / 1000, decimals)} km`;
    }
}

/**
 * Formats an area in square metres to a human-readable string.
 * `"auto"` chooses m² below 1 ha, ha below 1 km², km² above.
 */
export function formatArea(m2: number, unit: AreaUnit, decimals: number): string {
    switch (unit) {
        case "ha":
            return `${_round(m2 / 1e4, decimals)} ha`;
        case "km2":
            return `${_round(m2 / 1e6, decimals)} km²`;
        case "m2":
            return `${_round(m2, decimals)} m²`;
        case "auto":
        default:
            if (m2 < 1e4) return `${_round(m2, decimals)} m²`;
            if (m2 < 1e6) return `${_round(m2 / 1e4, decimals)} ha`;
            return `${_round(m2 / 1e6, decimals)} km²`;
    }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _round(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

// Re-exported for use by other modules (avoids direct @turf/helpers import)
