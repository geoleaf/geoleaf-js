/**
 * Tests pour DataConverter — Phase 1 step 1.1 (coverage 29% → 60%)
 */
const mockLog = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

import { DataConverter } from "../../src/kernel/geojson/loader/data-converter.js";

describe("config/data-converter", () => {
    beforeEach(() => {
        mockLog.warn.mockClear();
        mockLog.error.mockClear();
        mockLog.debug.mockClear();
    });

    describe("convertPoiArrayToGeoJSON", () => {
        test("returns empty FeatureCollection for non-array", () => {
            const out = DataConverter.convertPoiArrayToGeoJSON(null);
            expect(out).toEqual({ type: "FeatureCollection", features: [] });
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("converts POIs with latlng", () => {
            const out = DataConverter.convertPoiArrayToGeoJSON([
                { id: "1", latlng: [2.35, 48.85], title: "A" },
            ]);
            expect(out.type).toBe("FeatureCollection");
            expect(out.features).toHaveLength(1);
            expect(out.features[0].geometry.coordinates).toEqual([48.85, 2.35]);
            expect(out.features[0].properties.title).toBe("A");
        });

        test("converts POIs with location", () => {
            const out = DataConverter.convertPoiArrayToGeoJSON([
                { id: "2", location: { lat: 48.85, lng: 2.35 } },
            ]);
            expect(out.features).toHaveLength(1);
            expect(out.features[0].geometry.coordinates).toEqual([2.35, 48.85]);
        });

        test("uses default title and description when missing", () => {
            const out = DataConverter.convertPoiArrayToGeoJSON([{ id: "3", latlng: [0, 0] }]);
            expect(out.features[0].properties.title).toBe("Sans titre");
            expect(out.features[0].properties.description).toBe("");
        });

        test("merges attributes into properties", () => {
            const out = DataConverter.convertPoiArrayToGeoJSON([
                { id: "4", latlng: [1, 1], attributes: { foo: "bar", count: 42 } },
            ]);
            expect(out.features[0].properties.foo).toBe("bar");
            expect(out.features[0].properties.count).toBe(42);
        });

        test("skips non-object elements", () => {
            const out = DataConverter.convertPoiArrayToGeoJSON([
                { id: "a", latlng: [2, 48] },
                null,
                "string",
                { id: "b", location: { lat: 1, lng: 1 } },
            ]);
            expect(out.features).toHaveLength(2);
        });

        test("skips POI without id and warns", () => {
            const out = DataConverter.convertPoiArrayToGeoJSON([{ latlng: [2, 48] }]);
            expect(out.features).toHaveLength(0);
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("skips POI without valid coordinates", () => {
            const out = DataConverter.convertPoiArrayToGeoJSON([{ id: "x" }]);
            expect(out.features).toHaveLength(0);
        });
    });

    describe("convertRouteArrayToGeoJSON", () => {
        test("returns empty FeatureCollection for non-array", () => {
            const out = DataConverter.convertRouteArrayToGeoJSON({});
            expect(out).toEqual({ type: "FeatureCollection", features: [] });
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("converts route with LineString geometry", () => {
            const out = DataConverter.convertRouteArrayToGeoJSON([
                {
                    id: "r1",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [2, 48],
                            [2.1, 48.1],
                        ],
                    },
                    title: "Route",
                },
            ]);
            expect(out.features).toHaveLength(1);
            expect(out.features[0].geometry.type).toBe("LineString");
            expect(out.features[0].properties.id).toBe("r1");
        });

        test("uses default title and description, keeps categoryId and attributes", () => {
            const out = DataConverter.convertRouteArrayToGeoJSON([
                {
                    id: "r2",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [0, 0],
                            [1, 1],
                        ],
                    },
                    categoryId: "cat1",
                    subCategoryId: "sub1",
                    attributes: { difficulty: "easy" },
                },
            ]);
            expect(out.features[0].properties.title).toBe("Sans titre");
            expect(out.features[0].properties.description).toBe("");
            expect(out.features[0].properties.categoryId).toBe("cat1");
            expect(out.features[0].properties.subCategoryId).toBe("sub1");
            expect(out.features[0].properties.difficulty).toBe("easy");
        });

        test("skips route without id", () => {
            const out = DataConverter.convertRouteArrayToGeoJSON([
                { geometry: { type: "LineString", coordinates: [] } },
            ]);
            expect(out.features).toHaveLength(0);
        });

        test("skips route without valid LineString geometry", () => {
            const out = DataConverter.convertRouteArrayToGeoJSON([
                { id: "r3" },
                { id: "r4", geometry: { type: "Point", coordinates: [0, 0] } },
                { id: "r5", geometry: { type: "LineString" } },
            ]);
            expect(out.features).toHaveLength(0);
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    describe("convertZoneArrayToGeoJSON", () => {
        test("returns empty FeatureCollection for non-array", () => {
            const out = DataConverter.convertZoneArrayToGeoJSON(null);
            expect(out).toEqual({ type: "FeatureCollection", features: [] });
        });

        test("converts zone with Polygon geometry", () => {
            const coords = [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                ],
            ];
            const out = DataConverter.convertZoneArrayToGeoJSON([
                { id: "z1", geometry: { type: "Polygon", coordinates: coords } },
            ]);
            expect(out.features).toHaveLength(1);
            expect(out.features[0].geometry.type).toBe("Polygon");
        });

        test("uses siteName as title when provided", () => {
            const coords = [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                ],
            ];
            const out = DataConverter.convertZoneArrayToGeoJSON([
                {
                    id: "z2",
                    geometry: { type: "Polygon", coordinates: coords },
                    siteName: "Mon site",
                },
            ]);
            expect(out.features[0].properties.title).toBe("Mon site");
        });

        test("skips zone without valid Polygon geometry", () => {
            const out = DataConverter.convertZoneArrayToGeoJSON([
                { id: "z3" },
                { id: "z4", geometry: { type: "LineString", coordinates: [] } },
            ]);
            expect(out.features).toHaveLength(0);
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    describe("autoConvert", () => {
        test("returns empty FeatureCollection for null or undefined", () => {
            expect(DataConverter.autoConvert(null)).toEqual({
                type: "FeatureCollection",
                features: [],
            });
            expect(DataConverter.autoConvert(undefined)).toEqual({
                type: "FeatureCollection",
                features: [],
            });
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("returns same data for existing FeatureCollection", () => {
            const fc = { type: "FeatureCollection", features: [] };
            const out = DataConverter.autoConvert(fc);
            expect(out).toBe(fc);
            expect(mockLog.debug).toHaveBeenCalled();
        });

        test("wraps single Feature in FeatureCollection", () => {
            const feature = {
                type: "Feature",
                geometry: { type: "Point", coordinates: [2, 48] },
                properties: {},
            };
            const out = DataConverter.autoConvert(feature);
            expect(out.type).toBe("FeatureCollection");
            expect(out.features).toHaveLength(1);
            expect(out.features[0]).toBe(feature);
        });

        test("returns empty for non-array or empty array", () => {
            expect(DataConverter.autoConvert({})).toEqual({
                type: "FeatureCollection",
                features: [],
            });
            expect(DataConverter.autoConvert([])).toEqual({
                type: "FeatureCollection",
                features: [],
            });
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("returns empty for array with invalid first element", () => {
            const out = DataConverter.autoConvert([null, { id: "1", latlng: [2, 48] }]);
            expect(out).toEqual({ type: "FeatureCollection", features: [] });
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("detects POI array and converts", () => {
            const out = DataConverter.autoConvert([{ id: "p1", latlng: [2, 48], title: "P" }]);
            expect(out.type).toBe("FeatureCollection");
            expect(out.features).toHaveLength(1);
            expect(out.features[0].properties.title).toBe("P");
        });

        test("detects route array and converts", () => {
            const out = DataConverter.autoConvert([
                {
                    id: "r1",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [0, 0],
                            [1, 1],
                        ],
                    },
                },
            ]);
            expect(out.type).toBe("FeatureCollection");
            expect(out.features).toHaveLength(1);
            expect(out.features[0].geometry.type).toBe("LineString");
        });

        test("detects zone array and converts", () => {
            const coords = [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                ],
            ];
            const out = DataConverter.autoConvert([
                { id: "z1", geometry: { type: "Polygon", coordinates: coords } },
            ]);
            expect(out.type).toBe("FeatureCollection");
            expect(out.features).toHaveLength(1);
            expect(out.features[0].geometry.type).toBe("Polygon");
        });

        test("returns empty for unrecognized array type", () => {
            const out = DataConverter.autoConvert([{ foo: "bar" }]);
            expect(out).toEqual({ type: "FeatureCollection", features: [] });
            expect(mockLog.warn).toHaveBeenCalledWith(
                "[DataConverter.autoConvert] Unrecognized data type"
            );
        });
    });
});
