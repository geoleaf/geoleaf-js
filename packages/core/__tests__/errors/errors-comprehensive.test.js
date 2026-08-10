/**
 * @file errors-comprehensive.test.js
 * Sprint 3.2 — Comprehensive tests for the Errors module
 */

import {
    GeoLeafError,
    ValidationError,
    SecurityError,
    ConfigError,
    NetworkError,
    InitializationError,
    MapError,
    DataError,
    POIError,
    RouteError,
    UIError,
    normalizeError,
    sanitizeErrorMessage,
    createErrorByType,
    safeErrorHandler,
    ErrorCodes,
} from "../../src/utils/errors/errors.js";

// ─────────────────────────────────────────
// 3.2.1  Error class hierarchy
// ─────────────────────────────────────────
const ERROR_TYPES = [
    { Cls: ValidationError, code: "VALIDATION_ERROR" },
    { Cls: SecurityError, code: "SECURITY_ERROR" },
    { Cls: ConfigError, code: "CONFIG_ERROR" },
    { Cls: NetworkError, code: "NETWORK_ERROR" },
    { Cls: InitializationError, code: "INITIALIZATION_ERROR" },
    { Cls: MapError, code: "MAP_ERROR" },
    { Cls: DataError, code: "DATA_ERROR" },
    { Cls: POIError, code: "POI_ERROR" },
    { Cls: RouteError, code: "ROUTE_ERROR" },
    { Cls: UIError, code: "UI_ERROR" },
];

describe("Error class hierarchy", () => {
    it("GeoLeafError is an instance of Error", () => {
        const err = new GeoLeafError("test");
        expect(err instanceof Error).toBe(true);
    });

    it("GeoLeafError has a valid ISO timestamp", () => {
        const err = new GeoLeafError("test");
        expect(() => new Date(err.timestamp)).not.toThrow();
        expect(new Date(err.timestamp).toISOString()).toBe(err.timestamp);
    });

    it("GeoLeafError.toJSON() returns a serialisable object", () => {
        const err = new GeoLeafError("test", { key: "value" });
        const json = err.toJSON();
        expect(json).toMatchObject({
            name: "GeoLeafError",
            message: "test",
            context: { key: "value" },
        });
        expect(() => JSON.stringify(json)).not.toThrow();
    });

    it("GeoLeafError.toString() includes context when present", () => {
        const err = new GeoLeafError("test", { id: 42 });
        expect(err.toString()).toContain("Context");
        expect(err.toString()).toContain("42");
    });

    it("GeoLeafError.toString() omits context section when empty", () => {
        const err = new GeoLeafError("test");
        expect(err.toString()).not.toContain("Context");
    });

    ERROR_TYPES.forEach(({ Cls, code }) => {
        describe(`${Cls.name}`, () => {
            it(`is instanceof GeoLeafError`, () => {
                expect(new Cls("msg") instanceof GeoLeafError).toBe(true);
            });

            it(`is instanceof Error`, () => {
                expect(new Cls("msg") instanceof Error).toBe(true);
            });

            it(`has name === "${Cls.name}"`, () => {
                expect(new Cls("msg").name).toBe(Cls.name);
            });

            it(`has code === "${code}"`, () => {
                expect(new Cls("msg").code).toBe(code);
            });

            it("has a valid ISO timestamp", () => {
                const err = new Cls("msg");
                expect(new Date(err.timestamp).toISOString()).toBe(err.timestamp);
            });

            it("toJSON() returns correct structure", () => {
                const err = new Cls("msg", { ctx: 1 });
                const json = err.toJSON();
                expect(json.name).toBe(Cls.name);
                expect(json.message).toBe("msg");
                expect(json.context).toEqual({ ctx: 1 });
                expect(typeof json.timestamp).toBe("string");
            });

            it("toString() includes context", () => {
                const err = new Cls("msg", { detail: "info" });
                expect(err.toString()).toContain("detail");
            });
        });
    });
});

// ─────────────────────────────────────────
// 3.2.2  Utility functions
// ─────────────────────────────────────────
describe("normalizeError()", () => {
    it("returns the same Error instance when passed an Error", () => {
        const e = new Error("raw");
        expect(normalizeError(e)).toBe(e);
    });

    it("wraps a string in GeoLeafError", () => {
        const err = normalizeError("something went wrong");
        expect(err instanceof GeoLeafError).toBe(true);
        expect(err.message).toBe("something went wrong");
    });

    it("wraps an object with a message field", () => {
        const err = normalizeError({ message: "obj error" });
        expect(err.message).toBe("obj error");
    });

    it("uses defaultMessage for null input", () => {
        const err = normalizeError(null, "fallback message");
        expect(err.message).toBe("fallback message");
    });

    it("uses defaultMessage for undefined input", () => {
        const err = normalizeError(undefined, "fallback");
        expect(err.message).toBe("fallback");
    });

    it('uses default "An unknown error occurred" when no fallback given', () => {
        const err = normalizeError(null);
        expect(err.message).toBe("An unknown error occurred");
    });
});

describe("sanitizeErrorMessage()", () => {
    it('returns "Unknown error" for null', () => {
        expect(sanitizeErrorMessage(null)).toBe("Unknown error");
    });

    it('returns "Unknown error" for undefined', () => {
        expect(sanitizeErrorMessage(undefined)).toBe("Unknown error");
    });

    it("escapes < and > in messages", () => {
        const result = sanitizeErrorMessage("<script>xss</script>");
        expect(result).not.toContain("<script>");
        expect(result).toContain("&lt;");
    });

    it("truncates messages longer than maxLength", () => {
        const long = "a".repeat(600);
        const result = sanitizeErrorMessage(long, 500);
        expect(result.length).toBeLessThanOrEqual(503); // 500 + "..."
        expect(result.endsWith("...")).toBe(true);
    });

    it("does not truncate messages within maxLength", () => {
        const msg = "short message";
        expect(sanitizeErrorMessage(msg)).toBe(msg);
    });

    it("converts non-string to string before sanitizing", () => {
        const result = sanitizeErrorMessage(42);
        expect(result).toBe("42");
    });
});

describe("createErrorByType()", () => {
    it('creates ValidationError for "validation"', () => {
        expect(createErrorByType("validation", "msg") instanceof ValidationError).toBe(true);
    });

    it('creates SecurityError for "security"', () => {
        expect(createErrorByType("security", "msg") instanceof SecurityError).toBe(true);
    });

    it('creates ConfigError for "config"', () => {
        expect(createErrorByType("config", "msg") instanceof ConfigError).toBe(true);
    });

    it('creates NetworkError for "network"', () => {
        expect(createErrorByType("network", "msg") instanceof NetworkError).toBe(true);
    });

    it('creates InitializationError for "initialization"', () => {
        expect(createErrorByType("initialization", "msg") instanceof InitializationError).toBe(
            true
        );
    });

    it('creates MapError for "map"', () => {
        expect(createErrorByType("map", "msg") instanceof MapError).toBe(true);
    });

    it('creates DataError for "data"', () => {
        expect(createErrorByType("data", "msg") instanceof DataError).toBe(true);
    });

    it('creates POIError for "poi"', () => {
        expect(createErrorByType("poi", "msg") instanceof POIError).toBe(true);
    });

    it('creates RouteError for "route"', () => {
        expect(createErrorByType("route", "msg") instanceof RouteError).toBe(true);
    });

    it('creates UIError for "ui"', () => {
        expect(createErrorByType("ui", "msg") instanceof UIError).toBe(true);
    });

    it("falls back to GeoLeafError for unknown type", () => {
        expect(createErrorByType("unknown_xyz", "msg") instanceof GeoLeafError).toBe(true);
    });

    it('is case-insensitive ("VALIDATION")', () => {
        expect(createErrorByType("VALIDATION", "msg") instanceof ValidationError).toBe(true);
    });
});

describe("safeErrorHandler()", () => {
    it("calls the handler with the error", () => {
        const handler = vi.fn();
        const err = new Error("test");
        safeErrorHandler(handler, err);
        expect(handler).toHaveBeenCalledWith(err);
    });

    it("does not throw when handler itself throws", () => {
        const throwingHandler = () => {
            throw new Error("handler crash");
        };
        expect(() => safeErrorHandler(throwingHandler, new Error("orig"))).not.toThrow();
    });

    it("does nothing when handler is not a function", () => {
        expect(() => safeErrorHandler(null, new Error("test"))).not.toThrow();
        expect(() => safeErrorHandler(42, new Error("test"))).not.toThrow();
    });
});

describe("ErrorCodes", () => {
    it("is frozen (immutable)", () => {
        expect(Object.isFrozen(ErrorCodes)).toBe(true);
    });

    it("has all 10 expected codes", () => {
        expect(Object.keys(ErrorCodes)).toHaveLength(10);
    });

    it('VALIDATION === "VALIDATION_ERROR"', () => {
        expect(ErrorCodes.VALIDATION).toBe("VALIDATION_ERROR");
    });
});
