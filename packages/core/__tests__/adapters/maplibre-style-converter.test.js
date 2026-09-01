/**
 * Unit tests for maplibre-style-converter — pure functions, no mocks needed.
 *
 * Covers: normalizeToFlat, parseDashArray, toFillPaint, toLinePaint,
 * toCirclePaint, toCasingPaint, conditionToExpression, styleRulesToPaint,
 * toClusterCirclePaint.
 */

import {
    normalizeToFlat,
    parseDashArray,
    toFillPaint,
    toLinePaint,
    toCirclePaint,
    toCasingPaint,
    conditionToExpression,
    styleRulesToPaint,
    collectHatchPatterns,
    toClusterCirclePaint,
} from "../../src/adapters/maplibre/maplibre-style-converter.js";
import { buildHatchPatternId } from "../../src/adapters/maplibre/maplibre-hatch-patterns.js";
import { DEFAULT_FEATURE_COLOR } from "../../src/utils/constants/constants.js";
describe("normalizeToFlat", () => {
    it("returns {} for null input", () => {
        expect(normalizeToFlat(null)).toEqual({});
    });
    it("returns {} for undefined input", () => {
        expect(normalizeToFlat(undefined)).toEqual({});
    });
    it("returns {} for non-object input", () => {
        expect(normalizeToFlat("string")).toEqual({});
    });
    it("returns a shallow copy when style is already flat", () => {
        const flat = { fillColor: "#ff0000", weight: 2 };
        const result = normalizeToFlat(flat);
        expect(result).toEqual({ fillColor: "#ff0000", weight: 2 });
        expect(result).not.toBe(flat); // must be a copy
    });
    it("passes through flat fill/stroke/weight keys as-is", () => {
        const flat = {
            fillColor: "#00ff00",
            fillOpacity: 0.5,
            color: "#0000ff",
            opacity: 0.8,
            weight: 3,
        };
        const result = normalizeToFlat(flat);
        expect(result).toEqual({
            fillColor: "#00ff00",
            fillOpacity: 0.5,
            color: "#0000ff",
            opacity: 0.8,
            weight: 3,
        });
    });
    it("passes through dashArray, lineCap, lineJoin from flat style", () => {
        const flat = {
            color: "#000",
            dashArray: "5, 10",
            lineCap: "round",
            lineJoin: "bevel",
        };
        const result = normalizeToFlat(flat);
        expect(result.dashArray).toBe("5, 10");
        expect(result.lineCap).toBe("round");
        expect(result.lineJoin).toBe("bevel");
    });
    it("carries shape from top-level", () => {
        const nested = {
            fill: { color: "#abc" },
            shape: "circle",
        };
        expect(normalizeToFlat(nested).shape).toBe("circle");
    });
    it("does not alias sizePx to radius (legacy alias removed in S3)", () => {
        const nested = {
            fill: { color: "#abc" },
            sizePx: 12,
        };
        expect(normalizeToFlat(nested).radius).toBeUndefined();
    });
    it("passes through fill-color/opacity flat keys", () => {
        const flat = { fillColor: "#aaa", fillOpacity: 0.3 };
        const result = normalizeToFlat(flat);
        expect(result).toEqual({ fillColor: "#aaa", fillOpacity: 0.3 });
    });
    it("passes through stroke color/weight flat keys", () => {
        const flat = { color: "#bbb", weight: 5 };
        const result = normalizeToFlat(flat);
        expect(result).toEqual({ color: "#bbb", weight: 5 });
    });
});
describe("parseDashArray", () => {
    it("parses comma-separated string", () => {
        expect(parseDashArray("5, 10")).toEqual([5, 10]);
    });
    it("parses space-separated string", () => {
        expect(parseDashArray("5 10 15")).toEqual([5, 10, 15]);
    });
    it("parses single value", () => {
        expect(parseDashArray("8")).toEqual([8]);
    });
    it("returns undefined for empty string", () => {
        expect(parseDashArray("")).toBeUndefined();
    });
    it("returns undefined for undefined input", () => {
        expect(parseDashArray(undefined)).toBeUndefined();
    });
    it("returns undefined for non-string input", () => {
        expect(parseDashArray(42)).toBeUndefined();
    });
    it("filters out NaN values", () => {
        expect(parseDashArray("5, abc, 10")).toEqual([5, 10]);
    });
    it("returns undefined when all values are NaN", () => {
        expect(parseDashArray("abc, xyz")).toBeUndefined();
    });
});
describe("toFillPaint", () => {
    it("maps fillColor to fill-color", () => {
        const result = toFillPaint({ fillColor: "#ff0000" });
        expect(result["fill-color"]).toBe("#ff0000");
    });
    it("maps fillOpacity to fill-opacity", () => {
        const result = toFillPaint({ fillOpacity: 0.5 });
        expect(result["fill-opacity"]).toBe(0.5);
    });
    it("maps color to fill-outline-color", () => {
        const result = toFillPaint({ color: "#0000ff" });
        expect(result["fill-outline-color"]).toBe("#0000ff");
    });
    // 🛑 A missing colour used to emit NOTHING, so MapLibre applied its own default —
    // an opaque #000000, which reads as data rather than as an omission. The styleRules
    // path already fell back to DEFAULT_FEATURE_COLOR; the two paths now agree.
    it("falls back to the feature default colour, never to MapLibre black", () => {
        expect(toFillPaint({})).toEqual({ "fill-color": DEFAULT_FEATURE_COLOR });
    });
    it("maps all fill properties at once", () => {
        const result = toFillPaint({
            fillColor: "#aaa",
            fillOpacity: 0.7,
            color: "#bbb",
        });
        expect(result).toEqual({
            "fill-color": "#aaa",
            "fill-opacity": 0.7,
            "fill-outline-color": "#bbb",
        });
    });
});
describe("toLinePaint", () => {
    it("maps color, weight, opacity", () => {
        const result = toLinePaint({ color: "#333", weight: 4, opacity: 0.9 });
        expect(result["line-color"]).toBe("#333");
        expect(result["line-width"]).toBe(4);
        expect(result["line-opacity"]).toBe(0.9);
    });
    it("parses and maps dashArray", () => {
        const result = toLinePaint({ dashArray: "5, 10" });
        expect(result["line-dasharray"]).toEqual([5, 10]);
    });
    it("maps lineCap and lineJoin", () => {
        const result = toLinePaint({ lineCap: "round", lineJoin: "miter" });
        expect(result["line-cap"]).toBe("round");
        expect(result["line-join"]).toBe("miter");
    });
    it("falls back to the feature default colour, never to MapLibre black", () => {
        expect(toLinePaint({})).toEqual({ "line-color": DEFAULT_FEATURE_COLOR });
    });
});
describe("toCirclePaint", () => {
    it("maps fillColor to circle-color", () => {
        const result = toCirclePaint({ fillColor: "#f00" });
        expect(result["circle-color"]).toBe("#f00");
    });
    it("maps fillOpacity to circle-opacity", () => {
        const result = toCirclePaint({ fillOpacity: 0.6 });
        expect(result["circle-opacity"]).toBe(0.6);
    });
    it("maps radius to circle-radius", () => {
        const result = toCirclePaint({ radius: 10 });
        expect(result["circle-radius"]).toBe(10);
    });
    it("maps color to circle-stroke-color", () => {
        const result = toCirclePaint({ color: "#00f" });
        expect(result["circle-stroke-color"]).toBe("#00f");
    });
    it("maps weight to circle-stroke-width", () => {
        const result = toCirclePaint({ weight: 2 });
        expect(result["circle-stroke-width"]).toBe(2);
    });
    it("falls back to the feature default colour, never to MapLibre black", () => {
        expect(toCirclePaint({})).toEqual({ "circle-color": DEFAULT_FEATURE_COLOR });
    });

    // The size defaults are DELIBERATELY left to MapLibre: 41 of the 53 layer styles in
    // the repo omit `radius`, and moving that default would move almost every point
    // layer for a defect that is not the one being closed here.
    it("leaves circle-radius unset when no radius is declared", () => {
        expect(toCirclePaint({})["circle-radius"]).toBeUndefined();
    });
});
describe("toCasingPaint", () => {
    it("computes casing width = mainWeight + widthPx * 2", () => {
        const casing = { enabled: true, color: "#000", widthPx: 3 };
        const result = toCasingPaint(casing, 4);
        expect(result["line-width"]).toBe(4 + 3 * 2); // 10
    });
    it("defaults widthPx to 1 when not provided", () => {
        const casing = { enabled: true, color: "#111" };
        const result = toCasingPaint(casing, 5);
        expect(result["line-width"]).toBe(5 + 1 * 2); // 7
    });
    it("defaults color to #000000 when not provided", () => {
        const casing = { enabled: true };
        const result = toCasingPaint(casing, 2);
        expect(result["line-color"]).toBe("#000000");
    });
    it("maps optional opacity, dashArray, lineCap, lineJoin", () => {
        const casing = {
            enabled: true,
            color: "#ff0000",
            opacity: 0.5,
            widthPx: 2,
            dashArray: "4, 8",
            lineCap: "butt",
            lineJoin: "round",
        };
        const result = toCasingPaint(casing, 3);
        expect(result["line-opacity"]).toBe(0.5);
        expect(result["line-dasharray"]).toEqual([4, 8]);
        expect(result["line-cap"]).toBe("butt");
        expect(result["line-join"]).toBe("round");
    });
});
describe("conditionToExpression", () => {
    // --- Equality operators ---
    it("converts == operator", () => {
        const result = conditionToExpression({ field: "type", operator: "==", value: "park" });
        expect(result).toEqual(["==", ["get", "type"], "park"]);
    });
    it("converts === operator (alias for ==)", () => {
        const result = conditionToExpression({ field: "type", operator: "===", value: "lake" });
        expect(result).toEqual(["==", ["get", "type"], "lake"]);
    });
    it("converts eq operator (alias for ==)", () => {
        const result = conditionToExpression({ field: "type", operator: "eq", value: "road" });
        expect(result).toEqual(["==", ["get", "type"], "road"]);
    });
    // --- Inequality operators ---
    it("converts != operator", () => {
        const result = conditionToExpression({ field: "type", operator: "!=", value: "river" });
        expect(result).toEqual(["!=", ["get", "type"], "river"]);
    });
    it("converts !== operator (alias for !=)", () => {
        const result = conditionToExpression({ field: "type", operator: "!==", value: "X" });
        expect(result).toEqual(["!=", ["get", "type"], "X"]);
    });
    it("converts neq operator (alias for !=)", () => {
        const result = conditionToExpression({ field: "type", operator: "neq", value: "Y" });
        expect(result).toEqual(["!=", ["get", "type"], "Y"]);
    });
    // --- Comparison operators ---
    it("converts > operator", () => {
        const result = conditionToExpression({ field: "pop", operator: ">", value: 1000 });
        expect(result).toEqual([">", ["get", "pop"], 1000]);
    });
    it("converts >= operator", () => {
        const result = conditionToExpression({ field: "pop", operator: ">=", value: 500 });
        expect(result).toEqual([">=", ["get", "pop"], 500]);
    });
    it("converts < operator", () => {
        const result = conditionToExpression({ field: "pop", operator: "<", value: 100 });
        expect(result).toEqual(["<", ["get", "pop"], 100]);
    });
    it("converts <= operator", () => {
        const result = conditionToExpression({ field: "pop", operator: "<=", value: 200 });
        expect(result).toEqual(["<=", ["get", "pop"], 200]);
    });
    // --- String operators ---
    it("converts contains operator (case-insensitive)", () => {
        const result = conditionToExpression({
            field: "name",
            operator: "contains",
            value: "Park",
        });
        expect(result).toEqual(["in", "park", ["downcase", ["to-string", ["get", "name"]]]]);
    });
    it("converts startsWith operator (case-insensitive)", () => {
        const result = conditionToExpression({
            field: "name",
            operator: "startsWith",
            value: "Mont",
        });
        expect(result).toEqual([
            "==",
            ["slice", ["downcase", ["to-string", ["get", "name"]]], 0, 4],
            "mont",
        ]);
    });
    it("converts endsWith operator (case-insensitive)", () => {
        const result = conditionToExpression({
            field: "name",
            operator: "endsWith",
            value: "Lake",
        });
        expect(result).toEqual([
            "==",
            [
                "slice",
                ["downcase", ["to-string", ["get", "name"]]],
                ["-", ["length", ["to-string", ["get", "name"]]], 4],
            ],
            "lake",
        ]);
    });
    // --- Array / range operators ---
    it("converts in operator with array value", () => {
        const result = conditionToExpression({ field: "type", operator: "in", value: ["a", "b"] });
        expect(result).toEqual(["in", ["get", "type"], ["literal", ["a", "b"]]]);
    });
    it("returns null for in operator with non-array value", () => {
        expect(
            conditionToExpression({ field: "type", operator: "in", value: "single" })
        ).toBeNull();
    });
    it("converts notIn operator with array value", () => {
        const result = conditionToExpression({
            field: "type",
            operator: "notIn",
            value: ["x", "y"],
        });
        expect(result).toEqual(["!", ["in", ["get", "type"], ["literal", ["x", "y"]]]]);
    });
    it("returns null for notIn operator with non-array value", () => {
        expect(conditionToExpression({ field: "type", operator: "notIn", value: 42 })).toBeNull();
    });
    it("converts between operator", () => {
        const result = conditionToExpression({
            field: "val",
            operator: "between",
            value: [10, 50],
        });
        expect(result).toEqual(["all", [">=", ["get", "val"], 10], ["<=", ["get", "val"], 50]]);
    });
    it("returns null for between with non-array value", () => {
        expect(conditionToExpression({ field: "val", operator: "between", value: 10 })).toBeNull();
    });
    it("returns null for between with wrong-length array", () => {
        expect(
            conditionToExpression({ field: "val", operator: "between", value: [10] })
        ).toBeNull();
    });
    // --- Invalid / edge cases ---
    it("returns null for unknown operator", () => {
        expect(conditionToExpression({ field: "x", operator: "like", value: "a" })).toBeNull();
    });
    it("returns null when field is missing", () => {
        expect(conditionToExpression({ operator: "==", value: "a" })).toBeNull();
    });
    it("returns null when operator is missing", () => {
        expect(conditionToExpression({ field: "x", value: "a" })).toBeNull();
    });
    // --- Combinator ---
    it("converts all combinator with multiple sub-conditions", () => {
        const result = conditionToExpression({
            all: [
                { field: "type", operator: "==", value: "park" },
                { field: "pop", operator: ">", value: 100 },
            ],
        });
        expect(result).toEqual([
            "all",
            ["==", ["get", "type"], "park"],
            [">", ["get", "pop"], 100],
        ]);
    });
    it("unwraps single-element all combinator", () => {
        const result = conditionToExpression({
            all: [{ field: "type", operator: "==", value: "park" }],
        });
        expect(result).toEqual(["==", ["get", "type"], "park"]);
    });
    it("returns null for empty all combinator", () => {
        expect(conditionToExpression({ all: [] })).toBeNull();
    });
    it("filters out invalid sub-conditions in all combinator", () => {
        const result = conditionToExpression({
            all: [
                { field: "type", operator: "==", value: "park" },
                { operator: "invalid" }, // invalid — no field
            ],
        });
        // Only 1 valid sub-condition remains, so it gets unwrapped
        expect(result).toEqual(["==", ["get", "type"], "park"]);
    });
    // --- properties. prefix stripping ---
    it("strips 'properties.' prefix from field name", () => {
        const result = conditionToExpression({
            field: "properties.ecorregion",
            operator: "==",
            value: "Altos Andes",
        });
        expect(result).toEqual(["==", ["get", "ecorregion"], "Altos Andes"]);
    });
    it("keeps bare field name unchanged", () => {
        const result = conditionToExpression({ field: "type", operator: "==", value: "park" });
        expect(result).toEqual(["==", ["get", "type"], "park"]);
    });
    it("strips prefix in all combinator sub-conditions", () => {
        const result = conditionToExpression({
            all: [
                { field: "properties.pop", operator: ">=", value: 0 },
                { field: "properties.pop", operator: "<", value: 1000 },
            ],
        });
        expect(result).toEqual(["all", [">=", ["get", "pop"], 0], ["<", ["get", "pop"], 1000]]);
    });
    it("strips prefix for between operator", () => {
        const result = conditionToExpression({
            field: "properties.val",
            operator: "between",
            value: [10, 50],
        });
        expect(result).toEqual(["all", [">=", ["get", "val"], 10], ["<=", ["get", "val"], 50]]);
    });
    it("strips prefix for contains operator", () => {
        const result = conditionToExpression({
            field: "properties.name",
            operator: "contains",
            value: "Mont",
        });
        expect(result).toEqual(["in", "mont", ["downcase", ["to-string", ["get", "name"]]]]);
    });
});
describe("styleRulesToPaint", () => {
    it("returns base paint when styleRules is empty", () => {
        const defaultStyle = { fillColor: "#aaa", fillOpacity: 0.5 };
        const result = styleRulesToPaint([], defaultStyle, "fill");
        expect(result).toEqual({
            "fill-color": "#aaa",
            "fill-opacity": 0.5,
        });
    });
    it("returns base paint when styleRules is null/undefined", () => {
        const defaultStyle = { color: "#333", weight: 2 };
        const result = styleRulesToPaint(null, defaultStyle, "line");
        expect(result).toEqual({
            "line-color": "#333",
            "line-width": 2,
        });
    });
    it("builds case expressions for varying fill-color", () => {
        const defaultStyle = { fillColor: "#aaa", fillOpacity: 0.5 };
        const rules = [
            {
                when: { field: "type", operator: "==", value: "park" },
                style: { fillColor: "#00ff00" },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");

        // fill-color varies between rules → case expression
        expect(result["fill-color"]).toEqual([
            "case",
            ["==", ["get", "type"], "park"],
            "#00ff00",
            "#aaa",
        ]);
        // fill-opacity doesn't vary → static value
        expect(result["fill-opacity"]).toBe(0.5);
    });
    it("builds case expressions for line paint", () => {
        const defaultStyle = { color: "#000", weight: 2 };
        const rules = [
            {
                when: { field: "road", operator: "==", value: "highway" },
                style: { color: "#ff0000", weight: 5 },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "line");

        expect(result["line-color"]).toEqual([
            "case",
            ["==", ["get", "road"], "highway"],
            "#ff0000",
            "#000",
        ]);
        expect(result["line-width"]).toEqual(["case", ["==", ["get", "road"], "highway"], 5, 2]);
    });
    it("builds case expressions for circle paint", () => {
        const defaultStyle = { fillColor: "#ccc", radius: 6 };
        const rules = [
            {
                when: { field: "cat", operator: "==", value: "A" },
                style: { fillColor: "#f00", radius: 10 },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "circle");

        expect(result["circle-color"]).toEqual([
            "case",
            ["==", ["get", "cat"], "A"],
            "#f00",
            "#ccc",
        ]);
        expect(result["circle-radius"]).toEqual(["case", ["==", ["get", "cat"], "A"], 10, 6]);
    });
    it("skips rules with invalid when condition", () => {
        const defaultStyle = { fillColor: "#aaa" };
        const rules = [
            {
                when: { operator: "==" }, // missing field
                style: { fillColor: "#bbb" },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");
        // No valid rules → returns base paint
        expect(result).toEqual({ "fill-color": "#aaa" });
    });
    it("skips rules missing when or style", () => {
        const defaultStyle = { fillColor: "#aaa" };
        const rules = [
            { style: { fillColor: "#bbb" } }, // no when
            { when: { field: "x", operator: "==" } }, // no style
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");
        expect(result).toEqual({ "fill-color": "#aaa" });
    });
    it("handles flat style in rules", () => {
        const defaultStyle = { fillColor: "#aaa" };
        const rules = [
            {
                when: { field: "type", operator: "==", value: "forest" },
                style: {
                    fillColor: "#228B22",
                },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");

        expect(result["fill-color"]).toEqual([
            "case",
            ["==", ["get", "type"], "forest"],
            "#228B22",
            "#aaa",
        ]);
    });
    it("uses _getPaintDefault fallback when default style has no value for a key", () => {
        // Default style has no fillColor but a rule introduces one
        const defaultStyle = {};
        const rules = [
            {
                when: { field: "type", operator: "==", value: "x" },
                style: { fillColor: "#f00" },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");

        // fill-color appears only in the rule → case with _getPaintDefault fallback
        expect(result["fill-color"]).toEqual([
            "case",
            ["==", ["get", "type"], "x"],
            "#f00",
            "#cccccc", // _getPaintDefault for fill-color
        ]);
    });
});
describe("toClusterCirclePaint", () => {
    it("uses default stops when no config is provided", () => {
        const result = toClusterCirclePaint();
        expect(result["circle-color"]).toEqual([
            "step",
            ["get", "point_count"],
            "#51bbd6",
            100,
            "#f1f075",
            750,
            "#f28cb1",
        ]);
        expect(result["circle-radius"]).toEqual([
            "step",
            ["get", "point_count"],
            18,
            100,
            24,
            750,
            32,
        ]);
        expect(result["circle-stroke-width"]).toBe(2);
        expect(result["circle-stroke-color"]).toBe("#ffffff");
    });
    it("uses custom colorStops and radiusStops", () => {
        const result = toClusterCirclePaint({
            colorStops: [
                [0, "#aaa"],
                [50, "#bbb"],
            ],
            radiusStops: [
                [0, 10],
                [50, 20],
            ],
        });
        expect(result["circle-color"]).toEqual([
            "step",
            ["get", "point_count"],
            "#aaa",
            50,
            "#bbb",
        ]);
        expect(result["circle-radius"]).toEqual(["step", ["get", "point_count"], 10, 50, 20]);
    });
    it("uses defaults when config is empty object", () => {
        const result = toClusterCirclePaint({});
        // Should use the default stops
        expect(result["circle-color"]).toEqual([
            "step",
            ["get", "point_count"],
            "#51bbd6",
            100,
            "#f1f075",
            750,
            "#f28cb1",
        ]);
    });
});
// ─── Hatch pattern integration ──────────────────────────────────────────────

describe("normalizeToFlat — hatch preservation", () => {
    it("preserves hatch from flat style with fillColor", () => {
        const flat = {
            fillColor: "#aaa",
            fillOpacity: 0.5,
            hatch: { enabled: true, type: "dot", spacingPx: 12 },
        };
        const result = normalizeToFlat(flat);
        expect(result.hatch).toEqual({ enabled: true, type: "dot", spacingPx: 12 });
        expect(result.fillColor).toBe("#aaa");
    });

    it("preserves hatch from flat style (shallow copy)", () => {
        const flat = {
            fillColor: "#bbb",
            hatch: { enabled: true, type: "diagonal" },
        };
        const result = normalizeToFlat(flat);
        expect(result.hatch).toEqual({ enabled: true, type: "diagonal" });
    });
});

describe("toFillPaint — hatch → fill-pattern", () => {
    it("emits fill-pattern when hatch.enabled and layerId provided", () => {
        const style = {
            fillColor: "#abc",
            hatch: { enabled: true, type: "dot", spacingPx: 10, stroke: { color: "#000" } },
        };
        const result = toFillPaint(style, "my-layer");
        expect(result["fill-pattern"]).toBe(buildHatchPatternId("my-layer", style.hatch));
        expect(result["fill-color"]).toBe("#abc");
    });

    it("does NOT emit fill-pattern without layerId", () => {
        const style = {
            fillColor: "#abc",
            hatch: { enabled: true, type: "dot" },
        };
        const result = toFillPaint(style);
        expect(result["fill-pattern"]).toBeUndefined();
    });

    it("does NOT emit fill-pattern when hatch.enabled is false", () => {
        const style = {
            fillColor: "#abc",
            hatch: { enabled: false, type: "dot" },
        };
        const result = toFillPaint(style, "layer-x");
        expect(result["fill-pattern"]).toBeUndefined();
    });

    it("sets fill-color transparent for renderMode pattern_only", () => {
        const style = {
            fillColor: "#abc",
            hatch: { enabled: true, type: "dot", renderMode: "pattern_only" },
        };
        const result = toFillPaint(style, "pluv");
        expect(result["fill-pattern"]).toBeDefined();
        expect(result["fill-color"]).toBe("transparent");
        expect(result["fill-opacity"]).toBe(1);
    });
});

describe("collectHatchPatterns", () => {
    it("collects pattern from default style", () => {
        const defaultStyle = {
            hatch: { enabled: true, type: "dot", spacingPx: 10, stroke: { color: "#000" } },
        };
        const patterns = collectHatchPatterns(defaultStyle, undefined, "layer-a");
        expect(patterns).toHaveLength(1);
        expect(patterns[0].patternId).toContain("gl-hatch-layer-a");
    });

    it("returns empty array when no hatch", () => {
        expect(collectHatchPatterns({ fillColor: "#abc" }, undefined, "x")).toEqual([]);
    });

    it("collects patterns from styleRules", () => {
        const defaultStyle = { fillColor: "#aaa" };
        const styleRules = [
            {
                when: { field: "class_id", operator: "==", value: 2 },
                style: {
                    fill: { color: "transparent" },
                    hatch: {
                        enabled: true,
                        type: "dot",
                        spacingPx: 14,
                        stroke: { color: "#c1eaff" },
                    },
                },
            },
            {
                when: { field: "class_id", operator: "==", value: 3 },
                style: {
                    fill: { color: "transparent" },
                    hatch: {
                        enabled: true,
                        type: "dot",
                        spacingPx: 12,
                        stroke: { color: "#2e83de" },
                    },
                },
            },
        ];
        const patterns = collectHatchPatterns(defaultStyle, styleRules, "pluv");
        expect(patterns).toHaveLength(2);
        expect(patterns[0].patternId).not.toBe(patterns[1].patternId);
    });

    it("deduplicates identical hatch configs", () => {
        const hatch = { enabled: true, type: "dot", spacingPx: 10, stroke: { color: "#000" } };
        const defaultStyle = { hatch };
        const styleRules = [{ when: { field: "x", operator: "==", value: 1 }, style: { hatch } }];
        const patterns = collectHatchPatterns(defaultStyle, styleRules, "dup");
        expect(patterns).toHaveLength(1);
    });
});

describe("styleRulesToPaint — hatch data-driven fill-pattern", () => {
    it("builds fill-pattern case expression when rules have different hatch configs", () => {
        const defaultStyle = { fillColor: "#aaa" };
        const rules = [
            {
                when: { field: "class_id", operator: "==", value: 2 },
                style: {
                    fill: { color: "transparent" },
                    hatch: {
                        enabled: true,
                        type: "dot",
                        spacingPx: 14,
                        stroke: { color: "#c1eaff" },
                    },
                },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill", "pluv-jan");
        // fill-pattern should be a case expression since it varies
        expect(result["fill-pattern"]).toEqual(expect.arrayContaining(["case"]));
    });

    it("does NOT add fill-pattern when no layerId provided", () => {
        const defaultStyle = { fillColor: "#aaa" };
        const rules = [
            {
                when: { field: "x", operator: "==", value: 1 },
                style: {
                    hatch: { enabled: true, type: "dot" },
                },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");
        expect(result["fill-pattern"]).toBeUndefined();
    });
});

describe("expressionPaint — native MapLibre expression pass-through", () => {
    it("normalizeToFlat preserves expressionPaint", () => {
        const expr = {
            "fill-color": ["interpolate", ["linear"], ["zoom"], 5, "#ffffcc", 12, "#800026"],
        };
        const style = { fillColor: "#aaa", expressionPaint: expr };
        const flat = normalizeToFlat(style);
        expect(flat.expressionPaint).toEqual(expr);
    });

    it("toFillPaint merges expressionPaint over GeoLeaf-derived values", () => {
        const style = {
            fillColor: "#aaa",
            fillOpacity: 0.5,
            expressionPaint: {
                "fill-color": ["step", ["zoom"], "#ffffcc", 10, "#e31a1c"],
                "fill-opacity": 1,
            },
        };
        const paint = toFillPaint(style);
        // expressionPaint overrides fillColor and fillOpacity
        expect(paint["fill-color"]).toEqual(["step", ["zoom"], "#ffffcc", 10, "#e31a1c"]);
        expect(paint["fill-opacity"]).toBe(1);
    });

    it("toLinePaint merges expressionPaint over GeoLeaf-derived values", () => {
        const style = {
            color: "#aaa",
            weight: 2,
            expressionPaint: { "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 14, 4] },
        };
        const paint = toLinePaint(style);
        expect(paint["line-color"]).toBe("#aaa");
        expect(paint["line-width"]).toEqual(["interpolate", ["linear"], ["zoom"], 8, 1, 14, 4]);
    });

    it("toCirclePaint merges expressionPaint over GeoLeaf-derived values", () => {
        const style = {
            fillColor: "#add42d",
            radius: 8,
            expressionPaint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 12, 10],
            },
        };
        const paint = toCirclePaint(style);
        expect(paint["circle-color"]).toBe("#add42d");
        expect(paint["circle-radius"]).toEqual(["interpolate", ["linear"], ["zoom"], 5, 4, 12, 10]);
    });

    it("styleRulesToPaint injects expressionPaint from defaultStyle as final overrides", () => {
        const defaultStyle = {
            fillColor: "#cccccc",
            fillOpacity: 0.8,
            expressionPaint: {
                "fill-color": ["step", ["zoom"], "#ffffb2", 8, "#fd8d3c", 12, "#e31a1c"],
            },
        };
        const rules = [
            {
                when: { field: "properties.category", operator: "==", value: "A" },
                style: { fillColor: "#ff0000" },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");
        // expressionPaint overrides the case expression for fill-color
        expect(result["fill-color"]).toEqual([
            "step",
            ["zoom"],
            "#ffffb2",
            8,
            "#fd8d3c",
            12,
            "#e31a1c",
        ]);
        // fill-opacity is unaffected (no expressionPaint key for it)
        expect(result["fill-opacity"]).toBe(0.8);
    });

    it("styleRulesToPaint with no rules still applies expressionPaint", () => {
        const defaultStyle = {
            fillColor: "#aaa",
            expressionPaint: {
                "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 12, 1],
            },
        };
        const result = styleRulesToPaint([], defaultStyle, "fill");
        expect(result["fill-color"]).toBe("#aaa");
        expect(result["fill-opacity"]).toEqual([
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.3,
            12,
            1,
        ]);
    });
});

describe('styleRulesToPaint — "extends": "base"', () => {
    const defaultStyle = { fillColor: "#base", fillOpacity: 0.8, color: "#333", weight: 1 };

    it("rule with extends:base only inherits all base properties", () => {
        const rules = [
            { when: { field: "class_id", operator: "==", value: 1 }, style: { extends: "base" } },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");
        // All values are static (rule == base), no case expression needed
        expect(result["fill-color"]).toBe("#base");
        expect(result["fill-opacity"]).toBe(0.8);
    });

    it("rule with extends:base + override produces correct case expression", () => {
        const rules = [
            { when: { field: "class_id", operator: "==", value: 1 }, style: { extends: "base" } },
            {
                when: { field: "class_id", operator: "==", value: 2 },
                style: { extends: "base", fillColor: "#override" },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");
        // fill-color varies → case expression
        expect(Array.isArray(result["fill-color"])).toBe(true);
        expect(result["fill-color"][0]).toBe("case");
        // fill-opacity is static (same across base + both rules)
        expect(result["fill-opacity"]).toBe(0.8);
    });

    it("extends:base output is identical to fully-specified rule", () => {
        const rulesWithExtends = [
            { when: { field: "v", operator: "==", value: 1 }, style: { extends: "base" } },
            {
                when: { field: "v", operator: "==", value: 2 },
                style: { extends: "base", fillColor: "#red" },
            },
        ];
        const rulesFullySpecified = [
            {
                when: { field: "v", operator: "==", value: 1 },
                style: { fillColor: "#base", fillOpacity: 0.8, color: "#333", weight: 1 },
            },
            {
                when: { field: "v", operator: "==", value: 2 },
                style: { fillColor: "#red", fillOpacity: 0.8, color: "#333", weight: 1 },
            },
        ];
        const r1 = styleRulesToPaint(rulesWithExtends, defaultStyle, "fill");
        const r2 = styleRulesToPaint(rulesFullySpecified, defaultStyle, "fill");
        expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it("extends key does not leak into the MapLibre paint output", () => {
        const rules = [
            {
                when: { field: "x", operator: "==", value: 1 },
                style: { extends: "base", fillColor: "#ff0" },
            },
        ];
        const result = styleRulesToPaint(rules, defaultStyle, "fill");
        expect(Object.keys(result).every((k) => k !== "extends")).toBe(true);
    });
});
