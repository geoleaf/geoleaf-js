/*!
 * @geoleaf/host-runtime — core-utils-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * @vitest-environment happy-dom
 *
 * `createSVGIcon` and `clearElementFast` build/mutate real nodes, so this suite opts
 * into a DOM (the package default is `node`). Ported from `plugin-table`'s
 * `internal-utils.test.ts` at STRUCT S2 (F3), where the assertions had become
 * library coverage living in a plugin suite, plus the cases that file did not carry.
 */
import { describe, it, expect } from "vitest";
import { getNestedValue, createSVGIcon, clearElementFast } from "../core-utils-seam.js";

describe("getNestedValue", () => {
    it("retrieves a nested value via a dotted path", () => {
        expect(getNestedValue({ properties: { name: "Alice" } }, "properties.name")).toBe("Alice");
    });

    it("retrieves a single-segment path", () => {
        expect(getNestedValue({ a: 1 }, "a")).toBe(1);
    });

    it("walks arbitrarily deep", () => {
        expect(getNestedValue({ a: { b: { c: { d: "deep" } } } }, "a.b.c.d")).toBe("deep");
    });

    it("preserves falsy leaf values that are not undefined", () => {
        // The `!== undefined` guard, not a truthiness test — 0, "" and false are data.
        expect(getNestedValue({ a: 0 }, "a")).toBe(0);
        expect(getNestedValue({ a: "" }, "a")).toBe("");
        expect(getNestedValue({ a: false }, "a")).toBe(false);
        expect(getNestedValue({ a: null }, "a")).toBeNull();
    });

    it("returns null when the object is null/undefined", () => {
        expect(getNestedValue(null, "a")).toBeNull();
        expect(getNestedValue(undefined, "a")).toBeNull();
    });

    it("returns null when the input is not an object", () => {
        expect(getNestedValue("string" as unknown as object, "a")).toBeNull();
    });

    it("returns null when the path is empty or not a string", () => {
        expect(getNestedValue({ a: 1 }, "")).toBeNull();
        expect(getNestedValue({ a: 1 }, null as unknown as string)).toBeNull();
    });

    it("returns null when an intermediate segment is null", () => {
        expect(getNestedValue({ a: null }, "a.b")).toBeNull();
    });

    it("returns null when the leaf value is undefined", () => {
        expect(getNestedValue({ a: { b: undefined } }, "a.b")).toBeNull();
    });

    it("returns null when a segment is absent altogether", () => {
        expect(getNestedValue({ a: { b: 1 } }, "a.z.y")).toBeNull();
    });
});

describe("createSVGIcon", () => {
    it("builds an <svg> with a child <path> using the defaults", () => {
        const svg = createSVGIcon(16, 16, "M0 0h24v24H0z");
        expect(svg.tagName.toLowerCase()).toBe("svg");
        expect(svg.getAttribute("width")).toBe("16");
        expect(svg.getAttribute("height")).toBe("16");
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.getAttribute("fill")).toBe("none");
        expect(svg.getAttribute("stroke")).toBe("currentColor");
        expect(svg.getAttribute("stroke-width")).toBe("2");
        expect(svg.getAttribute("stroke-linecap")).toBe("round");
        expect(svg.getAttribute("stroke-linejoin")).toBe("round");
        const path = svg.querySelector("path");
        expect(path).not.toBeNull();
        expect(path?.getAttribute("d")).toBe("M0 0h24v24H0z");
    });

    it("applies explicit option overrides", () => {
        const svg = createSVGIcon(24, 24, "M1 1", {
            viewBox: "0 0 32 32",
            fill: "red",
            stroke: "blue",
            strokeWidth: 3,
            strokeLinecap: "butt",
            strokeLinejoin: "miter",
        });
        expect(svg.getAttribute("viewBox")).toBe("0 0 32 32");
        expect(svg.getAttribute("fill")).toBe("red");
        expect(svg.getAttribute("stroke")).toBe("blue");
        expect(svg.getAttribute("stroke-width")).toBe("3");
        expect(svg.getAttribute("stroke-linecap")).toBe("butt");
        expect(svg.getAttribute("stroke-linejoin")).toBe("miter");
    });

    it("creates the nodes in the SVG namespace, not the HTML one", () => {
        const svg = createSVGIcon(8, 8, "M0 0");
        expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
        expect(svg.querySelector("path")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    });

    it("@security never interprets the path string as markup", () => {
        const svg = createSVGIcon(8, 8, '"><script>alert(1)</script>');
        expect(svg.querySelector("script")).toBeNull();
        expect(svg.querySelector("path")?.getAttribute("d")).toBe('"><script>alert(1)</script>');
    });
});

describe("clearElementFast", () => {
    it("empties an element's content", () => {
        const div = document.createElement("div");
        div.textContent = "stuff";
        clearElementFast(div);
        expect(div.textContent).toBe("");
    });

    it("removes child ELEMENTS, not only text", () => {
        const div = document.createElement("div");
        div.appendChild(document.createElement("span"));
        div.appendChild(document.createElement("span"));
        clearElementFast(div);
        expect(div.childNodes.length).toBe(0);
    });

    it("@security empties via textContent — the content cannot be re-interpreted", () => {
        const div = document.createElement("div");
        div.appendChild(document.createElement("span"));
        clearElementFast(div);
        // A naive `innerHTML = ""` would be equivalent here; asserting the OUTCOME is
        // what protects the invariant if the body is ever rewritten.
        expect(div.innerHTML).toBe("");
    });

    it("is a no-op for null (does not throw)", () => {
        expect(() => clearElementFast(null)).not.toThrow();
    });

    it("is a no-op for undefined", () => {
        expect(() => clearElementFast(undefined)).not.toThrow();
    });

    it("is a no-op for an object without nodeType", () => {
        expect(() => clearElementFast({} as unknown as HTMLElement)).not.toThrow();
    });
});
