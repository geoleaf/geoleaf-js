import { describe, it, expect } from "vitest";
import { csvConverter } from "../../converters/csv-converter.js";

describe("csv-converter", () => {
    it("formatName is CSV", () => {
        expect(csvConverter.formatName).toBe("CSV");
    });

    it("returns empty FC + warning for empty string", () => {
        const result = csvConverter.convert("");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings).toContain("Empty CSV input");
    });

    it("converts CSV with lat/lng columns to Point features", () => {
        const csv = `name,lat,lng,population
Paris,48.85,2.35,2161000
Lyon,45.76,4.84,516092`;
        const result = csvConverter.convert(csv);
        expect(result.data.features).toHaveLength(2);

        const f0 = result.data.features[0];
        expect(f0.geometry.type).toBe("Point");
        expect((f0.geometry as GeoJSON.Point).coordinates).toEqual([2.35, 48.85]);
        expect(f0.properties?.name).toBe("Paris");
        expect(f0.properties?.population).toBe(2161000);
    });

    it("detects latitude/longitude column names (case insensitive)", () => {
        const csv = `City,Latitude,Longitude
A,48.0,2.0`;
        const result = csvConverter.convert(csv);
        expect(result.data.features).toHaveLength(1);
        expect((result.data.features[0].geometry as GeoJSON.Point).coordinates).toEqual([2, 48]);
    });

    it("detects x/y column names", () => {
        const csv = `name,x,y
P1,2.35,48.85`;
        const result = csvConverter.convert(csv);
        expect(result.data.features).toHaveLength(1);
        // x → lng, y → lat
        expect((result.data.features[0].geometry as GeoJSON.Point).coordinates).toEqual([
            2.35, 48.85,
        ]);
    });

    it("converts CSV with WKT column", () => {
        const csv = `name,wkt
Paris,POINT (2.35 48.85)`;
        const result = csvConverter.convert(csv);
        expect(result.data.features).toHaveLength(1);
        expect((result.data.features[0].geometry as GeoJSON.Point).coordinates).toEqual([
            2.35, 48.85,
        ]);
    });

    it("handles WKT POINT with Z coordinate", () => {
        const csv = `id,wkt
1,POINT (2.35 48.85 150)`;
        const result = csvConverter.convert(csv);
        expect((result.data.features[0].geometry as GeoJSON.Point).coordinates).toEqual([
            2.35, 48.85, 150,
        ]);
    });

    it("warns and skips rows with invalid lat/lng", () => {
        const csv = `name,lat,lng
A,abc,2.0
B,48.0,2.0`;
        const result = csvConverter.convert(csv);
        expect(result.data.features).toHaveLength(1);
        expect(result.warnings?.some((w) => w.includes("Row 1: invalid coordinates"))).toBe(true);
    });

    it("warns and skips rows with empty WKT", () => {
        const csv = `name,wkt
A,
B,POINT (2 48)`;
        const result = csvConverter.convert(csv);
        expect(result.data.features).toHaveLength(1);
        expect(result.warnings?.some((w) => w.includes("empty WKT"))).toBe(true);
    });

    it("warns and skips unsupported WKT types", () => {
        const csv = `name,wkt
A,LINESTRING (0 0, 1 1)`;
        const result = csvConverter.convert(csv);
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("unsupported or invalid WKT"))).toBe(true);
    });

    it("returns warning when no geo columns detected", () => {
        const csv = `name,value
A,1
B,2`;
        const result = csvConverter.convert(csv);
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("No geographic columns"))).toBe(true);
    });

    it("handles TSV (tab separated) via auto-detection", () => {
        const tsv = "name\tlat\tlng\nA\t48.85\t2.35";
        const result = csvConverter.convert(tsv);
        expect(result.data.features).toHaveLength(1);
    });

    it("excludes geo columns from properties", () => {
        const csv = `name,lat,lng,color
P,48,2,red`;
        const result = csvConverter.convert(csv);
        const props = result.data.features[0].properties!;
        expect(props.name).toBe("P");
        expect(props.color).toBe("red");
        expect(props.lat).toBeUndefined();
        expect(props.lng).toBeUndefined();
    });

    it("accepts ArrayBuffer input", () => {
        const csv = "name,lat,lng\nA,48,2";
        const buf = new TextEncoder().encode(csv).buffer;
        const result = csvConverter.convert(buf);
        expect(result.data.features).toHaveLength(1);
    });

    it("returns warning when CSV has no headers", () => {
        const result = csvConverter.convert("\n\n\n");
        expect(result.data.features).toHaveLength(0);
    });
});
