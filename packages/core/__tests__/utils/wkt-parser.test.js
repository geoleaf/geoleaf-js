/**
 * @tests utils/wkt-parser
 */

import { wktToGeoJSON } from "../../src/utils/geo/wkt-parser.js";

describe("utils/wkt-parser — wktToGeoJSON", () => {
    // ─── Null / empty inputs ──────────────────────────────────────────────────

    it("returns null for null input", () => {
        expect(wktToGeoJSON(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
        expect(wktToGeoJSON(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
        expect(wktToGeoJSON("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
        expect(wktToGeoJSON("   ")).toBeNull();
    });

    // ─── POINT ───────────────────────────────────────────────────────────────

    it("parses POINT 2D", () => {
        expect(wktToGeoJSON("POINT(2.3522 48.8566)")).toEqual({
            type: "Point",
            coordinates: [2.3522, 48.8566],
        });
    });

    it("parses POINT with spaces inside parens", () => {
        expect(wktToGeoJSON("POINT ( 10 20 )")).toEqual({
            type: "Point",
            coordinates: [10, 20],
        });
    });

    it("parses POINT 3D (Z coordinate)", () => {
        expect(wktToGeoJSON("POINT Z (2.3522 48.8566 35.5)")).toEqual({
            type: "Point",
            coordinates: [2.3522, 48.8566, 35.5],
        });
    });

    it("parses POINT EMPTY as empty coordinates", () => {
        const result = wktToGeoJSON("POINT EMPTY");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("Point");
    });

    it("strips SRID prefix", () => {
        expect(wktToGeoJSON("SRID=4326;POINT(2.0 3.0)")).toEqual({
            type: "Point",
            coordinates: [2.0, 3.0],
        });
    });

    // ─── LINESTRING ───────────────────────────────────────────────────────────

    it("parses LINESTRING 2D", () => {
        expect(wktToGeoJSON("LINESTRING(0 0, 1 1, 2 2)")).toEqual({
            type: "LineString",
            coordinates: [
                [0, 0],
                [1, 1],
                [2, 2],
            ],
        });
    });

    it("parses LINESTRING 3D", () => {
        expect(wktToGeoJSON("LINESTRING Z(0 0 1, 1 1 2)")).toEqual({
            type: "LineString",
            coordinates: [
                [0, 0, 1],
                [1, 1, 2],
            ],
        });
    });

    // ─── POLYGON ─────────────────────────────────────────────────────────────

    it("parses POLYGON (no hole)", () => {
        expect(wktToGeoJSON("POLYGON((0 0, 4 0, 4 4, 0 4, 0 0))")).toEqual({
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [4, 0],
                    [4, 4],
                    [0, 4],
                    [0, 0],
                ],
            ],
        });
    });

    it("parses POLYGON with hole", () => {
        const result = wktToGeoJSON(
            "POLYGON((0 0, 10 0, 10 10, 0 10, 0 0),(1 1, 2 1, 2 2, 1 2, 1 1))"
        );
        expect(result?.type).toBe("Polygon");
        expect(result.coordinates).toHaveLength(2);
    });

    // ─── MULTIPOINT ──────────────────────────────────────────────────────────

    it("parses MULTIPOINT with wrapped coords", () => {
        expect(wktToGeoJSON("MULTIPOINT((0 0),(1 1))")).toEqual({
            type: "MultiPoint",
            coordinates: [
                [0, 0],
                [1, 1],
            ],
        });
    });

    it("parses MULTIPOINT with bare coords", () => {
        expect(wktToGeoJSON("MULTIPOINT(0 0, 1 1)")).toEqual({
            type: "MultiPoint",
            coordinates: [
                [0, 0],
                [1, 1],
            ],
        });
    });

    // ─── MULTILINESTRING ─────────────────────────────────────────────────────

    it("parses MULTILINESTRING", () => {
        const result = wktToGeoJSON("MULTILINESTRING((0 0, 1 1),(2 2, 3 3))");
        expect(result?.type).toBe("MultiLineString");
        expect(result.coordinates).toHaveLength(2);
    });

    // ─── MULTIPOLYGON ────────────────────────────────────────────────────────

    it("parses MULTIPOLYGON", () => {
        const result = wktToGeoJSON(
            "MULTIPOLYGON(((0 0,4 0,4 4,0 4,0 0)),((5 5,9 5,9 9,5 9,5 5)))"
        );
        expect(result?.type).toBe("MultiPolygon");
        expect(result.coordinates).toHaveLength(2);
    });

    // ─── GEOMETRYCOLLECTION ───────────────────────────────────────────────────

    it("parses GEOMETRYCOLLECTION", () => {
        const result = wktToGeoJSON("GEOMETRYCOLLECTION(POINT(0 0),LINESTRING(0 0,1 1))");
        expect(result?.type).toBe("GeometryCollection");
        expect(result.geometries).toHaveLength(2);
        expect(result.geometries[0].type).toBe("Point");
        expect(result.geometries[1].type).toBe("LineString");
    });

    it("parses GEOMETRYCOLLECTION EMPTY", () => {
        const result = wktToGeoJSON("GEOMETRYCOLLECTION EMPTY");
        expect(result?.type).toBe("GeometryCollection");
        expect(result.geometries).toHaveLength(0);
    });

    // ─── Invalid inputs ───────────────────────────────────────────────────────

    it("returns null for unknown geometry type", () => {
        expect(wktToGeoJSON("ELLIPSE(0 0 5 10)")).toBeNull();
    });

    it("returns null for truncated WKT", () => {
        expect(wktToGeoJSON("POINT(1")).toBeNull();
    });

    it("returns null for garbage trailing content", () => {
        expect(wktToGeoJSON("POINT(1 2) GARBAGE")).toBeNull();
    });

    it("returns null for non-numeric coordinates", () => {
        expect(wktToGeoJSON("POINT(abc def)")).toBeNull();
    });

    // ─── Case insensitivity ───────────────────────────────────────────────────

    it("is case-insensitive for type keywords", () => {
        expect(wktToGeoJSON("point(1 2)")).toEqual({
            type: "Point",
            coordinates: [1, 2],
        });
    });

    it("is case-insensitive for SRID prefix", () => {
        expect(wktToGeoJSON("srid=32632;POINT(1 2)")).toEqual({
            type: "Point",
            coordinates: [1, 2],
        });
    });

    // ─── Negative / decimal coordinates ──────────────────────────────────────

    it("handles negative coordinates", () => {
        expect(wktToGeoJSON("POINT(-73.9857 40.7484)")).toEqual({
            type: "Point",
            coordinates: [-73.9857, 40.7484],
        });
    });
});
