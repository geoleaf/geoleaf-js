/**
 *
 * Extended Security tests for GeoLeaf — ESM, no global.GeoLeaf (migrated from legacy CJS bridge).
 * Covers sanitizeSvgContent, validateNumber, parseHtmlSafely and other methods.
 */

const mockLog = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({
    Log: mockLog,
}));

import { Security } from "../../src/kernel/security/index.js";

describe("GeoLeaf.Security Extended", () => {
    // ============================================
    // SANITIZE SVG CONTENT TESTS
    // ============================================
    describe("sanitizeSvgContent()", () => {
        test("method exists and is callable", () => {
            expect(typeof Security.sanitizeSvgContent).toBe("function");
        });

        test("returns null for null input", () => {
            expect(Security.sanitizeSvgContent(null)).toBeNull();
        });

        test("returns null for undefined input", () => {
            expect(Security.sanitizeSvgContent(undefined)).toBeNull();
        });

        test("returns null for empty string", () => {
            expect(Security.sanitizeSvgContent("")).toBeNull();
        });

        test("returns null for non-string input", () => {
            expect(Security.sanitizeSvgContent(123)).toBeNull();
            expect(Security.sanitizeSvgContent({})).toBeNull();
        });

        test("parses valid SVG content", () => {
            const svg = '<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>';
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            expect(result.tagName.toLowerCase()).toBe("svg");
        });

        test("returns null for invalid SVG", () => {
            const invalid = "<div>not an svg</div>";
            const result = Security.sanitizeSvgContent(invalid);

            expect(result).toBeNull();
        });

        test("removes script elements from SVG", () => {
            const svg = '<svg><script>alert(1)</script><circle cx="50" cy="50" r="40"/></svg>';
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            expect(result.querySelector("script")).toBeNull();
        });

        test("removes onclick attributes from child elements", () => {
            const svg = '<svg><rect onclick="alert(1)" width="100" height="100"/></svg>';
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            const rect = result.querySelector("rect");
            if (rect) {
                expect(rect.hasAttribute("onclick")).toBe(false);
            }
        });

        test("removes onerror attributes", () => {
            const svg = '<svg><image onerror="alert(1)" href="x"/></svg>';
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            const image = result.querySelector("image");
            if (image) {
                expect(image.hasAttribute("onerror")).toBe(false);
            }
        });

        test("removes javascript: href", () => {
            const jsHref = "javascript" + ":alert(1)";
            const svg = '<svg><a href="' + jsHref + '"><text>Click</text></a></svg>';
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            const link = result.querySelector("a");
            if (link) {
                expect(link.hasAttribute("href")).toBe(false);
            }
        });

        test("handles malformed SVG gracefully", () => {
            const malformed = "<svg><circle not closed";
            expect(() => Security.sanitizeSvgContent(malformed)).not.toThrow();
        });

        // SMIL animation vectors (audit L3) — these elements can mutate
        // attributes at runtime or fire begin/end events, so they are stripped.
        test("removes <set> SMIL element (attribute mutation vector)", () => {
            const jsHref = "javascript" + ":alert(1)";
            const svg =
                '<svg><a href="#"><set attributeName="href" to="' +
                jsHref +
                '"/><text>x</text></a></svg>';
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            expect(result.querySelector("set")).toBeNull();
        });

        test("removes <animate> SMIL element", () => {
            const svg =
                '<svg><rect width="10" height="10"><animate attributeName="x" begin="0s" to="100"/></rect></svg>';
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            expect(result.querySelector("animate")).toBeNull();
        });

        test("removes animateTransform / animateMotion / animateColor / mpath", () => {
            const svg =
                "<svg>" +
                '<rect width="10" height="10">' +
                '<animateTransform attributeName="transform" type="rotate" to="90"/>' +
                '<animateColor attributeName="fill" to="red"/>' +
                "</rect>" +
                '<animateMotion path="M0,0 L100,100"><mpath href="#p"/></animateMotion>' +
                "</svg>";
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            expect(result.querySelector("animateTransform")).toBeNull();
            expect(result.querySelector("animateMotion")).toBeNull();
            expect(result.querySelector("animateColor")).toBeNull();
            expect(result.querySelector("mpath")).toBeNull();
        });

        test("keeps benign shapes while stripping SMIL siblings", () => {
            const svg =
                '<svg><circle cx="50" cy="50" r="40"/><animate attributeName="r" to="80"/></svg>';
            const result = Security.sanitizeSvgContent(svg);

            expect(result).not.toBeNull();
            expect(result.querySelector("circle")).not.toBeNull();
            expect(result.querySelector("animate")).toBeNull();
        });
    });

    // ============================================
    // VALIDATE NUMBER TESTS
    // ============================================
    describe("validateNumber()", () => {
        test("method exists and is callable", () => {
            expect(typeof Security.validateNumber).toBe("function");
        });

        test("returns valid number for numeric string", () => {
            expect(Security.validateNumber("123")).toBe(123);
        });

        test("returns valid number for actual number", () => {
            expect(Security.validateNumber(456)).toBe(456);
        });

        test("returns valid number for float", () => {
            expect(Security.validateNumber("3.14")).toBeCloseTo(3.14);
        });

        test("returns valid negative number", () => {
            expect(Security.validateNumber("-42")).toBe(-42);
        });

        test("returns null for non-numeric string", () => {
            expect(Security.validateNumber("abc")).toBeNull();
        });

        test("returns null for script injection attempt", () => {
            expect(Security.validateNumber("<script>")).toBeNull();
        });

        test("returns null for NaN", () => {
            expect(Security.validateNumber(NaN)).toBeNull();
        });

        test("returns null for Infinity", () => {
            expect(Security.validateNumber(Infinity)).toBeNull();
            expect(Security.validateNumber(-Infinity)).toBeNull();
        });

        test("respects minimum bound", () => {
            expect(Security.validateNumber(5, 0, 100)).toBe(5);
            expect(Security.validateNumber(-5, 0, 100)).toBeNull();
        });

        test("respects maximum bound", () => {
            expect(Security.validateNumber(50, 0, 100)).toBe(50);
            expect(Security.validateNumber(150, 0, 100)).toBeNull();
        });

        test("handles edge cases at bounds", () => {
            expect(Security.validateNumber(0, 0, 100)).toBe(0);
            expect(Security.validateNumber(100, 0, 100)).toBe(100);
        });

        test("works with only min bound", () => {
            expect(Security.validateNumber(1000, 0)).toBe(1000);
            expect(Security.validateNumber(-1, 0)).toBeNull();
        });

        test("works with only max bound", () => {
            expect(Security.validateNumber(-1000, -Infinity, 0)).toBe(-1000);
            expect(Security.validateNumber(1, -Infinity, 0)).toBeNull();
        });
    });

    // ============================================
    // PARSE HTML SAFELY TESTS
    // ============================================
    describe("parseHtmlSafely()", () => {
        test("method exists and is callable", () => {
            expect(typeof Security.parseHtmlSafely).toBe("function");
        });

        test("returns DocumentFragment for valid input", () => {
            const result = Security.parseHtmlSafely("<p>Hello</p>");
            expect(result instanceof DocumentFragment).toBe(true);
        });

        test("returns empty fragment for null input", () => {
            const result = Security.parseHtmlSafely(null);
            expect(result instanceof DocumentFragment).toBe(true);
            expect(result.childNodes.length).toBe(0);
        });

        test("returns empty fragment for undefined input", () => {
            const result = Security.parseHtmlSafely(undefined);
            expect(result.childNodes.length).toBe(0);
        });

        test("returns empty fragment for non-string input", () => {
            const result = Security.parseHtmlSafely(123);
            expect(result.childNodes.length).toBe(0);
        });

        test("preserves allowed tags", () => {
            const html = "<p>Paragraph</p><strong>Bold</strong><em>Italic</em>";
            const result = Security.parseHtmlSafely(html);

            const div = document.createElement("div");
            div.appendChild(result.cloneNode(true));

            expect(div.querySelector("p")).not.toBeNull();
            expect(div.querySelector("strong")).not.toBeNull();
            expect(div.querySelector("em")).not.toBeNull();
        });

        test("removes script tags", () => {
            const html = "<p>Hello</p><script>alert(1)</script>";
            const result = Security.parseHtmlSafely(html);

            const div = document.createElement("div");
            div.appendChild(result.cloneNode(true));

            expect(div.querySelector("script")).toBeNull();
        });

        test("removes disallowed tags but keeps text", () => {
            const html = "<div>Content in div</div>";
            const result = Security.parseHtmlSafely(html);

            const div = document.createElement("div");
            div.appendChild(result.cloneNode(true));

            expect(div.querySelector("div")).toBeNull();
            expect(div.textContent).toContain("Content in div");
        });

        test("validates href in links", () => {
            const html = '<a href="https://example.com">Link</a>';
            const result = Security.parseHtmlSafely(html);

            const div = document.createElement("div");
            div.appendChild(result.cloneNode(true));

            const link = div.querySelector("a");
            if (link) {
                expect(link.getAttribute("href")).toBe("https://example.com/");
                expect(link.getAttribute("rel")).toBe("noopener noreferrer");
                expect(link.getAttribute("target")).toBe("_blank");
            }
        });

        test("removes javascript: links", () => {
            const jsHref = "javascript" + ":alert(1)";
            const html = '<a href="' + jsHref + '">Bad Link</a>';
            const result = Security.parseHtmlSafely(html);

            const div = document.createElement("div");
            div.appendChild(result.cloneNode(true));

            const link = div.querySelector("a");
            if (link) {
                const href = link.getAttribute("href");
                const jsProto = "javascript" + ":";
                expect(href === null || !href.includes(jsProto)).toBe(true);
            }
        });

        test("accepts custom allowed tags", () => {
            const html = "<div>Div</div><span>Span</span>";
            const result = Security.parseHtmlSafely(html, ["div"]);

            const container = document.createElement("div");
            container.appendChild(result.cloneNode(true));

            expect(container.querySelector("div")).not.toBeNull();
            expect(container.querySelector("span")).toBeNull();
        });

        test("handles nested elements", () => {
            const html = "<p><strong><em>Nested</em></strong></p>";
            const result = Security.parseHtmlSafely(html);

            const div = document.createElement("div");
            div.appendChild(result.cloneNode(true));

            expect(div.textContent).toBe("Nested");
        });

        test("handles list elements", () => {
            const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
            const result = Security.parseHtmlSafely(html);

            const div = document.createElement("div");
            div.appendChild(result.cloneNode(true));

            expect(div.querySelector("ul")).not.toBeNull();
            expect(div.querySelectorAll("li").length).toBe(2);
        });
    });

    // ============================================
    // CONTAINS DANGEROUS HTML TESTS
    // ============================================
    describe("containsDangerousHtml()", () => {
        test("method exists and is callable", () => {
            expect(typeof Security.containsDangerousHtml).toBe("function");
        });

        test("returns false for safe text", () => {
            expect(Security.containsDangerousHtml("Hello World")).toBe(false);
        });

        test("returns true for script tags", () => {
            expect(Security.containsDangerousHtml("<script>alert(1)</script>")).toBe(true);
        });

        test("returns true for javascript: protocol", () => {
            const jsStr = "javascript" + ":alert(1)";
            expect(Security.containsDangerousHtml(jsStr)).toBe(true);
        });

        test("returns true for onclick handler", () => {
            expect(Security.containsDangerousHtml('<div onclick="alert(1)">')).toBe(true);
        });

        test("returns true for onerror handler", () => {
            expect(Security.containsDangerousHtml('<img onerror="alert(1)">')).toBe(true);
        });

        test("returns true for iframe", () => {
            expect(Security.containsDangerousHtml('<iframe src="evil.html">')).toBe(true);
        });

        test("returns true for object tag", () => {
            expect(Security.containsDangerousHtml('<object data="evil.swf">')).toBe(true);
        });

        test("returns true for embed tag", () => {
            expect(Security.containsDangerousHtml('<embed src="evil.swf">')).toBe(true);
        });

        test("returns true for applet tag", () => {
            expect(Security.containsDangerousHtml('<applet code="Evil.class">')).toBe(true);
        });

        test("returns true for meta tag", () => {
            expect(Security.containsDangerousHtml('<meta http-equiv="refresh">')).toBe(true);
        });

        test("returns true for link tag", () => {
            expect(Security.containsDangerousHtml('<link href="evil.css">')).toBe(true);
        });

        test("returns true for vbscript", () => {
            expect(Security.containsDangerousHtml("vbscript:msgbox(1)")).toBe(true);
        });

        test("returns true for data:text/html", () => {
            expect(Security.containsDangerousHtml("data:text/html,<script>alert(1)</script>")).toBe(
                true
            );
        });

        test("returns false for non-string input", () => {
            expect(Security.containsDangerousHtml(123)).toBe(false);
            expect(Security.containsDangerousHtml(null)).toBe(false);
            expect(Security.containsDangerousHtml(undefined)).toBe(false);
        });

        test("is case insensitive", () => {
            expect(Security.containsDangerousHtml("<SCRIPT>alert(1)</SCRIPT>")).toBe(true);
            const jsUpper = "JAVASCRIPT" + ":alert(1)";
            expect(Security.containsDangerousHtml(jsUpper)).toBe(true);
        });
    });

    // ============================================
    // STRIP HTML TESTS
    // ============================================
    describe("stripHtml()", () => {
        test("method exists and is callable", () => {
            expect(typeof Security.stripHtml).toBe("function");
        });

        test("removes HTML tags and returns text", () => {
            const html = "<p>Hello <b>World</b></p>";
            expect(Security.stripHtml(html)).toBe("Hello World");
        });

        test("returns empty string for non-string input", () => {
            expect(Security.stripHtml(123)).toBe("");
            expect(Security.stripHtml(null)).toBe("");
            expect(Security.stripHtml(undefined)).toBe("");
        });

        test("handles nested tags", () => {
            const html = "<div><p><span>Nested</span></p></div>";
            expect(Security.stripHtml(html)).toBe("Nested");
        });

        test("handles script tags", () => {
            const html = "<script>alert(1)</script>Hello";
            const result = Security.stripHtml(html);
            expect(result).not.toContain("alert");
        });

        test("preserves text content", () => {
            const html = "Plain text without tags";
            expect(Security.stripHtml(html)).toBe("Plain text without tags");
        });
    });

    // ============================================
    // CREATE SAFE ELEMENT TESTS
    // ============================================
    describe("createSafeElement()", () => {
        test("method exists and is callable", () => {
            expect(typeof Security.createSafeElement).toBe("function");
        });

        test("creates element with tag name", () => {
            const el = Security.createSafeElement("div");
            expect(el.tagName.toLowerCase()).toBe("div");
        });

        test("sets className", () => {
            const el = Security.createSafeElement("div", { className: "my-class" });
            expect(el.className).toBe("my-class");
        });

        test("sets id", () => {
            const el = Security.createSafeElement("div", { id: "my-id" });
            expect(el.id).toBe("my-id");
        });

        test("sets textContent safely", () => {
            const el = Security.createSafeElement("div", {
                textContent: "<script>alert(1)</script>",
            });
            expect(el.textContent).toBe("<script>alert(1)</script>");
            expect(el.innerHTML).not.toContain("<script>");
        });

        test("sets attributes with escaping", () => {
            const el = Security.createSafeElement("div", {
                attributes: { "data-value": 'test"value' },
            });
            expect(el.getAttribute("data-value")).toBe("test&quot;value");
        });

        test("appends children", () => {
            const child = document.createElement("span");
            child.textContent = "Child";

            const el = Security.createSafeElement("div", {
                children: [child],
            });

            expect(el.children.length).toBe(1);
            expect(el.children[0].tagName.toLowerCase()).toBe("span");
        });

        test("ignores non-Element children", () => {
            const el = Security.createSafeElement("div", {
                children: ["not an element", 123, null],
            });

            expect(el.children.length).toBe(0);
        });
    });
});
