/**
 * StorageHelper — localStorage seam and JSON round-trip (CAPACITÉS B.7)
 *
 * Companion to `storage-helper-validation.test.js`, which owns the schema gate. This file
 * owns what the module does with the browser: key guards, the validator+sanitize path of
 * `setItem` / `getItem`, the absent-localStorage and throwing-localStorage branches, and
 * `parseJSON` / `stringifyJSON`.
 *
 * ⚠️ ESM `import` on purpose — see the measurement note in
 * `storage-helper-validation.test.js`. `require()` on this module produces bogus coverage.
 */

import { StorageHelperModule as StorageHelper } from "../../../src/capabilities/offline/db/storage-helper.ts";

/** Minimal Storage double — used only where the real one cannot be made to misbehave. */
function fakeStorage(overrides = {}) {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        ...overrides,
    };
}

/**
 * Log double installed through the `globalThis.GeoLeaf.Log` hook the Log proxy honours
 * (`modules/utils/log/logger.ts`).
 *
 * Not decoration: several guards here return the SAME value as the catch block they protect
 * — `setItem` with no localStorage returns false, and so does `setItem` blowing up on
 * `undefined.setItem`. The log line is the only thing that tells the two apart, so it is the
 * only thing that makes those branches testable at all.
 */
let logSpy;

beforeEach(() => {
    globalThis.localStorage.clear();
    logSpy = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    globalThis.GeoLeaf = { ...(globalThis.GeoLeaf ?? {}), Log: logSpy };
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.GeoLeaf;
});

describe("StorageHelper.setItem — key guard", () => {
    test.each([
        ["an empty string", ""],
        ["null", null],
        ["undefined", undefined],
        ["a number", 123],
        ["an object", {}],
    ])("refuses %s as a key and writes nothing", (_label, key) => {
        expect(StorageHelper.setItem(key, "v")).toBe(false);
        expect(globalThis.localStorage.length).toBe(0);
        expect(logSpy.error).toHaveBeenCalledWith("[StorageHelper] Invalid key provided:", key);
    });
});

describe("StorageHelper.setItem — validator and sanitize", () => {
    test("stores the value when the validator accepts it", () => {
        const validator = { validate: vi.fn(() => true), sanitize: vi.fn() };

        expect(StorageHelper.setItem("theme", "dark", validator)).toBe(true);
        expect(globalThis.localStorage.getItem("theme")).toBe("dark");
        expect(validator.validate).toHaveBeenCalledWith("dark");
        expect(validator.sanitize).not.toHaveBeenCalled();
    });

    test("refuses to store when the validator rejects and there is no sanitize", () => {
        const validator = { validate: () => false };

        expect(StorageHelper.setItem("theme", "<script>", validator)).toBe(false);
        expect(globalThis.localStorage.getItem("theme")).toBeNull();
    });

    test("a non-function `sanitize` is not a sanitizer — the write is refused", () => {
        const validator = { validate: () => false, sanitize: "not-a-function" };

        expect(StorageHelper.setItem("theme", "<script>", validator)).toBe(false);
        expect(globalThis.localStorage.getItem("theme")).toBeNull();
    });

    test("stores the sanitized value when the validator rejects and sanitize repairs it", () => {
        const validator = {
            validate: (v) => v === "dark",
            sanitize: vi.fn(() => "dark"),
        };

        expect(StorageHelper.setItem("theme", "DARK", validator)).toBe(true);
        expect(validator.sanitize).toHaveBeenCalledWith("DARK");
        expect(globalThis.localStorage.getItem("theme")).toBe("dark");
    });

    // ── FIXED: the sanitised value is revalidated ──

    test("a sanitizer that does not sanitize is refused, not stored", () => {
        // Was DEFECT B.7-D1: `sanitize`'s output went straight to storage and the call
        // reported success, so the validator became advisory the moment a sanitizer
        // existed. Now revalidated once — a sanitizer that cannot produce a valid value on
        // the first pass will not on the second, and looping would hand an unbounded retry
        // to caller-supplied code.
        const validator = {
            validate: vi.fn(() => false),
            sanitize: () => "<img onerror=alert(1)>",
        };

        expect(StorageHelper.setItem("theme", "whatever", validator)).toBe(false);
        expect(globalThis.localStorage.getItem("theme")).toBeNull();
        // Twice: once on the input, once on the sanitizer's output.
        expect(validator.validate).toHaveBeenCalledTimes(2);
    });

    test("a sanitizer that DOES sanitize still stores its output", () => {
        // The complement — the fix must not refuse a working sanitizer.
        const validator = {
            validate: (v) => v === "dark",
            sanitize: () => "dark",
        };
        expect(StorageHelper.setItem("theme2", "DARK", validator)).toBe(true);
        expect(globalThis.localStorage.getItem("theme2")).toBe("dark");
    });

    test("a validator object without a `validate` function is ignored", () => {
        expect(StorageHelper.setItem("k", "raw", {})).toBe(true);
        expect(StorageHelper.setItem("k2", "raw", { validate: "nope" })).toBe(true);
        expect(globalThis.localStorage.getItem("k")).toBe("raw");
        expect(globalThis.localStorage.getItem("k2")).toBe("raw");
    });
});

describe("StorageHelper.setItem — storage seam", () => {
    test("returns false through the availability guard, not through an exception", () => {
        vi.stubGlobal("localStorage", undefined);

        expect(StorageHelper.setItem("k", "v")).toBe(false);
        expect(logSpy.warn).toHaveBeenCalledWith("[StorageHelper] localStorage not available");
        expect(logSpy.error).not.toHaveBeenCalled();
    });

    test("returns false when the write throws (quota exceeded)", () => {
        vi.stubGlobal(
            "localStorage",
            fakeStorage({
                setItem: () => {
                    throw new DOMException("quota", "QuotaExceededError");
                },
            })
        );

        expect(StorageHelper.setItem("k", "v")).toBe(false);
        expect(logSpy.error).toHaveBeenCalledWith("[StorageHelper] setItem error:", "quota");
    });

    test("hands localStorage a string, never the raw value", () => {
        // `localStorage.setItem` coerces on its own, so the `String(value)` conversion is
        // invisible against the real Storage. A recording double is what shows it happens
        // before the call — the contract any Storage polyfill or spy depends on.
        const seen = [];
        vi.stubGlobal("localStorage", fakeStorage({ setItem: (k, v) => seen.push([k, v]) }));

        StorageHelper.setItem("n", 42);
        StorageHelper.setItem("o", { a: 1 });

        expect(seen).toEqual([
            ["n", "42"],
            ["o", "[object Object]"],
        ]);
        expect(seen.every(([, v]) => typeof v === "string")).toBe(true);
    });

    test.each([
        ["a number", 42, "42"],
        ["a boolean", true, "true"],
        ["null", null, "null"],
        ["undefined", undefined, "undefined"],
    ])("coerces %s with String()", (_label, value, expected) => {
        expect(StorageHelper.setItem("k", value)).toBe(true);
        expect(globalThis.localStorage.getItem("k")).toBe(expected);
    });

    // ── FINDING B.7-D5 (documented, no production caller today) ──

    test("FINDING: a non-string object is flattened by String() — the data is lost", () => {
        // `String({...})` is "[object Object]" and `String([1,2])` is "1,2". Nothing in
        // `packages/core/src` calls `setItem`, so this is currently unreachable in
        // production; it is pinned because the signature accepts `unknown` and invites it.
        expect(StorageHelper.setItem("obj", { a: 1, b: 2 })).toBe(true);
        expect(globalThis.localStorage.getItem("obj")).toBe("[object Object]");

        expect(StorageHelper.setItem("arr", [1, 2])).toBe(true);
        expect(globalThis.localStorage.getItem("arr")).toBe("1,2");
    });
});

describe("StorageHelper.getItem", () => {
    test.each([
        ["an empty string", ""],
        ["null", null],
        ["undefined", undefined],
        ["a number", 7],
    ])("returns the default for %s as a key", (_label, key) => {
        expect(StorageHelper.getItem(key, "fallback")).toBe("fallback");
        expect(logSpy.error).toHaveBeenCalledWith("[StorageHelper] Invalid key provided:", key);
    });

    test("returns the stored value", () => {
        globalThis.localStorage.setItem("theme", "dark");
        expect(StorageHelper.getItem("theme", "light")).toBe("dark");
    });

    test("returns the default when the key is absent", () => {
        expect(StorageHelper.getItem("never-written", "light")).toBe("light");
    });

    test("an empty stored string is a value, not an absence", () => {
        globalThis.localStorage.setItem("theme", "");
        expect(StorageHelper.getItem("theme", "light")).toBe("");
    });

    test("returns the default through the availability guard, not through an exception", () => {
        vi.stubGlobal("localStorage", undefined);

        expect(StorageHelper.getItem("theme", "light")).toBe("light");
        expect(logSpy.warn).toHaveBeenCalledWith(
            "[StorageHelper] localStorage not available, returning default"
        );
        expect(logSpy.error).not.toHaveBeenCalled();
    });

    test("returns the default when the read throws", () => {
        vi.stubGlobal(
            "localStorage",
            fakeStorage({
                getItem: () => {
                    throw new DOMException("blocked", "SecurityError");
                },
            })
        );

        expect(StorageHelper.getItem("theme", "light")).toBe("light");
        expect(logSpy.error).toHaveBeenCalledWith("[StorageHelper] getItem error:", "blocked");
    });

    test("returns the default when the validator rejects what is stored", () => {
        globalThis.localStorage.setItem("theme", "neon");
        const validator = { validate: (v) => v === "dark" };

        expect(StorageHelper.getItem("theme", "light", validator)).toBe("light");
        // The rejected value is left in place — getItem does not self-heal storage.
        expect(globalThis.localStorage.getItem("theme")).toBe("neon");
    });

    test("returns the value when the validator accepts it", () => {
        globalThis.localStorage.setItem("theme", "dark");
        expect(StorageHelper.getItem("theme", "light", { validate: () => true })).toBe("dark");
    });

    test("a validator object without a `validate` function is ignored", () => {
        globalThis.localStorage.setItem("theme", "neon");
        expect(StorageHelper.getItem("theme", "light", {})).toBe("neon");
        expect(StorageHelper.getItem("theme", "light", { validate: null })).toBe("neon");
    });

    test("the validator sees the RAW STRING, not the value that was passed to setItem", () => {
        // Asymmetry worth knowing: `setItem` validates before `String()`, `getItem`
        // validates after. The same validator therefore sees `42` on the way in and `"42"`
        // on the way out.
        const onWrite = vi.fn(() => true);
        const onRead = vi.fn(() => true);

        StorageHelper.setItem("n", 42, { validate: onWrite });
        StorageHelper.getItem("n", null, { validate: onRead });

        expect(onWrite).toHaveBeenCalledWith(42);
        expect(onRead).toHaveBeenCalledWith("42");
    });
});

describe("StorageHelper.removeItem", () => {
    test.each([
        ["an empty string", ""],
        ["null", null],
        ["a number", 3],
    ])("refuses %s as a key", (_label, key) => {
        expect(StorageHelper.removeItem(key)).toBe(false);
        expect(logSpy.error).toHaveBeenCalledWith("[StorageHelper] Invalid key provided:", key);
    });

    test("removes an existing key", () => {
        globalThis.localStorage.setItem("theme", "dark");
        expect(StorageHelper.removeItem("theme")).toBe(true);
        expect(globalThis.localStorage.getItem("theme")).toBeNull();
    });

    test("removing an absent key still reports success", () => {
        expect(StorageHelper.removeItem("never-written")).toBe(true);
    });

    test("returns false silently when localStorage is unavailable", () => {
        // Unlike setItem/getItem this guard logs NOTHING, which is precisely what separates
        // it from the catch block below — both return false.
        vi.stubGlobal("localStorage", undefined);

        expect(StorageHelper.removeItem("theme")).toBe(false);
        expect(logSpy.error).not.toHaveBeenCalled();
        expect(logSpy.warn).not.toHaveBeenCalled();
    });

    test("returns false when the removal throws", () => {
        vi.stubGlobal(
            "localStorage",
            fakeStorage({
                removeItem: () => {
                    throw new DOMException("blocked", "SecurityError");
                },
            })
        );

        expect(StorageHelper.removeItem("theme")).toBe(false);
        expect(logSpy.error).toHaveBeenCalledWith("[StorageHelper] removeItem error:", "blocked");
    });
});

describe("StorageHelper.parseJSON", () => {
    test("parses valid JSON", () => {
        expect(StorageHelper.parseJSON('{"theme":"dark","n":[1,2]}', null)).toEqual({
            theme: "dark",
            n: [1, 2],
        });
    });

    test.each([
        ["null", null],
        ["undefined", undefined],
    ])(
        "returns the default for %s, treating it as an absence rather than bad input",
        (_label, input) => {
            // The nullish guard sits BEFORE the `typeof !== "string"` one and returns without a
            // warning: an unset key is normal, a non-string argument is a caller bug. Same return
            // value, different diagnosis — the log is what distinguishes the two branches.
            expect(StorageHelper.parseJSON(input, "default")).toBe("default");
            expect(logSpy.warn).not.toHaveBeenCalled();
        }
    );

    test.each([
        ["an object", { a: 1 }],
        ["a number", 42],
        ["an array", []],
        ["false", false],
    ])("returns the default for %s (not a string) and warns", (_label, input) => {
        expect(StorageHelper.parseJSON(input, "default")).toBe("default");
        expect(logSpy.warn).toHaveBeenCalledWith(
            "[StorageHelper] parseJSON: input not a string, returning default"
        );
    });

    test.each([
        ["truncated", "{broken"],
        ["empty", ""],
        ["a bare word", "undefined"],
    ])("returns the default for %s input", (_label, input) => {
        expect(StorageHelper.parseJSON(input, "default")).toBe("default");
    });

    test('the literal "null" parses to null — it is NOT the default', () => {
        // Distinguishes the `json === null` guard from a truthiness test: `"null"` is a
        // string, parses fine, and its result is a legitimate value.
        expect(StorageHelper.parseJSON("null", "default")).toBeNull();
    });

    test('the literal "0" and "false" parse to their values', () => {
        expect(StorageHelper.parseJSON("0", "default")).toBe(0);
        expect(StorageHelper.parseJSON("false", "default")).toBe(false);
    });
});

describe("StorageHelper.stringifyJSON", () => {
    test("stringifies plain data", () => {
        expect(StorageHelper.stringifyJSON({ theme: "dark" })).toBe('{"theme":"dark"}');
        expect(StorageHelper.stringifyJSON([1, "a"])).toBe('[1,"a"]');
        expect(StorageHelper.stringifyJSON(null)).toBe("null");
    });

    test("returns the fallback when the data is circular", () => {
        const circular = { name: "loop" };
        circular.self = circular;

        expect(StorageHelper.stringifyJSON(circular)).toBe("null");
        expect(StorageHelper.stringifyJSON(circular, "{}")).toBe("{}");
    });

    test("returns the fallback when a getter throws", () => {
        const hostile = {
            get boom() {
                throw new Error("nope");
            },
        };
        expect(StorageHelper.stringifyJSON(hostile, "FALLBACK")).toBe("FALLBACK");
    });

    // ── FIXED: the `: string` signature is held ──

    test("falls back for values JSON cannot represent, instead of returning undefined", () => {
        // Was DEFECT B.7-D3. `JSON.stringify` RETURNS `undefined` for these — it does not
        // throw — so the catch never ran and the declared `: string` was violated in
        // silence; a caller doing `.length` got a TypeError far from here.
        expect(StorageHelper.stringifyJSON(undefined)).toBe("null");
        expect(StorageHelper.stringifyJSON(() => {})).toBe("null");
        expect(StorageHelper.stringifyJSON(Symbol("s"), "FALLBACK")).toBe("FALLBACK");
        // And the nominal path is unchanged.
        expect(StorageHelper.stringifyJSON({ a: 1 })).toBe('{"a":1}');
    });
});
