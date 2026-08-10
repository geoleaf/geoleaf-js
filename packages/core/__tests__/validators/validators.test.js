/**
 */

// Tests for GeoLeaf.Validators module

describe("GeoLeaf.Validators", () => {
    let Validators;

    beforeEach(async () => {
        // Mock GeoLeaf namespace with Errors
        global.GeoLeaf = {
            Errors: {
                ValidationError: class ValidationError extends Error {
                    constructor(message, details) {
                        super(message);
                        this.name = "ValidationError";
                        this.details = details;
                    }
                },
                SecurityError: class SecurityError extends Error {
                    constructor(message, details) {
                        super(message);
                        this.name = "SecurityError";
                        this.details = details;
                    }
                },
                ConfigError: class ConfigError extends Error {
                    constructor(message, details) {
                        super(message);
                        this.name = "ConfigError";
                        this.details = details;
                    }
                },
            },
        };

        vi.resetModules();
        // Phase 7 B11: capture named export and attach to global (facades don't mutate global)
        const validatorsModule = await import("../../src/api/geoleaf.validators.js");
        Validators = validatorsModule.Validators || global.GeoLeaf.Validators;
        if (Validators) global.GeoLeaf.Validators = Validators;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("validateCoordinates()", () => {
        it("should return valid for valid coordinates", () => {
            const result = Validators.validateCoordinates(48.8566, 2.3522);

            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should return invalid for non-number lat", () => {
            const result = Validators.validateCoordinates("48.8566", 2.3522);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("must be numbers");
        });

        it("should return invalid for non-number lng", () => {
            const result = Validators.validateCoordinates(48.8566, "2.3522");

            expect(result.valid).toBe(false);
            expect(result.error).toContain("must be numbers");
        });

        it("should return invalid for NaN coordinates", () => {
            const result = Validators.validateCoordinates(NaN, 2.3522);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("finite numbers");
        });

        it("should return invalid for Infinity", () => {
            const result = Validators.validateCoordinates(Infinity, 2.3522);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("finite numbers");
        });

        it("should return invalid for out-of-range latitude (> 90)", () => {
            const result = Validators.validateCoordinates(95, 2.3522);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("Latitude");
        });

        it("should return invalid for out-of-range latitude (< -90)", () => {
            const result = Validators.validateCoordinates(-95, 2.3522);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("Latitude");
        });

        it("should return invalid for out-of-range longitude (> 180)", () => {
            const result = Validators.validateCoordinates(48.8566, 200);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("Longitude");
        });

        it("should return invalid for out-of-range longitude (< -180)", () => {
            const result = Validators.validateCoordinates(48.8566, -200);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("Longitude");
        });

        it("should throw when throwOnError is true", () => {
            expect(() => {
                Validators.validateCoordinates("invalid", 2.3522, { throwOnError: true });
            }).toThrow();
        });

        it("should accept edge case coordinates", () => {
            expect(Validators.validateCoordinates(90, 180).valid).toBe(true);
            expect(Validators.validateCoordinates(-90, -180).valid).toBe(true);
            expect(Validators.validateCoordinates(0, 0).valid).toBe(true);
        });
    });

    describe("validateUrl()", () => {
        it("should return valid for https URL", () => {
            const result = Validators.validateUrl("https://example.com/path");

            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should return valid for http URL", () => {
            const result = Validators.validateUrl("http://example.com/path");

            expect(result.valid).toBe(true);
        });

        it("should return invalid for empty URL", () => {
            const result = Validators.validateUrl("");

            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should return invalid for null URL", () => {
            const result = Validators.validateUrl(null);

            expect(result.valid).toBe(false);
        });

        it("should return invalid for non-string URL", () => {
            const result = Validators.validateUrl(123);

            expect(result.valid).toBe(false);
        });

        it("should return valid for data:image URL", () => {
            const result = Validators.validateUrl("data:image/png;base64,abc123");

            expect(result.valid).toBe(true);
        });

        it("should accept data:image URL with allowDataImages true", () => {
            const result = Validators.validateUrl("data:image/png;base64,abc123", {
                allowDataImages: true,
            });

            expect(result.valid).toBe(true);
        });

        it("should throw when throwOnError is true", () => {
            expect(() => {
                Validators.validateUrl("", { throwOnError: true });
            }).toThrow();
        });
    });

    describe("validateEmail()", () => {
        it("should return valid for valid email", () => {
            const result = Validators.validateEmail("test@example.com");

            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should return invalid for empty email", () => {
            const result = Validators.validateEmail("");

            expect(result.valid).toBe(false);
            expect(result.error).toContain("non-empty string");
        });

        it("should return invalid for email without @", () => {
            const result = Validators.validateEmail("testexample.com");

            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid email");
        });

        it("should return invalid for email without domain", () => {
            const result = Validators.validateEmail("test@");

            expect(result.valid).toBe(false);
        });

        it("should return invalid for email without TLD", () => {
            const result = Validators.validateEmail("test@example");

            expect(result.valid).toBe(false);
        });

        it("should throw when throwOnError is true", () => {
            expect(() => {
                Validators.validateEmail("invalid", { throwOnError: true });
            }).toThrow();
        });
    });

    describe("validatePhone()", () => {
        it("should return valid for valid phone number", () => {
            const result = Validators.validatePhone("+33 1 23 45 67 89");

            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should return valid for phone with digits only", () => {
            const result = Validators.validatePhone("0123456789");

            expect(result.valid).toBe(true);
        });

        it("should return invalid for empty phone", () => {
            const result = Validators.validatePhone("");

            expect(result.valid).toBe(false);
        });

        it("should return invalid for phone with letters", () => {
            const result = Validators.validatePhone("123abc456");

            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid phone format");
        });

        it("should return invalid for phone with less than 10 digits", () => {
            const result = Validators.validatePhone("123456");

            expect(result.valid).toBe(false);
            expect(result.error).toContain("10 digits");
        });

        it("should throw when throwOnError is true", () => {
            expect(() => {
                Validators.validatePhone("", { throwOnError: true });
            }).toThrow();
        });
    });

    describe("validateZoom()", () => {
        it("should return valid for valid zoom level", () => {
            const result = Validators.validateZoom(10);

            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("should return valid for edge zoom levels", () => {
            expect(Validators.validateZoom(0).valid).toBe(true);
            expect(Validators.validateZoom(20).valid).toBe(true);
        });

        it("should return invalid for non-number zoom", () => {
            const result = Validators.validateZoom("10");

            expect(result.valid).toBe(false);
            expect(result.error).toContain("must be a number");
        });

        it("should return invalid for NaN zoom", () => {
            const result = Validators.validateZoom(NaN);

            expect(result.valid).toBe(false);
        });

        it("should return invalid for zoom > 20", () => {
            const result = Validators.validateZoom(25);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("between");
        });

        it("should return invalid for zoom < 0", () => {
            const result = Validators.validateZoom(-1);

            expect(result.valid).toBe(false);
        });

        it("should accept custom min/max", () => {
            const result = Validators.validateZoom(25, { min: 0, max: 30 });

            expect(result.valid).toBe(true);
        });

        it("should throw when throwOnError is true", () => {
            expect(() => {
                Validators.validateZoom("invalid", { throwOnError: true });
            }).toThrow();
        });
    });

    // Note: validateConfig and validatePoi may not be exposed on the public API

    describe("Module exposure", () => {
        it("should expose Validators on GeoLeaf namespace", () => {
            expect(global.GeoLeaf.Validators).toBeDefined();
        });

        it("should expose core validation functions", () => {
            expect(typeof Validators.validateCoordinates).toBe("function");
            expect(typeof Validators.validateUrl).toBe("function");
            expect(typeof Validators.validateEmail).toBe("function");
            expect(typeof Validators.validatePhone).toBe("function");
            expect(typeof Validators.validateZoom).toBe("function");
        });
    });
});
