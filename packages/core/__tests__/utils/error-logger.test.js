/**
 */
// Tests for modules/utils/error-logger.ts - Phase R0 branch recovery

const LogMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: LogMock }));

import { ErrorLogger } from "../../src/utils/log/error-logger.js";

describe("ErrorLogger", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("debug calls Log.debug when available", () => {
        ErrorLogger.debug("Mod", "test message");
        expect(LogMock.debug).toHaveBeenCalledWith(expect.stringContaining("test message"));
    });

    it("debug falls back to console.debug when Log.debug is not a function", () => {
        const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
        const origDebug = LogMock.debug;
        LogMock.debug = undefined;
        ErrorLogger.debug("Mod", "fallback test");
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("fallback test"));
        LogMock.debug = origDebug;
        consoleSpy.mockRestore();
    });

    it("error calls Log.error with message and stack", () => {
        const err = new Error("test");
        ErrorLogger.error("Mod", "oops", err);
        expect(LogMock.error).toHaveBeenCalledWith(expect.stringContaining("oops"), err);
    });

    it("warn calls Log.warn", () => {
        ErrorLogger.warn("Mod", "warning");
        expect(LogMock.warn).toHaveBeenCalledWith(expect.stringContaining("warning"));
    });

    it("info calls Log.info", () => {
        ErrorLogger.info("Mod", "info msg");
        expect(LogMock.info).toHaveBeenCalledWith(expect.stringContaining("info msg"));
    });

    // ─── Extended methods (lines 61-109) ──────────────────────────────────────

    it("quotaError logs a formatted quota exceeded message", () => {
        ErrorLogger.quotaError("Mod", 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
        expect(LogMock.error).toHaveBeenCalledWith(
            expect.stringContaining("QUOTA EXCEEDED"),
            undefined
        );
    });

    it("networkError logs the URL and status", () => {
        ErrorLogger.networkError("Mod", "https://example.com/data", 404);
        expect(LogMock.error).toHaveBeenCalledWith(
            expect.stringContaining("Network error [404]"),
            undefined
        );
    });

    it("networkError forwards the error object", () => {
        const err = new Error("timeout");
        ErrorLogger.networkError("Mod", "https://example.com", 500, err);
        expect(LogMock.error).toHaveBeenCalledWith(expect.any(String), err);
    });

    it("validationError logs a validation warning", () => {
        ErrorLogger.validationError("Mod", "email", "user@example.com");
        expect(LogMock.warn).toHaveBeenCalledWith(expect.stringContaining("Validation error"));
    });

    it("idbError logs an IndexedDB error", () => {
        const err = new Error("idb-fail");
        ErrorLogger.idbError("Mod", "get", err);
        expect(LogMock.error).toHaveBeenCalledWith(
            expect.stringContaining("IndexedDB error (get)"),
            err
        );
    });

    it("performance logs a performance info message", () => {
        ErrorLogger.performance("Mod", "load", 123);
        expect(LogMock.info).toHaveBeenCalledWith(
            expect.stringContaining("load completed in 123ms")
        );
    });

    it("memoryWarning logs a memory warning", () => {
        ErrorLogger.memoryWarning("Mod", 512);
        expect(LogMock.warn).toHaveBeenCalledWith(expect.stringContaining("512MB"));
    });

    describe("operation context", () => {
        it("success() logs info and returns result", () => {
            const ctx = ErrorLogger.operation("Mod", "fetch");
            const result = ctx.success("data");
            expect(result).toBe("data");
            expect(LogMock.info).toHaveBeenCalledWith(expect.stringContaining("fetch succeeded"));
        });

        it("error() logs error and rethrows", () => {
            const ctx = ErrorLogger.operation("Mod", "save");
            const err = new Error("save-fail");
            expect(() => ctx.error(err)).toThrow("save-fail");
            expect(LogMock.error).toHaveBeenCalledWith(expect.stringContaining("save failed"), err);
        });

        it("warn() logs a warning", () => {
            const ctx = ErrorLogger.operation("Mod", "parse");
            ctx.warn("unexpected token");
            expect(LogMock.warn).toHaveBeenCalledWith(expect.stringContaining("parse warning"));
        });
    });
});
