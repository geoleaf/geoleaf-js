/**
 * Tests for Validators module (ESM)
 * Validation functions for coordinates, URLs, emails, etc.
 */

import {
    validateCoordinates,
    validateUrl,
    validateEmail,
    validatePhone,
    validateZoom,
    validateRequiredFields,
    validateGeoJSON,
    validateColor,
    validateBatch,
    Validators,
} from "../../src/utils/validators/general-validators.js";
import { validateUrl as securityValidateUrl } from "../../src/kernel/security/index.js";

describe("Validators ↔ Security — shared data: whitelist (KERNEL S10)", () => {
    // The two validators stay DELIBERATELY distinct: different return shapes,
    // different option surfaces (allowedProtocols[] vs httpsOnly). Full
    // delegation is not possible. What they must share is the verdict on
    // `data:` MIME types — that divergence was a real security hole.
    const cases = [
        ["image/bmp", false],
        ["image/x-icon", false],
        ["text/html", false],
        ["image/png", true],
        ["image/svg+xml", true],
    ];

    it.each(cases)("agrees on data:%s (allowed: %s)", (mime, allowed) => {
        const url = `data:${mime};base64,abc`;

        // general-validators: result object, never throws by default
        expect(validateUrl(url).valid).toBe(allowed);

        // security: returns the href, throws on rejection
        if (allowed) {
            expect(typeof securityValidateUrl(url)).toBe("string");
        } else {
            expect(() => securityValidateUrl(url)).toThrow();
        }
    });
});

describe("Validators - Coordinates", () => {
    describe("validateCoordinates", () => {
        it("should validate valid coordinates", () => {
            const result = validateCoordinates(45.5, -73.5);
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should reject non-number latitude", () => {
            const result = validateCoordinates("45.5", -73.5);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("must be numbers");
        });

        it("should reject non-number longitude", () => {
            const result = validateCoordinates(45.5, "-73.5");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("must be numbers");
        });

        it("should reject NaN coordinates", () => {
            const result = validateCoordinates(NaN, -73.5);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("finite numbers");
        });

        it("should reject Infinity coordinates", () => {
            const result = validateCoordinates(Infinity, -73.5);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("finite numbers");
        });

        it("should reject latitude out of range (too high)", () => {
            const result = validateCoordinates(91, -73.5);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("between -90 and 90");
        });

        it("should reject latitude out of range (too low)", () => {
            const result = validateCoordinates(-91, -73.5);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("between -90 and 90");
        });

        it("should reject longitude out of range (too high)", () => {
            const result = validateCoordinates(45.5, 181);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("between -180 and 180");
        });

        it("should reject longitude out of range (too low)", () => {
            const result = validateCoordinates(45.5, -181);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("between -180 and 180");
        });

        it("should throw error when throwOnError is true", () => {
            expect(() => validateCoordinates("invalid", -73.5, { throwOnError: true })).toThrow(
                "must be numbers"
            );
        });

        it("should validate edge cases (poles and dateline)", () => {
            expect(validateCoordinates(90, 180).valid).toBe(true);
            expect(validateCoordinates(-90, -180).valid).toBe(true);
            expect(validateCoordinates(0, 0).valid).toBe(true);
        });
    });
});

describe("Validators - URL", () => {
    describe("validateUrl", () => {
        it("should validate HTTP URL", () => {
            const result = validateUrl("http://example.com");
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
            expect(result.url).toContain("example.com");
        });

        it("should validate HTTPS URL", () => {
            const result = validateUrl("https://example.com");
            expect(result.valid).toBe(true);
        });

        it("should reject empty URL", () => {
            const result = validateUrl("");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should reject non-string URL", () => {
            const result = validateUrl(123);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should validate data:image URL when allowed", () => {
            const dataUrl =
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";
            const result = validateUrl(dataUrl, { allowDataImages: true });
            expect(result.valid).toBe(true);
        });

        it("should reject data:image URL when not allowed", () => {
            const dataUrl = "data:image/png;base64,test";
            const result = validateUrl(dataUrl, { allowDataImages: false });
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Data URLs are not allowed");
        });

        it("should reject data:text URL", () => {
            const dataUrl = "data:text/plain;base64,test";
            const result = validateUrl(dataUrl);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Only data:image URLs");
        });

        // ── KERNEL S10 — coherence with built-in/security ──

        it("should reject an image subtype outside the shared whitelist", () => {
            // Was accepted before S10: this validator prefix-tested `image/`
            // while security.validateUrl matched an exact 6-MIME whitelist, so
            // the same URL got opposite verdicts depending on the entry point.
            const result = validateUrl("data:image/bmp;base64,abc");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Only data:image URLs");
        });

        it.each([
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/gif",
            "image/svg+xml",
            "image/webp",
        ])("should accept whitelisted type %s carrying an encoding parameter", (mime) => {
            // Guards the MIME parser: the pre-S10 extraction stopped at the
            // first `,` only, yielding `image/png;base64` — invisible to a
            // prefix test, fatal against an exact whitelist.
            expect(validateUrl(`data:${mime};base64,abc`).valid).toBe(true);
        });

        it("should resolve a relative URL against the real origin", () => {
            // Was `http://dummy.com` hardcoded: a validator returned an invented
            // domain in `result.url` for any relative input.
            const result = validateUrl("/api/data.json");
            expect(result.valid).toBe(true);
            expect(result.url).not.toContain("dummy.com");
            expect(result.url).toBe(`${globalThis.location.origin}/api/data.json`);
        });

        it("should reject FTP protocol by default", () => {
            const result = validateUrl("ftp://example.com");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("not allowed");
        });

        it("should allow custom protocols", () => {
            const result = validateUrl("ftp://example.com", {
                allowedProtocols: ["http:", "https:", "ftp:"],
            });
            expect(result.valid).toBe(true);
        });

        it("should throw error when throwOnError is true", () => {
            expect(() => validateUrl("", { throwOnError: true })).toThrow("non-empty string");
        });
    });
});

describe("Validators - Email", () => {
    describe("validateEmail", () => {
        it("should validate correct email", () => {
            const result = validateEmail("test@example.com");
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should validate email with subdomain", () => {
            const result = validateEmail("user@mail.example.com");
            expect(result.valid).toBe(true);
        });

        it("should reject email without @", () => {
            const result = validateEmail("testexample.com");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid email format");
        });

        it("should reject email without domain", () => {
            const result = validateEmail("test@");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid email format");
        });

        it("should reject email without user", () => {
            const result = validateEmail("@example.com");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid email format");
        });

        it("should reject email with spaces", () => {
            const result = validateEmail("test @example.com");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid email format");
        });

        it("should reject empty email", () => {
            const result = validateEmail("");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should reject non-string email", () => {
            const result = validateEmail(123);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should throw error when throwOnError is true", () => {
            expect(() => validateEmail("invalid", { throwOnError: true })).toThrow(
                "Invalid email format"
            );
        });
    });
});

describe("Validators - Phone", () => {
    describe("validatePhone", () => {
        it("should validate phone with spaces", () => {
            const result = validatePhone("555 123 4567");
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should validate phone with dashes", () => {
            const result = validatePhone("555-123-4567");
            expect(result.valid).toBe(true);
        });

        it("should validate phone with parentheses", () => {
            const result = validatePhone("(555) 123-4567");
            expect(result.valid).toBe(true);
        });

        it("should validate international phone with +", () => {
            const result = validatePhone("+1 555 123 4567");
            expect(result.valid).toBe(true);
        });

        it("should reject phone with letters", () => {
            const result = validatePhone("555-CALL-NOW");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid phone format");
        });

        it("should reject phone with too few digits", () => {
            const result = validatePhone("555-1234");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("at least 10 digits");
        });

        it("should reject empty phone", () => {
            const result = validatePhone("");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should reject non-string phone", () => {
            const result = validatePhone(5551234567);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should throw error when throwOnError is true", () => {
            expect(() => validatePhone("123", { throwOnError: true })).toThrow(
                "at least 10 digits"
            );
        });
    });
});

describe("Validators - Zoom", () => {
    describe("validateZoom", () => {
        it("should validate zoom within default range", () => {
            const result = validateZoom(10);
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should validate min zoom (0)", () => {
            const result = validateZoom(0);
            expect(result.valid).toBe(true);
        });

        it("should validate max zoom (20)", () => {
            const result = validateZoom(20);
            expect(result.valid).toBe(true);
        });

        it("should reject zoom below min", () => {
            const result = validateZoom(-1);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("between 0 and 20");
        });

        it("should reject zoom above max", () => {
            const result = validateZoom(21);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("between 0 and 20");
        });

        it("should support custom min/max", () => {
            const result = validateZoom(25, { min: 5, max: 30 });
            expect(result.valid).toBe(true);
        });

        it("should reject non-number zoom", () => {
            const result = validateZoom("10");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("must be a number");
        });

        it("should reject NaN zoom", () => {
            const result = validateZoom(NaN);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("finite number");
        });

        it("should reject Infinity zoom", () => {
            const result = validateZoom(Infinity);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("finite number");
        });

        it("should throw error when throwOnError is true", () => {
            expect(() => validateZoom(-1, { throwOnError: true })).toThrow("between 0 and 20");
        });
    });
});

describe("Validators - Required Fields", () => {
    describe("validateRequiredFields", () => {
        it("should validate config with all required fields", () => {
            const config = { name: "test", id: 123, enabled: true };
            const result = validateRequiredFields(config, ["name", "id"]);
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
            expect(result.missing).toEqual([]);
        });

        it("should reject config missing required fields", () => {
            const config = { name: "test" };
            const result = validateRequiredFields(config, ["name", "id", "enabled"]);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Missing required fields");
            expect(result.missing).toEqual(["id", "enabled"]);
        });

        it("should reject fields with null value", () => {
            const config = { name: "test", id: null };
            const result = validateRequiredFields(config, ["name", "id"]);
            expect(result.valid).toBe(false);
            expect(result.missing).toContain("id");
        });

        it("should reject fields with undefined value", () => {
            const config = { name: "test", id: undefined };
            const result = validateRequiredFields(config, ["name", "id"]);
            expect(result.valid).toBe(false);
            expect(result.missing).toContain("id");
        });

        it("should accept fields with falsy but defined values", () => {
            const config = { name: "", count: 0, enabled: false };
            const result = validateRequiredFields(config, ["name", "count", "enabled"]);
            expect(result.valid).toBe(true);
        });

        it("should reject null config", () => {
            const result = validateRequiredFields(null, ["name"]);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Config must be an object");
        });

        it("should reject non-object config", () => {
            const result = validateRequiredFields("config", ["name"]);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Config must be an object");
        });

        it("should throw error when throwOnError is true", () => {
            expect(() => validateRequiredFields({}, ["name"], { throwOnError: true })).toThrow(
                "Missing required fields"
            );
        });
    });
});

describe("Validators - GeoJSON", () => {
    describe("validateGeoJSON", () => {
        it("should validate Point geometry", () => {
            const geojson = {
                type: "Point",
                coordinates: [0, 0],
            };
            const result = validateGeoJSON(geojson);
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should validate Feature", () => {
            const geojson = {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [0, 0],
                },
                properties: {},
            };
            const result = validateGeoJSON(geojson);
            expect(result.valid).toBe(true);
        });

        it("should validate FeatureCollection", () => {
            const geojson = {
                type: "FeatureCollection",
                features: [],
            };
            const result = validateGeoJSON(geojson);
            expect(result.valid).toBe(true);
        });

        it("should reject non-object GeoJSON", () => {
            const result = validateGeoJSON("geojson");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("must be an object");
        });

        it("should reject GeoJSON without type", () => {
            const geojson = { coordinates: [0, 0] };
            const result = validateGeoJSON(geojson);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("must have a type field");
        });

        it("should reject invalid GeoJSON type", () => {
            const geojson = { type: "InvalidType" };
            const result = validateGeoJSON(geojson);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid GeoJSON type");
        });

        it("should reject Feature without geometry", () => {
            const geojson = {
                type: "Feature",
                properties: {},
            };
            const result = validateGeoJSON(geojson);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("must have a geometry");
        });

        it("should reject FeatureCollection without features array", () => {
            const geojson = {
                type: "FeatureCollection",
            };
            const result = validateGeoJSON(geojson);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("must have a features array");
        });

        it("should validate all geometry types", () => {
            const types = [
                "Point",
                "MultiPoint",
                "LineString",
                "MultiLineString",
                "Polygon",
                "MultiPolygon",
                "GeometryCollection",
            ];

            types.forEach((type) => {
                const geojson = { type, coordinates: [] };
                const result = validateGeoJSON(geojson);
                expect(result.valid).toBe(true);
            });
        });

        it("should throw error when throwOnError is true", () => {
            expect(() => validateGeoJSON(null, { throwOnError: true })).toThrow(
                "must be an object"
            );
        });
    });
});

describe("Validators - Color", () => {
    describe("validateColor", () => {
        it("should validate hex color (6 digits)", () => {
            const result = validateColor("#FF5733");
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should validate hex color (3 digits)", () => {
            const result = validateColor("#F53");
            expect(result.valid).toBe(true);
        });

        it("should validate rgb color", () => {
            const result = validateColor("rgb(255, 87, 51)");
            expect(result.valid).toBe(true);
        });

        it("should validate rgba color", () => {
            const result = validateColor("rgba(255, 87, 51, 0.5)");
            expect(result.valid).toBe(true);
        });

        it("should reject invalid hex color", () => {
            const result = validateColor("#GGGGGG");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid color format");
        });

        it("should reject invalid rgb color", () => {
            const result = validateColor("rgb(255, 87)");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid color format");
        });

        it("should reject empty color", () => {
            const result = validateColor("");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should reject non-string color", () => {
            const result = validateColor(123);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should throw error when throwOnError is true", () => {
            expect(() => validateColor("invalid", { throwOnError: true })).toThrow(
                "Invalid color format"
            );
        });
    });
});

describe("Validators - Batch", () => {
    describe("validateBatch", () => {
        it("should validate all passing validations", () => {
            const validations = [
                { value: "test@example.com", validator: validateEmail, label: "Email" },
                { value: 10, validator: validateZoom, label: "Zoom" },
                { value: "555-123-4567", validator: validatePhone, label: "Phone" },
            ];

            const result = validateBatch(validations);
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should collect errors from failing validations", () => {
            const validations = [
                { value: "invalid-email", validator: validateEmail, label: "Email" },
                { value: -1, validator: validateZoom, label: "Zoom" },
                { value: "555-CALL", validator: validatePhone, label: "Phone" },
            ];

            const result = validateBatch(validations);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBe(3);
            expect(result.errors[0]).toContain("Email:");
            expect(result.errors[1]).toContain("Zoom:");
            expect(result.errors[2]).toContain("Phone:");
        });

        it("should handle mix of passing and failing validations", () => {
            const validations = [
                { value: "test@example.com", validator: validateEmail, label: "Email" },
                { value: -1, validator: validateZoom, label: "Zoom" },
            ];

            const result = validateBatch(validations);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toContain("Zoom:");
        });

        it("should handle invalid validator", () => {
            const validations = [{ value: "test", validator: "not-a-function", label: "Test" }];

            const result = validateBatch(validations);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain("Invalid validator for Test");
        });

        it("should use default label if not provided", () => {
            const validations = [{ value: "invalid", validator: validateEmail }];

            const result = validateBatch(validations);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain("value:");
        });

        it("should pass custom options to validators", () => {
            const validations = [
                {
                    value: 25,
                    validator: validateZoom,
                    options: { min: 5, max: 30 },
                    label: "CustomZoom",
                },
            ];

            const result = validateBatch(validations);
            expect(result.valid).toBe(true);
        });
    });
});

describe("Validators - Namespace Export", () => {
    it("should export all validators in Validators namespace", () => {
        expect(Validators.validateCoordinates).toBe(validateCoordinates);
        expect(Validators.validateUrl).toBe(validateUrl);
        expect(Validators.validateEmail).toBe(validateEmail);
        expect(Validators.validatePhone).toBe(validatePhone);
        expect(Validators.validateZoom).toBe(validateZoom);
        expect(Validators.validateRequiredFields).toBe(validateRequiredFields);
        expect(Validators.validateGeoJSON).toBe(validateGeoJSON);
        expect(Validators.validateColor).toBe(validateColor);
        expect(Validators.validateBatch).toBe(validateBatch);
    });
});
