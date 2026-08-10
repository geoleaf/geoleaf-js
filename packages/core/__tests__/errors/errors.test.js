/**
 *
 * Tests for Errors module — ESM, no global.GeoLeaf (migrated from legacy CJS bridge).
 */

const mockLog = vi.hoisted(() => ({
    error: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({
    Log: mockLog,
}));

import { Errors } from "../../src/utils/errors/errors.js";

describe("GeoLeaf.Errors Module", () => {
    beforeEach(() => {
        mockLog.error.mockClear();
    });

    describe("GeoLeafError (Base Class)", () => {
        test("should create basic error", () => {
            const error = new Errors.GeoLeafError("Test error");

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe("GeoLeafError");
            expect(error.message).toBe("Test error");
            expect(error.context).toEqual({});
            expect(error.timestamp).toBeDefined();
        });

        test("should include context", () => {
            const context = { field: "username", value: "test" };
            const error = new Errors.GeoLeafError("Test error", context);

            expect(error.context).toEqual(context);
        });

        test("should have timestamp", () => {
            const error = new Errors.GeoLeafError("Test error");
            const timestamp = new Date(error.timestamp);

            expect(timestamp).toBeInstanceOf(Date);
            expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
        });

        test("should convert to JSON", () => {
            const error = new Errors.GeoLeafError("Test error", { key: "value" });
            const json = error.toJSON();

            expect(json).toHaveProperty("name", "GeoLeafError");
            expect(json).toHaveProperty("message", "Test error");
            expect(json).toHaveProperty("context", { key: "value" });
            expect(json).toHaveProperty("timestamp");
            expect(json).toHaveProperty("stack");
        });

        test("should convert to string", () => {
            const error = new Errors.GeoLeafError("Test error", { key: "value" });
            const str = error.toString();

            expect(str).toContain("GeoLeafError");
            expect(str).toContain("Test error");
            expect(str).toContain("key");
        });

        test("should have stack trace", () => {
            const error = new Errors.GeoLeafError("Test error");

            expect(error.stack).toBeDefined();
            expect(error.stack).toContain("GeoLeafError");
        });
    });

    describe("ValidationError", () => {
        test("should create validation error", () => {
            const error = new Errors.ValidationError("Invalid input");

            expect(error).toBeInstanceOf(Errors.GeoLeafError);
            expect(error.name).toBe("ValidationError");
            expect(error.code).toBe("VALIDATION_ERROR");
            expect(error.message).toBe("Invalid input");
        });

        test("should include validation context", () => {
            const error = new Errors.ValidationError("Invalid coordinate", {
                field: "latitude",
                value: 91,
                expected: "Range: -90 to 90",
            });

            expect(error.context.field).toBe("latitude");
            expect(error.context.value).toBe(91);
        });
    });

    describe("SecurityError", () => {
        test("should create security error", () => {
            const error = new Errors.SecurityError("XSS detected");

            expect(error).toBeInstanceOf(Errors.GeoLeafError);
            expect(error.name).toBe("SecurityError");
            expect(error.code).toBe("SECURITY_ERROR");
        });

        test("should include security context", () => {
            // Intentional test data for SecurityError (dangerous URL pattern)
            const jsProto = "javascript" + ":";
            const error = new Errors.SecurityError("Invalid protocol", {
                url: jsProto + "alert(1)",
                protocol: jsProto,
                allowed: ["http:", "https:"],
            });

            expect(error.context.protocol).toBe(jsProto);
        });
    });

    describe("ConfigError", () => {
        test("should create config error", () => {
            const error = new Errors.ConfigError("Missing required config");

            expect(error.name).toBe("ConfigError");
            expect(error.code).toBe("CONFIG_ERROR");
        });
    });

    describe("NetworkError", () => {
        test("should create network error", () => {
            const error = new Errors.NetworkError("Failed to fetch");

            expect(error.name).toBe("NetworkError");
            expect(error.code).toBe("NETWORK_ERROR");
        });

        test("should include HTTP status", () => {
            const error = new Errors.NetworkError("HTTP 404", {
                status: 404,
                url: "https://example.com/api",
            });

            expect(error.context.status).toBe(404);
        });
    });

    describe("InitializationError", () => {
        test("should create initialization error", () => {
            const error = new Errors.InitializationError("Module failed to initialize");

            expect(error.name).toBe("InitializationError");
            expect(error.code).toBe("INITIALIZATION_ERROR");
        });
    });

    describe("MapError", () => {
        test("should create map error", () => {
            const error = new Errors.MapError("Invalid map instance");

            expect(error.name).toBe("MapError");
            expect(error.code).toBe("MAP_ERROR");
        });
    });

    describe("DataError", () => {
        test("should create data error", () => {
            const error = new Errors.DataError("Invalid GeoJSON");

            expect(error.name).toBe("DataError");
            expect(error.code).toBe("DATA_ERROR");
        });
    });

    describe("POIError", () => {
        test("should create POI error", () => {
            const error = new Errors.POIError("Invalid POI coordinates");

            expect(error.name).toBe("POIError");
            expect(error.code).toBe("POI_ERROR");
        });
    });

    describe("RouteError", () => {
        test("should create route error", () => {
            const error = new Errors.RouteError("Route calculation failed");

            expect(error.name).toBe("RouteError");
            expect(error.code).toBe("ROUTE_ERROR");
        });
    });

    describe("UIError", () => {
        test("should create UI error", () => {
            const error = new Errors.UIError("Element not found");

            expect(error.name).toBe("UIError");
            expect(error.code).toBe("UI_ERROR");
        });
    });

    describe("normalizeError", () => {
        test("should return Error as-is", () => {
            const original = new Error("Test");
            const normalized = Errors.normalizeError(original);

            expect(normalized).toBe(original);
        });

        test("should convert string to GeoLeafError", () => {
            const normalized = Errors.normalizeError("Error message");

            expect(normalized).toBeInstanceOf(Errors.GeoLeafError);
            expect(normalized.message).toBe("Error message");
        });

        test("should convert object to GeoLeafError", () => {
            const obj = { message: "Something went wrong", code: 500 };
            const normalized = Errors.normalizeError(obj);

            expect(normalized).toBeInstanceOf(Errors.GeoLeafError);
            expect(normalized.message).toBe("Something went wrong");
            expect(normalized.context.originalError).toBe(obj);
        });

        test("should use default message for unknown types", () => {
            const normalized = Errors.normalizeError(null);

            expect(normalized.message).toBe("An unknown error occurred");
        });

        test("should handle error objects without message", () => {
            const obj = { error: "Failed", status: 500 };
            const normalized = Errors.normalizeError(obj);

            expect(normalized.message).toBe("Failed");
        });
    });

    describe("isErrorType", () => {
        test("should correctly identify error type", () => {
            const error = new Errors.ValidationError("Test");

            expect(Errors.isErrorType(error, Errors.ValidationError)).toBe(true);
            expect(Errors.isErrorType(error, Errors.SecurityError)).toBe(false);
        });

        test("should work with base class", () => {
            const error = new Errors.ValidationError("Test");

            expect(Errors.isErrorType(error, Errors.GeoLeafError)).toBe(true);
        });
    });

    describe("getErrorCode", () => {
        test("should return error code", () => {
            const error = new Errors.ValidationError("Test");
            const code = Errors.getErrorCode(error);

            expect(code).toBe("VALIDATION_ERROR");
        });

        test("should return UNKNOWN_ERROR for objects without code", () => {
            const code = Errors.getErrorCode({ message: "Test" });

            expect(code).toBe("UNKNOWN_ERROR");
        });

        test("should return UNKNOWN_ERROR for primitives", () => {
            expect(Errors.getErrorCode(null)).toBe("UNKNOWN_ERROR");
            expect(Errors.getErrorCode("error")).toBe("UNKNOWN_ERROR");
        });
    });

    describe("createError", () => {
        test("should create error with proper stack trace", () => {
            const error = Errors.createError(Errors.ValidationError, "Test error", {
                field: "test",
            });

            expect(error).toBeInstanceOf(Errors.ValidationError);
            expect(error.message).toBe("Test error");
            expect(error.context.field).toBe("test");
            expect(error.stack).toBeDefined();
        });
    });

    describe("createErrorByType", () => {
        test("should create validation error from type string", () => {
            const error = Errors.createErrorByType("validation", "Invalid input");

            expect(error).toBeInstanceOf(Errors.ValidationError);
        });

        test("should create security error from type string", () => {
            const error = Errors.createErrorByType("security", "XSS detected");

            expect(error).toBeInstanceOf(Errors.SecurityError);
        });

        test("should create config error from type string", () => {
            const error = Errors.createErrorByType("config", "Missing config");

            expect(error).toBeInstanceOf(Errors.ConfigError);
        });

        test("should handle case-insensitive type", () => {
            const error = Errors.createErrorByType("VALIDATION", "Test");

            expect(error).toBeInstanceOf(Errors.ValidationError);
        });

        test("should default to GeoLeafError for unknown type", () => {
            const error = Errors.createErrorByType("unknown", "Test");

            expect(error).toBeInstanceOf(Errors.GeoLeafError);
            expect(error.name).toBe("GeoLeafError");
        });

        test("should include context", () => {
            const error = Errors.createErrorByType("validation", "Test", { field: "test" });

            expect(error.context.field).toBe("test");
        });
    });

    describe("safeErrorHandler", () => {
        test("should call error handler", () => {
            const handler = vi.fn();
            const error = new Error("Test");

            Errors.safeErrorHandler(handler, error);

            expect(handler).toHaveBeenCalledWith(error);
        });

        test("should catch errors in handler", () => {
            const handler = vi.fn(() => {
                throw new Error("Handler error");
            });
            const error = new Error("Original error");

            Errors.safeErrorHandler(handler, error);

            expect(handler).toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining("Error in error handler"),
                expect.any(Error)
            );
        });

        test("should log both errors when handler fails", () => {
            const handler = () => {
                throw new Error("Handler error");
            };
            const originalError = new Error("Original");

            Errors.safeErrorHandler(handler, originalError);

            expect(mockLog.error).toHaveBeenCalledTimes(2);
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining("Error in error handler"),
                expect.any(Error)
            );
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining("Original error"),
                originalError
            );
        });
    });

    describe("ErrorCodes", () => {
        test("should have all error codes defined", () => {
            expect(Errors.ErrorCodes.VALIDATION).toBe("VALIDATION_ERROR");
            expect(Errors.ErrorCodes.SECURITY).toBe("SECURITY_ERROR");
            expect(Errors.ErrorCodes.CONFIG).toBe("CONFIG_ERROR");
            expect(Errors.ErrorCodes.NETWORK).toBe("NETWORK_ERROR");
            expect(Errors.ErrorCodes.INITIALIZATION).toBe("INITIALIZATION_ERROR");
            expect(Errors.ErrorCodes.MAP).toBe("MAP_ERROR");
            expect(Errors.ErrorCodes.DATA).toBe("DATA_ERROR");
            expect(Errors.ErrorCodes.POI).toBe("POI_ERROR");
            expect(Errors.ErrorCodes.ROUTE).toBe("ROUTE_ERROR");
            expect(Errors.ErrorCodes.UI).toBe("UI_ERROR");
        });

        test("ErrorCodes should be frozen", () => {
            expect(Object.isFrozen(Errors.ErrorCodes)).toBe(true);

            const original = Errors.ErrorCodes.VALIDATION;
            try {
                Errors.ErrorCodes.VALIDATION = "CHANGED";
            } catch (_) {
                // In ESM strict mode, assignment to frozen property throws
            }
            expect(Errors.ErrorCodes.VALIDATION).toBe(original);
        });
    });

    describe("Error Inheritance", () => {
        test("all error types should inherit from GeoLeafError", () => {
            const errors = [
                new Errors.ValidationError("Test"),
                new Errors.SecurityError("Test"),
                new Errors.ConfigError("Test"),
                new Errors.NetworkError("Test"),
                new Errors.InitializationError("Test"),
                new Errors.MapError("Test"),
                new Errors.DataError("Test"),
                new Errors.POIError("Test"),
                new Errors.RouteError("Test"),
                new Errors.UIError("Test"),
            ];

            errors.forEach((error) => {
                expect(error).toBeInstanceOf(Errors.GeoLeafError);
                expect(error).toBeInstanceOf(Error);
            });
        });
    });
});
