/**
 * @fileoverview ESM-import version of wkt-parser tests for Istanbul instrumentation.
 *
 * The existing wkt-parser.test.js uses require() which bypasses Istanbul.
 * This file uses ESM import to ensure branch coverage is captured.
 */

import { wktToGeoJSON } from "../../src/utils/geo/wkt-parser.js";

describe("wkt-parser — ESM import (coverage)", () => {
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

    // ─── POINT ───────────────────────────────────────────────────────────────

    it("parses POINT 2D", () => {
        expect(wktToGeoJSON("POINT(2.3522 48.8566)")).toEqual({
            type: "Point",
            coordinates: [2.3522, 48.8566],
        });
    });

    it("parses POINT 3D (Z coordinate)", () => {
        expect(wktToGeoJSON("POINT Z (2.3522 48.8566 35.5)")).toEqual({
            type: "Point",
            coordinates: [2.3522, 48.8566, 35.5],
        });
    });

    it("parses POINT EMPTY", () => {
        const result = wktToGeoJSON("POINT EMPTY");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("Point");
    });

    it("is case-insensitive for type keywords", () => {
        expect(wktToGeoJSON("point(1 2)")).toEqual({
            type: "Point",
            coordinates: [1, 2],
        });
    });

    it("strips SRID prefix", () => {
        expect(wktToGeoJSON("SRID=4326;POINT(2.0 3.0)")).toEqual({
            type: "Point",
            coordinates: [2.0, 3.0],
        });
    });

    it("is case-insensitive for SRID prefix", () => {
        expect(wktToGeoJSON("srid=32632;POINT(1 2)")).toEqual({
            type: "Point",
            coordinates: [1, 2],
        });
    });

    it("handles negative coordinates", () => {
        expect(wktToGeoJSON("POINT(-2.5 -48.5)")).toEqual({
            type: "Point",
            coordinates: [-2.5, -48.5],
        });
    });

    it("parses POINT with spaces inside parens", () => {
        expect(wktToGeoJSON("POINT ( 10 20 )")).toEqual({
            type: "Point",
            coordinates: [10, 20],
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
        const result = wktToGeoJSON("POLYGON((0 0, 4 0, 4 4, 0 4, 0 0))");
        expect(result?.type).toBe("Polygon");
        expect(result?.coordinates).toHaveLength(1);
    });

    it("parses POLYGON with hole", () => {
        const result = wktToGeoJSON(
            "POLYGON((0 0, 10 0, 10 10, 0 10, 0 0),(1 1, 2 1, 2 2, 1 2, 1 1))"
        );
        expect(result?.type).toBe("Polygon");
        expect(result?.coordinates).toHaveLength(2);
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
        expect(result?.coordinates).toHaveLength(2);
    });

    // ─── MULTIPOLYGON ────────────────────────────────────────────────────────

    it("parses MULTIPOLYGON", () => {
        const result = wktToGeoJSON(
            "MULTIPOLYGON(((0 0,4 0,4 4,0 4,0 0)),((5 5,9 5,9 9,5 9,5 5)))"
        );
        expect(result?.type).toBe("MultiPolygon");
        expect(result?.coordinates).toHaveLength(2);
    });

    // ─── GEOMETRYCOLLECTION ───────────────────────────────────────────────────

    it("parses GEOMETRYCOLLECTION with nested types", () => {
        const result = wktToGeoJSON("GEOMETRYCOLLECTION(POINT(0 0),LINESTRING(0 0,1 1))");
        expect(result?.type).toBe("GeometryCollection");
        expect(result?.geometries).toHaveLength(2);
        expect(result?.geometries[0].type).toBe("Point");
        expect(result?.geometries[1].type).toBe("LineString");
    });

    it("parses GEOMETRYCOLLECTION EMPTY", () => {
        const result = wktToGeoJSON("GEOMETRYCOLLECTION EMPTY");
        expect(result?.type).toBe("GeometryCollection");
        expect(result?.geometries).toHaveLength(0);
    });

    // ─── Error paths: _peek ??" right side (L42) ──────────────────────────────

    it("returns null for MULTIPOINT with trailing comma and no closing paren (L42+L173)", () => {
        // After reading "1 2,", _peek is called at end-of-string → ?? "" covers right side
        expect(wktToGeoJSON("MULTIPOINT(1 2,")).toBeNull();
    });

    // ─── Error paths: _readNumber isNaN (L71) ────────────────────────────────

    it("returns null when coordinate starts with '.' only (L71 isNaN branch)", () => {
        // parseFloat(".") === NaN → isNaN true → L71 TRUE branch
        expect(wktToGeoJSON("POINT(. 1)")).toBeNull();
    });

    // ─── Error paths: _readCoordinate z=null (L87) ───────────────────────────

    it("falls back to 2D when Z candidate is '-' only (L87 z-null FALSE branch)", () => {
        // next="-" passes /[-+\d]/ check, but parseFloat("-")=NaN → z=null → L87 FALSE
        // The coordinate falls back to [x, y] 2D point
        const result = wktToGeoJSON("POINT(1 2 -)");
        expect(result).toEqual({ type: "Point", coordinates: [1, 2] });
    });

    // ─── Error paths: _readCoordinateList (L96, L101, L106) ─────────────────

    it("returns null for LINESTRING without opening paren (L96 TRUE branch)", () => {
        expect(wktToGeoJSON("LINESTRING 1 2, 3 4")).toBeNull();
    });

    it("returns null for LINESTRING with non-numeric coordinate (L101 TRUE branch)", () => {
        expect(wktToGeoJSON("LINESTRING(x y)")).toBeNull();
    });

    it("returns null for LINESTRING with missing closing paren (L106 TRUE branch)", () => {
        expect(wktToGeoJSON("LINESTRING(1 2, 3 4")).toBeNull();
    });

    // ─── Error paths: _readRingList (L112, L117, L122) ────────────────────────

    it("returns null for POLYGON without outer paren (L112 TRUE branch)", () => {
        expect(wktToGeoJSON("POLYGON 0 0, 4 4, 0 0")).toBeNull();
    });

    it("returns null for POLYGON ring with non-numeric coord (L117 TRUE branch)", () => {
        expect(wktToGeoJSON("POLYGON(x y)")).toBeNull();
    });

    it("returns null for POLYGON missing outer closing paren (L122 TRUE branch)", () => {
        expect(wktToGeoJSON("POLYGON((0 0, 4 0, 4 4, 0 4, 0 0)")).toBeNull();
    });

    // ─── Error paths: _parsePoint (L140, L145) ───────────────────────────────

    it("returns null for POINT without opening paren (L140 TRUE branch)", () => {
        expect(wktToGeoJSON("POINT 1 2")).toBeNull();
    });

    it("returns null for POINT with missing closing paren (L145 TRUE branch)", () => {
        expect(wktToGeoJSON("POINT(1 2")).toBeNull();
    });

    // ─── Error paths: _parseLineString EMPTY + null (L150, L152) ────────────

    it("parses LINESTRING EMPTY (L150 TRUE branch)", () => {
        const result = wktToGeoJSON("LINESTRING EMPTY");
        expect(result?.type).toBe("LineString");
        expect(result?.coordinates).toHaveLength(0);
    });

    it("returns null for LINESTRING without parens → coords null (L152 TRUE branch)", () => {
        // _readCoordinateList called without "(" → returns null → L152 TRUE
        expect(wktToGeoJSON("LINESTRING 0 0, 1 1")).toBeNull();
    });

    // ─── Error paths: _parsePolygon EMPTY + null (L157, L159) ───────────────

    it("parses POLYGON EMPTY (L157 TRUE branch)", () => {
        const result = wktToGeoJSON("POLYGON EMPTY");
        expect(result?.type).toBe("Polygon");
        expect(result?.coordinates).toHaveLength(0);
    });

    it("returns null for POLYGON without parens → rings null (L159 TRUE branch)", () => {
        expect(wktToGeoJSON("POLYGON 0 0, 4 4, 0 0")).toBeNull();
    });

    // ─── Error paths: _parseMultiPoint (L164, L166, L177) ───────────────────

    it("returns null for MULTIPOINT without opening paren (L164 TRUE branch)", () => {
        expect(wktToGeoJSON("MULTIPOINT 1 2, 3 4")).toBeNull();
    });

    it("returns null for MULTIPOINT wrapped group with multiple coords (L166 TRUE branch)", () => {
        // ((1 2, 3 4)) → list.length=2   != 1 → L166 TRUE
        expect(wktToGeoJSON("MULTIPOINT((1 2, 3 4))")).toBeNull();
    });

    it("returns null for MULTIPOINT missing closing paren (L177 TRUE branch)", () => {
        expect(wktToGeoJSON("MULTIPOINT(1 2, 3 4")).toBeNull();
    });

    // ─── Error paths: _parseMultiLineString (L183, L188, L190) ──────────────

    it("returns null for MULTILINESTRING without outer paren (L183 TRUE branch)", () => {
        expect(wktToGeoJSON("MULTILINESTRING 0 0, 1 1")).toBeNull();
    });

    it("returns null for MULTILINESTRING with invalid inner line (L188 TRUE branch)", () => {
        // Inner line "x y" has no "(" → _readCoordinateList returns null → L188 TRUE
        expect(wktToGeoJSON("MULTILINESTRING(x y)")).toBeNull();
    });

    it("returns null for MULTILINESTRING missing outer closing paren (L190 TRUE branch)", () => {
        expect(wktToGeoJSON("MULTILINESTRING((1 2, 3 4)")).toBeNull();
    });

    // ─── Error paths: _parseMultiPolygon (L195, L200, L205) ─────────────────

    it("returns null for MULTIPOLYGON without outer paren (L195 TRUE branch)", () => {
        expect(wktToGeoJSON("MULTIPOLYGON 0 0")).toBeNull();
    });

    it("returns null for MULTIPOLYGON with invalid polygon (L200 TRUE branch)", () => {
        // Inner polygon "0 0" has no ring parens → _readRingList returns null → L200 TRUE
        expect(wktToGeoJSON("MULTIPOLYGON(0 0)")).toBeNull();
    });

    it("returns null for MULTIPOLYGON missing outer closing paren (L205 TRUE branch)", () => {
        expect(wktToGeoJSON("MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0))")).toBeNull();
    });

    // ─── Error paths: _parseGeometryCollection (L207, L212, L217) ───────────

    it("returns null for GEOMETRYCOLLECTION without opening paren (L207 TRUE branch)", () => {
        expect(wktToGeoJSON("GEOMETRYCOLLECTION POINT(1 2)")).toBeNull();
    });

    it("returns null for GEOMETRYCOLLECTION with unknown geometry inside (L212 TRUE branch)", () => {
        expect(wktToGeoJSON("GEOMETRYCOLLECTION(NOTAGEOMETRY(1 2))")).toBeNull();
    });

    it("returns null for GEOMETRYCOLLECTION missing outer closing paren (L217 TRUE branch)", () => {
        expect(wktToGeoJSON("GEOMETRYCOLLECTION(POINT(1 2)")).toBeNull();
    });

    // ─── MULTILINESTRING / MULTIPOLYGON EMPTY (L183/L195 FALSE paths) ────────

    it("parses MULTILINESTRING EMPTY (EMPTY branch)", () => {
        const result = wktToGeoJSON("MULTILINESTRING EMPTY");
        expect(result?.type).toBe("MultiLineString");
    });

    it("parses MULTIPOLYGON EMPTY (EMPTY branch)", () => {
        const result = wktToGeoJSON("MULTIPOLYGON EMPTY");
        expect(result?.type).toBe("MultiPolygon");
    });
});
