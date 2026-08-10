/*!
 * @geoleaf/host-runtime — log-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * Runs under the package default (`environment: "node"`): the seam only reads the
 * `GeoLeaf` namespace off `globalThis`, it never touches the DOM.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Log } from "../log-seam.js";
import type { GeoLeafHost } from "../host.js";

type Carrier = { GeoLeaf?: GeoLeafHost };
const carrier = globalThis as Carrier;

/** A logger stub recording every level the seam is expected to forward. */
const stubLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
});

const LEVELS = ["debug", "info", "warn", "error"] as const;

afterEach(() => {
    delete carrier.GeoLeaf;
});

describe("Log — delegation", () => {
    it.each(LEVELS)("forwards %s to the core logger, arguments intact", (level) => {
        const logger = stubLogger();
        carrier.GeoLeaf = { Log: logger };

        Log[level]("message", 42, { detail: true });

        expect(logger[level]).toHaveBeenCalledTimes(1);
        expect(logger[level]).toHaveBeenCalledWith("message", 42, { detail: true });
    });

    it("forwards a zero-argument call", () => {
        const logger = stubLogger();
        carrier.GeoLeaf = { Log: logger };

        Log.info();

        expect(logger.info).toHaveBeenCalledWith();
    });

    it("resolves the logger at CALL time, not at import time", () => {
        // The seam was imported while the namespace was absent — the module-eval-order
        // trap this accessor exists to avoid.
        expect(() => Log.debug("before boot")).not.toThrow();

        const logger = stubLogger();
        carrier.GeoLeaf = { Log: logger };
        Log.debug("after boot");

        expect(logger.debug).toHaveBeenCalledWith("after boot");
    });

    it("re-reads the logger on every call — a swapped logger takes effect", () => {
        const first = stubLogger();
        const second = stubLogger();

        carrier.GeoLeaf = { Log: first };
        Log.warn("one");
        carrier.GeoLeaf = { Log: second };
        Log.warn("two");

        expect(first.warn).toHaveBeenCalledWith("one");
        expect(first.warn).toHaveBeenCalledTimes(1);
        expect(second.warn).toHaveBeenCalledWith("two");
    });
});

describe("Log — silent no-op degradation", () => {
    it.each(LEVELS)("%s is callable and silent when the namespace is absent", (level) => {
        expect(() => Log[level]("dropped")).not.toThrow();
    });

    it.each(LEVELS)("%s is silent when the core mounted no logger", (level) => {
        carrier.GeoLeaf = {};
        expect(() => Log[level]("dropped")).not.toThrow();
    });

    it.each(LEVELS)("%s is silent when the logger lacks that level", (level) => {
        // The core's logger surface is optional per method (`GeoLeafHost["Log"]`), so a
        // partial logger must not throw — plugins call all four levels unconditionally.
        carrier.GeoLeaf = { Log: {} };
        expect(() => Log[level]("dropped")).not.toThrow();
    });

    it("does not fall back to console — level filtering belongs to the core", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            Log.error("must not reach the console");
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
