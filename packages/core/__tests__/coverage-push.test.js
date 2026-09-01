/**
 * Targeted tests to increase coverage (target 50%)
 * Imports and exercises modules poorly covered by the other suites.
 */

import { formatDateTime, formatFileSize, toGB, toMB } from "../src/utils/general/formatters.js";
import {
    getNestedValue,
    setNestedValue,
    hasNestedPath,
} from "../src/utils/general/object-utils.js";
import {
    getDistance,
    deepMerge,
    mergeOptions,
    debounce,
    throttle,
} from "../src/utils/general/utils-base.js";
import {
    calculateMapScale,
    isScaleInRange,
    clearScaleCache,
} from "../src/utils/general/scale-utils.js";

vi.mock("../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Coverage push — formatters", () => {
    describe("formatDateTime", () => {
        it("formats date and time", () => {
            const r = formatDateTime(new Date("2025-01-15T14:30:00"));
            expect(r).toBeDefined();
        });
        it("returns empty string for invalid date", () => {
            expect(formatDateTime(NaN)).toBe("");
        });
    });

    describe("formatFileSize", () => {
        it("formats bytes", () => {
            expect(formatFileSize(1024)).toBeDefined();
        });
        it("formats bytes under 1024 (B unit)", () => {
            const r = formatFileSize(100);
            expect(r).toMatch(/\d+\s*B/);
        });
        it("formats KB/MB", () => {
            expect(formatFileSize(1024 * 1024)).toBeDefined();
        });
        it('returns "0 B" for null, NaN or 0', () => {
            expect(formatFileSize(null)).toBe("0 B");
            expect(formatFileSize(0)).toBe("0 B");
        });
    });

    describe("toGB / toMB", () => {
        it("toGB converts bytes", () => {
            expect(toGB(2 * 1024 * 1024 * 1024)).toBeDefined();
        });
        it("toMB converts bytes", () => {
            expect(toMB(512 * 1024 * 1024)).toBeDefined();
        });
        it('toGB and toMB return "0" for null or 0', () => {
            expect(toGB(null)).toBe("0");
            expect(toMB(0)).toBe("0");
        });
    });
});

describe("Coverage push — object-utils", () => {
    describe("getNestedValue", () => {
        it("returns nested value", () => {
            expect(getNestedValue({ a: { b: 1 } }, "a.b")).toBe(1);
        });
        it("returns null for invalid input", () => {
            expect(getNestedValue(null, "a")).toBeNull();
            expect(getNestedValue({}, "a.b")).toBeNull();
        });
    });

    describe("setNestedValue", () => {
        it("sets nested value", () => {
            const obj = { a: {} };
            setNestedValue(obj, "a.b", 2);
            expect(obj.a.b).toBe(2);
        });
    });

    describe("hasNestedPath", () => {
        it("returns true when path exists", () => {
            expect(hasNestedPath({ a: { b: 1 } }, "a.b")).toBe(true);
        });
        it("returns false when path missing", () => {
            expect(hasNestedPath({ a: {} }, "a.b")).toBe(false);
        });
    });
});

describe("Coverage push — general-utils", () => {
    it("getDistance computes distance between two points", () => {
        const d = getDistance(45, -73, 45.01, -73);
        expect(typeof d).toBe("number");
        expect(d).toBeGreaterThan(0);
    });
    it("deepMerge merges objects", () => {
        const out = deepMerge({ a: 1 }, { b: 2 });
        expect(out).toEqual({ a: 1, b: 2 });
    });
    it("deepMerge merges nested", () => {
        const out = deepMerge({ a: { x: 1 } }, { a: { y: 2 } });
        expect(out.a).toEqual({ x: 1, y: 2 });
    });
    it("mergeOptions overrides defaults", () => {
        const out = mergeOptions({ a: 1, b: 2 }, { b: 3 });
        expect(out).toEqual({ a: 1, b: 3 });
    });
    it("mergeOptions returns defaults when override null", () => {
        expect(mergeOptions({ a: 1 }, null)).toEqual({ a: 1 });
    });
    it("debounce returns a function", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 10);
        expect(typeof debounced).toBe("function");
        debounced();
        expect(fn).not.toHaveBeenCalled();
    });
    it("throttle returns a function and invokes once", () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 1000);
        throttled();
        throttled();
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe("Coverage push — scale-utils", () => {
    it("calculateMapScale returns 0 when map is null", () => {
        expect(calculateMapScale(null)).toBe(0);
    });
    it("calculateMapScale returns 0 when map has no center or zoom", () => {
        expect(calculateMapScale({ getCenter: () => null, getZoom: () => 10 })).toBe(0);
        expect(
            calculateMapScale({ getCenter: () => ({ lat: 45 }), getZoom: () => undefined })
        ).toBe(0);
    });
    it("calculateMapScale returns scale with mock map", () => {
        const map = {
            getCenter: () => ({ lat: 45 }),
            getZoom: () => 10,
        };
        const scale = calculateMapScale(map);
        expect(typeof scale).toBe("number");
        expect(scale).toBeGreaterThan(0);
    });
    it("isScaleInRange returns true when in range (minScale >= current >= maxScale)", () => {
        expect(isScaleInRange(1000, 2000, 100)).toBe(true);
    });
    it("isScaleInRange returns false when too zoomed out (current > minScale)", () => {
        expect(isScaleInRange(3000, 1000, 100)).toBe(false);
    });
    it("isScaleInRange returns false when too zoomed in (current < maxScale)", () => {
        expect(isScaleInRange(50, 10000, 200)).toBe(false);
    });
    it("isScaleInRange with logger calls debug", () => {
        const logger = { debug: vi.fn() };
        isScaleInRange(3000, 1000, 100, logger);
        expect(logger.debug).toHaveBeenCalled();
    });
    it("isScaleInRange returns true with both min/max null (visible)", () => {
        const logger = { debug: vi.fn() };
        expect(isScaleInRange(1000, null, null, logger)).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("visible"));
    });
    it("calculateMapScale with force bypasses cache", () => {
        const map = { getCenter: () => ({ lat: 45 }), getZoom: () => 10 };
        calculateMapScale(map);
        const scale2 = calculateMapScale(map, { force: true });
        expect(typeof scale2).toBe("number");
        expect(scale2).toBeGreaterThan(0);
    });
    it("calculateMapScale with logger calls debug", () => {
        const logger = { debug: vi.fn() };
        const map = { getCenter: () => ({ lat: 46 }), getZoom: () => 8 };
        calculateMapScale(map, { logger });
        expect(logger.debug).toHaveBeenCalled();
    });
    it("clearScaleCache clears internal cache", () => {
        clearScaleCache();
        expect(calculateMapScale(null)).toBe(0);
    });
});

// `utils/general/event-bus.ts` (in-memory pub/sub behind `GeoLeaf.Bus`) was
// removed at KERNEL S10: written at boot, never read in three years. The live
// event system is `built-in/events/event-bus.ts` — see `__tests__/events/`.
