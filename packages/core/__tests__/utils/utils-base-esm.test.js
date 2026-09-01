/**
 * @fileoverview ESM-import targeted tests for general-utils.ts branch coverage.
 *
 * The existing general-utils.test.js uses require() — this file uses ESM import
 * so Istanbul instruments the module properly.
 * Focuses on branches NOT yet covered: non-http validateUrl, deepMerge edge cases,
 * ensureMap, fireMapEvent error path, debounce immediate, throttle defaults, etc.
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ⚠️ A `vi.mock("../../src/utils/security/security-utils.js")` providing
// `validateUrl` lived here. It NEVER applied, for two cumulative reasons:
// `modules/utils/security/` does not exist in the tree, and
// `general-utils.ts` takes its `validateUrl` from
// `built-in/security/index.js`. This file's `validateUrl` assertions thus
// always exercised the REAL implementation — the desirable behaviour, but
// not the one the author believed they were writing.
//
// Removed after proof: without it, the suite is unchanged. A `vi.mock` on a
// path nothing imports is silent (the native mocker only throws on a
// missing export of a RESOLVED module), so nothing would have flagged it.

import {
    validateUrl,
    deepMerge,
    ensureMap,
    mergeOptions,
    fireMapEvent,
    debounce,
    throttle,
    resolveField,
    compareByOrder,
} from "../../src/utils/general/utils-base.js";

describe("utils-base — ESM (branch coverage)", () => {
    // ── validateUrl ─────────────────────────────────────────────────────────

    describe("validateUrl", () => {
        it("returns null when url is not a string", () => {
            expect(validateUrl(null)).toBeNull();
            expect(validateUrl(undefined)).toBeNull();
            expect(validateUrl(42)).toBeNull();
        });

        it("returns null when protocol is not in allowed list (ftp)", () => {
            // Covers L25 true branch: protocol not in allowedProtocols
            expect(validateUrl("ftp://bad.example.com/file.txt")).toBeNull();
        });

        it("returns href for non-http(s) protocols in allowed list (mailto:)", () => {
            // Covers L28 true branch: protocol is mailto: → return parsed.href
            const result = validateUrl("mailto:test@example.com", ["mailto:", "http:", "https:"]);
            expect(result).toBe("mailto:test@example.com");
        });

        it("returns href for tel: protocol in allowed list", () => {
            const result = validateUrl("tel:+33123456789", ["tel:", "http:", "https:"]);
            expect(result).toBe("tel:+33123456789");
        });
    });

    // ── deepMerge ────────────────────────────────────────────────────────────

    describe("deepMerge", () => {
        it("returns source when target is null (L41 true branch)", () => {
            const src = { a: 1 };
            const result = deepMerge(null, src);
            expect(result).toEqual(src);
        });

        it("merges recursively when srcVal is an object (L48 true branch)", () => {
            const result = deepMerge({ a: { x: 1 } }, { a: { y: 2 } });
            expect(result.a).toEqual({ x: 1, y: 2 });
        });

        it("ignores __proto__ key (dangerous key guard)", () => {
            const original = {};
            deepMerge(original, { __proto__: { polluted: true } });
            expect({}.polluted).toBeUndefined();
        });

        it("returns target unchanged when source is null", () => {
            const target = { a: 1 };
            const result = deepMerge(target, null);
            expect(result).toBe(target);
        });
    });

    // ── ensureMap ────────────────────────────────────────────────────────────

    describe("ensureMap", () => {
        const mapLike = () => ({
            getCenter: () => ({}),
            getBounds: () => ({}),
            on: () => {},
            off: () => {},
        });

        it("returns explicitMap when it looks like a map", () => {
            const mockMap = mapLike();
            expect(ensureMap(mockMap)).toBe(mockMap);
        });

        // S13 — `{ id: "map" }` used to pass here, because the function returned any
        // truthy argument unchanged. It validates now, so a non-map is refused like an
        // absent one rather than travelling on to explode at the first method call.
        it("returns null for a truthy non-map", () => {
            expect(ensureMap({ id: "map" })).toBeNull();
        });

        it("returns null when no explicitMap and no Core.getMap", () => {
            // globalThis.GeoLeaf.Core is likely null
            expect(ensureMap(null)).toBeNull();
        });
    });

    // ── mergeOptions ─────────────────────────────────────────────────────────

    describe("mergeOptions", () => {
        it("returns defaults when override is null (L78 true branch shortcut)", () => {
            const defaults = { x: 1 };
            expect(mergeOptions(defaults, null)).toBe(defaults);
        });

        it("returns defaults when override is not an object", () => {
            const defaults = { x: 1 };
            expect(mergeOptions(defaults, "string")).toBe(defaults);
        });

        it("merges override into defaults when valid", () => {
            const result = mergeOptions({ x: 1 }, { y: 2 });
            expect(result).toEqual({ x: 1, y: 2 });
        });
    });

    // ── fireMapEvent ─────────────────────────────────────────────────────────

    describe("fireMapEvent", () => {
        it("is a no-op when map is null (L85 true branch)", () => {
            expect(() => fireMapEvent(null, "test")).not.toThrow();
        });

        it("is a no-op when map.fire is not a function", () => {
            expect(() => fireMapEvent({}, "test")).not.toThrow();
        });

        it("uses {} when payload is undefined (L87 ?? fallback)", () => {
            const fire = vi.fn();
            fireMapEvent({ fire }, "test:event");
            expect(fire).toHaveBeenCalledWith("test:event", {});
        });

        it("passes payload when provided", () => {
            const fire = vi.fn();
            fireMapEvent({ fire }, "test:event", { id: "p1" });
            expect(fire).toHaveBeenCalledWith("test:event", { id: "p1" });
        });
    });

    // ── debounce ─────────────────────────────────────────────────────────────

    describe("debounce", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it("uses default wait (250ms) when not provided (default-arg branch)", () => {
            const fn = vi.fn();
            const debounced = debounce(fn); // no wait arg → uses default 250
            debounced();
            expect(fn).not.toHaveBeenCalled();
            vi.advanceTimersByTime(300);
            expect(fn).toHaveBeenCalledOnce();
        });

        it("calls immediately when immediate=true (L103 true + L108 true branches)", () => {
            const fn = vi.fn();
            const debounced = debounce(fn, 100, true);
            debounced();
            expect(fn).toHaveBeenCalledOnce();
        });

        it("does NOT call later() when immediate=true (L103 if(!immediate) false branch)", () => {
            const fn = vi.fn();
            const debounced = debounce(fn, 100, true);
            debounced();
            vi.advanceTimersByTime(200);
            // With immediate=true, function called once (immediately), not again on timeout
            expect(fn).toHaveBeenCalledOnce();
        });
    });

    // ── throttle ─────────────────────────────────────────────────────────────

    describe("throttle", () => {
        it("uses default limit (100ms) when not provided (default-arg branch)", () => {
            const fn = vi.fn();
            const throttled = throttle(fn); // no limit → uses default 100
            throttled();
            expect(fn).toHaveBeenCalledOnce();
        });

        it("throttles calls within the limit period", () => {
            vi.useFakeTimers();
            const fn = vi.fn();
            const throttled = throttle(fn, 200);
            throttled();
            throttled(); // called again too soon — should be throttled
            expect(fn).toHaveBeenCalledOnce();
            vi.useRealTimers();
        });
    });

    // ── resolveField ──────────────────────────────────────────────────────────

    describe("resolveField", () => {
        it("returns empty string when obj is null", () => {
            expect(resolveField(null, "name")).toBe("");
        });

        it("returns empty string when no path matches", () => {
            expect(resolveField({ a: 1 }, "missing.path")).toBe("");
        });

        it("traverses nested paths", () => {
            expect(resolveField({ a: { b: "hello" } }, "a.b")).toBe("hello");
        });

        it("falls back to second path when first is null", () => {
            expect(resolveField({ name: "Alice" }, "missing", "name")).toBe("Alice");
        });

        it("returns empty string for empty string value", () => {
            // _traversePath returns null for whitespace-only strings
            expect(resolveField({ name: "  " }, "name")).toBe("");
        });
    });

    // ── compareByOrder ───────────────────────────────────────────────────────

    describe("compareByOrder", () => {
        it("uses fallback when a.order is not a number (L183 ternary false branch)", () => {
            const result = compareByOrder({ order: undefined }, { order: 1 });
            // a uses fallback 999, b uses 1 → a - b = 998 (positive)
            expect(result).toBeGreaterThan(0);
        });

        it("uses fallback when b.order is not a number (L184 ternary false branch)", () => {
            const result = compareByOrder({ order: 1 }, { order: undefined });
            // a=1, b=fallback 999 → negative
            expect(result).toBeLessThan(0);
        });

        it("compares two objects with numbers", () => {
            expect(compareByOrder({ order: 2 }, { order: 5 })).toBeLessThan(0);
        });

        it("uses custom fallback", () => {
            const result = compareByOrder({}, { order: 0 }, 10);
            // a uses 10, b uses 0 → positive
            expect(result).toBeGreaterThan(0);
        });
    });
});
