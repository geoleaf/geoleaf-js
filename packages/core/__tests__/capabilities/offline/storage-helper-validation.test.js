/**
 * StorageHelper — validation seam (CAPACITÉS B.7)
 *
 * `capabilities/offline/db/storage-helper.ts` is the validated-storage façade of the
 * whole offline capability, and until this file NOTHING in the core suite called it: the
 * full-suite lcov reported 0/14 functions and 0/106 branches. `validateBeforeStore` and
 * `_validateField` are the schema gate; `setItem` / `getItem` carry the validator+sanitize
 * branches. Those come first here — a validator nobody exercises is a validator nobody
 * knows the shape of.
 *
 * ⚠️ MEASUREMENT — these tests use ESM `import`, NOT `require()`, and that is load-bearing.
 * Under the forks pool a `require("…/storage-helper.ts")` goes through tsx's CJS transform
 * and the V8 → source remapping comes out WRONG for this file: a probe that called only
 * `setItem` reported `FNDA:0,setItem` while marking lines 269-441 (`openDatabase` body,
 * `validateBeforeStore`, `_validateField`) as covered. The same probe written with `import`
 * reported `FNDA:1,setItem` and exactly setItem's own lines. Coverage measured through
 * `require()` on this file is fiction in both directions.
 */

import { StorageHelperModule as StorageHelper } from "../../../src/capabilities/offline/db/storage-helper.ts";

/** Runs `validateBeforeStore` and returns the thrown message, or null when it passed. */
function failureOf(data, schema) {
    try {
        StorageHelper.validateBeforeStore(data, schema);
        return null;
    } catch (err) {
        return err.message;
    }
}

describe("StorageHelper.validateBeforeStore — argument guards", () => {
    test.each([
        ["null", null],
        ["undefined", undefined],
        ["a string", "not-an-object"],
        ["a number", 42],
        ["false", false],
    ])("rejects data that is %s", (_label, data) => {
        expect(() => StorageHelper.validateBeforeStore(data, {})).toThrow(
            "[StorageHelper] Data must be an object"
        );
    });

    test.each([
        ["null", null],
        ["undefined", undefined],
        ["a string", "schema"],
        ["a number", 1],
    ])("rejects a schema that is %s", (_label, schema) => {
        expect(() => StorageHelper.validateBeforeStore({ id: "x" }, schema)).toThrow(
            "[StorageHelper] Schema must be an object"
        );
    });

    test("an empty schema validates any object", () => {
        expect(StorageHelper.validateBeforeStore({ anything: 1 }, {})).toBe(true);
    });

    test("a conforming payload returns true", () => {
        const schema = {
            id: { type: "string", required: true },
            data: { type: "object", required: true },
            size: { type: "number", required: false },
        };
        expect(StorageHelper.validateBeforeStore({ id: "a", data: {}, size: 3 }, schema)).toBe(
            true
        );
    });

    test("an array passes the `typeof data === 'object'` guard", () => {
        // Characterisation: `typeof [] === "object"`, so a list reaches field validation and
        // every named field is simply absent. Not a defect on its own — pinned because the
        // guard reads as "must be a plain object" and is not.
        expect(StorageHelper.validateBeforeStore([], { id: { type: "string" } })).toBe(true);
        expect(failureOf([], { id: { type: "string", required: true } })).toBe(
            "[StorageHelper] Validation failed: Missing required field: id"
        );
    });
});

describe("StorageHelper.validateBeforeStore — error aggregation", () => {
    test("reports EVERY failing field in one message, in schema order", () => {
        const schema = {
            a: { type: "string", required: true },
            b: { type: "number", required: true },
            c: { type: "object", required: true },
        };
        expect(failureOf({ a: 1, b: "x" }, schema)).toBe(
            "[StorageHelper] Validation failed: " +
                "Invalid type for a: expected string, got number, " +
                "Invalid type for b: expected number, got string, " +
                "Missing required field: c"
        );
    });

    test("one field can raise several errors at once", () => {
        const schema = { n: { type: "number", min: 10, validate: (v) => v > 100 } };
        expect(failureOf({ n: 4 }, schema)).toBe(
            "[StorageHelper] Validation failed: n must be >= 10, got 4, Custom validation failed for n"
        );
    });
});

describe("StorageHelper._validateField — presence", () => {
    test("a required field that is absent yields ONE error and skips type checking", () => {
        // The early `return` matters: without it the absent field would also be reported as
        // `Invalid type … got undefined`, i.e. two errors for one cause.
        expect(failureOf({}, { id: { type: "string", required: true } })).toBe(
            "[StorageHelper] Validation failed: Missing required field: id"
        );
    });

    test("an optional field that is absent is not checked at all", () => {
        const schema = { note: { type: "string", required: false, validate: () => false } };
        expect(StorageHelper.validateBeforeStore({}, schema)).toBe(true);
    });

    test("a field with no `required` flag is optional", () => {
        expect(StorageHelper.validateBeforeStore({}, { note: { type: "string" } })).toBe(true);
    });

    test("an optional field that IS present is still validated", () => {
        expect(failureOf({ note: 7 }, { note: { type: "string" } })).toBe(
            "[StorageHelper] Validation failed: Invalid type for note: expected string, got number"
        );
    });

    // ── DEFECT B.7-D2 — reported, not fixed (the fix picks a meaning for `required`) ──

    test("DEFECT: `required` is satisfied by a key present with value undefined", () => {
        // `_validateField` tests presence with `key in data`, which is true for
        // `{ id: undefined }`. With no `type` rule to catch it afterwards, a payload whose
        // required field holds no value validates clean.
        // Pins TODAY's behaviour. If this line ever goes red, the hole was closed — delete
        // the test rather than "fixing" it.
        expect(
            StorageHelper.validateBeforeStore({ id: undefined }, { id: { required: true } })
        ).toBe(true);
        expect(StorageHelper.validateBeforeStore({ id: null }, { id: { required: true } })).toBe(
            true
        );
    });

    test("with a `type` rule the same payload fails — but through the type check", () => {
        // The error does surface; it just says the wrong thing. `Missing required field: id`
        // is what a reader expects, `got undefined` is what they get.
        expect(failureOf({ id: undefined }, { id: { type: "string", required: true } })).toBe(
            "[StorageHelper] Validation failed: Invalid type for id: expected string, got undefined"
        );
    });
});

describe("StorageHelper._validateField — type rules", () => {
    test("arrays are typed `array`, not `object`", () => {
        expect(StorageHelper.validateBeforeStore({ v: [] }, { v: { type: "array" } })).toBe(true);
        expect(failureOf({ v: {} }, { v: { type: "array" } })).toBe(
            "[StorageHelper] Validation failed: Invalid type for v: expected array, got object"
        );
        expect(failureOf({ v: [] }, { v: { type: "object" } })).toBe(
            "[StorageHelper] Validation failed: Invalid type for v: expected object, got array"
        );
    });

    test.each([
        ["string", "x"],
        ["number", 1],
        ["boolean", true],
        ["object", {}],
        ["function", () => {}],
    ])("accepts a matching %s", (type, value) => {
        expect(StorageHelper.validateBeforeStore({ v: value }, { v: { type } })).toBe(true);
    });

    test("null is typed `object` — a `type: 'object'` field accepts it", () => {
        // Characterisation of the JS `typeof null` trap: a schema asking for an object gets
        // null through, while a schema asking for a string reports "got object".
        expect(StorageHelper.validateBeforeStore({ v: null }, { v: { type: "object" } })).toBe(
            true
        );
        expect(failureOf({ v: null }, { v: { type: "string" } })).toBe(
            "[StorageHelper] Validation failed: Invalid type for v: expected string, got object"
        );
    });

    test("no `type` rule means no type check", () => {
        expect(
            StorageHelper.validateBeforeStore({ v: Symbol("s") }, { v: { required: true } })
        ).toBe(true);
    });
});

describe("StorageHelper._validateField — numeric bounds", () => {
    test("min and max are inclusive", () => {
        const schema = { n: { type: "number", min: 5, max: 10 } };
        expect(StorageHelper.validateBeforeStore({ n: 5 }, schema)).toBe(true);
        expect(StorageHelper.validateBeforeStore({ n: 10 }, schema)).toBe(true);
        expect(failureOf({ n: 4 }, schema)).toBe(
            "[StorageHelper] Validation failed: n must be >= 5, got 4"
        );
        expect(failureOf({ n: 11 }, schema)).toBe(
            "[StorageHelper] Validation failed: n must be <= 10, got 11"
        );
    });

    test("min 0 and max 0 are honoured (not treated as absent)", () => {
        expect(failureOf({ n: -1 }, { n: { type: "number", min: 0 } })).toBe(
            "[StorageHelper] Validation failed: n must be >= 0, got -1"
        );
        expect(failureOf({ n: 1 }, { n: { type: "number", max: 0 } })).toBe(
            "[StorageHelper] Validation failed: n must be <= 0, got 1"
        );
    });

    test("a non-number value is reported ONCE, as a type error — bounds are not applied", () => {
        // Guard `typeof value === "number"`: without it JS would coerce and add a spurious
        // `"3" must be >= 5` on top of the type error.
        expect(failureOf({ n: "3" }, { n: { type: "number", min: 5 } })).toBe(
            "[StorageHelper] Validation failed: Invalid type for n: expected number, got string"
        );
    });

    // ── B.7-D4 — CORRIGÉ : les bornes s'appliquent à toute valeur numérique ──

    test("min/max are enforced on a numeric value even without `type: 'number'`", () => {
        // Was DEFECT B.7-D4: the check was gated on the DECLARED type, so a schema written
        // `{ min: 5 }` enforced nothing and said nothing — silence instead of a check or an
        // error.
        expect(() => StorageHelper.validateBeforeStore({ n: 4 }, { n: { min: 5 } })).toThrow(
            "n must be >= 5"
        );
        expect(() => StorageHelper.validateBeforeStore({ n: 99 }, { n: { max: 5 } })).toThrow(
            "n must be <= 5"
        );
        // In range still passes, and a non-numeric value is left to the type check.
        expect(StorageHelper.validateBeforeStore({ n: 7 }, { n: { min: 5, max: 9 } })).toBe(true);
        expect(StorageHelper.validateBeforeStore({ n: "x" }, { n: { min: 5 } })).toBe(true);
    });
});

describe("StorageHelper._validateField — custom validator", () => {
    test("a validator returning false fails the field, receiving the raw value", () => {
        const validate = vi.fn(() => false);
        expect(failureOf({ v: { deep: 1 } }, { v: { validate } })).toBe(
            "[StorageHelper] Validation failed: Custom validation failed for v"
        );
        expect(validate).toHaveBeenCalledWith({ deep: 1 });
    });

    test("a validator returning true passes", () => {
        expect(StorageHelper.validateBeforeStore({ v: 1 }, { v: { validate: () => true } })).toBe(
            true
        );
    });

    test("a throwing validator is caught and reported with its message", () => {
        const schema = {
            v: {
                validate: () => {
                    throw new Error("boom");
                },
            },
        };
        expect(failureOf({ v: 1 }, schema)).toBe(
            "[StorageHelper] Validation failed: Custom validation error for v: boom"
        );
    });

    test("a non-function `validate` rule is ignored instead of crashing", () => {
        expect(StorageHelper.validateBeforeStore({ v: 1 }, { v: { validate: "nope" } })).toBe(true);
    });
});
