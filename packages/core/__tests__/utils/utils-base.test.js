/**
 * @fileoverview Unit tests for general-utils — deepMerge, debounce, throttle, etc.
 * @phase C12 — Coverage push
 */

import { Utils } from "../../src/utils/general/utils-base.js";

describe("UtilsBase", () => {
    beforeAll(() => {
        global.GeoLeaf = global.GeoLeaf || {};
        global.GeoLeaf.Log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        global.GeoLeaf.Security = {
            validateUrl: (url) => {
                // Simple passthrough for tests
                try {
                    return new URL(url, "http://localhost").href;
                } catch {
                    return null;
                }
            },
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    // ─── deepMerge ────────────────────────────────────────────────────────────

    describe("deepMerge", () => {
        test("should merge flat objects", () => {
            const result = Utils.deepMerge({ a: 1 }, { b: 2 });
            expect(result).toEqual({ a: 1, b: 2 });
        });

        test("should override existing keys", () => {
            const result = Utils.deepMerge({ a: 1, b: 2 }, { b: 99 });
            expect(result.b).toBe(99);
        });

        test("should deep merge nested objects", () => {
            const target = { config: { color: "red", size: 10 } };
            const source = { config: { color: "blue", label: "test" } };
            const result = Utils.deepMerge(target, source);
            expect(result.config.color).toBe("blue");
            expect(result.config.size).toBe(10);
            expect(result.config.label).toBe("test");
        });

        test("should not mutate target object", () => {
            const target = { a: 1 };
            const source = { b: 2 };
            const result = Utils.deepMerge(target, source);
            expect(target).toEqual({ a: 1 });
            expect(result).toEqual({ a: 1, b: 2 });
        });

        test("should handle null source gracefully", () => {
            const result = Utils.deepMerge({ a: 1 }, null);
            expect(result).toEqual({ a: 1 });
        });

        test("should handle null target gracefully", () => {
            const result = Utils.deepMerge(null, { a: 1 });
            expect(result).toEqual({ a: 1 });
        });

        test("should protect against prototype pollution (__proto__)", () => {
            const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
            Utils.deepMerge({}, malicious);
            expect({}.polluted).toBeUndefined();
        });

        test("should protect against prototype pollution (constructor)", () => {
            const malicious = JSON.parse('{"constructor": {"polluted": true}}');
            Utils.deepMerge({}, malicious);
            expect({}.constructor.polluted).toBeUndefined();
        });

        test("should preserve arrays without deep merging them", () => {
            const result = Utils.deepMerge({ arr: [1, 2] }, { arr: [3, 4, 5] });
            expect(result.arr).toEqual([3, 4, 5]);
        });
    });

    // ─── mergeOptions ─────────────────────────────────────────────────────────

    describe("mergeOptions", () => {
        test("should shallow merge options", () => {
            const defaults = { a: 1, b: 2 };
            const override = { b: 99, c: 3 };
            const result = Utils.mergeOptions(defaults, override);
            expect(result).toEqual({ a: 1, b: 99, c: 3 });
        });

        test("should return defaults when override is null", () => {
            const defaults = { a: 1 };
            const result = Utils.mergeOptions(defaults, null);
            expect(result).toEqual({ a: 1 });
        });

        test("should return defaults when override is not an object", () => {
            const defaults = { a: 1 };
            const result = Utils.mergeOptions(defaults, "invalid");
            expect(result).toEqual({ a: 1 });
        });
    });

    // ─── debounce ─────────────────────────────────────────────────────────────

    describe("debounce", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        test("should call function after wait period", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn, 200);

            debounced();
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(200);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        test("should only call function once for rapid invocations", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn, 200);

            debounced();
            debounced();
            debounced();
            vi.advanceTimersByTime(200);

            expect(fn).toHaveBeenCalledTimes(1);
        });

        test("should pass arguments to the debounced function", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn, 100);

            debounced("arg1", "arg2");
            vi.advanceTimersByTime(100);

            expect(fn).toHaveBeenCalledWith("arg1", "arg2");
        });

        test("should call immediately when immediate=true", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn, 200, true);

            debounced();
            expect(fn).toHaveBeenCalledTimes(1);

            // Should not call again within wait period
            debounced();
            vi.advanceTimersByTime(100);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        test("should reset timer on each call", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn, 200);

            debounced();
            vi.advanceTimersByTime(150);
            debounced(); // Reset the timer
            vi.advanceTimersByTime(150);
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(50);
            expect(fn).toHaveBeenCalledTimes(1);
        });
    });

    // ─── throttle ─────────────────────────────────────────────────────────────

    describe("throttle", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        test("should call function immediately on first invocation", () => {
            // Throttle uses Date.now() internally — control through jest.setSystemTime
            vi.setSystemTime(1000);
            const fn = vi.fn();
            const throttled = Utils.throttle(fn, 200);

            throttled();
            expect(fn).toHaveBeenCalledTimes(1);
        });

        test("should not call function again within limit if not enough time has passed", () => {
            vi.setSystemTime(1000);
            const fn = vi.fn();
            const throttled = Utils.throttle(fn, 200);

            throttled(); // call 1
            vi.setSystemTime(1100); // only 100ms later
            throttled(); // should be throttled
            expect(fn).toHaveBeenCalledTimes(1);
        });

        test("should allow call after limit has elapsed", () => {
            vi.setSystemTime(1000);
            const fn = vi.fn();
            const throttled = Utils.throttle(fn, 200);

            throttled(); // call 1
            vi.setSystemTime(1300); // 300ms later
            throttled(); // should be allowed
            expect(fn).toHaveBeenCalledTimes(2);
        });
    });

    // ─── getDistance ──────────────────────────────────────────────────────────

    describe("getDistance", () => {
        test("should calculate distance Paris to London (~342 km)", () => {
            const dist = Utils.getDistance(48.8566, 2.3522, 51.5074, -0.1278);
            expect(dist).toBeGreaterThan(300);
            expect(dist).toBeLessThan(400);
        });

        test("should return 0 for same coordinates", () => {
            const dist = Utils.getDistance(48.8566, 2.3522, 48.8566, 2.3522);
            expect(dist).toBeCloseTo(0, 5);
        });

        test("should return positive distance regardless of order", () => {
            const d1 = Utils.getDistance(0, 0, 10, 10);
            const d2 = Utils.getDistance(10, 10, 0, 0);
            expect(d1).toBeCloseTo(d2, 5);
        });
    });

    // ─── resolveField ─────────────────────────────────────────────────────────

    describe("resolveField", () => {
        test("should return top-level field value", () => {
            const obj = { name: "Paris" };
            expect(Utils.resolveField(obj, "name")).toBe("Paris");
        });

        test("should resolve nested path", () => {
            const obj = { attributes: { label: "Lyon" } };
            expect(Utils.resolveField(obj, "attributes.label")).toBe("Lyon");
        });

        test("should try multiple paths and return first match", () => {
            const obj = { properties: { name: "Bordeaux" } };
            expect(Utils.resolveField(obj, "label", "properties.name")).toBe("Bordeaux");
        });

        test("should return empty string for missing paths", () => {
            const obj = { a: 1 };
            expect(Utils.resolveField(obj, "missing.path")).toBe("");
        });

        test("should return empty string for null object", () => {
            expect(Utils.resolveField(null, "name")).toBe("");
        });
    });

    // ─── compareByOrder ───────────────────────────────────────────────────────

    describe("compareByOrder", () => {
        test("should sort items by order property ascending", () => {
            const items = [{ order: 3 }, { order: 1 }, { order: 2 }];
            items.sort(Utils.compareByOrder);
            expect(items[0].order).toBe(1);
            expect(items[1].order).toBe(2);
            expect(items[2].order).toBe(3);
        });

        test("should sort items without order to end (fallback 999)", () => {
            const items = [{ order: 1 }, { name: "no-order" }, { order: 2 }];
            items.sort(Utils.compareByOrder);
            expect(items[0].order).toBe(1);
            expect(items[1].order).toBe(2);
            expect(items[2].name).toBe("no-order");
        });

        test("should accept custom fallback", () => {
            const a = {};
            const b = { order: 5 };
            // With fallback=0, items without order go first
            const result = Utils.compareByOrder(a, b, 0);
            expect(result).toBeLessThan(0);
        });
    });
});
