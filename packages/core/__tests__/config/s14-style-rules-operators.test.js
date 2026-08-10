/**
 * Config-contract Phase C / C5 — B6 styles/{style}.json styleRules[] per operator.
 *
 * Two engines read the styleRules operator enum (style.schema.json styleCondition.operator):
 *  1. MapLibre data-driven path — `conditionToExpression` / `styleRulesToPaint`
 *     (adapters/maplibre-style-converter): operator → MapLibre expression. Strips the
 *     "properties." prefix (["get"] is implicit on feature.properties).
 *  2. JS evaluation path — `GeoJSONStyleResolver.{evaluateCondition,evaluateStyleRules}`
 *     + `GeoJSONShared.STYLE_OPERATORS` (geojson/style-resolver + shared): still used at
 *     runtime for popup-content building. Resolves the field against feature.properties.
 *
 * Every operator of the schema enum is exercised on both paths; `when.all` compound,
 * first-match-wins, style.extends marker and the fixture round-trip are locked too.
 *
 * Inventory B6. Source of truth = profiles/_reference/.../styles/{defaut,alt}.json.
 */

import {
    conditionToExpression,
    styleRulesToPaint,
    normalizeToFlat,
} from "../../src/adapters/maplibre/maplibre-style-converter.js";
import { GeoJSONStyleResolver } from "../../src/kernel/geojson/style-resolver.js";
import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";
import { REFERENCE_STYLE, REFERENCE_STYLE_ALT, clone } from "./_helpers/config-harness.js";

const OPS = GeoJSONShared.STYLE_OPERATORS;
const Log = { warn() {} };

// ─── MapLibre expression path ────────────────────────────────────────────────

describe("config B6 — conditionToExpression: equality operators", () => {
    const g = ["get", "category"];
    it("== → ['==', getter, value]", () =>
        expect(
            conditionToExpression({ field: "properties.category", operator: "==", value: "A" })
        ).toEqual(["==", g, "A"]));
    it("=== and eq are aliases of ==", () => {
        expect(
            conditionToExpression({ field: "properties.category", operator: "===", value: "A" })
        ).toEqual(["==", g, "A"]);
        expect(
            conditionToExpression({ field: "properties.category", operator: "eq", value: "A" })
        ).toEqual(["==", g, "A"]);
    });
    it("!=, !==, neq → ['!=', getter, value]", () => {
        for (const op of ["!=", "!==", "neq"]) {
            expect(
                conditionToExpression({ field: "properties.category", operator: op, value: "A" })
            ).toEqual(["!=", g, "A"]);
        }
    });
});

describe("config B6 — conditionToExpression: comparison operators", () => {
    const g = ["get", "score"];
    it(">, >=, <, <= map verbatim", () => {
        expect(
            conditionToExpression({ field: "properties.score", operator: ">", value: 5 })
        ).toEqual([">", g, 5]);
        expect(
            conditionToExpression({ field: "properties.score", operator: ">=", value: 5 })
        ).toEqual([">=", g, 5]);
        expect(
            conditionToExpression({ field: "properties.score", operator: "<", value: 5 })
        ).toEqual(["<", g, 5]);
        expect(
            conditionToExpression({ field: "properties.score", operator: "<=", value: 5 })
        ).toEqual(["<=", g, 5]);
    });
});

describe("config B6 — conditionToExpression: string operators", () => {
    it("contains → case-insensitive substring via downcase/to-string", () => {
        expect(
            conditionToExpression({
                field: "properties.label",
                operator: "contains",
                value: "Park",
            })
        ).toEqual(["in", "park", ["downcase", ["to-string", ["get", "label"]]]]);
    });
    it("startsWith → slice from 0", () => {
        expect(
            conditionToExpression({ field: "properties.code", operator: "startsWith", value: "FR" })
        ).toEqual(["==", ["slice", ["downcase", ["to-string", ["get", "code"]]], 0, 2], "fr"]);
    });
    it("endsWith → slice from end", () => {
        expect(
            conditionToExpression({ field: "properties.code", operator: "endsWith", value: "ne" })
        ).toEqual([
            "==",
            [
                "slice",
                ["downcase", ["to-string", ["get", "code"]]],
                ["-", ["length", ["to-string", ["get", "code"]]], 2],
            ],
            "ne",
        ]);
    });
});

describe("config B6 — conditionToExpression: array operators", () => {
    const g = ["get", "category"];
    it("in → ['in', getter, ['literal', arr]]", () =>
        expect(
            conditionToExpression({
                field: "properties.category",
                operator: "in",
                value: ["X", "Y"],
            })
        ).toEqual(["in", g, ["literal", ["X", "Y"]]]));
    it("notIn → negated in", () =>
        expect(
            conditionToExpression({
                field: "properties.category",
                operator: "notIn",
                value: ["X", "Y"],
            })
        ).toEqual(["!", ["in", g, ["literal", ["X", "Y"]]]]));
    it("between → ['all', >=, <=]", () =>
        expect(
            conditionToExpression({ field: "properties.rank", operator: "between", value: [1, 3] })
        ).toEqual(["all", [">=", ["get", "rank"], 1], ["<=", ["get", "rank"], 3]]));
    it("in/notIn with a non-array value → null", () => {
        expect(
            conditionToExpression({ field: "properties.x", operator: "in", value: "X" })
        ).toBeNull();
        expect(
            conditionToExpression({ field: "properties.x", operator: "notIn", value: "X" })
        ).toBeNull();
    });
    it("between with wrong arity → null", () =>
        expect(
            conditionToExpression({ field: "properties.x", operator: "between", value: [1] })
        ).toBeNull());
});

describe("config B6 — conditionToExpression: compound, field-prefix, invalid", () => {
    it("when.all compound → ['all', ...subs]", () => {
        expect(
            conditionToExpression({
                all: [
                    { field: "properties.score", operator: ">=", value: 10 },
                    { field: "properties.score", operator: "<=", value: 20 },
                ],
            })
        ).toEqual(["all", [">=", ["get", "score"], 10], ["<=", ["get", "score"], 20]]);
    });
    it("single-item all returns the sub-expression directly", () => {
        expect(
            conditionToExpression({ all: [{ field: "properties.x", operator: ">", value: 1 }] })
        ).toEqual([">", ["get", "x"], 1]);
    });
    it("field WITHOUT properties. prefix is kept verbatim", () =>
        expect(conditionToExpression({ field: "mag", operator: ">", value: 3 })).toEqual([
            ">",
            ["get", "mag"],
            3,
        ]));
    it("missing field/operator → null; unknown operator → null", () => {
        expect(conditionToExpression({ operator: "==", value: 1 })).toBeNull();
        expect(conditionToExpression({ field: "x", operator: "bogus", value: 1 })).toBeNull();
    });
});

// ─── JS evaluation path ──────────────────────────────────────────────────────

describe("config B6 — STYLE_OPERATORS (JS evaluation semantics)", () => {
    it("comparison + equality", () => {
        expect(OPS[">"](5, 3)).toBe(true);
        expect(OPS["<="](3, 3)).toBe(true);
        expect(OPS["=="]("A", "A")).toBe(true);
        expect(OPS["!="]("A", "B")).toBe(true);
    });
    it("string operators are case-insensitive", () => {
        expect(OPS.contains("National Park", "park")).toBe(true);
        expect(OPS.startsWith("FR-75", "fr")).toBe(true);
        expect(OPS.endsWith("zone-ne", "NE")).toBe(true);
    });
    it("array operators", () => {
        expect(OPS.in("X", ["X", "Y"])).toBe(true);
        expect(OPS.notIn("Z", ["X", "Y"])).toBe(true);
        expect(OPS.between(2, [1, 3])).toBe(true);
        expect(OPS.between(4, [1, 3])).toBe(false);
    });
});

describe("config B6 — GeoJSONStyleResolver.evaluateCondition / evaluateStyleRules", () => {
    it("evaluateCondition resolves the field against feature.properties", () => {
        const feature = { properties: { score: 12 } };
        expect(
            GeoJSONStyleResolver.evaluateCondition(
                feature,
                { field: "score", operator: ">=", value: 10 },
                OPS,
                Log
            )
        ).toBe(true);
        expect(
            GeoJSONStyleResolver.evaluateCondition(
                feature,
                { field: "score", operator: ">", value: 20 },
                OPS,
                Log
            )
        ).toBe(false);
    });
    it("missing field value → false (no throw)", () => {
        expect(
            GeoJSONStyleResolver.evaluateCondition(
                { properties: {} },
                { field: "absent", operator: "==", value: 1 },
                OPS,
                Log
            )
        ).toBe(false);
    });
    it("evaluateStyleRules returns the FIRST matching rule's style", () => {
        const rules = [
            { when: { field: "t", operator: "==", value: "a" }, style: { fillColor: "#first" } },
            { when: { field: "t", operator: "==", value: "a" }, style: { fillColor: "#second" } },
        ];
        expect(GeoJSONStyleResolver.evaluateStyleRules({ properties: { t: "a" } }, rules)).toEqual({
            fillColor: "#first",
        });
    });
    it("evaluateStyleRules returns null when no rule matches", () => {
        const rules = [
            { when: { field: "t", operator: "==", value: "a" }, style: { fillColor: "#x" } },
        ];
        expect(
            GeoJSONStyleResolver.evaluateStyleRules({ properties: { t: "z" } }, rules)
        ).toBeNull();
    });
    it("getNestedValue walks dotted paths, returns null on miss", () => {
        expect(GeoJSONStyleResolver.getNestedValue({ a: { b: 2 } }, "a.b")).toBe(2);
        expect(GeoJSONStyleResolver.getNestedValue({}, "x")).toBeNull();
    });
});

// ─── Fixture round-trip + data-driven paint + extends ────────────────────────

describe("config B6 — fixture styleRules round-trip + data-driven paint", () => {
    it("every fixture rule condition compiles to a non-null MapLibre expression", () => {
        for (const rule of [...REFERENCE_STYLE.styleRules, ...REFERENCE_STYLE_ALT.styleRules]) {
            expect(conditionToExpression(rule.when)).not.toBeNull();
        }
    });
    it("a varying paint key becomes a ['case', ...] expression", () => {
        const paint = styleRulesToPaint(
            clone(REFERENCE_STYLE.styleRules),
            normalizeToFlat(REFERENCE_STYLE.style),
            "circle",
            "reference-points"
        );
        expect(Array.isArray(paint["circle-color"])).toBe(true);
        expect(paint["circle-color"][0]).toBe("case");
    });
    it("style.extends:'base' marker is stripped, defaultStyle inherited", () => {
        const paint = styleRulesToPaint(
            [
                {
                    when: { field: "properties.t", operator: "==", value: "a" },
                    style: { extends: "base", fillColor: "#111111" },
                },
            ],
            normalizeToFlat({ fillColor: "#999999", radius: 6 }),
            "circle"
        );
        // rule fillColor varies vs default → case expr carrying the rule color
        expect(JSON.stringify(paint["circle-color"])).toContain("#111111");
        expect(JSON.stringify(paint["circle-color"])).not.toContain("extends");
    });
});
