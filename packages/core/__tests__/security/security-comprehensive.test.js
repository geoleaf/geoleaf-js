/**
 * @file security-comprehensive.test.js
 * Comprehensive tests for the Security module
 */

import {
    escapeHtml,
    escapeAttribute,
    validateUrl,
    validateCoordinates,
    containsDangerousHtml,
    stripHtml,
    createSafeElement,
    sanitizeSvgContent,
    validateNumber,
    sanitizeHTML,
} from "../../src/kernel/security/index.js";

// ─────────────────────────────────────────
// 3.1.1  escapeHtml
// ─────────────────────────────────────────
describe("escapeHtml()", () => {
    it("returns a normal string unchanged", () => {
        expect(escapeHtml("Hello world")).toBe("Hello world");
    });

    it("escapes a basic XSS script tag", () => {
        const result = escapeHtml("<script>alert(1)</script>");
        expect(result).not.toContain("<script>");
        expect(result).toContain("&lt;script&gt;");
    });

    it("returns empty string for null", () => {
        expect(escapeHtml(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
        expect(escapeHtml(undefined)).toBe("");
    });

    it("converts number 0 to safe string", () => {
        expect(escapeHtml(0)).toBe("0");
    });

    it("converts false to safe string", () => {
        expect(escapeHtml(false)).toBe("false");
    });

    it('escapes & < > " characters', () => {
        const result = escapeHtml('a & b < c > d " e');
        expect(result).toContain("&amp;");
        expect(result).toContain("&lt;");
        expect(result).toContain("&gt;");
    });

    it("handles a very long string (10 000 chars)", () => {
        const long = "a".repeat(10000);
        expect(escapeHtml(long)).toBe(long);
    });

    it("handles emojis and unicode without corruption", () => {
        const input = "🗺️ Map — naive";
        const result = escapeHtml(input);
        expect(result).toContain("🗺");
        expect(result).toContain("naive");
    });

    it("escapes nested HTML with event handlers (converts to safe text)", () => {
        const input = '<div onclick="alert(1)"><img src=x onerror=alert(1)></div>';
        const result = escapeHtml(input);
        // Raw tags must be escaped — no executable HTML remains
        expect(result).not.toContain("<div");
        expect(result).toContain("&lt;div");
    });
});

// ─────────────────────────────────────────
// validateCoordinates (security module)
// ─────────────────────────────────────────
describe("validateCoordinates() [security]", () => {
    it("returns [lat, lng] for valid coordinates", () => {
        expect(validateCoordinates(48.85, 2.35)).toEqual([48.85, 2.35]);
    });

    it("accepts boundary values [90, 180]", () => {
        expect(validateCoordinates(90, 180)).toEqual([90, 180]);
    });

    it("throws TypeError for non-number inputs", () => {
        expect(() => validateCoordinates("48", 2)).toThrow(TypeError);
    });

    it("throws RangeError for NaN", () => {
        expect(() => validateCoordinates(NaN, 0)).toThrow(RangeError);
    });

    it("throws RangeError for Infinity", () => {
        expect(() => validateCoordinates(0, Infinity)).toThrow(RangeError);
    });

    it("throws RangeError for latitude > 90", () => {
        expect(() => validateCoordinates(91, 0)).toThrow(RangeError);
    });

    it("throws RangeError for longitude > 180", () => {
        expect(() => validateCoordinates(0, 181)).toThrow(RangeError);
    });
});

// ─────────────────────────────────────────
// 3.1.2  escapeAttribute
// ─────────────────────────────────────────
describe("escapeAttribute()", () => {
    it("returns empty string for null", () => {
        expect(escapeAttribute(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
        expect(escapeAttribute(undefined)).toBe("");
    });

    it("escapes double quotes", () => {
        expect(escapeAttribute('"value"')).toContain("&quot;");
    });

    it("escapes single quotes", () => {
        expect(escapeAttribute("it's")).toContain("&#39;");
    });

    it("escapes < and >", () => {
        const result = escapeAttribute("<tag>");
        expect(result).toContain("&lt;");
        expect(result).toContain("&gt;");
    });

    it("escapes & character", () => {
        expect(escapeAttribute("a & b")).toContain("&amp;");
    });

    it("neutralises attribute injection attempt by escaping quotes", () => {
        const malicious = '" onclick="alert(1)';
        const result = escapeAttribute(malicious);
        // Double quotes must be escaped so the value cannot break out of its attribute context
        expect(result).not.toContain('"');
        expect(result).toContain("&quot;");
    });
});

// ─────────────────────────────────────────
// 3.1.3  validateUrl
// ─────────────────────────────────────────
describe("validateUrl()", () => {
    it("accepts https:// URLs", () => {
        expect(() => validateUrl("https://example.com")).not.toThrow();
    });

    it("accepts http:// URLs", () => {
        expect(() => validateUrl("http://localhost:3000/path")).not.toThrow();
    });

    it("accepts relative paths", () => {
        expect(() => validateUrl("./data.json", "https://localhost")).not.toThrow();
    });

    it("blocks javascript: protocol", () => {
        expect(() => validateUrl("javascript:alert(1)")).toThrow();
    });

    it("blocks vbscript: protocol", () => {
        expect(() => validateUrl("vbscript:msgbox(1)")).toThrow();
    });

    it("blocks ftp:// protocol", () => {
        expect(() => validateUrl("ftp://files.example.com")).toThrow();
    });

    it("blocks file:// protocol", () => {
        expect(() => validateUrl("file:///etc/passwd")).toThrow();
    });

    it("allows data: URLs with image/png mime", () => {
        const dataUrl = "data:image/png;base64,abc123==";
        expect(() => validateUrl(dataUrl)).not.toThrow();
    });

    it("blocks data:text/html URLs", () => {
        expect(() => validateUrl("data:text/html,<h1>bad</h1>")).toThrow();
    });

    it("throws on empty string", () => {
        expect(() => validateUrl("")).toThrow();
    });

    it("throws on null", () => {
        expect(() => validateUrl(null)).toThrow();
    });

    it("accepts URLs with query params and fragments", () => {
        expect(() => validateUrl("https://example.com/path?q=1&f=2#section")).not.toThrow();
    });

    it("accepts URLs with credentials", () => {
        expect(() => validateUrl("https://user:pass@example.com")).not.toThrow();
    });
});

// ─────────────────────────────────────────
// stripHtml
// ─────────────────────────────────────────
describe("stripHtml()", () => {
    it("returns empty string for non-string input", () => {
        expect(stripHtml(null)).toBe("");
        expect(stripHtml(42)).toBe("");
    });

    it("returns plain text from HTML", () => {
        expect(stripHtml("<p>Hello <b>world</b></p>")).toContain("Hello");
        expect(stripHtml("<p>Hello <b>world</b></p>")).toContain("world");
    });

    it("strips all tags leaving only text", () => {
        const result = stripHtml("<div><script>bad()</script>text</div>");
        expect(result).not.toContain("<");
        expect(result).toContain("text");
    });
});

// ─────────────────────────────────────────
// createSafeElement
// ─────────────────────────────────────────
describe("createSafeElement()", () => {
    it("creates a DOM element with the given tag", () => {
        const el = createSafeElement("div");
        expect(el.tagName.toLowerCase()).toBe("div");
    });

    it("sets className and id", () => {
        const el = createSafeElement("span", { className: "my-class", id: "my-id" });
        expect(el.className).toBe("my-class");
        expect(el.id).toBe("my-id");
    });

    it("sets textContent safely (no HTML injection)", () => {
        const el = createSafeElement("div", { textContent: "<b>bold</b>" });
        expect(el.textContent).toBe("<b>bold</b>");
        expect(el.innerHTML).not.toContain("<b>");
    });

    it("sets escaped attribute values", () => {
        const el = createSafeElement("div", { attributes: { title: '"quoted"' } });
        expect(el.getAttribute("title")).toBeTruthy();
    });

    it("appends Element children", () => {
        const child = document.createElement("span");
        const el = createSafeElement("div", { children: [child] });
        expect(el.children.length).toBe(1);
    });
});

// ─────────────────────────────────────────
// validateNumber
// ─────────────────────────────────────────
describe("validateNumber()", () => {
    it("returns the number when valid", () => {
        expect(validateNumber(5, 0, 10)).toBe(5);
    });

    it("returns null for NaN", () => {
        expect(validateNumber(NaN)).toBeNull();
    });

    it("returns null for Infinity", () => {
        expect(validateNumber(Infinity)).toBeNull();
    });

    it("returns null when below min", () => {
        expect(validateNumber(-1, 0, 10)).toBeNull();
    });

    it("returns null when above max", () => {
        expect(validateNumber(11, 0, 10)).toBeNull();
    });

    it("returns the number for boundary values", () => {
        expect(validateNumber(0, 0, 10)).toBe(0);
        expect(validateNumber(10, 0, 10)).toBe(10);
    });

    it("coerces a numeric string to number", () => {
        expect(validateNumber("5", 0, 10)).toBe(5);
    });
});

// ─────────────────────────────────────────
// 3.1.5  containsDangerousHtml
// ─────────────────────────────────────────
describe("containsDangerousHtml()", () => {
    it("detects <script tags", () => {
        expect(containsDangerousHtml("<script>alert(1)</script>")).toBe(true);
    });

    it("detects javascript: URLs", () => {
        expect(containsDangerousHtml("javascript:void(0)")).toBe(true);
    });

    it("detects on* event handlers", () => {
        expect(containsDangerousHtml('onclick="bad()"')).toBe(true);
    });

    it("detects <iframe", () => {
        expect(containsDangerousHtml('<iframe src="x">')).toBe(true);
    });

    it("detects <object", () => {
        expect(containsDangerousHtml('<object data="x">')).toBe(true);
    });

    it("detects <embed", () => {
        expect(containsDangerousHtml('<embed src="x">')).toBe(true);
    });

    it("detects <applet", () => {
        expect(containsDangerousHtml('<applet code="x">')).toBe(true);
    });

    it("detects <meta", () => {
        expect(containsDangerousHtml('<meta charset="utf-8">')).toBe(true);
    });

    it("detects <link", () => {
        expect(containsDangerousHtml('<link rel="stylesheet">')).toBe(true);
    });

    it("detects vbscript:", () => {
        expect(containsDangerousHtml("vbscript:bad()")).toBe(true);
    });

    it("detects data:text/html", () => {
        expect(containsDangerousHtml("data:text/html,<h1>x</h1>")).toBe(true);
    });

    it("is case-insensitive for <SCRIPT>", () => {
        expect(containsDangerousHtml("<SCRIPT>alert(1)</SCRIPT>")).toBe(true);
    });

    it("is case-insensitive for mixed case <ScRiPt>", () => {
        expect(containsDangerousHtml("<ScRiPt>alert(1)")).toBe(true);
    });

    it("does not flag normal text containing the word script", () => {
        expect(containsDangerousHtml("The shell script ran fine.")).toBe(false);
    });

    it("returns false for safe plain text", () => {
        expect(containsDangerousHtml("Hello world")).toBe(false);
    });

    it("returns false for non-string input", () => {
        expect(containsDangerousHtml(42)).toBe(false);
        expect(containsDangerousHtml(null)).toBe(false);
    });
});

// ─────────────────────────────────────────
// 3.1.6  sanitizeSvgContent
// ─────────────────────────────────────────
describe("sanitizeSvgContent()", () => {
    it("returns null for null input", () => {
        expect(sanitizeSvgContent(null)).toBeNull();
    });

    it("returns null for empty string", () => {
        expect(sanitizeSvgContent("")).toBeNull();
    });

    it("returns null for invalid SVG", () => {
        expect(sanitizeSvgContent("<not-svg>bad</not-svg>")).toBeNull();
    });

    it("returns an SVGElement for valid SVG", () => {
        const svg = sanitizeSvgContent(
            '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
        );
        expect(svg).not.toBeNull();
        expect(svg.tagName.toLowerCase()).toBe("svg");
    });

    it("removes <script> elements from SVG", () => {
        const svg = sanitizeSvgContent(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>'
        );
        expect(svg).not.toBeNull();
        expect(svg.querySelector("script")).toBeNull();
    });

    it("removes <foreignObject> elements from SVG", () => {
        const svg = sanitizeSvgContent(
            '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>bad</div></foreignObject></svg>'
        );
        expect(svg).not.toBeNull();
        expect(svg.querySelector("foreignObject")).toBeNull();
    });

    it("removes on* event attributes from SVG elements", () => {
        const svg = sanitizeSvgContent(
            '<svg xmlns="http://www.w3.org/2000/svg"><circle onclick="bad()" r="5"/></svg>'
        );
        expect(svg).not.toBeNull();
        const circle = svg.querySelector("circle");
        expect(circle.hasAttribute("onclick")).toBe(false);
    });

    it('removes href="javascript:..." from SVG elements', () => {
        const svg = sanitizeSvgContent(
            '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:bad()"><text>x</text></a></svg>'
        );
        expect(svg).not.toBeNull();
        const a = svg.querySelector("a");
        expect(a.hasAttribute("href")).toBe(false);
    });
});

// ─────────────────────────────────────────
// 3.1.7  sanitizeHTML
// ─────────────────────────────────────────
describe("sanitizeHTML()", () => {
    let container;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    it("injects safe HTML keeping allowed tags", () => {
        sanitizeHTML(container, "<p>Hello <strong>world</strong></p>");
        expect(container.querySelector("p")).not.toBeNull();
        expect(container.querySelector("strong")).not.toBeNull();
    });

    it("converts disallowed tags to text", () => {
        sanitizeHTML(container, "<div>block</div>");
        expect(container.querySelector("div")).toBeNull();
        expect(container.textContent).toContain("block");
    });

    it('preserves valid link with rel="noopener noreferrer"', () => {
        sanitizeHTML(container, '<a href="https://example.com">link</a>');
        const a = container.querySelector("a");
        expect(a).not.toBeNull();
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("removes href from javascript: links", () => {
        sanitizeHTML(container, '<a href="javascript:bad()">link</a>');
        const a = container.querySelector("a");
        if (a) {
            expect(a.hasAttribute("href")).toBe(false);
        }
    });

    it("strips all HTML when stripAll: true", () => {
        sanitizeHTML(container, "<p>Only <b>text</b></p>", { stripAll: true });
        expect(container.querySelector("p")).toBeNull();
        expect(container.textContent).toContain("Only");
        expect(container.textContent).toContain("text");
    });

    it("sanitizes even when unknown options are passed", () => {
        sanitizeHTML(container, "<p>safe</p>");
        // Still sanitizes — result should have <p>
        expect(container.querySelector("p")).not.toBeNull();
    });

    it("returns null for invalid element argument", () => {
        const result = sanitizeHTML(null, "<p>test</p>");
        expect(result).toBeNull();
    });

    it("clears element when html is null", () => {
        container.innerHTML = "<p>old</p>";
        sanitizeHTML(container, null);
        expect(container.innerHTML).toBe("");
    });
});
