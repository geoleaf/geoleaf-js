/**
 * Tests for the `GeoLeaf.Utils` namespace — utility functions.
 *
 * ⚠️ KERNEL S14 — this suite used to populate the namespace by requiring
 * `modules/geoleaf.utils.ts`, which reached the dead `utils-api.ts` assembler. That
 * path was NEVER executed in production: the facade had no importer since the UMD
 * builds were dropped in v2.0.0, so the suite exercised a branch the shipped bundle
 * never ran. It now goes through `globals.core.ts#setupCoreMap()`, the real B2 mount.
 *
 * The `escapeHtml` cases went with the assembler — that member only ever existed on
 * the dead object, never on the runtime namespace. `GeoLeaf.Security.escapeHtml` is
 * the live equivalent and is covered by the security suite.
 */

const mockCoreGetMap = vi.fn();
vi.mock("../../src/api/geoleaf.core.ts", () => ({
    Core: { getMap: (...args) => mockCoreGetMap(...args) },
}));

const mockLogWarn = vi.fn();
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: (...args) => mockLogWarn(...args), error: vi.fn() },
}));

describe("GeoLeaf.Utils", () => {
    let Utils;

    beforeEach(async () => {
        mockCoreGetMap.mockReset();
        mockLogWarn.mockReset();

        // Mock GeoLeaf namespace
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            Security: {
                escapeHtml: vi.fn((text) => text),
            },
            Core: {
                getMap: vi.fn().mockReturnValue({
                    fire: vi.fn(),
                }),
            },
        };

        vi.resetModules();
        const { setupCoreMap } = await import("../../src/globals/globals.core.js");
        setupCoreMap();

        Utils = global.GeoLeaf.Utils;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("Module structure", () => {
        it("should expose Utils on GeoLeaf namespace", () => {
            expect(global.GeoLeaf.Utils).toBeDefined();
        });

        it("should expose validateUrl method", () => {
            expect(typeof Utils.validateUrl).toBe("function");
        });

        it("should expose deepMerge method", () => {
            expect(typeof Utils.deepMerge).toBe("function");
        });

        it("should expose ensureMap method", () => {
            expect(typeof Utils.ensureMap).toBe("function");
        });

        it("should expose mergeOptions method", () => {
            expect(typeof Utils.mergeOptions).toBe("function");
        });

        it("should expose fireMapEvent method", () => {
            expect(typeof Utils.fireMapEvent).toBe("function");
        });

        it("should expose debounce method", () => {
            expect(typeof Utils.debounce).toBe("function");
        });

        it("should expose throttle method", () => {
            expect(typeof Utils.throttle).toBe("function");
        });

        it("should expose getDistance method", () => {
            expect(typeof Utils.getDistance).toBe("function");
        });

        it("should expose resolveField method", () => {
            expect(typeof Utils.resolveField).toBe("function");
        });
    });

    describe("validateUrl()", () => {
        it("should validate https URL", () => {
            const result = Utils.validateUrl("https://example.com/path");

            expect(result).toBe("https://example.com/path");
        });

        it("should validate http URL", () => {
            const result = Utils.validateUrl("http://example.com");

            expect(result).toBe("http://example.com/");
        });

        it("should validate mailto URL", () => {
            const result = Utils.validateUrl("mailto:test@example.com");

            expect(result).toBe("mailto:test@example.com");
        });

        it("should validate tel URL", () => {
            const result = Utils.validateUrl("tel:+1234567890");

            expect(result).toBe("tel:+1234567890");
        });

        it("should return null for javascript URL", () => {
            const result = Utils.validateUrl("javascript:alert(1)");

            expect(result).toBeNull();
        });

        it("should return null for data URL", () => {
            const result = Utils.validateUrl("data:text/html,<script>alert(1)</script>");

            expect(result).toBeNull();
        });

        it("should return null for empty string", () => {
            const result = Utils.validateUrl("");

            expect(result).toBeNull();
        });

        it("should return null for null", () => {
            const result = Utils.validateUrl(null);

            expect(result).toBeNull();
        });

        it("should accept custom allowed protocols", () => {
            const result = Utils.validateUrl("ftp://example.com", ["ftp:"]);

            expect(result).toBe("ftp://example.com/");
        });
    });

    describe("deepMerge()", () => {
        it("should merge simple objects", () => {
            const target = { a: 1, b: 2 };
            const source = { c: 3 };

            const result = Utils.deepMerge(target, source);

            expect(result).toEqual({ a: 1, b: 2, c: 3 });
        });

        it("should override existing properties", () => {
            const target = { a: 1 };
            const source = { a: 2 };

            const result = Utils.deepMerge(target, source);

            expect(result.a).toBe(2);
        });

        it("should deep merge nested objects", () => {
            const target = { nested: { a: 1, b: 2 } };
            const source = { nested: { c: 3 } };

            const result = Utils.deepMerge(target, source);

            expect(result.nested).toEqual({ a: 1, b: 2, c: 3 });
        });

        it("should not deep merge arrays", () => {
            const target = { arr: [1, 2] };
            const source = { arr: [3, 4] };

            const result = Utils.deepMerge(target, source);

            expect(result.arr).toEqual([3, 4]);
        });

        it("should return target if source is null", () => {
            const target = { a: 1 };

            const result = Utils.deepMerge(target, null);

            expect(result).toEqual({ a: 1 });
        });

        it("should return source if target is null", () => {
            const source = { a: 1 };

            const result = Utils.deepMerge(null, source);

            expect(result).toEqual({ a: 1 });
        });
    });

    describe("ensureMap()", () => {
        /** Minimal shape accepted by the duck-type: adapter AND raw maplibregl.Map. */
        const mapLike = (extra = {}) => ({
            getCenter: () => ({ lat: 0, lng: 0 }),
            getBounds: () => ({}),
            on: () => {},
            off: () => {},
            ...extra,
        });

        it("should return the explicit map when it looks like a map", () => {
            const explicitMap = mapLike({ id: "explicit" });

            const result = Utils.ensureMap(explicitMap);

            expect(result).toBe(explicitMap);
        });

        // S13 — the repair. This used to return the argument unchanged whatever it was,
        // so `ensureMap("foo")` yielded `"foo"`: the function ensured nothing and the
        // failure surfaced later, at the first method call, far from the cause.
        it.each([
            ["a bare object", { id: "explicit" }],
            ["a string", "foo"],
            ["a number", 42],
        ])("returns null for %s instead of handing it back", (_label, notAMap) => {
            mockCoreGetMap.mockReturnValue(null);
            expect(Utils.ensureMap(notAMap)).toBeNull();
        });

        // The duck-type must NOT require `setView`: that is a Leaflet API, absent from
        // MapLibre. Demanding it is what made the removed MapHelpers reject a real
        // `maplibregl.Map` while claiming to validate "is this a map?".
        it("accepts a MapLibre-shaped map that has no setView", () => {
            const native = mapLike();
            expect(native.setView).toBeUndefined();
            expect(Utils.ensureMap(native)).toBe(native);
        });

        it("should get map from Core if not provided", () => {
            mockCoreGetMap.mockReturnValue(null);
            Utils.ensureMap(null);

            expect(mockCoreGetMap).toHaveBeenCalled();
        });

        it("should return null if Core not available", () => {
            mockCoreGetMap.mockReturnValue(null);

            const result = Utils.ensureMap(null);

            expect(result).toBeNull();
        });
    });

    describe("mergeOptions()", () => {
        it("should merge options objects", () => {
            const defaults = { a: 1, b: 2 };
            const override = { b: 3, c: 4 };

            const result = Utils.mergeOptions(defaults, override);

            expect(result).toEqual({ a: 1, b: 3, c: 4 });
        });

        it("should return defaults if override is null", () => {
            const defaults = { a: 1 };

            const result = Utils.mergeOptions(defaults, null);

            expect(result).toEqual({ a: 1 });
        });

        it("should not mutate original objects", () => {
            const defaults = { a: 1 };
            const override = { b: 2 };

            Utils.mergeOptions(defaults, override);

            expect(defaults).toEqual({ a: 1 });
            expect(override).toEqual({ b: 2 });
        });
    });

    describe("fireMapEvent()", () => {
        it("should fire event on map", () => {
            const mockMap = { fire: vi.fn() };

            Utils.fireMapEvent(mockMap, "geoleaf:test", { data: "value" });

            expect(mockMap.fire).toHaveBeenCalledWith("geoleaf:test", { data: "value" });
        });

        it("should use empty object if no payload", () => {
            const mockMap = { fire: vi.fn() };

            Utils.fireMapEvent(mockMap, "geoleaf:test");

            expect(mockMap.fire).toHaveBeenCalledWith("geoleaf:test", {});
        });

        it("should not throw if map is null", () => {
            expect(() => {
                Utils.fireMapEvent(null, "event", {});
            }).not.toThrow();
        });

        it("should handle map.fire errors gracefully", () => {
            const mockMap = {
                fire: vi.fn().mockImplementation(() => {
                    throw new Error("Fire error");
                }),
            };

            expect(() => {
                Utils.fireMapEvent(mockMap, "event", {});
            }).not.toThrow();

            expect(mockLogWarn).toHaveBeenCalled();
        });
    });

    describe("debounce()", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should delay function execution", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn, 100);

            debounced();
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(100);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it("should use default delay of 250ms", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn);

            debounced();
            vi.advanceTimersByTime(249);
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it("should reset timer on repeated calls", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn, 100);

            debounced();
            vi.advanceTimersByTime(50);
            debounced();
            vi.advanceTimersByTime(50);
            debounced();
            vi.advanceTimersByTime(100);

            expect(fn).toHaveBeenCalledTimes(1);
        });

        it("should pass arguments to function", () => {
            const fn = vi.fn();
            const debounced = Utils.debounce(fn, 100);

            debounced("arg1", "arg2");
            vi.advanceTimersByTime(100);

            expect(fn).toHaveBeenCalledWith("arg1", "arg2");
        });
    });

    describe("throttle()", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should execute immediately on first call", () => {
            const fn = vi.fn();
            const throttled = Utils.throttle(fn, 100);

            throttled();

            expect(fn).toHaveBeenCalledTimes(1);
        });

        it("should block subsequent calls within limit", () => {
            const fn = vi.fn();
            const throttled = Utils.throttle(fn, 100);

            throttled();
            throttled();
            throttled();

            expect(fn).toHaveBeenCalledTimes(1);
        });

        it("should allow calls after limit expires", () => {
            const fn = vi.fn();
            const throttled = Utils.throttle(fn, 100);

            throttled();
            vi.advanceTimersByTime(100);
            throttled();

            expect(fn).toHaveBeenCalledTimes(2);
        });

        it("should use default limit of 100ms", () => {
            const fn = vi.fn();
            const throttled = Utils.throttle(fn);

            throttled();
            vi.advanceTimersByTime(99);
            throttled(); // blocked
            vi.advanceTimersByTime(1);
            throttled();

            expect(fn).toHaveBeenCalledTimes(2);
        });

        it("should pass arguments to function", () => {
            const fn = vi.fn();
            const throttled = Utils.throttle(fn, 100);

            throttled("arg1", "arg2");

            expect(fn).toHaveBeenCalledWith("arg1", "arg2");
        });
    });

    describe("getDistance()", () => {
        it("should calculate distance between Paris and London", () => {
            // Paris: 48.8566, 2.3522
            // London: 51.5074, -0.1278
            const distance = Utils.getDistance(48.8566, 2.3522, 51.5074, -0.1278);

            // Distance is approximately 343 km
            expect(distance).toBeGreaterThan(340);
            expect(distance).toBeLessThan(350);
        });

        it("should return 0 for same coordinates", () => {
            const distance = Utils.getDistance(48.8566, 2.3522, 48.8566, 2.3522);

            expect(distance).toBe(0);
        });

        it("should handle antipodal points", () => {
            // Two points on opposite sides of the Earth
            const distance = Utils.getDistance(0, 0, 0, 180);

            // Half the Earth circumference ~ 20015 km
            expect(distance).toBeGreaterThan(20000);
        });

        it("should handle negative coordinates", () => {
            // Sydney: -33.8688, 151.2093
            // Auckland: -36.8485, 174.7633
            const distance = Utils.getDistance(-33.8688, 151.2093, -36.8485, 174.7633);

            // Distance is approximately 2155 km
            expect(distance).toBeGreaterThan(2000);
            expect(distance).toBeLessThan(2300);
        });
    });

    describe("resolveField()", () => {
        it("should resolve simple field", () => {
            const obj = { name: "Test" };

            const result = Utils.resolveField(obj, "name");

            expect(result).toBe("Test");
        });

        it("should resolve nested field", () => {
            const obj = {
                attributes: {
                    description: "Description",
                },
            };

            const result = Utils.resolveField(obj, "attributes.description");

            expect(result).toBe("Description");
        });

        it("should try multiple paths and return first match", () => {
            const obj = {
                title: "Title",
                name: "Name",
            };

            const result = Utils.resolveField(obj, "label", "title", "name");

            expect(result).toBe("Title");
        });

        it("should return empty string if no path matches", () => {
            const obj = { other: "value" };

            const result = Utils.resolveField(obj, "name", "title");

            expect(result).toBe("");
        });

        it("should return empty string for null object", () => {
            const result = Utils.resolveField(null, "name");

            expect(result).toBe("");
        });

        it("should skip empty string values", () => {
            const obj = { name: "", title: "Title" };

            const result = Utils.resolveField(obj, "name", "title");

            expect(result).toBe("Title");
        });

        it("should return objects", () => {
            const obj = { data: { nested: true } };

            const result = Utils.resolveField(obj, "data");

            expect(result).toEqual({ nested: true });
        });

        it("should return arrays", () => {
            const obj = { items: [1, 2, 3] };

            const result = Utils.resolveField(obj, "items");

            expect(result).toEqual([1, 2, 3]);
        });

        it("should handle deeply nested paths", () => {
            const obj = {
                level1: {
                    level2: {
                        level3: "Deep value",
                    },
                },
            };

            const result = Utils.resolveField(obj, "level1.level2.level3");

            expect(result).toBe("Deep value");
        });
    });
});
