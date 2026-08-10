/**
 * Equivalence guard: the shared `domCreate` test double must behave exactly like
 * the real factory.
 *
 * This is the piece that makes the double safe. Seven test files stub `domCreate`;
 * before KERNEL S14 each carried its own copy and six of them had drifted — one
 * dropped `parent` entirely, so components that rely on insertion were never
 * inserted under test while passing green.
 *
 * ADR-10 plans to EXTEND `domCreate` (the 40 `$create` call sites need
 * `textContent` / `attributes` / `dataset` / `on*`, none of which it handles).
 * The day that happens, this suite goes red and names the single file to update —
 * instead of seven stubs silently asserting against a shape production no longer has.
 */

import { domCreate } from "../../src/utils/general/dom-helpers.js";
import { domCreateDouble } from "../_helpers/dom-create-double.js";

/** Argument matrix covering every branch of the factory, sharp edges included. */
const CASES = [
    ["div"],
    ["span", "gl-x"],
    ["button", "gl-btn gl-primary"],
    ["a", undefined],
    ["input", ""], // falsy class → no attribute written
    ["p", null],
    // Array class: the real factory assigns it as-is, so it stringifies to "a,b".
    // One historical stub joined arrays into "a b" instead — a divergence this
    // matrix missed until a mutation run exposed the blind spot.
    ["ul", ["a", "b"]],
    ["li", "single", "PARENT"], // sentinel: replaced by a fresh parent per side
    ["section", undefined, "PARENT"],
    ["h3", "", "PARENT"],
];

/** Runs one case against a factory, returning an observable description. */
function observe(factory, [tag, className, parentSentinel]) {
    const parent = parentSentinel === "PARENT" ? document.createElement("main") : undefined;
    const el = factory(tag, className, parent);
    return {
        tagName: el.tagName,
        className: el.className,
        hasClassAttr: el.hasAttribute("class"),
        attributes: el.getAttributeNames().sort(),
        appended: parent ? parent.firstElementChild === el : null,
        parentChildCount: parent ? parent.children.length : null,
        isSameRef: parent ? el === parent.firstElementChild : null,
    };
}

describe("domCreate — shared test double ≡ real factory", () => {
    it.each(CASES)("behaves identically for (%s, %s, %s)", (...args) => {
        expect(observe(domCreateDouble, args)).toEqual(observe(domCreate, args));
    });

    it("throws on an empty tag, exactly like the original", () => {
        expect(() => domCreate("")).toThrow();
        expect(() => domCreateDouble("")).toThrow();
    });

    it("exposes the same arity — a dropped parameter is how the drift started", () => {
        expect(domCreateDouble.length).toBe(domCreate.length);
    });
});
