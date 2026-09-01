/**
 * @file validators-comprehensive.test.js
 * Comprehensive tests for general-validators
 */

import {
    validateCoordinates,
    validateUrl,
    validateEmail,
    validatePhone,
    validateZoom,
    validateGeoJSON,
    validateColor,
    validateBatch,
} from "../../src/utils/validators/general-validators.js";

// ─────────────────────────────────────────
// 3.4.1  general-validators
// ─────────────────────────────────────────

describe("validateCoordinates()", () => {
    it("returns valid for correct coordinates", () => {
        expect(validateCoordinates(48.8566, 2.3522).valid).toBe(true);
    });

    it("returns invalid for latitude out of range (> 90)", () => {
        expect(validateCoordinates(91, 0).valid).toBe(false);
    });

    it("returns invalid for latitude out of range (< -90)", () => {
        expect(validateCoordinates(-91, 0).valid).toBe(false);
    });

    it("returns invalid for longitude out of range (> 180)", () => {
        expect(validateCoordinates(0, 181).valid).toBe(false);
    });

    it("returns invalid for longitude out of range (< -180)", () => {
        expect(validateCoordinates(0, -181).valid).toBe(false);
    });

    it("returns invalid for NaN latitude", () => {
        expect(validateCoordinates(NaN, 0).valid).toBe(false);
    });

    it("returns invalid for Infinity longitude", () => {
        expect(validateCoordinates(0, Infinity).valid).toBe(false);
    });

    it("returns invalid for string inputs", () => {
        expect(validateCoordinates("48", "2").valid).toBe(false);
    });

    it("throws when throwOnError is true", () => {
        expect(() => validateCoordinates(91, 0, { throwOnError: true })).toThrow();
    });

    it("accepts boundary values 90, 180", () => {
        expect(validateCoordinates(90, 180).valid).toBe(true);
    });

    it("accepts boundary values -90, -180", () => {
        expect(validateCoordinates(-90, -180).valid).toBe(true);
    });
});

describe("validateUrl() [validator]", () => {
    it("accepts https:// URL", () => {
        expect(validateUrl("https://example.com").valid).toBe(true);
    });

    it("accepts http:// URL", () => {
        expect(validateUrl("http://example.com").valid).toBe(true);
    });

    it("blocks javascript: protocol", () => {
        expect(validateUrl("javascript:alert(1)").valid).toBe(false);
    });

    it("blocks ftp:// protocol", () => {
        expect(validateUrl("ftp://server.com").valid).toBe(false);
    });

    it("returns invalid for empty string", () => {
        expect(validateUrl("").valid).toBe(false);
    });

    it("returns invalid for null", () => {
        expect(validateUrl(null).valid).toBe(false);
    });

    it("returns invalid for non-string", () => {
        expect(validateUrl(42).valid).toBe(false);
    });

    it("throws when throwOnError and URL is invalid", () => {
        expect(() => validateUrl("javascript:bad()", { throwOnError: true })).toThrow();
    });
});

describe("validateEmail()", () => {
    it("accepts a valid email", () => {
        expect(validateEmail("user@example.com").valid).toBe(true);
    });

    it("accepts email with subdomain", () => {
        expect(validateEmail("user@mail.example.co.uk").valid).toBe(true);
    });

    it("rejects email without @", () => {
        expect(validateEmail("userexample.com").valid).toBe(false);
    });

    it("rejects email without TLD", () => {
        expect(validateEmail("user@example").valid).toBe(false);
    });

    it("rejects empty string", () => {
        expect(validateEmail("").valid).toBe(false);
    });

    it("rejects null", () => {
        expect(validateEmail(null).valid).toBe(false);
    });
});

describe("validatePhone()", () => {
    it("accepts a standard French number", () => {
        expect(validatePhone("+33 6 12 34 56 78").valid).toBe(true);
    });

    it("accepts North American format", () => {
        expect(validatePhone("(514) 555-1234").valid).toBe(true);
    });

    it("rejects a number with less than 10 digits", () => {
        expect(validatePhone("123").valid).toBe(false);
    });

    it("rejects a string with letters", () => {
        expect(validatePhone("not-a-phone").valid).toBe(false);
    });

    it("rejects null", () => {
        expect(validatePhone(null).valid).toBe(false);
    });
});

describe("validateZoom()", () => {
    it("accepts zoom 0", () => {
        expect(validateZoom(0).valid).toBe(true);
    });

    it("accepts zoom 20", () => {
        expect(validateZoom(20).valid).toBe(true);
    });

    it("accepts zoom 12", () => {
        expect(validateZoom(12).valid).toBe(true);
    });

    it("rejects zoom 21 (above max)", () => {
        expect(validateZoom(21).valid).toBe(false);
    });

    it("rejects zoom -1 (below min)", () => {
        expect(validateZoom(-1).valid).toBe(false);
    });

    it("rejects NaN", () => {
        expect(validateZoom(NaN).valid).toBe(false);
    });

    it("rejects Infinity", () => {
        expect(validateZoom(Infinity).valid).toBe(false);
    });

    it('rejects string "12"', () => {
        expect(validateZoom("12").valid).toBe(false);
    });
});

describe("validateGeoJSON()", () => {
    it("accepts a valid Point feature", () => {
        const gj = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 48] },
            properties: {},
        };
        expect(validateGeoJSON(gj).valid).toBe(true);
    });

    it("accepts a FeatureCollection with features array", () => {
        const gj = { type: "FeatureCollection", features: [] };
        expect(validateGeoJSON(gj).valid).toBe(true);
    });

    it("rejects object without type", () => {
        expect(validateGeoJSON({ coordinates: [0, 0] }).valid).toBe(false);
    });

    it("rejects object with invalid type", () => {
        expect(validateGeoJSON({ type: "Banana" }).valid).toBe(false);
    });

    it("rejects Feature without geometry", () => {
        expect(validateGeoJSON({ type: "Feature", properties: {} }).valid).toBe(false);
    });

    it("rejects FeatureCollection without features array", () => {
        expect(validateGeoJSON({ type: "FeatureCollection" }).valid).toBe(false);
    });

    it("rejects null", () => {
        expect(validateGeoJSON(null).valid).toBe(false);
    });
});

describe("validateColor()", () => {
    it("accepts 6-digit hex #aabbcc", () => {
        expect(validateColor("#aabbcc").valid).toBe(true);
    });

    it("accepts 3-digit hex #abc", () => {
        expect(validateColor("#abc").valid).toBe(true);
    });

    it("accepts rgb() format", () => {
        expect(validateColor("rgb(255, 0, 0)").valid).toBe(true);
    });

    it("accepts rgba() format", () => {
        expect(validateColor("rgba(255, 0, 0, 0.5)").valid).toBe(true);
    });

    it('rejects invalid string "notacolor"', () => {
        expect(validateColor("notacolor").valid).toBe(false);
    });

    it("rejects empty string", () => {
        expect(validateColor("").valid).toBe(false);
    });

    it("rejects null", () => {
        expect(validateColor(null).valid).toBe(false);
    });
});

describe("validateBatch()", () => {
    it("returns valid when all validations pass", () => {
        const result = validateBatch([
            { value: "user@example.com", validator: validateEmail, label: "email" },
            { value: 12, validator: validateZoom, label: "zoom" },
        ]);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("returns invalid and collects errors when some fail", () => {
        const result = validateBatch([
            { value: "bad-email", validator: validateEmail, label: "email" },
            { value: 12, validator: validateZoom, label: "zoom" },
        ]);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("email");
    });
});
