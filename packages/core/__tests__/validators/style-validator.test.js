/**
 * Tests pour style-validator — Phase C S5B.13 (15.62% → 70%)
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
    validateStyle,
    formatValidationErrors,
    StyleValidationError,
} from "../../src/utils/validators/style-validator.ts";

import {
    validateFont,
    validateLabelComponent,
    validateLabel,
    validateStroke,
    validateCasing,
    validateFillPattern,
    validateBaseStyle,
} from "../../src/utils/validators/style-validator-properties.ts";

describe("validators/style-validator", () => {
    describe("validateStyle", () => {
        it("returns invalid for null/undefined", () => {
            expect(validateStyle(null).valid).toBe(false);
            expect(validateStyle(undefined).valid).toBe(false);
        });
        it("returns invalid for non-object", () => {
            expect(validateStyle("string").valid).toBe(false);
        });
        it("returns invalid when id and style/defaultStyle missing", () => {
            const r = validateStyle({});
            expect(r.valid).toBe(false);
            expect(r.errors.some((e) => e.field === "id" || e.field === "style")).toBe(true);
        });
        it("validates styleRules when present", () => {
            const r = validateStyle({
                id: "s1",
                style: {},
                scaleConfig: { minScale: 0, maxScale: 100 },
                styleRules: "not-array",
            });
            expect(r.valid).toBe(false);
            expect(r.errors.some((e) => e.field && e.field.includes("styleRules"))).toBe(true);
        });
        it("validates scales (scaleConfig bounds)", () => {
            const r = validateStyle({
                id: "s1",
                style: {},
                scaleConfig: { minScale: -1, maxScale: 100 },
            });
            expect(r.errors.some((e) => e.field && e.field.includes("scaleConfig"))).toBe(true);
        });
        it("validates legend when present", () => {
            const r = validateStyle({
                id: "s1",
                style: {},
                scaleConfig: { minScale: 0, maxScale: 100 },
                legend: "not-object",
            });
            expect(r.valid).toBe(false);
            expect(r.errors.some((e) => e.field === "legend")).toBe(true);
        });
        it("returns valid for minimal valid style", () => {
            const r = validateStyle({
                id: "style-1",
                style: { fill: { color: "#3388ff" } },
                scaleConfig: { minScale: 0, maxScale: 1000 },
            });
            expect(r.valid).toBe(true);
            expect(r.errors).toHaveLength(0);
        });
    });

    describe("formatValidationErrors", () => {
        it("formats errors array to string", () => {
            const result = {
                valid: false,
                errors: [{ field: "id", message: "Missing" }],
                warnings: [],
            };
            const str = formatValidationErrors(result);
            expect(str).toContain("id");
            expect(str).toContain("Missing");
        });
        it("returns null when valid", () => {
            expect(formatValidationErrors({ valid: true, errors: [], warnings: [] })).toBeNull();
        });
    });

    describe("StyleValidationError", () => {
        it("is an Error with message and context", () => {
            const err = new StyleValidationError("test", { field: "id" });
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe("test");
            expect(err.context).toEqual({ field: "id" });
        });
    });

    describe("validateStyle required and id", () => {
        it("accepts a missing id — the loader derives it from the file name", () => {
            // The schema stopped requiring `id` in S1/PRF-SCHEMA ("filename acts as id for
            // ~20% of style files"), but this validator kept demanding it: 15 real styles
            // were rejected and, since the loader throws on validation errors, their layers
            // were never created. `_ensureStyleId` (style-loader-core) supplies the fallback.
            const r = validateStyle({
                style: {},
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(true);
            expect(r.errors.some((e) => e.field === "id")).toBe(false);
        });
        it("pushes error when id is invalid pattern", () => {
            const r = validateStyle({
                id: "bad id!",
                style: {},
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
            expect(r.errors.some((e) => e.field === "id")).toBe(true);
        });
    });

    describe("validateStyle label", () => {
        it("accepts label as string", () => {
            const r = validateStyle({
                id: "s1",
                label: "My Style",
                style: {},
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(true);
        });
        it("validates label object with enabled and field", () => {
            const r = validateStyle({
                id: "s1",
                label: { enabled: true, field: "name" },
                style: {},
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.errors.length).toBe(0);
        });
        it("pushes error when label object has invalid color", () => {
            const r = validateStyle({
                id: "s1",
                label: { enabled: true, field: "n", color: "nothex" },
                style: {},
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
            expect(r.errors.some((e) => e.field && e.field.includes("label"))).toBe(true);
        });
    });

    describe("validateStyle base style", () => {
        it("validates defaultStyle when style missing", () => {
            const r = validateStyle({
                id: "s1",
                defaultStyle: { fill: { color: "#fff" } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(true);
        });
        it("pushes error for invalid fillColor", () => {
            const r = validateStyle({
                id: "s1",
                style: { fillColor: "nothex" },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
            expect(r.errors.some((e) => e.field && e.field.includes("fillColor"))).toBe(true);
        });
        it("pushes error for invalid fillOpacity", () => {
            const r = validateStyle({
                id: "s1",
                style: { fillOpacity: 2 },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("pushes error for invalid weight", () => {
            const r = validateStyle({
                id: "s1",
                style: { weight: -1 },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("pushes error for invalid shape", () => {
            const r = validateStyle({
                id: "s1",
                style: { shape: "triangle" },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates stroke object", () => {
            const r = validateStyle({
                id: "s1",
                style: { stroke: { color: "invalid" } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates casing object", () => {
            const r = validateStyle({
                id: "s1",
                style: { casing: { enabled: "yes" } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates fillPattern object", () => {
            const r = validateStyle({
                id: "s1",
                style: { fillPattern: { enabled: "yes" } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates fillPattern type", () => {
            const r = validateStyle({
                id: "s1",
                style: { fillPattern: { type: "invalid" } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates fillPattern color", () => {
            const r = validateStyle({
                id: "s1",
                style: { fillPattern: { color: "nothex" } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates stroke dashArray must be string", () => {
            const r = validateStyle({
                id: "s1",
                style: { stroke: { dashArray: 123 } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates stroke as non-object", () => {
            const r = validateStyle({
                id: "s1",
                style: { stroke: "string" },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates style as non-object when defaultStyle is string", () => {
            const r = validateStyle({
                id: "s1",
                defaultStyle: "not-object",
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
        });
        it("validates valid stroke and casing", () => {
            const r = validateStyle({
                id: "s1",
                style: {
                    fillColor: "#3388ff",
                    stroke: { color: "#ffffff", weight: 1 },
                    casing: { enabled: true, color: "#000000" },
                },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(true);
        });
        it("validates fillPattern weight and density must be number >= 0", () => {
            const r = validateStyle({
                id: "s1",
                style: { fillPattern: { weight: -1 } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r.valid).toBe(false);
            const r2 = validateStyle({
                id: "s2",
                style: { fillPattern: { density: "high" } },
                scaleConfig: { minScale: 0, maxScale: 100 },
            });
            expect(r2.valid).toBe(false);
        });
    });
});

describe("formatValidationErrors path and stack", () => {
    it("includes styleFilePath when provided", () => {
        const result = validateStyle({ id: "x" });
        const formatted = formatValidationErrors(result, "/path/to/style.json");
        expect(formatted).toContain("/path/to/style.json");
    });
});

// ── Additional branches (TEST-04) ─────────────────────────────────────

describe("style-validator — label configuration branches", () => {
    it("validates label object missing 'enabled' field", () => {
        const r = validateStyle({
            id: "s1",
            style: {},
            scaleConfig: { minScale: 0, maxScale: 100 },
            label: { field: "name" },
        });
        expect(r.errors.some((e) => e.field === "label.enabled")).toBe(true);
    });

    it("validates label.enabled as non-boolean", () => {
        const r = validateStyle({
            id: "s1",
            style: {},
            scaleConfig: { minScale: 0, maxScale: 100 },
            label: { enabled: "yes", field: "name" },
        });
        expect(r.errors.some((e) => e.field === "label.enabled")).toBe(true);
    });

    it("warns when label enabled but no field specified", () => {
        const r = validateStyle({
            id: "s1",
            style: {},
            scaleConfig: { minScale: 0, maxScale: 100 },
            label: { enabled: true },
        });
        expect(r.warnings.some((w) => w.field === "label.field")).toBe(true);
    });

    it("validates font config in label — non-object font", () => {
        const r = validateStyle({
            id: "s1",
            style: {},
            scaleConfig: { minScale: 0, maxScale: 100 },
            label: { enabled: true, field: "name", font: "arial" },
        });
        expect(r.errors.some((e) => e.field === "label.font")).toBe(true);
    });

    it("validates font sizePt must be >= 1", () => {
        const r = validateStyle({
            id: "s1",
            style: {},
            scaleConfig: { minScale: 0, maxScale: 100 },
            label: { enabled: true, field: "name", font: { sizePt: 0 } },
        });
        expect(r.errors.some((e) => e.field === "label.font.sizePt")).toBe(true);
    });

    it("validates font weight must be 0-100", () => {
        const r = validateStyle({
            id: "s1",
            style: {},
            scaleConfig: { minScale: 0, maxScale: 100 },
            label: { enabled: true, field: "name", font: { weight: 150 } },
        });
        expect(r.errors.some((e) => e.field === "label.font.weight")).toBe(true);
    });

    it("validates label buffer as non-object", () => {
        const r = validateStyle({
            id: "s1",
            style: {},
            scaleConfig: { minScale: 0, maxScale: 100 },
            label: { enabled: true, field: "name", buffer: "large" },
        });
        expect(r.errors.some((e) => e.field && e.field.includes("buffer"))).toBe(true);
    });

    it("accepts valid label string config", () => {
        const r = validateStyle({
            id: "s1",
            style: {},
            scaleConfig: { minScale: 0, maxScale: 100 },
            label: "Display Name",
        });
        expect(r.valid).toBe(true);
    });
});

describe("style-validator — stroke/casing/fillPattern branches", () => {
    it("validates stroke.opacity invalid (out of range)", () => {
        const r = validateStyle({
            id: "s1",
            style: { stroke: { opacity: 2 } },
            scaleConfig: { minScale: 0, maxScale: 100 },
        });
        expect(r.errors.some((e) => e.field === "style.stroke.opacity")).toBe(true);
    });

    it("validates stroke.weight invalid (negative)", () => {
        const r = validateStyle({
            id: "s1",
            style: { stroke: { weight: -1 } },
            scaleConfig: { minScale: 0, maxScale: 100 },
        });
        expect(r.errors.some((e) => e.field === "style.stroke.weight")).toBe(true);
    });

    it("validates casing as non-object", () => {
        const r = validateStyle({
            id: "s1",
            style: { casing: "bold" },
            scaleConfig: { minScale: 0, maxScale: 100 },
        });
        expect(r.errors.some((e) => e.field === "style.casing")).toBe(true);
    });

    it("validates fillPattern as non-object (string)", () => {
        const r = validateStyle({
            id: "s1",
            style: { fillPattern: "hatched" },
            scaleConfig: { minScale: 0, maxScale: 100 },
        });
        expect(r.errors.some((e) => e.field === "style.fillPattern")).toBe(true);
    });
});

describe("formatValidationErrors — warnings branch", () => {
    it("includes warnings section when style has both errors and warnings", () => {
        const mockResult = {
            valid: false,
            errors: [{ field: "id", message: "required", context: {} }],
            warnings: [{ field: "label.field", message: "missing field", context: {} }],
        };
        const formatted = formatValidationErrors(mockResult);
        expect(formatted).toContain("warning");
    });
});

// ── Direct tests for style-validator-properties.ts functions (S5B.13) ──────

describe("validateFont — direct", () => {
    it("pushes error for non-object font (string)", () => {
        const errors = [];
        validateFont("bold", errors, [], {});
        expect(errors.some((e) => e.field === "label.font")).toBe(true);
    });
    it("pushes error for null font", () => {
        const errors = [];
        validateFont(null, errors, [], {});
        expect(errors.some((e) => e.field === "label.font")).toBe(true);
    });
    it("pushes error for sizePt < 1", () => {
        const errors = [];
        validateFont({ sizePt: 0 }, errors, [], {});
        expect(errors.some((e) => e.field === "label.font.sizePt")).toBe(true);
    });
    it("pushes error for sizePt not a number", () => {
        const errors = [];
        validateFont({ sizePt: "large" }, errors, [], {});
        expect(errors.some((e) => e.field === "label.font.sizePt")).toBe(true);
    });
    it("pushes error for weight > 100", () => {
        const errors = [];
        validateFont({ weight: 150 }, errors, [], {});
        expect(errors.some((e) => e.field === "label.font.weight")).toBe(true);
    });
    it("pushes error for weight < 0", () => {
        const errors = [];
        validateFont({ weight: -5 }, errors, [], {});
        expect(errors.some((e) => e.field === "label.font.weight")).toBe(true);
    });
    it("pushes error for weight non-integer", () => {
        const errors = [];
        validateFont({ weight: 1.5 }, errors, [], {});
        expect(errors.some((e) => e.field === "label.font.weight")).toBe(true);
    });
    it("no error for valid font", () => {
        const errors = [];
        validateFont({ sizePt: 12, weight: 50 }, errors, [], {});
        expect(errors).toHaveLength(0);
    });
    it("no error when sizePt/weight absent (optional)", () => {
        const errors = [];
        validateFont({}, errors, [], {});
        expect(errors).toHaveLength(0);
    });
});

describe("validateLabelComponent — direct", () => {
    it("pushes error when component is not an object (string)", () => {
        const errors = [];
        validateLabelComponent("large", "label.buffer", errors, [], {});
        expect(errors.some((e) => e.field === "label.buffer")).toBe(true);
    });
    it("pushes error when component is null", () => {
        const errors = [];
        validateLabelComponent(null, "label.background", errors, [], {});
        expect(errors.some((e) => e.field === "label.background")).toBe(true);
    });
    it("no error for empty valid component", () => {
        const errors = [];
        validateLabelComponent({}, "label.buffer", errors, [], {});
        expect(errors).toHaveLength(0);
    });
    it("calls sub-validators on component properties (invalid color)", () => {
        const errors = [];
        validateLabelComponent({ color: "notahex" }, "label.buffer", errors, [], {});
        expect(errors.some((e) => e.field.includes("color"))).toBe(true);
    });
});

describe("validateLabel — direct", () => {
    it("no-op when label absent from styleData", () => {
        const errors = [];
        validateLabel({}, errors, [], {});
        expect(errors).toHaveLength(0);
    });
    it("no error when label is a string", () => {
        const errors = [];
        validateLabel({ label: "My Label" }, errors, [], {});
        expect(errors).toHaveLength(0);
    });
    it("pushes error when label is a number", () => {
        const errors = [];
        validateLabel({ label: 42 }, errors, [], {});
        expect(errors.some((e) => e.field === "label")).toBe(true);
    });
    it("pushes error when label object missing enabled", () => {
        const errors = [];
        validateLabel({ label: { field: "name" } }, errors, [], {});
        expect(errors.some((e) => e.field === "label.enabled")).toBe(true);
    });
    it("pushes error when label.enabled is non-boolean", () => {
        const errors = [];
        validateLabel({ label: { enabled: "yes", field: "name" } }, errors, [], {});
        expect(errors.some((e) => e.field === "label.enabled")).toBe(true);
    });
    it("warning when enabled=true but field missing", () => {
        const errors = [];
        const warnings = [];
        validateLabel({ label: { enabled: true } }, errors, warnings, {});
        expect(warnings.some((w) => w.field === "label.field")).toBe(true);
    });
    it("no warning when enabled=false and field missing", () => {
        const errors = [];
        const warnings = [];
        validateLabel({ label: { enabled: false } }, errors, warnings, {});
        expect(warnings).toHaveLength(0);
    });
    it("delegates font validation when font present", () => {
        const errors = [];
        validateLabel(
            { label: { enabled: true, field: "name", font: "not-object" } },
            errors,
            [],
            {}
        );
        expect(errors.some((e) => e.field === "label.font")).toBe(true);
    });
    it("validates label.offset.distancePx when not a number", () => {
        const errors = [];
        validateLabel(
            { label: { enabled: true, field: "n", offset: { distancePx: "far" } } },
            errors,
            [],
            {}
        );
        expect(errors.some((e) => e.field === "label.offset.distancePx")).toBe(true);
    });
    it("no error for valid label.offset.distancePx", () => {
        const errors = [];
        validateLabel(
            { label: { enabled: true, field: "n", offset: { distancePx: 5 } } },
            errors,
            [],
            {}
        );
        expect(errors.filter((e) => e.field === "label.offset.distancePx")).toHaveLength(0);
    });
    it("validates buffer when present", () => {
        const errors = [];
        validateLabel({ label: { enabled: false, buffer: "bad" } }, errors, [], {});
        expect(errors.some((e) => e.field === "label.buffer")).toBe(true);
    });
    it("validates background when present", () => {
        const errors = [];
        validateLabel({ label: { enabled: false, background: "solid" } }, errors, [], {});
        expect(errors.some((e) => e.field === "label.background")).toBe(true);
    });
});

describe("validateStroke — direct", () => {
    it("pushes error for non-object stroke", () => {
        const errors = [];
        validateStroke("solid", errors, [], {});
        expect(errors.some((e) => e.field === "style.stroke")).toBe(true);
    });
    it("no error for valid empty stroke", () => {
        const errors = [];
        validateStroke({}, errors, [], {});
        expect(errors).toHaveLength(0);
    });
    it("pushes error for dashArray not a string", () => {
        const errors = [];
        validateStroke({ dashArray: 123 }, errors, [], {});
        expect(errors.some((e) => e.field === "style.stroke.dashArray")).toBe(true);
    });
    it("no error for dashArray = null", () => {
        const errors = [];
        validateStroke({ dashArray: null }, errors, [], {});
        expect(errors.filter((e) => e.field === "style.stroke.dashArray")).toHaveLength(0);
    });
    it("no error for valid dashArray string", () => {
        const errors = [];
        validateStroke({ dashArray: "5,5" }, errors, [], {});
        expect(errors.filter((e) => e.field === "style.stroke.dashArray")).toHaveLength(0);
    });
});

describe("validateCasing — direct", () => {
    it("pushes error for non-object casing", () => {
        const errors = [];
        validateCasing("tight", errors, [], {});
        expect(errors.some((e) => e.field === "style.casing")).toBe(true);
    });
    it("no error for valid casing with enabled boolean", () => {
        const errors = [];
        validateCasing({ enabled: true, color: "#000000" }, errors, [], {});
        expect(errors).toHaveLength(0);
    });
    it("pushes error when enabled is non-boolean", () => {
        const errors = [];
        validateCasing({ enabled: "yes" }, errors, [], {});
        expect(errors.some((e) => e.field === "style.casing.enabled")).toBe(true);
    });
    it("no error when enabled not present", () => {
        const errors = [];
        validateCasing({}, errors, [], {});
        expect(errors).toHaveLength(0);
    });
});

describe("validateFillPattern — direct", () => {
    it("pushes error for non-object pattern", () => {
        const errors = [];
        validateFillPattern("hatched", errors, [], {});
        expect(errors.some((e) => e.field === "style.fillPattern")).toBe(true);
    });
    it("no error for empty object", () => {
        const errors = [];
        validateFillPattern({}, errors, [], {});
        expect(errors).toHaveLength(0);
    });
    it("pushes error for invalid type", () => {
        const errors = [];
        validateFillPattern({ type: "dotted" }, errors, [], {});
        expect(errors.some((e) => e.field === "style.fillPattern.type")).toBe(true);
    });
    it("no error for valid type 'diagonal'", () => {
        const errors = [];
        validateFillPattern({ type: "diagonal" }, errors, [], {});
        expect(errors.filter((e) => e.field === "style.fillPattern.type")).toHaveLength(0);
    });
    it("no error for valid type 'cross'", () => {
        const errors = [];
        validateFillPattern({ type: "cross" }, errors, [], {});
        expect(errors.filter((e) => e.field === "style.fillPattern.type")).toHaveLength(0);
    });
    it("no error when enabled is boolean", () => {
        const errors = [];
        validateFillPattern({ enabled: false }, errors, [], {});
        expect(errors.filter((e) => e.field === "style.fillPattern.enabled")).toHaveLength(0);
    });
    it("pushes error when enabled is non-boolean", () => {
        const errors = [];
        validateFillPattern({ enabled: 1 }, errors, [], {});
        expect(errors.some((e) => e.field === "style.fillPattern.enabled")).toBe(true);
    });
});

describe("validateBaseStyle — direct", () => {
    it("no-op when no style or defaultStyle", () => {
        const errors = [];
        validateBaseStyle({ id: "s1" }, errors, [], {});
        expect(errors).toHaveLength(0);
    });
    it("pushes error when style is not an object (string)", () => {
        const errors = [];
        validateBaseStyle({ style: "flat" }, errors, [], {});
        expect(errors.some((e) => e.field === "style")).toBe(true);
    });
    it("uses defaultStyle when style absent", () => {
        const errors = [];
        validateBaseStyle({ defaultStyle: { fillColor: "notahex" } }, errors, [], {});
        expect(errors.some((e) => e.field === "style.fillColor")).toBe(true);
    });
    it("delegates to validateStroke when stroke present", () => {
        const errors = [];
        validateBaseStyle({ style: { stroke: "bad" } }, errors, [], {});
        expect(errors.some((e) => e.field === "style.stroke")).toBe(true);
    });
    it("delegates to validateCasing when casing present", () => {
        const errors = [];
        validateBaseStyle({ style: { casing: "bad" } }, errors, [], {});
        expect(errors.some((e) => e.field === "style.casing")).toBe(true);
    });
    it("delegates to validateFillPattern when fillPattern present", () => {
        const errors = [];
        validateBaseStyle({ style: { fillPattern: "bad" } }, errors, [], {});
        expect(errors.some((e) => e.field === "style.fillPattern")).toBe(true);
    });
    it("no error for valid style object with no special props", () => {
        const errors = [];
        validateBaseStyle({ style: { fillColor: "#3388ff", weight: 2 } }, errors, [], {});
        expect(errors).toHaveLength(0);
    });
});
