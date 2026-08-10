/**
 * @fileoverview Unit tests for DOMSecurity — setTextContent, setSafeHTML, SVG icons
 * @phase C12 — Coverage push (ESM: import + jest.mock Log)
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { DOMSecurity } from "../../src/kernel/security/dom-security.js";
// Le fichier liait ce même export sous DEUX noms locaux : `Security` dans le beforeAll,
// `security` dans deux `it()`. Les deux liaisons sont conservées telles quelles.
import { Security, Security as security } from "../../src/kernel/security/index.js";

describe("DOMSecurity", () => {
    beforeAll(() => {
        global.GeoLeaf = global.GeoLeaf || {};
        global.GeoLeaf.Security = Security;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ─── setTextContent ───────────────────────────────────────────────────────

    describe("setTextContent", () => {
        test("should set textContent of element", () => {
            const el = document.createElement("div");
            DOMSecurity.setTextContent(el, "Hello World");
            expect(el.textContent).toBe("Hello World");
        });

        test("should convert number to string", () => {
            const el = document.createElement("div");
            DOMSecurity.setTextContent(el, 42);
            expect(el.textContent).toBe("42");
        });

        test("should set empty string for null", () => {
            const el = document.createElement("div");
            el.textContent = "initial";
            DOMSecurity.setTextContent(el, null);
            expect(el.textContent).toBe("");
        });

        test("should set empty string for undefined", () => {
            const el = document.createElement("div");
            DOMSecurity.setTextContent(el, undefined);
            expect(el.textContent).toBe("");
        });

        test("should prevent XSS — script tags stored as literal text", () => {
            const el = document.createElement("div");
            DOMSecurity.setTextContent(el, "<script>alert(1)</script>");
            // textContent stores as text — not parsed as HTML
            expect(el.innerHTML).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
        });

        test("should do nothing for null element", () => {
            expect(() => DOMSecurity.setTextContent(null, "text")).not.toThrow();
        });

        test("should do nothing for element without nodeType", () => {
            expect(() => DOMSecurity.setTextContent({}, "text")).not.toThrow();
        });
    });

    // ─── setSafeHTML ──────────────────────────────────────────────────────────

    describe("setSafeHTML", () => {
        test("should inject sanitized HTML when Security is available", () => {
            const el = document.createElement("div");
            // Security.sanitizeHTML is available since we loaded security module
            DOMSecurity.setSafeHTML(el, "<strong>Bold</strong>");
            // After sanitization, strong tag should remain (it is in the default allowlist)
            expect(el.innerHTML).toContain("strong");
        });

        test("setSafeHTML should produce textContent without dangerous tags", () => {
            // Security is loaded — setSafeHTML calls Security.sanitizeHTML
            // sanitizeHTML with default allowlist keeps <b>/<strong>/<em> but strips scripts
            const el = document.createElement("div");
            DOMSecurity.setSafeHTML(el, "<b>safe</b>");
            // textContent strips all HTML tags → plain text of the rendered content
            expect(el.textContent).toBe("safe");
        });

        test("should do nothing for null element", () => {
            expect(() => DOMSecurity.setSafeHTML(null, "<b>text</b>")).not.toThrow();
        });

        test("should strip scripts even without Security module", () => {
            const el = document.createElement("div");
            const savedSecurity = global.GeoLeaf.Security;
            delete global.GeoLeaf.Security;
            DOMSecurity.setSafeHTML(el, "<script>bad()</script>text");
            // Should not contain script as parsed HTML
            expect(el.querySelector("script")).toBeNull();
            global.GeoLeaf.Security = savedSecurity;
        });

        test("should call Security.sanitizeHTML with allowedTags when provided", () => {
            const el = document.createElement("div");
            DOMSecurity.setSafeHTML(el, "<b>bold</b>", ["b", "strong"]);
            expect(el.textContent).toBe("bold");
        });

        test("should use textContent fallback when Security.sanitizeHTML is not a function", () => {
            const origSanitize = security.sanitizeHTML;
            delete security.sanitizeHTML;
            const el = document.createElement("div");
            DOMSecurity.setSafeHTML(el, "safe text");
            expect(el.textContent).toBe("safe text");
            security.sanitizeHTML = origSanitize;
        });

        test("should use empty string fallback for null html when Security unavailable", () => {
            const origSanitize = security.sanitizeHTML;
            delete security.sanitizeHTML;
            const el = document.createElement("div");
            DOMSecurity.setSafeHTML(el, null);
            expect(el.textContent).toBe("");
            security.sanitizeHTML = origSanitize;
        });
    });

    // ─── clearElement ─────────────────────────────────────────────────────────

    describe("clearElement", () => {
        test("should remove all children", () => {
            const el = document.createElement("div");
            el.appendChild(document.createElement("span"));
            el.appendChild(document.createElement("p"));
            el.appendChild(document.createTextNode("text"));
            expect(el.childNodes.length).toBe(3);

            DOMSecurity.clearElement(el);
            expect(el.childNodes.length).toBe(0);
        });

        test("should work on already-empty element", () => {
            const el = document.createElement("div");
            expect(() => DOMSecurity.clearElement(el)).not.toThrow();
            expect(el.childNodes.length).toBe(0);
        });

        test("should do nothing for null element", () => {
            expect(() => DOMSecurity.clearElement(null)).not.toThrow();
        });
    });

    // ─── clearElementFast ─────────────────────────────────────────────────────

    describe("clearElementFast", () => {
        test("should clear element via textContent", () => {
            const el = document.createElement("div");
            el.innerHTML = "<span>one</span><b>two</b>";
            DOMSecurity.clearElementFast(el);
            expect(el.textContent).toBe("");
            expect(el.childNodes.length).toBe(0);
        });

        test("should do nothing for null element", () => {
            expect(() => DOMSecurity.clearElementFast(null)).not.toThrow();
        });
    });

    // ─── createElement ────────────────────────────────────────────────────────

    // ─── createSVGIcon ────────────────────────────────────────────────────────

    describe("createSVGIcon", () => {
        test("should create SVG element", () => {
            const svg = DOMSecurity.createSVGIcon(18, 18, "M6 9l6 6 6-6");
            expect(svg.tagName.toLowerCase()).toContain("svg");
        });

        test("should set width and height", () => {
            const svg = DOMSecurity.createSVGIcon(24, 32, "M0 0");
            expect(svg.getAttribute("width")).toBe("24");
            expect(svg.getAttribute("height")).toBe("32");
        });

        test("should include a path element", () => {
            const svg = DOMSecurity.createSVGIcon(18, 18, "M6 9l6 6 6-6");
            const path = svg.querySelector("path");
            expect(path).not.toBeNull();
            expect(path.getAttribute("d")).toBe("M6 9l6 6 6-6");
        });

        test("should accept custom options", () => {
            const svg = DOMSecurity.createSVGIcon(18, 18, "M0 0", {
                fill: "red",
                stroke: "blue",
                strokeWidth: "3",
            });
            expect(svg.getAttribute("fill")).toBe("red");
            expect(svg.getAttribute("stroke")).toBe("blue");
            expect(svg.getAttribute("stroke-width")).toBe("3");
        });
    });

    // ─── getIcon ──────────────────────────────────────────────────────────────

    describe("getIcon", () => {
        test("should return SVG for known icon name", () => {
            const icon = DOMSecurity.getIcon("home");
            expect(icon).not.toBeNull();
            expect(icon.tagName.toLowerCase()).toContain("svg");
        });

        test("should return null for unknown icon name", () => {
            const icon = DOMSecurity.getIcon("nonexistent-icon-xyz");
            expect(icon).toBeNull();
        });

        test("should accept custom size", () => {
            const icon = DOMSecurity.getIcon("close", 32);
            expect(icon).toBeDefined();
        });

        test("should expose predefined SVG_ICONS", () => {
            expect(DOMSecurity.SVG_ICONS).toBeDefined();
            expect(typeof DOMSecurity.SVG_ICONS).toBe("object");
            expect(DOMSecurity.SVG_ICONS["chevron-down"]).toBeDefined();
        });
    });
});
