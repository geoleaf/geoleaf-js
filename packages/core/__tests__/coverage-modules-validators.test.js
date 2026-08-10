/**
 * Campagne de tests unitaires — validators (style-validator)
 */

import {
    validateStyle,
    formatValidationErrors,
    StyleValidationError,
} from "../src/utils/validators/style-validator.js";
import { validateUrl as validateUrlValidator } from "../src/utils/validators/general-validators.js";

vi.mock("../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Coverage — style-validator", () => {
    describe("validateStyle", () => {
        it("returns invalid for null/undefined", () => {
            const r = validateStyle(null);
            expect(r.valid).toBe(false);
            expect(r.errors.length).toBeGreaterThan(0);
        });
        it("returns invalid for non-object", () => {
            const r = validateStyle("string");
            expect(r.valid).toBe(false);
        });
        it("returns invalid when id and style/defaultStyle missing", () => {
            const r = validateStyle({});
            expect(r.valid).toBe(false);
            expect(r.errors.some((e) => e.field === "id" || e.field === "style")).toBe(true);
        });
        it("returns result with errors when style is incomplete", () => {
            const r = validateStyle({
                id: "style-1",
                label: "Style 1",
                style: {},
                layerScale: {},
            });
            expect(r).toHaveProperty("valid");
            expect(r).toHaveProperty("errors");
            expect(r).toHaveProperty("warnings");
            expect(Array.isArray(r.errors)).toBe(true);
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
            expect(typeof str).toBe("string");
            expect(str).toContain("id");
            expect(str).toContain("Missing");
        });
        it("returns null when valid", () => {
            expect(formatValidationErrors({ valid: true, errors: [], warnings: [] })).toBeNull();
        });
    });

    describe("StyleValidationError", () => {
        it("is an Error with message", () => {
            const err = new StyleValidationError("test message");
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe("test message");
        });
    });
});

describe("Coverage — general-validators (validateUrl)", () => {
    it("accepts data:image URL", () => {
        const r = validateUrlValidator("data:image/png;base64,abc");
        expect(r.valid).toBe(true);
        expect(r.error).toBeNull();
    });
    it("rejects data: URL when allowDataImages false", () => {
        const r = validateUrlValidator("data:image/png;base64,x", { allowDataImages: false });
        expect(r.valid).toBe(false);
        expect(r.error).toBeDefined();
    });
    it("rejects non-image data: URL", () => {
        const r = validateUrlValidator("data:text/plain,hello");
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/Only data:image|not allowed/i);
    });
    it("returns invalid for empty string", () => {
        const r = validateUrlValidator("");
        expect(r.valid).toBe(false);
        expect(r.url).toBeNull();
    });
});
