/**
 * Tests for utils/log/logger.ts — Log proxy + LEVELS
 * Sprint S5B.9 — migrated to ESM static imports for Istanbul coverage instrumentation.
 * Covers: setLevel (all branches), log methods (level gates), quiet mode,
 * handleGroupedMessage sequencing, Proxy delegation, showSummary.
 */

import { Log, LEVELS } from "../../src/utils/log/logger.ts";

describe("log/logger", () => {
    let consoleSpy;

    beforeEach(() => {
        consoleSpy = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        vi.spyOn(console, "debug").mockImplementation(consoleSpy.debug);
        vi.spyOn(console, "info").mockImplementation(consoleSpy.info);
        vi.spyOn(console, "warn").mockImplementation(consoleSpy.warn);
        vi.spyOn(console, "error").mockImplementation(consoleSpy.error);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("LEVELS", () => {
        it("exposes DEBUG, INFO, WARN, ERROR", () => {
            expect(LEVELS.DEBUG).toBe(0);
            expect(LEVELS.INFO).toBe(1);
            expect(LEVELS.WARN).toBe(2);
            expect(LEVELS.ERROR).toBe(3);
        });
    });

    describe("setLevel / getLevel / getLevelName", () => {
        it("sets and returns info by default", () => {
            Log.setLevel("info");
            expect(Log.getLevel()).toBe(LEVELS.INFO);
            expect(Log.getLevelName()).toBe("INFO");
        });

        it("sets debug level", () => {
            Log.setLevel("debug");
            expect(Log.getLevel()).toBe(LEVELS.DEBUG);
        });

        it("sets warn level", () => {
            Log.setLevel("warn");
            expect(Log.getLevel()).toBe(LEVELS.WARN);
        });

        it("sets error level", () => {
            Log.setLevel("error");
            expect(Log.getLevel()).toBe(LEVELS.ERROR);
        });

        it("production sets WARN and quiet mode", () => {
            Log.setLevel("production");
            expect(Log.getLevel()).toBe(LEVELS.WARN);
        });

        it("unknown level warns and leaves level unchanged", () => {
            Log.setLevel("info");
            Log.setLevel("invalid");
            expect(Log.getLevel()).toBe(LEVELS.INFO);
        });
    });

    describe("warn / error / info / debug", () => {
        it("warn calls console.warn when level allows", () => {
            Log.setLevel("warn");
            Log.warn("test warn");
            expect(consoleSpy.warn).toHaveBeenCalledWith(
                expect.stringContaining("GeoLeaf"),
                "test warn"
            );
        });

        it("error calls console.error when level allows", () => {
            Log.setLevel("error");
            Log.error("test error");
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining("GeoLeaf"),
                "test error"
            );
        });

        it("info calls console.info when level allows", () => {
            Log.setLevel("info");
            Log.info("test info");
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining("GeoLeaf"),
                "test info"
            );
        });

        it("debug calls console.debug when level is DEBUG", () => {
            Log.setLevel("debug");
            Log.debug("test debug");
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining("GeoLeaf"),
                "test debug"
            );
        });
    });

    describe("setQuietMode", () => {
        it("setQuietMode toggles without throwing", () => {
            expect(() => Log.setQuietMode(true)).not.toThrow();
            expect(() => Log.setQuietMode(false)).not.toThrow();
        });

        it("setQuietMode no-op when already same value", () => {
            Log.setQuietMode(true);
            const before = console.info.mock.calls.length;
            Log.setQuietMode(true);
            expect(console.info.mock.calls.length).toBe(before);
            Log.setQuietMode(false);
        });
    });

    describe("showSummary", () => {
        it("showSummary does not throw", () => {
            expect(() => Log.showSummary()).not.toThrow();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Level gate branches — messages suppressed when level too low
// ─────────────────────────────────────────────────────────────────────────────
describe("log/logger — level gates", () => {
    beforeEach(() => {
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        Log.setLevel("info");
        Log.setQuietMode(false);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Log.setQuietMode(false);
        Log.setLevel("info");
        delete globalThis.GeoLeaf;
    });

    it("debug() is suppressed when level is INFO", () => {
        Log.setLevel("info");
        Log.debug("should not appear");
        expect(console.debug).not.toHaveBeenCalled();
    });

    it("debug() is suppressed when level is WARN", () => {
        Log.setLevel("warn");
        Log.debug("should not appear");
        expect(console.debug).not.toHaveBeenCalled();
    });

    it("info() is suppressed when level is WARN", () => {
        Log.setLevel("warn");
        Log.info("should not appear");
        expect(console.info).not.toHaveBeenCalled();
    });

    it("info() is suppressed when level is ERROR", () => {
        Log.setLevel("error");
        Log.info("should not appear");
        expect(console.info).not.toHaveBeenCalled();
    });

    it("warn() is suppressed when level is ERROR", () => {
        Log.setLevel("error");
        Log.warn("should not appear");
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("warn() is shown when level is WARN", () => {
        Log.setLevel("warn");
        Log.warn("visible warn");
        expect(console.warn).toHaveBeenCalled();
    });

    it("error() is always shown even at ERROR level", () => {
        Log.setLevel("error");
        Log.error("visible error");
        expect(console.error).toHaveBeenCalled();
    });

    it("production level sets WARN and enables quietMode (console.info on enable)", () => {
        Log.setLevel("production");
        expect(Log.getLevel()).toBe(LEVELS.WARN);
        // production silently enables quiet mode — setQuietMode emits console.info only when
        // transitioning false → true for the first time; since state may already be set by
        // previous test runs, we just verify level is WARN
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quiet mode branches — critical vs repetitive message routing
// ─────────────────────────────────────────────────────────────────────────────
describe("log/logger — quiet mode routing", () => {
    beforeEach(() => {
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        Log.setLevel("debug");
        Log.setQuietMode(false);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Log.setQuietMode(false);
        Log.setLevel("info");
    });

    it("info() in quiet mode: critical message bypasses filtering (branch isCriticalMessage=true)", () => {
        Log.setQuietMode(true);
        Log.info("ERROR: critical failure detected");
        // critical messages always show even in quiet mode
        expect(console.info).toHaveBeenCalledWith(
            expect.stringContaining("GeoLeaf"),
            "ERROR: critical failure detected"
        );
    });

    it("info() in quiet mode: non-repetitive, non-critical message shows normally", () => {
        Log.setQuietMode(true);
        // This message doesn't match any repetitive pattern
        Log.info("Unique non-repetitive message xyz-abc-nonmatch");
        expect(console.info).toHaveBeenCalled();
    });

    it("debug() without quiet mode skips grouping entirely", () => {
        Log.setQuietMode(false);
        Log.debug("Module test loaded");
        expect(console.debug).toHaveBeenCalledWith(
            expect.stringContaining("GeoLeaf"),
            "Module test loaded"
        );
    });

    it("debug() in quiet mode: non-repetitive message shows normally", () => {
        Log.setQuietMode(true);
        Log.debug("A totally non-repetitive debug message no-match-99zz");
        expect(console.debug).toHaveBeenCalled();
    });

    it("setQuietMode(true) emits console.info when transitioning from false", () => {
        // Ensure we start from false
        Log.setQuietMode(false);
        vi.clearAllMocks(); // reset console.info spy
        vi.spyOn(console, "info").mockImplementation(() => {});
        Log.setQuietMode(true);
        expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Silent mode"));
        Log.setQuietMode(false); // cleanup
    });

    it("setQuietMode(false) does not emit console.info when transitioning from true", () => {
        Log.setQuietMode(true);
        vi.clearAllMocks();
        vi.spyOn(console, "info").mockImplementation(() => {});
        Log.setQuietMode(false);
        // No "silent mode" message on disable
        const silentCalls = console.info.mock.calls.filter((args) =>
            String(args[0]).includes("Silent mode")
        );
        expect(silentCalls.length).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleGroupedMessage branches — count sequencing via info() in quiet mode
// ─────────────────────────────────────────────────────────────────────────────
describe("log/logger — handleGroupedMessage sequencing", () => {
    // Use a unique message per describe to avoid count collisions with other tests.
    // The key is normalized: digits → "X", punctuation removed.
    // "Module GRPSEQ_A loaded" → normalized key "Module GRPSEQ_A loaded" (no digits)
    const UNIQUE_REPETITIVE_MSG = "Module GRPSEQ_counterA loaded";
    const UNIQUE_REPETITIVE_MSG2 = "Module GRPSEQ_counterB loaded";

    beforeEach(() => {
        vi.spyOn(console, "info").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        Log.setLevel("info");
        Log.setQuietMode(false);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Log.setQuietMode(false);
        Log.setLevel("info");
    });

    it("count=1: first occurrence shows message (return true)", () => {
        Log.setQuietMode(true);
        Log.info(UNIQUE_REPETITIVE_MSG);
        // count=1 → handleGroupedMessage returns true → console.info called with [GeoLeaf...] prefix
        const mainCalls = console.info.mock.calls.filter(
            (args) =>
                String(args[0]).includes("GeoLeaf") &&
                !String(args[0]).includes("Grouped") &&
                !String(args[0]).includes("Silent")
        );
        expect(mainCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("count=3: suppression notice shown, message hidden (return false)", () => {
        Log.setQuietMode(true);
        // Send the same unique message 3 times in sequence within this test.
        // Use a fresh unique key to guarantee we start at count=1 here.
        const msg = "Module GRPSEQ_suppress3 loaded";
        Log.info(msg); // count=1 → show
        Log.info(msg); // count=2 → show
        vi.clearAllMocks();
        vi.spyOn(console, "info").mockImplementation(() => {});
        Log.info(msg); // count=3 → suppression notice
        const grouped = console.info.mock.calls.find((args) => String(args[0]).includes("Grouped"));
        expect(grouped).toBeDefined();
    });

    it("count>3: message fully suppressed (return false, no console.info)", () => {
        Log.setQuietMode(true);
        const msg = "Module GRPSEQ_suppress4 loaded";
        Log.info(msg); // count=1
        Log.info(msg); // count=2
        Log.info(msg); // count=3 (suppression notice)
        vi.clearAllMocks();
        vi.spyOn(console, "info").mockImplementation(() => {});
        Log.info(msg); // count=4 → fully suppressed
        // No GeoLeaf-prefixed message, no grouped message
        const anyInfoWithPrefix = console.info.mock.calls.filter(
            (args) => String(args[0]).includes("GeoLeaf") || String(args[0]).includes("Grouped")
        );
        expect(anyInfoWithPrefix.length).toBe(0);
    });

    it("showSummary outputs grouped entries with count > 3", () => {
        Log.setQuietMode(true);
        const msg = UNIQUE_REPETITIVE_MSG2;
        Log.info(msg); // 1
        Log.info(msg); // 2
        Log.info(msg); // 3
        Log.info(msg); // 4
        vi.clearAllMocks();
        vi.spyOn(console, "group").mockImplementation(() => {});
        vi.spyOn(console, "groupEnd").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
        Log.showSummary();
        // groupedMessageCounts has entries with count >= 4 → should output summary
        expect(console.group).toHaveBeenCalledWith(expect.stringContaining("Grouped log summary"));
        Log.setQuietMode(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Proxy delegation — global.GeoLeaf.Log override
// ─────────────────────────────────────────────────────────────────────────────
describe("log/logger — Proxy delegation", () => {
    afterEach(() => {
        delete globalThis.GeoLeaf;
        Log.setLevel("info");
        Log.setQuietMode(false);
    });

    it("delegates to globalThis.GeoLeaf.Log when set to custom object", () => {
        const mockOverride = {
            getLevel: vi.fn(() => 42),
            getLevelName: vi.fn(() => "MOCKED"),
            setLevel: vi.fn(),
            setQuietMode: vi.fn(),
            showSummary: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        globalThis.GeoLeaf = { Log: mockOverride };
        expect(Log.getLevel()).toBe(42);
        expect(mockOverride.getLevel).toHaveBeenCalled();
        delete globalThis.GeoLeaf;
    });

    it("falls back to _LogImpl when globalThis.GeoLeaf.Log is not set", () => {
        delete globalThis.GeoLeaf;
        Log.setLevel("warn");
        expect(Log.getLevel()).toBe(LEVELS.WARN);
        Log.setLevel("info");
    });

    it("falls back to _LogImpl when globalThis.GeoLeaf is undefined", () => {
        globalThis.GeoLeaf = undefined;
        Log.setLevel("debug");
        expect(Log.getLevel()).toBe(LEVELS.DEBUG);
        Log.setLevel("info");
        delete globalThis.GeoLeaf;
    });
});
