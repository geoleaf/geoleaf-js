/**
 * Tests for compute.ts — Turf wrappers and unit formatters.
 */
import { describe, it, expect } from "vitest";
import {
    segmentLengths,
    perimeter,
    area,
    circlePolygon,
    centroid,
    bboxPolygon,
    formatDistance,
    formatArea,
} from "../compute.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Paris (2.3488, 48.8534) → Lyon (4.8357, 45.7640): ~391 km geodesic
const PARIS: [number, number] = [2.3488, 48.8534];
const LYON: [number, number] = [4.8357, 45.764];

// Simple triangle in Paris area (coords are lng, lat)
const TRIANGLE: [number, number][] = [
    [2.3, 48.85],
    [2.4, 48.85],
    [2.35, 48.9],
];

// ---------------------------------------------------------------------------
// segmentLengths
// ---------------------------------------------------------------------------

describe("segmentLengths", () => {
    it("returns [] for fewer than 2 points", () => {
        expect(segmentLengths([])).toEqual([]);
        expect(segmentLengths([[2, 48]])).toEqual([]);
    });

    it("returns one length for two points (Paris → Lyon ~391 km)", () => {
        const [d] = segmentLengths([PARIS, LYON]);
        expect(d).toBeGreaterThan(380_000);
        expect(d).toBeLessThan(400_000);
    });

    it("returns n-1 lengths for n points", () => {
        const coords: [number, number][] = [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
        ];
        const lens = segmentLengths(coords);
        expect(lens).toHaveLength(3);
        // All segments roughly equal along the equator
        lens.forEach((l) => {
            expect(l).toBeGreaterThan(100_000);
            expect(l).toBeLessThan(120_000);
        });
    });
});

// ---------------------------------------------------------------------------
// perimeter
// ---------------------------------------------------------------------------

describe("perimeter", () => {
    it("returns 0 for a single point", () => {
        expect(perimeter([PARIS], false)).toBe(0);
    });

    it("open polyline: sum of segments", () => {
        const coords: [number, number][] = [PARIS, LYON];
        const p = perimeter(coords, false);
        const [seg] = segmentLengths(coords);
        expect(p).toBeCloseTo(seg, 0);
    });

    it("closed polyline adds the closing edge", () => {
        const coords: [number, number][] = TRIANGLE;
        const open = perimeter(coords, false);
        const closed = perimeter(coords, true);
        expect(closed).toBeGreaterThan(open);
    });
});

// ---------------------------------------------------------------------------
// area
// ---------------------------------------------------------------------------

describe("area", () => {
    it("returns a positive value for a simple polygon", () => {
        const m2 = area([TRIANGLE]);
        // 0.1° × 0.05° ≈ a few km²
        expect(m2).toBeGreaterThan(1_000_000);
        expect(m2).toBeLessThan(500_000_000);
    });

    it("auto-closes an unclosed ring", () => {
        const open = [...TRIANGLE];
        const closed = [...TRIANGLE, TRIANGLE[0]];
        expect(area([open])).toBeCloseTo(area([closed]), 0);
    });
});

// ---------------------------------------------------------------------------
// circlePolygon
// ---------------------------------------------------------------------------

describe("circlePolygon", () => {
    it("returns the outer ring with the correct number of steps (closed)", () => {
        const ring = circlePolygon([2.35, 48.85], 100, 8);
        expect(ring).toHaveLength(1);
        // Turf circle ring is closed: first === last
        const coords = ring[0];
        expect(coords).toHaveLength(9); // steps + 1
    });

    it("ring bbox is approximately ±radius around the centre", () => {
        const radiusM = 1000;
        const ring = circlePolygon([0, 0], radiusM, 64);
        const coords = ring[0];
        // At equator, 1 km ≈ 0.009° lng / 0.009° lat
        const lngs = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        const maxLng = Math.max(...lngs);
        const minLng = Math.min(...lngs);
        expect(maxLng - minLng).toBeGreaterThan(0.01);
        expect(maxLng - minLng).toBeLessThan(0.05);
        const maxLat = Math.max(...lats);
        const minLat = Math.min(...lats);
        expect(maxLat - minLat).toBeGreaterThan(0.01);
        expect(maxLat - minLat).toBeLessThan(0.05);
    });
});

// ---------------------------------------------------------------------------
// centroid
// ---------------------------------------------------------------------------

describe("centroid", () => {
    it("returns a point inside the polygon", () => {
        const c = centroid(TRIANGLE);
        expect(c[0]).toBeGreaterThan(2.2);
        expect(c[0]).toBeLessThan(2.5);
        expect(c[1]).toBeGreaterThan(48.8);
        expect(c[1]).toBeLessThan(49.0);
    });
});

// ---------------------------------------------------------------------------
// bboxPolygon
// ---------------------------------------------------------------------------

describe("bboxPolygon", () => {
    it("returns a closed ring of 5 points", () => {
        const ring = bboxPolygon([1, 49], [3, 47]);
        expect(ring).toHaveLength(1);
        expect(ring[0]).toHaveLength(5);
    });

    it("works regardless of corner ordering", () => {
        const a = bboxPolygon([1, 49], [3, 47]);
        const b = bboxPolygon([3, 47], [1, 49]);
        expect(a).toEqual(b);
    });
});

// ---------------------------------------------------------------------------
// formatDistance
// ---------------------------------------------------------------------------

describe("formatDistance", () => {
    it('unit "m" always formats in metres', () => {
        expect(formatDistance(500, "m", 0)).toBe("500 m");
        expect(formatDistance(1500, "m", 0)).toBe("1500 m");
    });

    it('unit "km" always formats in kilometres', () => {
        expect(formatDistance(500, "km", 2)).toBe("0.5 km");
        expect(formatDistance(1500, "km", 1)).toBe("1.5 km");
    });

    it('"auto" uses m below 1000, km above', () => {
        expect(formatDistance(999, "auto", 0)).toContain("m");
        expect(formatDistance(999, "auto", 0)).not.toContain("km");
        expect(formatDistance(1001, "auto", 0)).toContain("km");
    });

    it("respects decimals parameter", () => {
        expect(formatDistance(1234.5, "m", 1)).toBe("1234.5 m");
        expect(formatDistance(1234.5, "m", 0)).toBe("1235 m");
    });
});

// ---------------------------------------------------------------------------
// formatArea
// ---------------------------------------------------------------------------

describe("formatArea", () => {
    it('unit "m2" always formats in m²', () => {
        expect(formatArea(500, "m2", 0)).toBe("500 m²");
        expect(formatArea(20000, "m2", 0)).toBe("20000 m²");
    });

    it('unit "ha" always formats in ha', () => {
        expect(formatArea(20000, "ha", 1)).toBe("2 ha");
        expect(formatArea(10000, "ha", 2)).toBe("1 ha");
    });

    it('unit "km2" always formats in km²', () => {
        expect(formatArea(2_000_000, "km2", 1)).toBe("2 km²");
    });

    it('"auto" picks the best unit', () => {
        expect(formatArea(9999, "auto", 0)).toContain("m²");
        expect(formatArea(10001, "auto", 1)).toContain("ha");
        expect(formatArea(1_000_001, "auto", 1)).toContain("km²");
    });

    it("respects decimals parameter", () => {
        expect(formatArea(15000, "ha", 2)).toBe("1.5 ha");
        expect(formatArea(15000, "ha", 0)).toBe("2 ha");
    });
});
