/**
 * Tests pour geojson/style-resolver — Phase C S5B.11 (29% → 70%)
 */

const { mockGeoJSONShared } = vi.hoisted(() => ({
    mockGeoJSONShared: { STYLE_OPERATORS: null },
}));

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: mockGeoJSONShared,
}));

vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ warn: vi.fn() }),
}));

import { GeoJSONStyleResolver } from "../../src/kernel/geojson/style-resolver.ts";

describe("geojson/style-resolver", () => {
    describe("getNestedValue", () => {
        it("returns null for null obj or empty path", () => {
            expect(GeoJSONStyleResolver.getNestedValue(null, "a")).toBeNull();
            expect(GeoJSONStyleResolver.getNestedValue({ a: 1 }, "")).toBeNull();
        });

        it("returns value for single key", () => {
            expect(GeoJSONStyleResolver.getNestedValue({ a: 42 }, "a")).toBe(42);
        });

        it("returns nested value for dot path", () => {
            expect(GeoJSONStyleResolver.getNestedValue({ a: { b: { c: 3 } } }, "a.b.c")).toBe(3);
        });

        it("returns null for missing path", () => {
            expect(GeoJSONStyleResolver.getNestedValue({ a: 1 }, "a.b.c")).toBeNull();
        });
    });

    describe("evaluateCondition", () => {
        const STYLE_OPERATORS = {
            eq: (a, b) => a === b,
            neq: (a, b) => a !== b,
        };
        const mockLog = { warn: vi.fn() };

        it("returns false when field or operator missing", () => {
            const feature = { properties: { x: 1 } };
            expect(
                GeoJSONStyleResolver.evaluateCondition(
                    feature,
                    { value: 1 },
                    STYLE_OPERATORS,
                    mockLog
                )
            ).toBe(false);
            expect(
                GeoJSONStyleResolver.evaluateCondition(
                    feature,
                    { field: "x" },
                    STYLE_OPERATORS,
                    mockLog
                )
            ).toBe(false);
        });

        it("returns true when eq matches", () => {
            const feature = { properties: { x: 1 } };
            expect(
                GeoJSONStyleResolver.evaluateCondition(
                    feature,
                    { field: "x", operator: "eq", value: 1 },
                    STYLE_OPERATORS,
                    mockLog
                )
            ).toBe(true);
        });

        it("returns false when eq does not match", () => {
            const feature = { properties: { x: 1 } };
            expect(
                GeoJSONStyleResolver.evaluateCondition(
                    feature,
                    { field: "x", operator: "eq", value: 2 },
                    STYLE_OPERATORS,
                    mockLog
                )
            ).toBe(false);
        });

        it("returns false when field value is null/undefined", () => {
            const feature = { properties: { x: null } };
            expect(
                GeoJSONStyleResolver.evaluateCondition(
                    feature,
                    { field: "x", operator: "eq", value: 1 },
                    STYLE_OPERATORS,
                    mockLog
                )
            ).toBe(false);
            expect(
                GeoJSONStyleResolver.evaluateCondition(
                    feature,
                    { field: "missing", operator: "eq", value: 1 },
                    STYLE_OPERATORS,
                    mockLog
                )
            ).toBe(false);
        });

        it("warns and returns false for unknown operator", () => {
            const feature = { properties: { x: 1 } };
            expect(
                GeoJSONStyleResolver.evaluateCondition(
                    feature,
                    { field: "x", operator: "unknownOp", value: 1 },
                    STYLE_OPERATORS,
                    mockLog
                )
            ).toBe(false);
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Unknown styleRules operator"),
                "unknownOp"
            );
        });

        it("warns and returns false when operator throws (Phase 8 coverage)", () => {
            const feature = { properties: { x: 1 } };
            const throwingOps = {
                eq: () => {
                    throw new Error("compare error");
                },
            };
            expect(
                GeoJSONStyleResolver.evaluateCondition(
                    feature,
                    { field: "x", operator: "eq", value: 1 },
                    throwingOps,
                    mockLog
                )
            ).toBe(false);
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Condition evaluation error"),
                "compare error"
            );
        });
    });

    describe("evaluateStyleRules", () => {
        it("returns null for empty or non-array styleRules", () => {
            expect(GeoJSONStyleResolver.evaluateStyleRules({ properties: {} }, null)).toBeNull();
            expect(GeoJSONStyleResolver.evaluateStyleRules({ properties: {} }, [])).toBeNull();
        });

        it("returns matched style when rule when matches", () => {
            const feature = { properties: { type: "a" } };
            const rules = [
                { when: { field: "type", operator: "eq", value: "a" }, style: { color: "#f00" } },
            ];
            const result = GeoJSONStyleResolver.evaluateStyleRules(feature, rules);
            expect(result).toEqual({ color: "#f00" });
        });

        it("returns style when when.all conditions are all met", () => {
            const feature = { properties: { a: 1, b: 2 } };
            const rules = [
                {
                    when: {
                        all: [
                            { field: "a", operator: "eq", value: 1 },
                            { field: "b", operator: "eq", value: 2 },
                        ],
                    },
                    style: { color: "#0f0" },
                },
            ];
            const result = GeoJSONStyleResolver.evaluateStyleRules(feature, rules);
            expect(result).toEqual({ color: "#0f0" });
        });

        it("skips rule when when.all not all met", () => {
            const feature = { properties: { a: 1, b: 99 } };
            const rules = [
                {
                    when: {
                        all: [
                            { field: "a", operator: "eq", value: 1 },
                            { field: "b", operator: "eq", value: 2 },
                        ],
                    },
                    style: { color: "#0f0" },
                },
            ];
            const result = GeoJSONStyleResolver.evaluateStyleRules(feature, rules);
            expect(result).toBeNull();
        });

        it("uses comparison operators >, >=, <, <= (Phase 8 — DEFAULT_STYLE_OPERATORS)", () => {
            const feature = { properties: { n: 10 } };
            const rulesGt = [
                { when: { field: "n", operator: ">", value: 5 }, style: { color: "#f00" } },
            ];
            const rulesGte = [
                { when: { field: "n", operator: ">=", value: 10 }, style: { color: "#0f0" } },
            ];
            const rulesLt = [
                { when: { field: "n", operator: "<", value: 20 }, style: { color: "#00f" } },
            ];
            const rulesLte = [
                { when: { field: "n", operator: "<=", value: 10 }, style: { color: "#ff0" } },
            ];
            expect(GeoJSONStyleResolver.evaluateStyleRules(feature, rulesGt)).toEqual({
                color: "#f00",
            });
            expect(GeoJSONStyleResolver.evaluateStyleRules(feature, rulesGte)).toEqual({
                color: "#0f0",
            });
            expect(GeoJSONStyleResolver.evaluateStyleRules(feature, rulesLt)).toEqual({
                color: "#00f",
            });
            expect(GeoJSONStyleResolver.evaluateStyleRules(feature, rulesLte)).toEqual({
                color: "#ff0",
            });
        });

        it("uses string operators contains, startsWith, endsWith (Phase 8)", () => {
            const feature = { properties: { name: "Hello World" } };
            expect(
                GeoJSONStyleResolver.evaluateStyleRules(feature, [
                    {
                        when: { field: "name", operator: "contains", value: "World" },
                        style: { color: "#a" },
                    },
                ])
            ).toEqual({ color: "#a" });
            expect(
                GeoJSONStyleResolver.evaluateStyleRules(feature, [
                    {
                        when: { field: "name", operator: "startsWith", value: "Hello" },
                        style: { color: "#b" },
                    },
                ])
            ).toEqual({ color: "#b" });
            expect(
                GeoJSONStyleResolver.evaluateStyleRules(feature, [
                    {
                        when: { field: "name", operator: "endsWith", value: "World" },
                        style: { color: "#c" },
                    },
                ])
            ).toEqual({ color: "#c" });
        });

        it("uses array operators in, notIn and between (Phase 8)", () => {
            const featureIn = { properties: { cat: "a" } };
            const featureBetween = { properties: { score: 5 } };
            expect(
                GeoJSONStyleResolver.evaluateStyleRules(featureIn, [
                    {
                        when: { field: "cat", operator: "in", value: ["a", "b"] },
                        style: { color: "#1" },
                    },
                ])
            ).toEqual({ color: "#1" });
            expect(
                GeoJSONStyleResolver.evaluateStyleRules(featureIn, [
                    {
                        when: { field: "cat", operator: "notIn", value: ["x"] },
                        style: { color: "#2" },
                    },
                ])
            ).toEqual({ color: "#2" });
            expect(
                GeoJSONStyleResolver.evaluateStyleRules(featureBetween, [
                    {
                        when: { field: "score", operator: "between", value: [1, 10] },
                        style: { color: "#3" },
                    },
                ])
            ).toEqual({ color: "#3" });
        });
    });

    describe("evaluateStyleRules — GeoJSONShared.STYLE_OPERATORS branch", () => {
        afterEach(() => {
            mockGeoJSONShared.STYLE_OPERATORS = null;
        });

        it("uses GeoJSONShared.STYLE_OPERATORS when available", () => {
            const customEq = vi.fn((a, b) => a === b);
            mockGeoJSONShared.STYLE_OPERATORS = { eq: customEq };
            const feature = { properties: { val: "x" } };
            const rules = [
                { when: { field: "val", operator: "eq", value: "x" }, style: { color: "#123" } },
            ];
            const result = GeoJSONStyleResolver.evaluateStyleRules(feature, rules);
            expect(customEq).toHaveBeenCalled();
            expect(result).toEqual({ color: "#123" });
        });

        it("when.all empty array always matches (every on empty returns true)", () => {
            const feature = { properties: {} };
            const rules = [{ when: { all: [] }, style: { color: "#empty" } }];
            const result = GeoJSONStyleResolver.evaluateStyleRules(feature, rules);
            expect(result).toEqual({ color: "#empty" });
        });
    });
});
