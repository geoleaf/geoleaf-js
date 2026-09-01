/**
 * @fileoverview Comprehensive XSS injection vector tests.
 * Tests each security function against OWASP XSS attack payloads.
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
import { DOMSecurity } from "../../src/kernel/security/dom-security.js";

// ── XSS Payloads (OWASP XSS Filter Evasion Cheat Sheet) ──

const XSS_PAYLOADS = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "<svg onload=alert(1)>",
    '<a href="javascript:alert(1)">click</a>',
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    '<iframe src="javascript:alert(1)"></iframe>',
    '<base href="javascript:alert(1)//">',
    '<form action="javascript:alert(1)"><input type=submit>',
    "<body onload=alert(1)>",
    "<input onfocus=alert(1) autofocus>",
    '<embed src="javascript:alert(1)">',
    '<object data="javascript:alert(1)">',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<link rel="stylesheet" href="javascript:alert(1)">',
    "vbscript:alert(1)",
];

describe("XSS Injection Vectors — Security Audit", () => {
    beforeEach(() => vi.clearAllMocks());

    // ── 1. escapeHtml ──

    describe("escapeHtml — all payloads produce escaped output", () => {
        // Payloads containing HTML tags — must produce &lt;
        const HTML_TAG_PAYLOADS = XSS_PAYLOADS.filter((p) => /<[a-z]/i.test(p));
        // Payloads without HTML tags (protocol-only) — escapeHtml returns as-is (safe in text context)
        const PROTOCOL_PAYLOADS = XSS_PAYLOADS.filter((p) => !/<[a-z]/i.test(p));

        test.each(HTML_TAG_PAYLOADS)("escapes HTML tags: %s", (payload) => {
            const result = Security.escapeHtml(payload);
            expect(result).not.toContain("<script");
            expect(result).not.toMatch(/<[a-z]/i);
            expect(result).toContain("&lt;");
        });

        test.each(PROTOCOL_PAYLOADS)(
            "passes through protocol-only payload (safe in text context): %s",
            (payload) => {
                const result = Security.escapeHtml(payload);
                // escapeHtml only escapes HTML meta-characters (<, >, &, ", ')
                // Protocol strings without HTML tags are safe when used as textContent
                expect(result).toBe(payload);
            }
        );
    });

    // ── 2. escapeAttribute ──

    describe("escapeAttribute — all payloads produce safe attribute values", () => {
        test.each(XSS_PAYLOADS)("escapes for attribute context: %s", (payload) => {
            const result = Security.escapeAttribute(payload);
            // Must not contain raw < > " ' & that could break out of attribute
            expect(result).not.toContain('"');
            expect(result).not.toContain("'");
            expect(result).not.toContain("<");
            expect(result).not.toContain(">");
        });

        test("double-quote breakout attempt", () => {
            const result = Security.escapeAttribute('" onmouseover="alert(1)');
            expect(result).not.toContain('"');
            expect(result).toContain("&quot;");
        });
    });

    // ── 3. containsDangerousHtml ──

    describe("containsDangerousHtml — detects all payloads", () => {
        const HTML_PAYLOADS = XSS_PAYLOADS.filter(
            (p) =>
                // Only test payloads that contain HTML tags or dangerous protocols
                /<[a-z]/i.test(p) ||
                /javascript:/i.test(p) ||
                /vbscript:/i.test(p) ||
                /data:text\/html/i.test(p)
        );

        test.each(HTML_PAYLOADS)("detects: %s", (payload) => {
            expect(Security.containsDangerousHtml(payload)).toBe(true);
        });

        test("detects <base> tag injection", () => {
            expect(Security.containsDangerousHtml('<base href="https://evil.com">')).toBe(true);
        });

        test("detects <form> tag injection", () => {
            expect(Security.containsDangerousHtml('<form action="https://evil.com">')).toBe(true);
        });

        test("does not false-positive on safe text", () => {
            expect(Security.containsDangerousHtml("Hello World")).toBe(false);
            expect(Security.containsDangerousHtml("Price: $42.00")).toBe(false);
            expect(Security.containsDangerousHtml("")).toBe(false);
        });

        test("returns false for non-string values", () => {
            expect(Security.containsDangerousHtml(null)).toBe(false);
            expect(Security.containsDangerousHtml(undefined)).toBe(false);
            expect(Security.containsDangerousHtml(42)).toBe(false);
        });
    });

    // ── 4. sanitizeSvgContent ──

    describe("sanitizeSvgContent — removes dangerous SVG content", () => {
        test("removes embedded <script>", () => {
            const svg =
                '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="10"/></svg>';
            const result = Security.sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            expect(result.querySelector("script")).toBeNull();
        });

        test("removes onload event handler", () => {
            const svg =
                '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="10"/></svg>';
            const result = Security.sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            expect(result.hasAttribute("onload")).toBe(false);
        });

        test("removes onerror on child elements", () => {
            const svg =
                '<svg xmlns="http://www.w3.org/2000/svg"><image onerror="alert(1)" href="x"/></svg>';
            const result = Security.sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            const img = result.querySelector("image");
            if (img) expect(img.hasAttribute("onerror")).toBe(false);
        });

        test("removes javascript: href", () => {
            const svg =
                '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>click</text></a></svg>';
            const result = Security.sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            const link = result.querySelector("a");
            if (link) expect(link.hasAttribute("href")).toBe(false);
        });

        test("removes foreignObject", () => {
            const svg =
                '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body onload="alert(1)"/></foreignObject></svg>';
            const result = Security.sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            expect(result.querySelector("foreignObject")).toBeNull();
        });

        test("returns null for invalid SVG", () => {
            expect(Security.sanitizeSvgContent("not svg at all")).toBeNull();
            expect(Security.sanitizeSvgContent(null)).toBeNull();
            expect(Security.sanitizeSvgContent(undefined)).toBeNull();
        });
    });

    // ── 5. parseHtmlSafely ──

    describe("parseHtmlSafely — tag allowlist enforcement", () => {
        test("removes <script> tags, keeps text", () => {
            const fragment = Security.parseHtmlSafely("<p>Hello</p><script>alert(1)</script>");
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.querySelector("script")).toBeNull();
            expect(div.textContent).toContain("Hello");
        });

        test("removes <img> tag (not in allowlist), converts to text", () => {
            const fragment = Security.parseHtmlSafely("<img src=x onerror=alert(1)>");
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.querySelector("img")).toBeNull();
        });

        test("removes <iframe>", () => {
            const fragment = Security.parseHtmlSafely(
                '<iframe src="javascript:alert(1)"></iframe>'
            );
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.querySelector("iframe")).toBeNull();
        });

        test("removes <svg> (not in default allowlist)", () => {
            const fragment = Security.parseHtmlSafely("<svg onload=alert(1)></svg>");
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.querySelector("svg")).toBeNull();
        });

        test("preserves allowed tags: p, strong, em, a", () => {
            const fragment = Security.parseHtmlSafely(
                "<p><strong>Bold</strong> and <em>italic</em></p>"
            );
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.querySelector("p")).not.toBeNull();
            expect(div.querySelector("strong")).not.toBeNull();
            expect(div.querySelector("em")).not.toBeNull();
        });

        test("validates href on <a> tags via validateUrl", () => {
            const fragment = Security.parseHtmlSafely('<a href="javascript:alert(1)">evil</a>');
            const div = document.createElement("div");
            div.appendChild(fragment);
            const link = div.querySelector("a");
            // Link should exist but href should be removed (invalid protocol)
            if (link) {
                expect(link.hasAttribute("href")).toBe(false);
            }
        });

        test("adds rel=noopener on valid links", () => {
            const fragment = Security.parseHtmlSafely('<a href="https://example.com">ok</a>');
            const div = document.createElement("div");
            div.appendChild(fragment);
            const link = div.querySelector("a");
            expect(link).not.toBeNull();
            expect(link.getAttribute("rel")).toBe("noopener noreferrer");
            expect(link.getAttribute("target")).toBe("_blank");
        });

        test("custom allowlist with SVG tags", () => {
            const svgTags = ["svg", "path", "circle"];
            const fragment = Security.parseHtmlSafely(
                '<svg><path d="M0 0"/><script>alert(1)</script></svg>',
                svgTags
            );
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.querySelector("svg")).not.toBeNull();
            expect(div.querySelector("path")).not.toBeNull();
            expect(div.querySelector("script")).toBeNull();
        });
    });

    // ── 6. sanitizeHTML ──

    describe("sanitizeHTML — DOM element injection", () => {
        test.each([
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            '<iframe src="javascript:alert(1)"></iframe>',
            "<svg onload=alert(1)>",
            '<base href="evil">',
            '<form action="evil">',
        ])("sanitizes injection into DOM element: %s", (payload) => {
            const el = document.createElement("div");
            Security.sanitizeHTML(el, payload);
            expect(el.querySelector("script")).toBeNull();
            expect(el.querySelector("img")).toBeNull();
            expect(el.querySelector("iframe")).toBeNull();
            expect(el.querySelector("svg")).toBeNull();
            expect(el.querySelector("base")).toBeNull();
            expect(el.querySelector("form")).toBeNull();
        });

        test("clears element when html is null", () => {
            const el = document.createElement("div");
            el.textContent = "existing";
            Security.sanitizeHTML(el, null);
            expect(el.textContent).toBe("");
        });

        test("stripAll option converts everything to text", () => {
            const el = document.createElement("div");
            Security.sanitizeHTML(el, "<p>Hello <strong>World</strong></p>", { stripAll: true });
            expect(el.querySelector("p")).toBeNull();
            expect(el.textContent).toBe("Hello World");
        });

        test("returns null for invalid element", () => {
            expect(Security.sanitizeHTML(null, "test")).toBeNull();
        });
    });

    // ── 7. validateUrl ──

    describe("validateUrl — protocol injection", () => {
        test("rejects javascript: protocol", () => {
            expect(() => Security.validateUrl("javascript:alert(1)")).toThrow();
        });

        test("rejects vbscript: protocol", () => {
            expect(() => Security.validateUrl("vbscript:alert(1)")).toThrow();
        });

        test("rejects data:text/html", () => {
            expect(() =>
                Security.validateUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")
            ).toThrow();
        });

        test("rejects data:text/javascript", () => {
            expect(() => Security.validateUrl("data:text/javascript,alert(1)")).toThrow();
        });

        test("accepts data:image/png", () => {
            expect(() =>
                Security.validateUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==")
            ).not.toThrow();
        });

        test("accepts https: URLs", () => {
            expect(Security.validateUrl("https://example.com")).toBe("https://example.com/");
        });

        test("accepts http: URLs (non httpsOnly)", () => {
            expect(Security.validateUrl("http://example.com")).toBe("http://example.com/");
        });

        test("rejects http: in httpsOnly mode", () => {
            expect(() =>
                Security.validateUrl("http://example.com", undefined, { httpsOnly: true })
            ).toThrow();
        });

        test("rejects empty/null URL", () => {
            expect(() => Security.validateUrl("")).toThrow(TypeError);
            expect(() => Security.validateUrl(null)).toThrow(TypeError);
        });
    });

    // ── 8. DOMSecurity.setSafeHTML ──

    describe("DOMSecurity.setSafeHTML — wrapper security", () => {
        test.each([
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            '<iframe src="javascript:alert(1)"></iframe>',
        ])("sanitizes via setSafeHTML: %s", (payload) => {
            const el = document.createElement("div");
            DOMSecurity.setSafeHTML(el, payload);
            expect(el.querySelector("script")).toBeNull();
            expect(el.querySelector("img")).toBeNull();
            expect(el.querySelector("iframe")).toBeNull();
        });

        test("falls back to textContent on invalid element", () => {
            DOMSecurity.setSafeHTML(null, "test");
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid element"));
        });

        test("setSafeHTML with SVG allowlist passes safe SVG through", () => {
            const el = document.createElement("div");
            const safeSvg = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
            DOMSecurity.setSafeHTML(el, safeSvg, ["svg", "path"]);
            expect(el.querySelector("svg")).not.toBeNull();
            expect(el.querySelector("path")).not.toBeNull();
        });
    });

    // ── 9. stripHtml ──

    describe("stripHtml — returns plain text only", () => {
        test.each(XSS_PAYLOADS)("strips all HTML from: %s", (payload) => {
            const result = Security.stripHtml(payload);
            expect(result).not.toMatch(/<[a-z]/i);
        });

        test("preserves text content", () => {
            expect(Security.stripHtml("<p>Hello <strong>World</strong></p>")).toBe("Hello World");
        });

        test("handles non-string input", () => {
            expect(Security.stripHtml(null)).toBe("");
            expect(Security.stripHtml(undefined)).toBe("");
            expect(Security.stripHtml(42)).toBe("");
        });
    });
});
