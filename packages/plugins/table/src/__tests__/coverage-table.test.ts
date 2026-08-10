/**
 * Campagne de tests unitaires — modules table (sort, export)
 *
 * Ported from the core suite (`__tests__/coverage-modules-table.test.js`).
 * Adaptation: import paths point at the plugin's flat `src/` layout; the export
 * helpers are pure (no GeoJSON / visibility seam), so only paths changed.
 */

import { describe, it, expect, vi } from "vitest";

import { sortInPlace, nextSortState } from "../sort.js";
import {
    resolveFeatureId,
    buildGeoJSONCollection,
    buildCSV,
    buildKML,
    buildGPX,
    downloadFile,
} from "../export.js";
import { getNestedValue } from "@geoleaf/host-runtime";

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Coverage — table/sort", () => {
    describe("sortInPlace", () => {
        it("does nothing when sortState has no field", () => {
            const data = [{ a: 2 }, { a: 1 }];
            sortInPlace(data, { field: null, direction: null }, getNestedValue);
            expect(data[0].a).toBe(2);
        });
        it("sorts ascending by field", () => {
            const data = [{ properties: { name: "b" } }, { properties: { name: "a" } }];
            sortInPlace(data, { field: "properties.name", direction: "asc" }, getNestedValue);
            expect(getNestedValue(data[0], "properties.name")).toBe("a");
        });
        it("sorts descending by field", () => {
            const data = [{ properties: { name: "a" } }, { properties: { name: "b" } }];
            sortInPlace(data, { field: "properties.name", direction: "desc" }, getNestedValue);
            expect(getNestedValue(data[0], "properties.name")).toBe("b");
        });
    });

    describe("nextSortState", () => {
        it("cycles from null to asc to desc to null", () => {
            const s0 = { field: null, direction: null };
            expect(nextSortState(s0, "name")).toEqual({ field: "name", direction: "asc" });
            expect(nextSortState({ field: "name", direction: "asc" }, "name")).toEqual({
                field: "name",
                direction: "desc",
            });
            expect(nextSortState({ field: "name", direction: "desc" }, "name")).toEqual({
                field: null,
                direction: null,
            });
        });
        it("new column starts asc", () => {
            expect(nextSortState({ field: "a", direction: "asc" }, "b")).toEqual({
                field: "b",
                direction: "asc",
            });
        });
    });
});

describe("Coverage — table/export", () => {
    describe("resolveFeatureId", () => {
        it("uses feature.id when present", () => {
            expect(resolveFeatureId({ id: "foo" }, 0)).toBe("foo");
        });
        it("uses properties.id when feature.id missing", () => {
            expect(resolveFeatureId({ properties: { id: "bar" } }, 0)).toBe("bar");
        });
        it("falls back to synthetic index", () => {
            expect(resolveFeatureId({ properties: {} }, 5)).toBe("__gl_row_5");
            expect(resolveFeatureId({}, 3)).toBe("__gl_row_3");
        });
    });

    describe("buildGeoJSONCollection", () => {
        it("builds FeatureCollection from features", () => {
            const features = [
                { properties: { a: 1 }, geometry: { type: "Point", coordinates: [0, 0] } },
            ];
            const out = buildGeoJSONCollection(features);
            expect(out.type).toBe("FeatureCollection");
            expect(out.features).toHaveLength(1);
            expect(out.features[0].type).toBe("Feature");
            expect(out.features[0].properties).toEqual({ a: 1 });
        });
    });

    describe("buildCSV", () => {
        const features = [
            { id: "1", properties: { name: "Alice", age: 30 }, geometry: null },
            { id: "2", properties: { name: "Bob", age: null }, geometry: null },
        ];

        it("starts with UTF-8 BOM", () => {
            const csv = buildCSV(features);
            expect(csv.codePointAt(0)).toBe(0xfeff);
        });

        it("first line is the header", () => {
            const lines = buildCSV(features).slice(1).split("\r\n");
            expect(lines[0]).toBe("name,age");
        });

        it("serialises rows correctly", () => {
            const lines = buildCSV(features).slice(1).split("\r\n");
            expect(lines[1]).toBe("Alice,30");
            expect(lines[2]).toBe("Bob,");
        });

        it("escapes values containing the separator", () => {
            const f = [{ properties: { v: "a,b" }, geometry: null }];
            const lines = buildCSV(f).slice(1).split("\r\n");
            expect(lines[1]).toBe('"a,b"');
        });

        it("escapes double-quotes", () => {
            const f = [{ properties: { v: 'say "hi"' }, geometry: null }];
            const lines = buildCSV(f).slice(1).split("\r\n");
            expect(lines[1]).toBe('"say ""hi"""');
        });

        it("uses custom separator", () => {
            const lines = buildCSV(features, { csvSeparator: ";" }).slice(1).split("\r\n");
            expect(lines[0]).toBe("name;age");
            expect(lines[1]).toBe("Alice;30");
        });

        it("includes __geometry column when csvIncludeGeometry is true", () => {
            const f = [
                {
                    properties: { x: 1 },
                    geometry: { type: "Point", coordinates: [1, 2] },
                },
            ];
            const lines = buildCSV(f, { csvIncludeGeometry: true }).slice(1).split("\r\n");
            expect(lines[0]).toBe("x,__geometry");
            expect(lines[1]).toContain("Point");
        });

        it("JSON-stringifies object properties", () => {
            const f = [{ properties: { meta: { nested: true } }, geometry: null }];
            const lines = buildCSV(f).slice(1).split("\r\n");
            expect(lines[1]).toContain("nested");
        });

        it("handles empty features array", () => {
            expect(buildCSV([])).toBe("﻿");
        });
    });

    describe("buildKML", () => {
        it("wraps output in <kml> and <Document>", () => {
            const kml = buildKML([], "test-layer");
            expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
            expect(kml).toContain("<Document>");
            expect(kml).toContain("<name>test-layer</name>");
        });

        it("creates a <Placemark> per feature", () => {
            const features = [
                {
                    id: "a",
                    properties: { label: "A" },
                    geometry: { type: "Point", coordinates: [2, 48] },
                },
                {
                    id: "b",
                    properties: { label: "B" },
                    geometry: { type: "Point", coordinates: [3, 49] },
                },
            ];
            const kml = buildKML(features);
            expect((kml.match(/<Placemark>/g) ?? []).length).toBe(2);
        });

        it("serialises Point geometry", () => {
            const features = [
                {
                    id: "p",
                    properties: {},
                    geometry: { type: "Point", coordinates: [2.35, 48.85] },
                },
            ];
            const kml = buildKML(features);
            expect(kml).toContain("<Point>");
            expect(kml).toContain("2.35,48.85");
        });

        it("serialises LineString geometry", () => {
            const features = [
                {
                    id: "l",
                    properties: {},
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [0, 0],
                            [1, 1],
                        ],
                    },
                },
            ];
            const kml = buildKML(features);
            expect(kml).toContain("<LineString>");
        });

        it("serialises Polygon geometry", () => {
            const features = [
                {
                    id: "poly",
                    properties: {},
                    geometry: {
                        type: "Polygon",
                        coordinates: [
                            [
                                [0, 0],
                                [1, 0],
                                [1, 1],
                                [0, 0],
                            ],
                        ],
                    },
                },
            ];
            const kml = buildKML(features);
            expect(kml).toContain("<Polygon>");
            expect(kml).toContain("<outerBoundaryIs>");
        });

        it("escapes XML characters in feature name", () => {
            const features = [{ id: "a&b", properties: {}, geometry: null }];
            const kml = buildKML(features);
            expect(kml).toContain("<name>a&amp;b</name>");
        });

        it("puts property values verbatim inside CDATA (no XML escape)", () => {
            const features = [{ id: "x", properties: { desc: "<b>&</b>" }, geometry: null }];
            const kml = buildKML(features);
            expect(kml).toContain("<![CDATA[desc: <b>&</b>]]>");
        });

        it("wraps description in CDATA", () => {
            const features = [{ id: "x", properties: { note: "hello" }, geometry: null }];
            const kml = buildKML(features);
            expect(kml).toContain("<![CDATA[");
        });
    });

    describe("buildGPX", () => {
        it("wraps output in <gpx>", () => {
            const gpx = buildGPX([], "my-layer");
            expect(gpx).toContain('<gpx version="1.1"');
            expect(gpx).toContain("<name>my-layer</name>");
        });

        it("serialises Point as <wpt>", () => {
            const features = [
                {
                    id: "w",
                    properties: {},
                    geometry: { type: "Point", coordinates: [2.35, 48.85] },
                },
            ];
            const gpx = buildGPX(features);
            expect(gpx).toContain('<wpt lat="48.85" lon="2.35">');
        });

        it("serialises LineString as <trk>", () => {
            const features = [
                {
                    id: "t",
                    properties: {},
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [0, 0],
                            [1, 1],
                        ],
                    },
                },
            ];
            const gpx = buildGPX(features);
            expect(gpx).toContain("<trk>");
            expect(gpx).toContain("<trkseg>");
            expect(gpx).toContain('<trkpt lat="0" lon="0">');
        });

        it("serialises MultiLineString as <trk> with multiple <trkseg>", () => {
            const features = [
                {
                    id: "ml",
                    properties: {},
                    geometry: {
                        type: "MultiLineString",
                        coordinates: [
                            [
                                [0, 0],
                                [1, 1],
                            ],
                            [
                                [2, 2],
                                [3, 3],
                            ],
                        ],
                    },
                },
            ];
            const gpx = buildGPX(features);
            expect((gpx.match(/<trkseg>/g) ?? []).length).toBe(2);
        });

        it("serialises Polygon as <rte>", () => {
            const features = [
                {
                    id: "r",
                    properties: {},
                    geometry: {
                        type: "Polygon",
                        coordinates: [
                            [
                                [0, 0],
                                [1, 0],
                                [1, 1],
                                [0, 0],
                            ],
                        ],
                    },
                },
            ];
            const gpx = buildGPX(features);
            expect(gpx).toContain("<rte>");
            expect(gpx).toContain("<rtept");
        });

        it("includes elevation when coordinate has Z", () => {
            const features = [
                {
                    id: "e",
                    properties: {},
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [0, 0, 100],
                            [1, 1, 200],
                        ],
                    },
                },
            ];
            const gpx = buildGPX(features);
            expect(gpx).toContain("<ele>100</ele>");
        });

        it("handles empty features array", () => {
            const gpx = buildGPX([]);
            expect(gpx).toContain("<gpx");
            expect(gpx).not.toContain("<wpt");
        });
    });

    describe("downloadFile", () => {
        it("creates and clicks an anchor element", () => {
            const appendSpy = vi
                .spyOn(document.body, "appendChild")
                .mockImplementation(() => document.body);
            const removeSpy = vi
                .spyOn(document.body, "removeChild")
                .mockImplementation(() => document.body);
            const clickSpy = vi.fn();
            vi.spyOn(document, "createElement").mockImplementationOnce(() => {
                const a = document.createElement("a");
                a.click = clickSpy;
                return a;
            });
            globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
            globalThis.URL.revokeObjectURL = vi.fn();

            downloadFile("hello", "test.txt", "text/plain");

            expect(clickSpy).toHaveBeenCalled();
            expect(URL.revokeObjectURL).toHaveBeenCalled();
            appendSpy.mockRestore();
            removeSpy.mockRestore();
        });
    });
});
