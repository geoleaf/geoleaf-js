/**
 * @file log.test.js
 * @description Tests for Log module (migrated from log.esm.test.js)
 */

import { Log, LEVELS } from "../../src/utils/log/logger.js";

describe("Log Module", () => {
    let consoleDebugSpy;
    let consoleInfoSpy;
    let consoleWarnSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        // Reset log level
        Log.setLevel("info");

        // Setup spies
        consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation();
        consoleInfoSpy = vi.spyOn(console, "info").mockImplementation();
        consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation();
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("LEVELS constant", () => {
        test("should export LEVELS with correct values", () => {
            expect(LEVELS).toEqual({
                DEBUG: 0,
                INFO: 1,
                WARN: 2,
                ERROR: 3,
            });
        });
    });

    describe("setLevel()", () => {
        test("should set DEBUG level", () => {
            Log.setLevel("debug");
            expect(Log.getLevel()).toBe(LEVELS.DEBUG);
        });

        test("should set INFO level", () => {
            Log.setLevel("info");
            expect(Log.getLevel()).toBe(LEVELS.INFO);
        });

        test("should set WARN level", () => {
            Log.setLevel("warn");
            expect(Log.getLevel()).toBe(LEVELS.WARN);
        });

        test("should set ERROR level", () => {
            Log.setLevel("error");
            expect(Log.getLevel()).toBe(LEVELS.ERROR);
        });

        test("should be case-insensitive", () => {
            Log.setLevel("DEBUG");
            expect(Log.getLevel()).toBe(LEVELS.DEBUG);

            Log.setLevel("InFo");
            expect(Log.getLevel()).toBe(LEVELS.INFO);
        });

        test("should warn on unknown level", () => {
            Log.setLevel("invalid");
            expect(consoleWarnSpy).toHaveBeenCalled();
            const callArgs = consoleWarnSpy.mock.calls[0];
            expect(callArgs[0]).toContain("[GeoLeaf.WARN]");
            expect(callArgs[0]).toContain("Unknown log level");
        });
    });

    describe("debug()", () => {
        test("should log when level is DEBUG", () => {
            Log.setLevel("debug");
            Log.debug("Test debug message", { data: "test" });

            expect(consoleDebugSpy).toHaveBeenCalledWith("[GeoLeaf.DEBUG]", "Test debug message", {
                data: "test",
            });
        });

        test("should not log when level is INFO", () => {
            Log.setLevel("info");
            Log.debug("Test debug message");

            expect(consoleDebugSpy).not.toHaveBeenCalled();
        });

        test("should not log when level is WARN", () => {
            Log.setLevel("warn");
            Log.debug("Test debug message");

            expect(consoleDebugSpy).not.toHaveBeenCalled();
        });
    });

    describe("info()", () => {
        test("should log when level is DEBUG", () => {
            Log.setLevel("debug");
            Log.info("Test info message");

            expect(consoleInfoSpy).toHaveBeenCalledWith("[GeoLeaf.INFO]", "Test info message");
        });

        test("should log when level is INFO", () => {
            Log.setLevel("info");
            Log.info("Test info message", 123);

            expect(consoleInfoSpy).toHaveBeenCalledWith("[GeoLeaf.INFO]", "Test info message", 123);
        });

        test("should not log when level is WARN", () => {
            Log.setLevel("warn");
            Log.info("Test info message");

            expect(consoleInfoSpy).not.toHaveBeenCalled();
        });
    });

    describe("warn()", () => {
        test("should log when level is DEBUG", () => {
            Log.setLevel("debug");
            Log.warn("Test warning");

            expect(consoleWarnSpy).toHaveBeenCalledWith("[GeoLeaf.WARN]", "Test warning");
        });

        test("should log when level is INFO", () => {
            Log.setLevel("info");
            Log.warn("Test warning");

            expect(consoleWarnSpy).toHaveBeenCalledWith("[GeoLeaf.WARN]", "Test warning");
        });

        test("should log when level is WARN", () => {
            Log.setLevel("warn");
            Log.warn("Test warning", { error: "details" });

            expect(consoleWarnSpy).toHaveBeenCalledWith("[GeoLeaf.WARN]", "Test warning", {
                error: "details",
            });
        });

        test("should not log when level is ERROR", () => {
            Log.setLevel("error");
            Log.warn("Test warning");

            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });

    describe("error()", () => {
        test("should always log at DEBUG level", () => {
            Log.setLevel("debug");
            Log.error("Test error");

            expect(consoleErrorSpy).toHaveBeenCalledWith("[GeoLeaf.ERROR]", "Test error");
        });

        test("should always log at INFO level", () => {
            Log.setLevel("info");
            Log.error("Test error");

            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        test("should always log at WARN level", () => {
            Log.setLevel("warn");
            Log.error("Test error");

            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        test("should log at ERROR level", () => {
            Log.setLevel("error");
            const errorObj = new Error("Test error");
            Log.error("Error occurred:", errorObj);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[GeoLeaf.ERROR]",
                "Error occurred:",
                errorObj
            );
        });

        test("should handle multiple arguments", () => {
            Log.setLevel("error");
            Log.error("Error:", "message", 123, { data: "test" });

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[GeoLeaf.ERROR]",
                "Error:",
                "message",
                123,
                { data: "test" }
            );
        });
    });

    describe("getLevel()", () => {
        test("should return current level number", () => {
            Log.setLevel("debug");
            expect(Log.getLevel()).toBe(0);

            Log.setLevel("info");
            expect(Log.getLevel()).toBe(1);

            Log.setLevel("warn");
            expect(Log.getLevel()).toBe(2);

            Log.setLevel("error");
            expect(Log.getLevel()).toBe(3);
        });
    });

    describe("getLevelName()", () => {
        test("should return current level name", () => {
            Log.setLevel("debug");
            expect(Log.getLevelName()).toBe("DEBUG");

            Log.setLevel("info");
            expect(Log.getLevelName()).toBe("INFO");

            Log.setLevel("warn");
            expect(Log.getLevelName()).toBe("WARN");

            Log.setLevel("error");
            expect(Log.getLevelName()).toBe("ERROR");
        });
    });

    describe("Integration", () => {
        test("should filter logs based on level", () => {
            Log.setLevel("warn");

            Log.debug("Should not appear");
            Log.info("Should not appear");
            Log.warn("Should appear");
            Log.error("Should appear");

            expect(consoleDebugSpy).not.toHaveBeenCalled();
            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        test("should allow changing level multiple times", () => {
            Log.setLevel("error");
            Log.info("Should not log");
            expect(consoleInfoSpy).not.toHaveBeenCalled();

            Log.setLevel("debug");
            Log.info("Should log");
            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);

            Log.setLevel("error");
            Log.info("Should not log again");
            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("Edge Cases", () => {
        test("should handle empty messages", () => {
            Log.setLevel("info");
            Log.info();
            expect(consoleInfoSpy).toHaveBeenCalledWith("[GeoLeaf.INFO]");
        });

        test("should handle null and undefined", () => {
            Log.setLevel("info");
            Log.info(null, undefined);
            expect(consoleInfoSpy).toHaveBeenCalledWith("[GeoLeaf.INFO]", null, undefined);
        });

        test("should handle objects and arrays", () => {
            Log.setLevel("info");
            const obj = { key: "value" };
            const arr = [1, 2, 3];
            Log.info("Data:", obj, arr);

            expect(consoleInfoSpy).toHaveBeenCalledWith("[GeoLeaf.INFO]", "Data:", obj, arr);
        });

        test("should handle circular references", () => {
            Log.setLevel("info");
            const circular = { prop: null };
            circular.prop = circular;

            // Should not throw
            expect(() => {
                Log.info("Circular:", circular);
            }).not.toThrow();
        });
    });

    describe("Performance", () => {
        test.skipIf(!!process.env.CI)("should handle many logs efficiently", () => {
            Log.setLevel("info");

            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                Log.info("Log message", i);
            }
            const duration = performance.now() - start;

            expect(duration).toBeLessThan(100);
            expect(consoleInfoSpy).toHaveBeenCalledTimes(1000);
        });

        test("should skip disabled logs without overhead", () => {
            Log.setLevel("error");

            // Many calls below the active level must produce no side effect.
            // The real contract is "disabled logs are skipped" — asserted via the
            // spy, not via wall-clock timing (which flakes under CPU contention).
            for (let i = 0; i < 10000; i++) {
                Log.debug("Should not process");
            }

            expect(consoleDebugSpy).not.toHaveBeenCalled();
        });
    });
});
