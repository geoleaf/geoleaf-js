/**
 * Unit suite for `domCreate` — the factory ADR-10 designates as canonical.
 *
 * ⚠️ It had **none** until now. Its 16 mentions across the test tree were all
 * `vi.fn()` stubs (which *replace* it, so they assert the stub's behaviour) or
 * comments noting it "works natively in jsdom — no mock needed" (so it passed
 * through unasserted). Meanwhile `createElement`, the factory ADR-10 says to
 * migrate AWAY from, had 17 dedicated cases.
 *
 * That asymmetry is why this file exists: the ADR-10 migration REQUIRES extending
 * `domCreate` (it handles none of the props the 40 `$create` call sites use —
 * `textContent`, `attributes`, `dataset`, `on*`). Extending an untested function
 * and moving 40 call sites onto it would have been a blind change.
 *
 * These cases pin the CURRENT behaviour, deliberately including the sharp edges
 * (falsy guards, the throw on an empty tag) — a migration must decide about them
 * explicitly rather than change them by accident.
 */

import { domCreate } from "../../src/utils/general/dom-helpers.js";

describe("utils/dom-helpers — domCreate (canonical factory, ADR-10)", () => {
    describe("tag", () => {
        it("creates an element of the requested tag", () => {
            expect(domCreate("div").tagName).toBe("DIV");
            expect(domCreate("button").tagName).toBe("BUTTON");
            expect(domCreate("a").tagName).toBe("A");
        });

        it("returns a real element carrying its tag-specific properties", () => {
            // The reason ADR-10 prefers it: the overload returns HTMLElementTagNameMap[K],
            // so `.value` / `.href` compile without a cast. Checked here at runtime.
            const input = domCreate("input");
            input.value = "x";
            expect(input.value).toBe("x");

            const anchor = domCreate("a");
            anchor.href = "https://example.test/";
            expect(anchor.href).toBe("https://example.test/");
        });

        it("throws on an empty tag — it does NOT silently fall back to div", () => {
            // Several test doubles used to write `tag || "div"`. The real function has
            // no such fallback; `document.createElement("")` throws. Pinned so a mock
            // cannot quietly re-introduce a behaviour production does not have.
            expect(() => domCreate("")).toThrow();
        });
    });

    describe("className", () => {
        it("sets the class when provided", () => {
            expect(domCreate("div", "gl-panel").className).toBe("gl-panel");
        });

        it("accepts several classes in one space-separated string", () => {
            const el = domCreate("div", "gl-btn gl-primary");
            expect(el.className).toBe("gl-btn gl-primary");
            expect(el.classList.contains("gl-btn")).toBe(true);
            expect(el.classList.contains("gl-primary")).toBe(true);
        });

        it("leaves the class empty when omitted", () => {
            expect(domCreate("div").className).toBe("");
        });

        it("writes NO class attribute for an empty string — the guard is falsy, not nullish", () => {
            // `.className` reads `""` under both guards, so it cannot tell them apart.
            // The observable difference is the ATTRIBUTE: a falsy guard skips the
            // assignment entirely, a nullish one would write `class=""`.
            const el = domCreate("div", "");
            expect(el.className).toBe("");
            expect(el.hasAttribute("class")).toBe(false);
        });

        it("does NOT accept an array of classes", () => {
            // One test double joined arrays. The real function assigns as-is, so an
            // array stringifies with a comma — which is NOT valid class syntax.
            const el = domCreate("div", ["a", "b"]);
            expect(el.className).toBe("a,b");
            expect(el.classList.contains("a")).toBe(false);
        });
    });

    describe("parent", () => {
        it("appends to the parent when provided", () => {
            const parent = document.createElement("section");
            const child = domCreate("div", undefined, parent);
            expect(child.parentElement).toBe(parent);
            expect(parent.children).toHaveLength(1);
        });

        it("does not append when the parent is omitted", () => {
            expect(domCreate("div").parentElement).toBeNull();
        });

        it("appends in call order", () => {
            const parent = document.createElement("section");
            domCreate("span", "first", parent);
            domCreate("span", "second", parent);
            expect([...parent.children].map((c) => c.className)).toEqual(["first", "second"]);
        });

        it("sets the class AND appends when both are given", () => {
            const parent = document.createElement("section");
            const el = domCreate("button", "gl-btn", parent);
            expect(el.className).toBe("gl-btn");
            expect(el.parentElement).toBe(parent);
        });
    });

    describe("return value", () => {
        it("returns the very element it appended (same reference)", () => {
            const parent = document.createElement("section");
            const returned = domCreate("div", "x", parent);
            expect(returned).toBe(parent.firstElementChild);
        });

        it("creates a distinct element on each call", () => {
            expect(domCreate("div")).not.toBe(domCreate("div"));
        });
    });

    describe("what it deliberately does NOT do", () => {
        // Pinned because the ADR-10 migration would have to ADD these. Today a caller
        // passing them gets silence, not an error — which is exactly how the
        // `options.styles` vs `props.style` loss described in the ADR happened.
        it("ignores a props bag — it is positional, not declarative", () => {
            const el = domCreate("div", { className: "x", textContent: "hello" });
            expect(el.textContent).toBe("");
            // The object is assigned to className verbatim, becoming "[object Object]".
            expect(el.className).toBe("[object Object]");
        });

        it("sets no id, dataset, attribute or handler", () => {
            const el = domCreate("div", "gl-x");
            expect(el.id).toBe("");
            expect(Object.keys(el.dataset)).toHaveLength(0);
            expect(el.getAttributeNames()).toEqual(["class"]);
        });
    });
});
