/**
 *
 * Tests complets pour Errors module — ESM, no global.GeoLeaf (migrated from legacy CJS bridge).
 */

const mockLog = vi.hoisted(() => ({
    error: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({
    Log: mockLog,
}));

import { Errors } from "../../src/utils/errors/errors.js";

describe("GeoLeaf.Errors", () => {
    beforeEach(() => {
        mockLog.error.mockClear();
    });

    // ========================================
    //   Module Structure
    // ========================================

    describe("Module Structure", () => {
        it("should expose Errors facade with all exports", () => {
            expect(Errors).toBeDefined();
        });

        it("should expose GeoLeafError base class", () => {
            expect(Errors.GeoLeafError).toBeDefined();
        });

        it("should expose ValidationError class", () => {
            expect(Errors.ValidationError).toBeDefined();
        });

        it("should expose SecurityError class", () => {
            expect(Errors.SecurityError).toBeDefined();
        });

        it("should expose ConfigError class", () => {
            expect(Errors.ConfigError).toBeDefined();
        });

        it("should expose NetworkError class", () => {
            expect(Errors.NetworkError).toBeDefined();
        });

        it("should expose InitializationError class", () => {
            expect(Errors.InitializationError).toBeDefined();
        });

        it("should expose MapError class", () => {
            expect(Errors.MapError).toBeDefined();
        });

        it("should expose DataError class", () => {
            expect(Errors.DataError).toBeDefined();
        });

        it("should expose POIError class", () => {
            expect(Errors.POIError).toBeDefined();
        });

        it("should expose RouteError class", () => {
            expect(Errors.RouteError).toBeDefined();
        });

        it("should expose UIError class", () => {
            expect(Errors.UIError).toBeDefined();
        });

        it("should expose utility functions", () => {
            expect(typeof Errors.normalizeError).toBe("function");
            expect(typeof Errors.isErrorType).toBe("function");
            expect(typeof Errors.getErrorCode).toBe("function");
            expect(typeof Errors.createError).toBe("function");
            expect(typeof Errors.createErrorByType).toBe("function");
            expect(typeof Errors.safeErrorHandler).toBe("function");
        });

        it("should expose ErrorCodes enum", () => {
            expect(Errors.ErrorCodes).toBeDefined();
        });

        it("should have frozen ErrorCodes", () => {
            expect(Object.isFrozen(Errors.ErrorCodes)).toBe(true);
        });
    });

    // ========================================
    //   GeoLeafError Base Class
    // ========================================

    describe("GeoLeafError", () => {
        it("should extend Error", () => {
            const error = new Errors.GeoLeafError("test");
            expect(error instanceof Error).toBe(true);
        });

        it("should set message", () => {
            const error = new Errors.GeoLeafError("Test message");
            expect(error.message).toBe("Test message");
        });

        it("should set name to constructor name", () => {
            const error = new Errors.GeoLeafError("test");
            expect(error.name).toBe("GeoLeafError");
        });

        it("should set timestamp", () => {
            const error = new Errors.GeoLeafError("test");
            expect(error.timestamp).toBeDefined();
            expect(typeof error.timestamp).toBe("string");
        });

        it("should set context with default empty object", () => {
            const error = new Errors.GeoLeafError("test");
            expect(error.context).toEqual({});
        });

        it("should set custom context", () => {
            const context = { key: "value", count: 42 };
            const error = new Errors.GeoLeafError("test", context);
            expect(error.context).toEqual(context);
        });

        it("should have stack trace", () => {
            const error = new Errors.GeoLeafError("test");
            expect(error.stack).toBeDefined();
        });

        describe("toJSON()", () => {
            it("should return JSON representation", () => {
                const error = new Errors.GeoLeafError("Test error", { key: "value" });
                const json = error.toJSON();

                expect(json.name).toBe("GeoLeafError");
                expect(json.message).toBe("Test error");
                expect(json.context).toEqual({ key: "value" });
                expect(json.timestamp).toBeDefined();
                expect(json.stack).toBeDefined();
            });
        });

        describe("toString()", () => {
            it("should return formatted string without context", () => {
                const error = new Errors.GeoLeafError("Test error");
                expect(error.toString()).toBe("GeoLeafError: Test error");
            });

            it("should return formatted string with context", () => {
                const error = new Errors.GeoLeafError("Test error", { key: "value" });
                const str = error.toString();
                expect(str).toContain("GeoLeafError: Test error");
                expect(str).toContain("Context:");
                expect(str).toContain("key");
            });
        });
    });

    // ========================================
    //   Specific Error Classes
    // ========================================

    describe("ValidationError", () => {
        it("should extend GeoLeafError", () => {
            const error = new Errors.ValidationError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });

        it("should have VALIDATION_ERROR code", () => {
            const error = new Errors.ValidationError("test");
            expect(error.code).toBe("VALIDATION_ERROR");
        });

        it("should set name correctly", () => {
            const error = new Errors.ValidationError("test");
            expect(error.name).toBe("ValidationError");
        });

        it("should accept context", () => {
            const error = new Errors.ValidationError("test", { field: "email" });
            expect(error.context.field).toBe("email");
        });
    });

    describe("SecurityError", () => {
        it("should have SECURITY_ERROR code", () => {
            const error = new Errors.SecurityError("XSS detected");
            expect(error.code).toBe("SECURITY_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.SecurityError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    describe("ConfigError", () => {
        it("should have CONFIG_ERROR code", () => {
            const error = new Errors.ConfigError("Missing config");
            expect(error.code).toBe("CONFIG_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.ConfigError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    describe("NetworkError", () => {
        it("should have NETWORK_ERROR code", () => {
            const error = new Errors.NetworkError("Network timeout");
            expect(error.code).toBe("NETWORK_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.NetworkError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    describe("InitializationError", () => {
        it("should have INITIALIZATION_ERROR code", () => {
            const error = new Errors.InitializationError("Init failed");
            expect(error.code).toBe("INITIALIZATION_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.InitializationError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    describe("MapError", () => {
        it("should have MAP_ERROR code", () => {
            const error = new Errors.MapError("Map not found");
            expect(error.code).toBe("MAP_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.MapError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    describe("DataError", () => {
        it("should have DATA_ERROR code", () => {
            const error = new Errors.DataError("Invalid GeoJSON");
            expect(error.code).toBe("DATA_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.DataError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    describe("POIError", () => {
        it("should have POI_ERROR code", () => {
            const error = new Errors.POIError("Invalid POI");
            expect(error.code).toBe("POI_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.POIError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    describe("RouteError", () => {
        it("should have ROUTE_ERROR code", () => {
            const error = new Errors.RouteError("Route not found");
            expect(error.code).toBe("ROUTE_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.RouteError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    describe("UIError", () => {
        it("should have UI_ERROR code", () => {
            const error = new Errors.UIError("Element not found");
            expect(error.code).toBe("UI_ERROR");
        });

        it("should extend GeoLeafError", () => {
            const error = new Errors.UIError("test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });
    });

    // ========================================
    //   Utility Functions
    // ========================================

    describe("normalizeError()", () => {
        it("should return Error instance unchanged", () => {
            const original = new Error("Original error");
            const result = Errors.normalizeError(original);
            expect(result).toBe(original);
        });

        it("should return GeoLeafError instance unchanged", () => {
            const original = new Errors.ValidationError("Validation failed");
            const result = Errors.normalizeError(original);
            expect(result).toBe(original);
        });

        it("should convert string to GeoLeafError", () => {
            const result = Errors.normalizeError("String error message");
            expect(result instanceof Errors.GeoLeafError).toBe(true);
            expect(result.message).toBe("String error message");
        });

        it("should convert object with message to GeoLeafError", () => {
            const result = Errors.normalizeError({ message: "Object error" });
            expect(result instanceof Errors.GeoLeafError).toBe(true);
            expect(result.message).toBe("Object error");
        });

        it("should convert object with error field to GeoLeafError", () => {
            const result = Errors.normalizeError({ error: "Error field" });
            expect(result.message).toBe("Error field");
        });

        it("should use default message for unknown values", () => {
            const result = Errors.normalizeError(null);
            expect(result.message).toBe("An unknown error occurred");
        });

        it("should allow custom default message", () => {
            const result = Errors.normalizeError(undefined, "Custom default");
            expect(result.message).toBe("Custom default");
        });

        it("should preserve original error in context for objects", () => {
            const original = { foo: "bar" };
            const result = Errors.normalizeError(original);
            expect(result.context.originalError).toBe(original);
        });
    });

    describe("isErrorType()", () => {
        it("should return true for matching error type", () => {
            const error = new Errors.ValidationError("test");
            expect(Errors.isErrorType(error, Errors.ValidationError)).toBe(true);
        });

        it("should return false for non-matching error type", () => {
            const error = new Errors.ValidationError("test");
            expect(Errors.isErrorType(error, Errors.SecurityError)).toBe(false);
        });

        it("should return true for parent class", () => {
            const error = new Errors.ValidationError("test");
            expect(Errors.isErrorType(error, Errors.GeoLeafError)).toBe(true);
        });

        it("should return true for Error base class", () => {
            const error = new Errors.ValidationError("test");
            expect(Errors.isErrorType(error, Error)).toBe(true);
        });
    });

    describe("getErrorCode()", () => {
        it("should return code from GeoLeaf error", () => {
            const error = new Errors.ValidationError("test");
            expect(Errors.getErrorCode(error)).toBe("VALIDATION_ERROR");
        });

        it("should return code from object with code property", () => {
            const obj = { code: "CUSTOM_CODE" };
            expect(Errors.getErrorCode(obj)).toBe("CUSTOM_CODE");
        });

        it("should return UNKNOWN_ERROR for objects without code", () => {
            const obj = { message: "error" };
            expect(Errors.getErrorCode(obj)).toBe("UNKNOWN_ERROR");
        });

        it("should return UNKNOWN_ERROR for null", () => {
            expect(Errors.getErrorCode(null)).toBe("UNKNOWN_ERROR");
        });

        it("should return UNKNOWN_ERROR for undefined", () => {
            expect(Errors.getErrorCode(undefined)).toBe("UNKNOWN_ERROR");
        });
    });

    describe("createError()", () => {
        it("should create error of specified class", () => {
            const error = Errors.createError(Errors.ValidationError, "Test message");
            expect(error instanceof Errors.ValidationError).toBe(true);
        });

        it("should set message", () => {
            const error = Errors.createError(Errors.SecurityError, "Security issue");
            expect(error.message).toBe("Security issue");
        });

        it("should set context", () => {
            const error = Errors.createError(Errors.ConfigError, "Config error", {
                file: "config.json",
            });
            expect(error.context.file).toBe("config.json");
        });
    });

    describe("createErrorByType()", () => {
        it("should create ValidationError for validation type", () => {
            const error = Errors.createErrorByType("validation", "Test");
            expect(error instanceof Errors.ValidationError).toBe(true);
        });

        it("should create SecurityError for security type", () => {
            const error = Errors.createErrorByType("security", "Test");
            expect(error instanceof Errors.SecurityError).toBe(true);
        });

        it("should create ConfigError for config type", () => {
            const error = Errors.createErrorByType("config", "Test");
            expect(error instanceof Errors.ConfigError).toBe(true);
        });

        it("should create NetworkError for network type", () => {
            const error = Errors.createErrorByType("network", "Test");
            expect(error instanceof Errors.NetworkError).toBe(true);
        });

        it("should create InitializationError for initialization type", () => {
            const error = Errors.createErrorByType("initialization", "Test");
            expect(error instanceof Errors.InitializationError).toBe(true);
        });

        it("should create MapError for map type", () => {
            const error = Errors.createErrorByType("map", "Test");
            expect(error instanceof Errors.MapError).toBe(true);
        });

        it("should create DataError for data type", () => {
            const error = Errors.createErrorByType("data", "Test");
            expect(error instanceof Errors.DataError).toBe(true);
        });

        it("should create POIError for poi type", () => {
            const error = Errors.createErrorByType("poi", "Test");
            expect(error instanceof Errors.POIError).toBe(true);
        });

        it("should create RouteError for route type", () => {
            const error = Errors.createErrorByType("route", "Test");
            expect(error instanceof Errors.RouteError).toBe(true);
        });

        it("should create UIError for ui type", () => {
            const error = Errors.createErrorByType("ui", "Test");
            expect(error instanceof Errors.UIError).toBe(true);
        });

        it("should be case insensitive", () => {
            const error = Errors.createErrorByType("VALIDATION", "Test");
            expect(error instanceof Errors.ValidationError).toBe(true);
        });

        it("should create GeoLeafError for unknown type", () => {
            const error = Errors.createErrorByType("unknown", "Test");
            expect(error instanceof Errors.GeoLeafError).toBe(true);
        });

        it("should pass context through", () => {
            const error = Errors.createErrorByType("validation", "Test", { field: "name" });
            expect(error.context.field).toBe("name");
        });
    });

    describe("safeErrorHandler()", () => {
        it("should call handler with error", () => {
            const handler = vi.fn();
            const error = new Error("Test error");

            Errors.safeErrorHandler(handler, error);

            expect(handler).toHaveBeenCalledWith(error);
        });

        it("should not throw when handler throws", () => {
            const handler = vi.fn(() => {
                throw new Error("Handler error");
            });
            const error = new Error("Original error");

            expect(() => {
                Errors.safeErrorHandler(handler, error);
            }).not.toThrow();
        });

        it("should log via Log when handler throws", () => {
            const handler = vi.fn(() => {
                throw new Error("Handler error");
            });
            const error = new Error("Original error");

            Errors.safeErrorHandler(handler, error);

            expect(mockLog.error).toHaveBeenCalled();
        });
    });

    // ========================================
    //   ErrorCodes
    // ========================================

    describe("ErrorCodes", () => {
        it("should have VALIDATION code", () => {
            expect(Errors.ErrorCodes.VALIDATION).toBe("VALIDATION_ERROR");
        });

        it("should have SECURITY code", () => {
            expect(Errors.ErrorCodes.SECURITY).toBe("SECURITY_ERROR");
        });

        it("should have CONFIG code", () => {
            expect(Errors.ErrorCodes.CONFIG).toBe("CONFIG_ERROR");
        });

        it("should have NETWORK code", () => {
            expect(Errors.ErrorCodes.NETWORK).toBe("NETWORK_ERROR");
        });

        it("should have INITIALIZATION code", () => {
            expect(Errors.ErrorCodes.INITIALIZATION).toBe("INITIALIZATION_ERROR");
        });

        it("should have MAP code", () => {
            expect(Errors.ErrorCodes.MAP).toBe("MAP_ERROR");
        });

        it("should have DATA code", () => {
            expect(Errors.ErrorCodes.DATA).toBe("DATA_ERROR");
        });

        it("should have POI code", () => {
            expect(Errors.ErrorCodes.POI).toBe("POI_ERROR");
        });

        it("should have ROUTE code", () => {
            expect(Errors.ErrorCodes.ROUTE).toBe("ROUTE_ERROR");
        });

        it("should have UI code", () => {
            expect(Errors.ErrorCodes.UI).toBe("UI_ERROR");
        });
    });

    // ========================================
    //   Error Throwing and Catching
    // ========================================

    describe("Error Throwing and Catching", () => {
        it("should be catchable by specific type", () => {
            let caught = false;
            try {
                throw new Errors.ValidationError("Invalid input");
            } catch (e) {
                if (e instanceof Errors.ValidationError) {
                    caught = true;
                }
            }
            expect(caught).toBe(true);
        });

        it("should be catchable by parent type", () => {
            let caught = false;
            try {
                throw new Errors.SecurityError("Security issue");
            } catch (e) {
                if (e instanceof Errors.GeoLeafError) {
                    caught = true;
                }
            }
            expect(caught).toBe(true);
        });

        it("should be catchable as Error", () => {
            let caught = false;
            try {
                throw new Errors.ConfigError("Config issue");
            } catch (e) {
                if (e instanceof Error) {
                    caught = true;
                }
            }
            expect(caught).toBe(true);
        });
    });
});
