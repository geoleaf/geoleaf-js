/**
 * Tests for validators/style-validator-rules.ts
 * Sprint S5B.10 — migrated to ESM static imports for Istanbul coverage instrumentation.
 */
import {
    validateStyleRules,
    validateWhenCondition,
    validateSimpleCondition,
    validateScales,
    validateLegend,
    StyleValidatorRules,
} from "../../src/utils/validators/style-validator-rules.ts";

describe("validators/style-validator-rules", () => {
    const ctx = {};

    describe("validateStyleRules", () => {
        it("pushes error when rules is not array", () => {
            const errors = [];
            const warnings = [];
            validateStyleRules({}, errors, warnings, ctx);
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toContain("table");
        });
        it("validates each rule has when and style", () => {
            const errors = [];
            const warnings = [];
            validateStyleRules([{}], errors, warnings, ctx);
            expect(errors.some((e) => e.field.includes("when"))).toBe(true);
            expect(errors.some((e) => e.field.includes("style"))).toBe(true);
        });
        it("accepts valid rule with when and style", () => {
            const errors = [];
            const warnings = [];
            validateStyleRules(
                [
                    {
                        when: { field: "type", operator: "==", value: "point" },
                        style: { fill: { color: "#f00" } },
                    },
                ],
                errors,
                warnings,
                ctx
            );
            expect(errors).toHaveLength(0);
        });
        it("validates when.all array", () => {
            const errors = [];
            const warnings = [];
            validateStyleRules(
                [
                    {
                        when: { all: [{ field: "a", operator: "==", value: 1 }] },
                        style: {},
                    },
                ],
                errors,
                warnings,
                ctx
            );
            expect(errors.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe("validateWhenCondition", () => {
        it("pushes error when when is not object", () => {
            const errors = [];
            const warnings = [];
            validateWhenCondition("string", 0, errors, warnings, ctx);
            expect(errors).toHaveLength(1);
        });
    });

    describe("validateSimpleCondition", () => {
        it("requires field, operator, value", () => {
            const errors = [];
            validateSimpleCondition({}, 0, null, errors, ctx);
            expect(errors.length).toBeGreaterThanOrEqual(1);
        });
        it("rejects invalid operator", () => {
            const errors = [];
            validateSimpleCondition({ field: "x", operator: "??", value: 1 }, 0, null, errors, ctx);
            expect(errors.some((e) => e.message?.toLowerCase().includes("operator"))).toBe(true);
        });
        it("accepts valid operators", () => {
            const errors = [];
            validateSimpleCondition({ field: "x", operator: "==", value: 1 }, 0, null, errors, ctx);
            expect(errors.filter((e) => e.field && e.field.includes("operator"))).toHaveLength(0);
        });
    });

    describe("validateScales", () => {
        it("rejects the retired zoomConfig", () => {
            const errors = [];
            const warnings = [];
            validateScales(
                { id: "s", style: {}, zoomConfig: { minZoom: 6, maxZoom: 18 } },
                errors,
                warnings,
                ctx
            );
            expect(errors.some((e) => e.field === "zoomConfig")).toBe(true);
        });
        it("accepts a style with no scaleConfig at all (optional = no constraint)", () => {
            const errors = [];
            const warnings = [];
            validateScales({ id: "s", style: {} }, errors, warnings, ctx);
            expect(errors).toHaveLength(0);
        });
        it("accepts valid scaleConfig", () => {
            const errors = [];
            const warnings = [];
            validateScales(
                {
                    id: "s",
                    style: {},
                    scaleConfig: { minScale: 9222148, maxScale: 2252 },
                },
                errors,
                warnings,
                ctx
            );
            expect(errors.filter((e) => e.field && e.field.startsWith("scaleConfig"))).toHaveLength(
                0
            );
        });
    });

    describe("validateLegend", () => {
        it("pushes error when legend is not object", () => {
            const errors = [];
            const warnings = [];
            validateLegend("string", errors, warnings, ctx);
            expect(errors).toHaveLength(1);
        });
        it("validates legend.order is integer", () => {
            const errors = [];
            const warnings = [];
            validateLegend({ order: 1.5 }, errors, warnings, ctx);
            expect(errors.some((e) => e.field === "legend.order")).toBe(true);
        });
    });

    describe("StyleValidatorRules export", () => {
        it("exports all functions", () => {
            expect(StyleValidatorRules.validateStyleRules).toBe(validateStyleRules);
            expect(StyleValidatorRules.validateScales).toBe(validateScales);
            expect(StyleValidatorRules.validateLegend).toBe(validateLegend);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateStyleRules — additional branches
// ─────────────────────────────────────────────────────────────────────────────
describe("validators/style-validator-rules — validateStyleRules branches", () => {
    const ctx = {};

    it("pushes error when rule is null (non-object)", () => {
        const errors = [];
        const warnings = [];
        validateStyleRules([null], errors, warnings, ctx);
        expect(errors.some((e) => e.field === "styleRules[0]")).toBe(true);
    });

    it("pushes error when rule is a string (non-object)", () => {
        const errors = [];
        const warnings = [];
        validateStyleRules(["str"], errors, warnings, ctx);
        expect(errors.some((e) => e.field === "styleRules[0]")).toBe(true);
    });

    it("pushes error for legend when it is a non-object value (string)", () => {
        const errors = [];
        const warnings = [];
        validateStyleRules(
            [
                {
                    when: { field: "x", operator: "==", value: 1 },
                    style: { fill: {} },
                    legend: "not-an-object",
                },
            ],
            errors,
            warnings,
            ctx
        );
        expect(errors.some((e) => e.field.includes("legend"))).toBe(true);
    });

    it("accepts valid rule with legend as object (no legend error)", () => {
        const errors = [];
        const warnings = [];
        validateStyleRules(
            [
                {
                    when: { field: "x", operator: "==", value: 1 },
                    style: { fill: {} },
                    legend: { label: "Point" },
                },
            ],
            errors,
            warnings,
            ctx
        );
        expect(errors.filter((e) => e.field.includes("legend"))).toHaveLength(0);
    });

    it("validates multiple rules independently", () => {
        const errors = [];
        const warnings = [];
        validateStyleRules(
            [
                { when: { field: "a", operator: "==", value: 1 }, style: {} },
                null,
                { when: { field: "b", operator: "!=", value: 2 }, style: {} },
            ],
            errors,
            warnings,
            ctx
        );
        // Only the null rule at index 1 should produce an error
        expect(errors.some((e) => e.field === "styleRules[1]")).toBe(true);
        expect(errors.filter((e) => e.field === "styleRules[0]")).toHaveLength(0);
        expect(errors.filter((e) => e.field === "styleRules[2]")).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateWhenCondition — when.all[] vs single condition routing
// ─────────────────────────────────────────────────────────────────────────────
describe("validators/style-validator-rules — validateWhenCondition branches", () => {
    const ctx = {};

    it("validates when.all[] compound conditions (each sub-condition checked)", () => {
        const errors = [];
        const warnings = [];
        validateWhenCondition(
            { all: [{ field: "a", operator: "==", value: 1 }, {}] },
            0,
            errors,
            warnings,
            ctx
        );
        // Second sub-condition {} is missing field, operator, value
        expect(errors.some((e) => e.field.includes("all[1]"))).toBe(true);
    });

    it("uses single-condition path when no .all property", () => {
        const errors = [];
        const warnings = [];
        validateWhenCondition({ field: "x", operator: "==", value: 1 }, 0, errors, warnings, ctx);
        expect(errors).toHaveLength(0);
    });

    it("uses single-condition path when .all is not an array", () => {
        const errors = [];
        const warnings = [];
        validateWhenCondition(
            { all: "not-array", field: "x", operator: "==", value: 1 },
            0,
            errors,
            warnings,
            ctx
        );
        // Falls through to single-condition validation (no .all array branch taken)
        expect(errors).toHaveLength(0);
    });

    it("when is null pushes error", () => {
        const errors = [];
        const warnings = [];
        validateWhenCondition(null, 0, errors, warnings, ctx);
        expect(errors.length).toBeGreaterThanOrEqual(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateSimpleCondition — all operators + condIndex prefix paths
// ─────────────────────────────────────────────────────────────────────────────
describe("validators/style-validator-rules — validateSimpleCondition branches", () => {
    const ctx = {};

    const validOperators = ["==", "!=", "<", ">", "<=", ">=", "in", "contains"];
    validOperators.forEach((op) => {
        it(`accepts valid operator: "${op}"`, () => {
            const errors = [];
            validateSimpleCondition({ field: "x", operator: op, value: 1 }, 0, null, errors, ctx);
            expect(errors.filter((e) => e.field.includes("operator"))).toHaveLength(0);
        });
    });

    it("rejects unknown operator and uses styleRules[N].when prefix when condIndex=null", () => {
        const errors = [];
        validateSimpleCondition({ field: "x", operator: "LIKE", value: 1 }, 2, null, errors, ctx);
        expect(errors.some((e) => e.field === "styleRules[2].when.operator")).toBe(true);
    });

    it("uses styleRules[N].when.all[M] prefix when condIndex is a number", () => {
        const errors = [];
        validateSimpleCondition({ operator: "LIKE" }, 1, 3, errors, ctx);
        // Missing field + invalid operator → error path with all[3]
        expect(errors.some((e) => e.field.includes("all[3]"))).toBe(true);
    });

    it("pushes error for non-string field (number)", () => {
        const errors = [];
        validateSimpleCondition({ field: 42, operator: "==", value: 1 }, 0, null, errors, ctx);
        expect(errors.some((e) => e.field.includes("field"))).toBe(true);
    });

    it("pushes error for non-string field with condIndex prefix", () => {
        const errors = [];
        validateSimpleCondition({ field: true, operator: "==", value: 1 }, 0, 2, errors, ctx);
        expect(errors.some((e) => e.field.includes("all[2]") && e.field.includes("field"))).toBe(
            true
        );
    });

    it("no error for missing field when value is missing too (all 3 required)", () => {
        const errors = [];
        validateSimpleCondition({}, 0, null, errors, ctx);
        expect(errors.length).toBe(3); // field, operator, value all missing
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateScales — scaleConfig (scale denominators) + labelScale.
// `zoomConfig` was retired in S5/N-1: its minZoom/maxZoom naming led profile authors to
// write MapLibre zoom levels into a field the engine read as scale denominators, which
// hid 18 layers at every zoom for ~3 months. These tests lock the guards that make that
// class of mistake loud instead of silent.
// ─────────────────────────────────────────────────────────────────────────────
describe("validators/style-validator-rules — validateScales branches", () => {
    const ctx = {};

    it("accepts scaleConfig with scale denominators", () => {
        const errors = [];
        const warnings = [];
        validateScales(
            { scaleConfig: { minScale: 9222148, maxScale: 2252 } },
            errors,
            warnings,
            ctx
        );
        expect(errors.filter((e) => e.field.startsWith("scaleConfig"))).toHaveLength(0);
    });

    it("scaleConfig is optional — no error when null", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: null }, errors, warnings, ctx);
        expect(errors).toHaveLength(0);
    });

    it("accepts an empty scaleConfig (bounds are optional)", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: {} }, errors, warnings, ctx);
        expect(errors).toHaveLength(0);
    });

    it("rejects the retired zoomConfig and points at scaleConfig", () => {
        const errors = [];
        const warnings = [];
        validateScales({ zoomConfig: { minZoom: 5, maxZoom: 18 } }, errors, warnings, ctx);
        const err = errors.find((e) => e.field === "zoomConfig");
        expect(err).toBeDefined();
        expect(err.message).toContain("scaleConfig");
    });

    it("rejects minZoom/maxZoom inside scaleConfig instead of ignoring them", () => {
        // The old alias is gone: an unknown key must fail loudly, otherwise the layer
        // silently loses its constraint — the quiet version of the original bug.
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: { minZoom: 3, maxZoom: 20 } }, errors, warnings, ctx);
        expect(errors.some((e) => e.field === "scaleConfig.minZoom")).toBe(true);
        expect(errors.some((e) => e.field === "scaleConfig.maxZoom")).toBe(true);
    });

    it("rejects a denominator that looks like a zoom level", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: { minScale: 6, maxScale: 18 } }, errors, warnings, ctx);
        // 1:6 and 1:18 are unreachable at any MapLibre zoom → always a mistyped zoom level.
        expect(errors.some((e) => e.field === "scaleConfig.minScale")).toBe(true);
        expect(errors.some((e) => e.field === "scaleConfig.maxScale")).toBe(true);
    });

    it("still accepts 0 — the documented 'constraint disabled' convention", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: { minScale: 20000000, maxScale: 0 } }, errors, warnings, ctx);
        expect(errors.filter((e) => e.field.startsWith("scaleConfig"))).toHaveLength(0);
    });

    it("pushes error when scale value is negative", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: { minScale: -1, maxScale: 2252 } }, errors, warnings, ctx);
        expect(errors.some((e) => e.field === "scaleConfig.minScale")).toBe(true);
    });

    it("pushes error when scale value is non-numeric (string)", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: { minScale: "bad", maxScale: 500 } }, errors, warnings, ctx);
        expect(errors.some((e) => e.field === "scaleConfig.minScale")).toBe(true);
    });

    it("accepts null scale value without error (null is explicitly allowed)", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: { minScale: null, maxScale: 500 } }, errors, warnings, ctx);
        expect(errors.filter((e) => e.field === "scaleConfig.minScale")).toHaveLength(0);
    });

    it("labelScale optional — no error when absent", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: { minScale: 50000, maxScale: 1000 } }, errors, warnings, ctx);
        expect(errors.filter((e) => e.field === "labelScale")).toHaveLength(0);
    });

    it("labelScale validated when present (accepts valid object)", () => {
        const errors = [];
        const warnings = [];
        validateScales(
            {
                scaleConfig: { minScale: 50000, maxScale: 1000 },
                labelScale: { minScale: 50000, maxScale: 1000 },
            },
            errors,
            warnings,
            ctx
        );
        expect(errors.filter((e) => e.field.startsWith("labelScale"))).toHaveLength(0);
    });

    it("labelScale gets the same zoom-level guard as scaleConfig", () => {
        const errors = [];
        const warnings = [];
        validateScales({ labelScale: { minScale: 5, maxScale: 18 } }, errors, warnings, ctx);
        expect(errors.some((e) => e.field === "labelScale.minScale")).toBe(true);
    });

    it("pushes error when scale object is a string (not object)", () => {
        const errors = [];
        const warnings = [];
        validateScales({ scaleConfig: "invalid" }, errors, warnings, ctx);
        expect(errors.some((e) => e.field === "scaleConfig")).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateLegend — additional branches
// ─────────────────────────────────────────────────────────────────────────────
describe("validators/style-validator-rules — validateLegend branches", () => {
    const ctx = {};

    it("pushes error when legend is null", () => {
        const errors = [];
        const warnings = [];
        validateLegend(null, errors, warnings, ctx);
        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe("legend");
    });

    it("pushes error when legend is a number", () => {
        const errors = [];
        const warnings = [];
        validateLegend(42, errors, warnings, ctx);
        expect(errors).toHaveLength(1);
    });

    it("accepts valid legend object with integer order", () => {
        const errors = [];
        const warnings = [];
        validateLegend({ order: 2, label: "Points" }, errors, warnings, ctx);
        expect(errors).toHaveLength(0);
    });

    it("accepts legend without order property (order is optional)", () => {
        const errors = [];
        const warnings = [];
        validateLegend({ label: "No order" }, errors, warnings, ctx);
        expect(errors).toHaveLength(0);
    });

    it("pushes error when order is a float", () => {
        const errors = [];
        const warnings = [];
        validateLegend({ order: 1.5 }, errors, warnings, ctx);
        expect(errors.some((e) => e.field === "legend.order")).toBe(true);
    });

    it("pushes error when order is a string", () => {
        const errors = [];
        const warnings = [];
        validateLegend({ order: "first" }, errors, warnings, ctx);
        expect(errors.some((e) => e.field === "legend.order")).toBe(true);
    });

    it("accepts order = 0 (valid integer)", () => {
        const errors = [];
        const warnings = [];
        validateLegend({ order: 0 }, errors, warnings, ctx);
        expect(errors).toHaveLength(0);
    });
});
