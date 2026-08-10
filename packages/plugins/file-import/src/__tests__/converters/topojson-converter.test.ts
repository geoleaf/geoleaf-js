import { describe, it, expect } from "vitest";
import { topojsonConverter } from "../../converters/topojson-converter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function simpleTopo(objectName: string, arcs: number[][][], geometries: unknown[]): string {
    return JSON.stringify({
        type: "Topology",
        arcs,
        objects: {
            [objectName]: {
                type: "GeometryCollection",
                geometries,
            },
        },
    });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("topojson-converter", () => {
    it("formatName is TopoJSON", () => {
        expect(topojsonConverter.formatName).toBe("TopoJSON");
    });

    it("returns empty FC + warning for empty string", () => {
        const result = topojsonConverter.convert("");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings).toContain("Empty TopoJSON input");
    });

    it("returns warning for invalid JSON", () => {
        const result = topojsonConverter.convert("{bad json");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("TopoJSON parsing error"))).toBe(true);
    });

    it("returns warning when no objects property", () => {
        const result = topojsonConverter.convert(JSON.stringify({ type: "Topology", arcs: [] }));
        expect(result.warnings?.some((w) => w.includes("no 'objects'"))).toBe(true);
    });

    it("returns warning for empty objects", () => {
        const result = topojsonConverter.convert(
            JSON.stringify({ type: "Topology", arcs: [], objects: {} })
        );
        expect(result.warnings?.some((w) => w.includes("no objects to convert"))).toBe(true);
    });

    it("converts a single object with Point geometry", () => {
        const topo = simpleTopo(
            "places",
            [],
            [{ type: "Point", coordinates: [2, 48], properties: { name: "Paris" } }]
        );
        const result = topojsonConverter.convert(topo);
        expect(result.data.features).toHaveLength(1);
        const f = result.data.features[0];
        expect(f.geometry.type).toBe("Point");
        expect(f.properties?._topoObjectName).toBe("places");
    });

    it("converts multiple objects into merged FeatureCollection", () => {
        const input = JSON.stringify({
            type: "Topology",
            arcs: [],
            objects: {
                cities: {
                    type: "GeometryCollection",
                    geometries: [
                        { type: "Point", coordinates: [2, 48], properties: { name: "A" } },
                    ],
                },
                regions: {
                    type: "GeometryCollection",
                    geometries: [
                        { type: "Point", coordinates: [3, 49], properties: { name: "B" } },
                    ],
                },
            },
        });
        const result = topojsonConverter.convert(input);
        expect(result.data.features).toHaveLength(2);
        const names = result.data.features.map((f) => f.properties?._topoObjectName);
        expect(names).toContain("cities");
        expect(names).toContain("regions");
    });

    it("handles topology with arcs (LineString)", () => {
        const topo = JSON.stringify({
            type: "Topology",
            arcs: [
                [
                    [0, 0],
                    [1, 1],
                    [2, 2],
                ],
            ],
            objects: {
                lines: {
                    type: "GeometryCollection",
                    geometries: [{ type: "LineString", arcs: [0] }],
                },
            },
        });
        const result = topojsonConverter.convert(topo);
        expect(result.data.features).toHaveLength(1);
        expect(result.data.features[0].geometry.type).toBe("LineString");
    });

    it("accepts ArrayBuffer input", () => {
        const topo = simpleTopo("pts", [], [{ type: "Point", coordinates: [2, 48] }]);
        const buf = new TextEncoder().encode(topo).buffer;
        const result = topojsonConverter.convert(buf);
        expect(result.data.features).toHaveLength(1);
    });
});
