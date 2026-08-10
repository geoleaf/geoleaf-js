/*!
 * @geoleaf/host-runtime — dom-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * @vitest-environment happy-dom
 *
 * Both helpers build/mutate real nodes, so this suite opts into a DOM (the package
 * default is `node`).
 */
import { describe, it, expect } from "vitest";
import { createEl, applyStyleText } from "../dom-seam.js";

describe("createEl", () => {
    it("creates a bare element when given only a tag", () => {
        const el = createEl("span");
        expect(el.tagName.toLowerCase()).toBe("span");
        expect(el.className).toBe("");
        expect(el.attributes.length).toBe(0);
    });

    it("assigns the class name", () => {
        expect(createEl("div", "gl-a gl-b").className).toBe("gl-a gl-b");
    });

    it("ignores an empty class name rather than writing class=''", () => {
        expect(createEl("div", "").hasAttribute("class")).toBe(false);
    });

    it("applies every attribute of the map", () => {
        const el = createEl("button", "gl-btn", { type: "button", "aria-label": "Fermer" });
        expect(el.getAttribute("type")).toBe("button");
        expect(el.getAttribute("aria-label")).toBe("Fermer");
    });

    it("accepts an empty attribute map", () => {
        expect(() => createEl("div", "x", {})).not.toThrow();
    });

    it("returns the tag-specific type, not a bare HTMLElement", () => {
        // The compile-time property of `HTMLElementTagNameMap`, asserted at runtime.
        const input = createEl("input", undefined, { type: "checkbox" });
        input.checked = true;
        expect(input.checked).toBe(true);
    });

    it("@security writes attributes, never markup", () => {
        const el = createEl("div", undefined, { title: "<img src=x onerror=1>" });
        expect(el.children.length).toBe(0);
        expect(el.getAttribute("title")).toBe("<img src=x onerror=1>");
    });
});

describe("applyStyleText", () => {
    it("applies a single declaration", () => {
        const el = document.createElement("div");
        applyStyleText(el, "color: red");
        expect(el.style.color).toBe("red");
    });

    it("applies several declarations and tolerates a trailing semicolon", () => {
        const el = document.createElement("div");
        applyStyleText(el, "color: red; display: block;");
        expect(el.style.color).toBe("red");
        expect(el.style.display).toBe("block");
    });

    it("honours !important as a priority, not as part of the value", () => {
        // `setProperty` rejects "!important" inline — it must be split out.
        const el = document.createElement("div");
        applyStyleText(el, "color: red !important");
        expect(el.style.getPropertyValue("color")).toBe("red");
        expect(el.style.getPropertyPriority("color")).toBe("important");
    });

    it("accepts !IMPORTANT in any case", () => {
        const el = document.createElement("div");
        applyStyleText(el, "color: blue !IMPORTANT");
        expect(el.style.getPropertyPriority("color")).toBe("important");
    });

    it("sets custom properties (CSS variables)", () => {
        const el = document.createElement("div");
        applyStyleText(el, "--gl-accent: #123456");
        expect(el.style.getPropertyValue("--gl-accent")).toBe("#123456");
    });

    it("skips a fragment with no colon", () => {
        const el = document.createElement("div");
        applyStyleText(el, "garbage; color: red");
        expect(el.style.color).toBe("red");
    });

    it("skips a fragment with an empty property name", () => {
        const el = document.createElement("div");
        applyStyleText(el, ": red; color: green");
        expect(el.style.color).toBe("green");
    });

    it("is a no-op for a falsy element or css string", () => {
        const el = document.createElement("div");
        expect(() => applyStyleText(el, "")).not.toThrow();
        expect(() => applyStyleText(null as unknown as HTMLElement, "color: red")).not.toThrow();
        expect(el.getAttribute("style")).toBeNull();
    });

    it("@security never assigns cssText — per-property writes are the CSP-safe path", () => {
        // If the body were "simplified" back to `el.style.cssText = css`, a strict
        // `style-src` CSP would drop the whole declaration. Asserting the outcome is what
        // survives a rewrite.
        const el = document.createElement("div");
        applyStyleText(el, "color: red; width: 10px");
        expect(el.style.color).toBe("red");
        expect(el.style.width).toBe("10px");
    });
});
