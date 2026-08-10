/**
 * Tests for GeoJSON module (ESM)
 * Style operators, feature validation, coordinate extraction
 */

import { GeoJSONCore as GeoJSON } from "../../src/kernel/geojson/core.js";
import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";
import {
    evaluateStyleCondition,
    getFeatureProperty,
    getGeometryType,
    isPointGeometry,
    isLineGeometry,
    isPolygonGeometry,
    validateFeature,
    validateFeatureCollection,
    extractCoordinates,
    calculateBounds,
} from "../../src/kernel/geojson/geojson-utils.js";

const STYLE_OPERATORS = GeoJSONShared.STYLE_OPERATORS;
const DEFAULT_STYLES = GeoJSONShared.DEFAULT_STYLES;

describe("GeoJSON - Style Operators", () => {
    describe("STYLE_OPERATORS", () => {
        it("should have comparison operators", () => {
            expect(STYLE_OPERATORS[">"](10, 5)).toBe(true);
            expect(STYLE_OPERATORS[">="](10, 10)).toBe(true);
            expect(STYLE_OPERATORS["<"](5, 10)).toBe(true);
            expect(STYLE_OPERATORS["<="](10, 10)).toBe(true);
        });

        it("should have equality operators", () => {
            expect(STYLE_OPERATORS["=="](5, "5")).toBe(true);
            expect(STYLE_OPERATORS["==="](5, 5)).toBe(true);
            expect(STYLE_OPERATORS["eq"](10, "10")).toBe(true);
        });

        it("should have inequality operators", () => {
            expect(STYLE_OPERATORS["!="](5, 10)).toBe(true);
            expect(STYLE_OPERATORS["!=="](5, "5")).toBe(true);
            expect(STYLE_OPERATORS["neq"](5, 10)).toBe(true);
        });

        it("should have string operators", () => {
            expect(STYLE_OPERATORS["contains"]("Hello World", "world")).toBe(true);
            expect(STYLE_OPERATORS["startsWith"]("Hello", "hel")).toBe(true);
            expect(STYLE_OPERATORS["endsWith"]("World", "LD")).toBe(true);
        });

        it("should have array operators", () => {
            expect(STYLE_OPERATORS["in"](5, [1, 5, 10])).toBe(true);
            expect(STYLE_OPERATORS["notIn"](3, [1, 5, 10])).toBe(true);
        });

        it("should have between operator", () => {
            expect(STYLE_OPERATORS["between"](5, [1, 10])).toBe(true);
            expect(STYLE_OPERATORS["between"](15, [1, 10])).toBe(false);
            expect(STYLE_OPERATORS["between"](1, [1, 10])).toBe(true);
            expect(STYLE_OPERATORS["between"](10, [1, 10])).toBe(true);
        });
    });

    describe("evaluateStyleCondition", () => {
        it("should evaluate greater than", () => {
            expect(evaluateStyleCondition(10, ">", 5)).toBe(true);
            expect(evaluateStyleCondition(5, ">", 10)).toBe(false);
        });

        it("should evaluate equality", () => {
            expect(evaluateStyleCondition("red", "==", "red")).toBe(true);
            expect(evaluateStyleCondition(5, "===", 5)).toBe(true);
        });

        it("should evaluate contains", () => {
            expect(evaluateStyleCondition("Restaurant", "contains", "rest")).toBe(true);
            expect(evaluateStyleCondition("Cafe", "contains", "bar")).toBe(false);
        });

        it("should evaluate in array", () => {
            expect(evaluateStyleCondition("A", "in", ["A", "B", "C"])).toBe(true);
            expect(evaluateStyleCondition("D", "in", ["A", "B", "C"])).toBe(false);
        });

        it("should handle unknown operator", () => {
            const result = evaluateStyleCondition(5, "unknown", 10);
            expect(result).toBe(false);
        });

        it("should handle errors gracefully", () => {
            const result = evaluateStyleCondition(null, ">", undefined);
            expect(result).toBe(false);
        });
    });
});

describe("GeoJSON - Feature Properties", () => {
    describe("getFeatureProperty", () => {
        const feature = {
            type: "Feature",
            id: "feature-1",
            properties: {
                name: "Test",
                category: "restaurant",
                rating: {
                    stars: 4.5,
                    count: 100,
                },
            },
            geometry: {
                type: "Point",
                coordinates: [2.3522, 48.8566],
            },
        };

        it("should get root property", () => {
            expect(getFeatureProperty(feature, "type")).toBe("Feature");
            expect(getFeatureProperty(feature, "id")).toBe("feature-1");
        });

        it("should get properties field", () => {
            expect(getFeatureProperty(feature, "properties.name")).toBe("Test");
            expect(getFeatureProperty(feature, "properties.category")).toBe("restaurant");
        });

        it("should get nested property", () => {
            expect(getFeatureProperty(feature, "properties.rating.stars")).toBe(4.5);
            expect(getFeatureProperty(feature, "properties.rating.count")).toBe(100);
        });

        it("should get geometry property", () => {
            expect(getFeatureProperty(feature, "geometry.type")).toBe("Point");
        });

        it("should return null for missing property", () => {
            expect(getFeatureProperty(feature, "missing")).toBeNull();
            expect(getFeatureProperty(feature, "properties.missing")).toBeNull();
        });

        it("should handle null input", () => {
            expect(getFeatureProperty(null, "property")).toBeNull();
            expect(getFeatureProperty(feature, null)).toBeNull();
        });
    });
});

describe("GeoJSON - Geometry Types", () => {
    describe("getGeometryType", () => {
        it("should detect Point", () => {
            const feature = {
                geometry: { type: "Point", coordinates: [0, 0] },
            };
            expect(getGeometryType(feature)).toBe("Point");
        });

        it("should detect LineString", () => {
            const feature = {
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                    ],
                },
            };
            expect(getGeometryType(feature)).toBe("LineString");
        });

        it("should detect Polygon", () => {
            const feature = {
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [0, 0],
                            [1, 0],
                            [1, 1],
                            [0, 1],
                            [0, 0],
                        ],
                    ],
                },
            };
            expect(getGeometryType(feature)).toBe("Polygon");
        });

        it("should return null for missing geometry", () => {
            expect(getGeometryType({})).toBeNull();
            expect(getGeometryType({ geometry: {} })).toBeNull();
        });

        it("should return null for null input", () => {
            expect(getGeometryType(null)).toBeNull();
        });
    });

    describe("isPointGeometry", () => {
        it("should detect Point", () => {
            const feature = {
                geometry: { type: "Point", coordinates: [0, 0] },
            };
            expect(isPointGeometry(feature)).toBe(true);
        });

        it("should detect MultiPoint", () => {
            const feature = {
                geometry: {
                    type: "MultiPoint",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                    ],
                },
            };
            expect(isPointGeometry(feature)).toBe(true);
        });

        it("should reject non-point geometries", () => {
            const line = {
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                    ],
                },
            };
            expect(isPointGeometry(line)).toBe(false);
        });
    });

    describe("isLineGeometry", () => {
        it("should detect LineString", () => {
            const feature = {
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                    ],
                },
            };
            expect(isLineGeometry(feature)).toBe(true);
        });

        it("should detect MultiLineString", () => {
            const feature = {
                geometry: {
                    type: "MultiLineString",
                    coordinates: [
                        [
                            [0, 0],
                            [1, 1],
                        ],
                    ],
                },
            };
            expect(isLineGeometry(feature)).toBe(true);
        });

        it("should reject non-line geometries", () => {
            const point = {
                geometry: { type: "Point", coordinates: [0, 0] },
            };
            expect(isLineGeometry(point)).toBe(false);
        });
    });

    describe("isPolygonGeometry", () => {
        it("should detect Polygon", () => {
            const feature = {
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
            };
            expect(isPolygonGeometry(feature)).toBe(true);
        });

        it("should detect MultiPolygon", () => {
            const feature = {
                geometry: {
                    type: "MultiPolygon",
                    coordinates: [
                        [
                            [
                                [0, 0],
                                [1, 0],
                                [1, 1],
                                [0, 0],
                            ],
                        ],
                    ],
                },
            };
            expect(isPolygonGeometry(feature)).toBe(true);
        });

        it("should reject non-polygon geometries", () => {
            const point = {
                geometry: { type: "Point", coordinates: [0, 0] },
            };
            expect(isPolygonGeometry(point)).toBe(false);
        });
    });
});

describe("GeoJSON - Validation", () => {
    describe("validateFeature", () => {
        it("should validate correct feature", () => {
            const feature = {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [0, 0],
                },
                properties: { name: "Test" },
            };

            const result = validateFeature(feature);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("should reject non-object", () => {
            const result = validateFeature(null);
            expect(result.valid).toBe(false);
            // Assert that a diagnostic was produced, not its wording: matching on message
            // text couples the test to the copy (it broke on the KERNEL S6 translation pass).
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it("should reject wrong type", () => {
            const feature = {
                type: "WrongType",
                geometry: { type: "Point", coordinates: [0, 0] },
            };

            const result = validateFeature(feature);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("Feature") && e.includes("Feature"))).toBe(
                true
            );
        });

        it("should reject missing geometry", () => {
            const feature = {
                type: "Feature",
                properties: {},
            };

            const result = validateFeature(feature);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("geometry"))).toBe(true);
        });

        it("should reject geometry without type", () => {
            const feature = {
                type: "Feature",
                geometry: { coordinates: [0, 0] },
                properties: { name: "Test" },
            };

            const result = validateFeature(feature);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("geometry") && e.includes("type"))).toBe(
                true
            );
        });

        it("should reject geometry without coordinates", () => {
            const feature = {
                type: "Feature",
                geometry: { type: "Point" },
                properties: { name: "Test" },
            };

            const result = validateFeature(feature);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("coordinates"))).toBe(true);
        });
    });

    describe("validateFeatureCollection", () => {
        it("should validate correct FeatureCollection", () => {
            const geojson = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [0, 0] },
                        properties: { name: "Test" },
                    },
                ],
            };

            const result = validateFeatureCollection(geojson);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.featureCount).toBe(1);
        });

        it("should reject non-object", () => {
            const result = validateFeatureCollection(null);
            expect(result.valid).toBe(false);
            // Same reasoning as validateFeature above — assert the diagnostic exists,
            // not its wording.
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it("should reject wrong type", () => {
            const geojson = {
                type: "WrongType",
                features: [],
            };

            const result = validateFeatureCollection(geojson);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("FeatureCollection"))).toBe(true);
        });

        it("should reject missing features array", () => {
            const geojson = {
                type: "FeatureCollection",
            };

            const result = validateFeatureCollection(geojson);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("features array"))).toBe(true);
        });

        it("should validate individual features", () => {
            const geojson = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [0, 0] },
                        properties: { name: "A" },
                    },
                    {
                        type: "WrongType",
                        geometry: { type: "Point", coordinates: [1, 1] },
                    },
                ],
            };

            const result = validateFeatureCollection(geojson);
            expect(result.valid).toBe(false);
            expect(result.featureCount).toBe(2);
            expect(result.errors.length > 0).toBe(true);
        });
    });
});

describe("GeoJSON - Coordinate Extraction", () => {
    describe("extractCoordinates", () => {
        it("should extract Point coordinates", () => {
            const feature = {
                geometry: {
                    type: "Point",
                    coordinates: [2.3522, 48.8566],
                },
            };

            const coords = extractCoordinates(feature);
            expect(coords).toEqual([[48.8566, 2.3522]]);
        });

        it("should extract MultiPoint coordinates", () => {
            const feature = {
                geometry: {
                    type: "MultiPoint",
                    coordinates: [
                        [2.3522, 48.8566],
                        [-73.6, 45.5],
                    ],
                },
            };

            const coords = extractCoordinates(feature);
            expect(coords).toEqual([
                [48.8566, 2.3522],
                [45.5, -73.6],
            ]);
        });

        it("should extract LineString coordinates", () => {
            const feature = {
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                        [2, 2],
                    ],
                },
            };

            const coords = extractCoordinates(feature);
            expect(coords).toEqual([
                [0, 0],
                [1, 1],
                [2, 2],
            ]);
        });

        it("should extract Polygon coordinates (outer ring only)", () => {
            const feature = {
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [0, 0],
                            [1, 0],
                            [1, 1],
                            [0, 1],
                            [0, 0],
                        ],
                        [
                            [0.2, 0.2],
                            [0.8, 0.2],
                            [0.8, 0.8],
                            [0.2, 0.8],
                            [0.2, 0.2],
                        ],
                    ],
                },
            };

            const coords = extractCoordinates(feature);
            expect(coords).toHaveLength(5);
            expect(coords[0]).toEqual([0, 0]);
        });

        it("should return null for missing geometry", () => {
            expect(extractCoordinates({})).toBeNull();
            expect(extractCoordinates({ geometry: {} })).toBeNull();
        });

        it("should return null for null input", () => {
            expect(extractCoordinates(null)).toBeNull();
        });
    });

    describe("calculateBounds", () => {
        it("should calculate bounds from features", () => {
            const features = [
                {
                    geometry: { type: "Point", coordinates: [2.0, 48.0] },
                },
                {
                    geometry: { type: "Point", coordinates: [3.0, 49.0] },
                },
            ];

            const bounds = calculateBounds(features);
            expect(bounds).toEqual([
                [48.0, 2.0],
                [49.0, 3.0],
            ]);
        });

        it("should handle single feature", () => {
            const features = [
                {
                    geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
                },
            ];

            const bounds = calculateBounds(features);
            expect(bounds).toEqual([
                [48.8566, 2.3522],
                [48.8566, 2.3522],
            ]);
        });

        it("should handle mixed geometry types", () => {
            const features = [
                {
                    geometry: { type: "Point", coordinates: [0, 0] },
                },
                {
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [1, 1],
                            [2, 2],
                        ],
                    },
                },
            ];

            const bounds = calculateBounds(features);
            expect(bounds).toEqual([
                [0, 0],
                [2, 2],
            ]);
        });

        it("should return null for empty array", () => {
            expect(calculateBounds([])).toBeNull();
        });

        it("should return null for invalid input", () => {
            expect(calculateBounds(null)).toBeNull();
            expect(calculateBounds("invalid")).toBeNull();
        });

        it("should handle features without coordinates", () => {
            const features = [{ geometry: { type: "Point", coordinates: [] } }, { geometry: {} }];

            const bounds = calculateBounds(features);
            expect(bounds).toBeNull();
        });
    });
});

describe("GeoJSON - Default Styles", () => {
    it("should have polygon styles", () => {
        expect(DEFAULT_STYLES.polygon).toBeDefined();
        expect(DEFAULT_STYLES.polygon.color).toBeDefined();
        expect(DEFAULT_STYLES.polygon.fillColor).toBeDefined();
    });

    it("should have line styles", () => {
        expect(DEFAULT_STYLES.line).toBeDefined();
        expect(DEFAULT_STYLES.line.color).toBeDefined();
        expect(DEFAULT_STYLES.line.weight).toBeDefined();
    });

    it("should have point styles", () => {
        expect(DEFAULT_STYLES.point).toBeDefined();
        expect(DEFAULT_STYLES.point.radius).toBeDefined();
        expect(DEFAULT_STYLES.point.fillColor).toBeDefined();
    });
});

describe("GeoJSON - Namespace Export", () => {
    it("should export all functions in GeoJSON namespace", () => {
        expect(GeoJSON.STYLE_OPERATORS).toBe(STYLE_OPERATORS);
        expect(GeoJSON.evaluateStyleCondition).toBe(evaluateStyleCondition);
        expect(GeoJSON.getFeatureProperty).toBe(getFeatureProperty);
        expect(GeoJSON.getGeometryType).toBe(getGeometryType);
        expect(GeoJSON.isPointGeometry).toBe(isPointGeometry);
        expect(GeoJSON.isLineGeometry).toBe(isLineGeometry);
        expect(GeoJSON.isPolygonGeometry).toBe(isPolygonGeometry);
        expect(GeoJSON.validateFeature).toBe(validateFeature);
        expect(GeoJSON.validateFeatureCollection).toBe(validateFeatureCollection);
        expect(GeoJSON.extractCoordinates).toBe(extractCoordinates);
        expect(GeoJSON.calculateBounds).toBe(calculateBounds);
        expect(GeoJSON.DEFAULT_STYLES).toBe(DEFAULT_STYLES);
    });
});
