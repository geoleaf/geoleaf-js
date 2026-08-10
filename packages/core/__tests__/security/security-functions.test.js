/**
 * @file security-functions.test.js
 * @description Tests for Security module individual functions (migrated from security.esm.test.js)
 * HTML sanitization, XSS prevention, URL validation
 */

import {
    sanitizeHTML,
    escapeHtml,
    escapeAttribute,
    validateUrl,
    validateCoordinates,
    containsDangerousHtml,
    stripHtml,
    createSafeElement,
    sanitizeSvgContent,
    validateNumber,
    parseHtmlSafely,
    Security,
} from "../../src/kernel/security/index.js";

describe("Security - HTML Escaping", () => {
    describe("escapeHtml", () => {
        it("should escape HTML tags", () => {
            const result = escapeHtml("<script>alert(1)</script>");
            expect(result).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
        });

        it("should escape special characters", () => {
            const result = escapeHtml("< > & \" '");
            expect(result).toContain("&lt;");
            expect(result).toContain("&gt;");
            expect(result).toContain("&amp;");
        });

        it("should handle null", () => {
            expect(escapeHtml(null)).toBe("");
        });

        it("should handle undefined", () => {
            expect(escapeHtml(undefined)).toBe("");
        });

        it("should convert non-strings", () => {
            expect(escapeHtml(123)).toBe("123");
        });

        it("should escape XSS attempts", () => {
            const xss = "<img src=x onerror=alert(1)>";
            const result = escapeHtml(xss);
            expect(result).not.toContain("<img");
            expect(result).toContain("&lt;img");
        });
    });

    describe("escapeAttribute", () => {
        it("should escape ampersand", () => {
            expect(escapeAttribute("a&b")).toBe("a&amp;b");
        });

        it("should escape single quote", () => {
            expect(escapeAttribute("a'b")).toBe("a&#39;b");
        });

        it("should escape double quote", () => {
            expect(escapeAttribute('a"b')).toBe("a&quot;b");
        });

        it("should escape less than", () => {
            expect(escapeAttribute("a<b")).toBe("a&lt;b");
        });

        it("should escape greater than", () => {
            expect(escapeAttribute("a>b")).toBe("a&gt;b");
        });

        it("should handle null", () => {
            expect(escapeAttribute(null)).toBe("");
        });

        it("should prevent XSS in attributes", () => {
            const xss = 'value"onclick="alert(1)';
            const result = escapeAttribute(xss);
            expect(result).toBe("value&quot;onclick=&quot;alert(1)");
        });
    });

    describe("stripHtml", () => {
        it("should strip all HTML tags", () => {
            const result = stripHtml("<p>Hello <b>World</b></p>");
            expect(result).toBe("Hello World");
        });

        it("should strip scripts", () => {
            const result = stripHtml("<script>alert(1)</script>Text");
            expect(result).toBe("Text");
        });

        it("should handle empty string", () => {
            expect(stripHtml("")).toBe("");
        });

        it("should handle non-string", () => {
            expect(stripHtml(123)).toBe("");
        });

        it("should strip complex HTML", () => {
            const html = '<div><p>A</p><span>B</span><img src="x"/></div>';
            const result = stripHtml(html);
            expect(result).toBe("AB");
        });
    });
});

describe("Security - HTML Sanitization", () => {
    describe("sanitizeHTML", () => {
        let container;

        beforeEach(() => {
            container = document.createElement("div");
        });

        it("should sanitize and set innerHTML", () => {
            sanitizeHTML(container, "<p>Safe content</p>");
            expect(container.innerHTML).toContain("Safe content");
        });

        it("should remove script tags", () => {
            sanitizeHTML(container, "<p>Text</p><script>alert(1)</script>");
            expect(container.innerHTML).not.toContain("<script");
            expect(container.innerHTML).toContain("Text");
        });

        it("should handle null HTML", () => {
            sanitizeHTML(container, null);
            expect(container.innerHTML).toBe("");
        });

        it("should handle stripAll option", () => {
            sanitizeHTML(container, "<p>Hello <b>World</b></p>", { stripAll: true });
            expect(container.textContent).toBe("Hello World");
            expect(container.innerHTML).not.toContain("<p>");
        });

        it("should handle SVG content with sanitization", () => {
            const svg = '<svg><circle r="5"/></svg>';
            // SVG tags are NOT in DEFAULT_ALLOWED_TAGS → stripped by default
            sanitizeHTML(container, svg);
            expect(container.innerHTML).not.toContain("<svg>");

            // With explicit allowedTags, SVG is preserved
            const container2 = document.createElement("div");
            sanitizeHTML(container2, svg, { allowedTags: ["svg", "circle"] });
            expect(container2.innerHTML).toContain("svg");
        });

        it("should handle custom allowedTags", () => {
            sanitizeHTML(container, "<p>Text</p><div>More</div>", {
                allowedTags: ["p"],
            });
            expect(container.innerHTML).toContain("Text");
            expect(container.innerHTML).toContain("More");
        });

        it("should return element for chaining", () => {
            const result = sanitizeHTML(container, "<p>Test</p>");
            expect(result).toBe(container);
        });

        it("should handle invalid element", () => {
            const result = sanitizeHTML(null, "<p>Test</p>");
            expect(result).toBeNull();
        });

        it("should convert non-string HTML", () => {
            sanitizeHTML(container, 123);
            expect(container.innerHTML).toContain("123");
        });
    });

    describe("parseHtmlSafely", () => {
        it("should parse safe HTML", () => {
            const fragment = parseHtmlSafely("<p>Hello</p>");
            expect(fragment).toBeInstanceOf(DocumentFragment);
            expect(fragment.childNodes.length).toBeGreaterThan(0);
        });

        it("should remove dangerous tags", () => {
            const fragment = parseHtmlSafely("<p>Safe</p><script>alert(1)</script>");
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.innerHTML).not.toContain("<script");
            expect(div.innerHTML).toContain("Safe");
        });

        it("should preserve allowed tags", () => {
            const fragment = parseHtmlSafely("<p>A</p><strong>B</strong>");
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.innerHTML).toContain("<p>");
            expect(div.innerHTML).toContain("<strong>");
        });

        it("should validate links", () => {
            const fragment = parseHtmlSafely('<a href="http://example.com">Link</a>');
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.innerHTML).toContain('href="http://example.com');
            expect(div.innerHTML).toContain('rel="noopener noreferrer"');
        });

        it("should remove invalid links", () => {
            const fragment = parseHtmlSafely('<a href="javascript:alert(1)">Bad</a>');
            const div = document.createElement("div");
            div.appendChild(fragment);
            expect(div.innerHTML).not.toContain("javascript:");
        });

        it("should handle custom allowed tags", () => {
            const fragment = parseHtmlSafely("<div>Text</div>", ["div"]);
            const container = document.createElement("div");
            container.appendChild(fragment);
            expect(container.innerHTML).toContain("<div>");
        });

        it("should handle empty HTML", () => {
            const fragment = parseHtmlSafely("");
            expect(fragment.childNodes.length).toBe(0);
        });
    });
});

describe("Security - URL Validation", () => {
    describe("validateUrl", () => {
        it("should validate HTTP URL", () => {
            const result = validateUrl("http://example.com");
            expect(result).toBe("http://example.com/");
        });

        it("should validate HTTPS URL", () => {
            const result = validateUrl("https://example.com");
            expect(result).toBe("https://example.com/");
        });

        it("should validate data:image URL", () => {
            const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
            const result = validateUrl(dataUrl);
            expect(result).toBe(dataUrl);
        });

        it("should reject javascript: protocol", () => {
            expect(() => validateUrl("javascript:alert(1)")).toThrow("not allowed");
        });

        it("should reject file: protocol", () => {
            expect(() => validateUrl("file:///etc/passwd")).toThrow("not allowed");
        });

        it("should reject data:text URLs", () => {
            expect(() => validateUrl("data:text/html,<script>alert(1)</script>")).toThrow(
                "not allowed"
            );
        });

        it("should reject invalid data: format", () => {
            expect(() => validateUrl("data:invalid")).toThrow("not allowed");
        });

        it("should throw on empty URL", () => {
            expect(() => validateUrl("")).toThrow("non-empty string");
        });

        it("should throw on null URL", () => {
            expect(() => validateUrl(null)).toThrow("non-empty string");
        });

        it("should handle baseUrl parameter", () => {
            const result = validateUrl("/path", "http://example.com");
            expect(result).toBe("http://example.com/path");
        });

        it("should trim whitespace", () => {
            const result = validateUrl("  http://example.com  ");
            expect(result).toBe("http://example.com/");
        });
    });
});

describe("Security - Coordinate Validation", () => {
    describe("validateCoordinates", () => {
        it("should validate valid coordinates", () => {
            const result = validateCoordinates(45.5, -73.6);
            expect(result).toEqual([45.5, -73.6]);
        });

        it("should validate edge cases", () => {
            expect(validateCoordinates(90, 180)).toEqual([90, 180]);
            expect(validateCoordinates(-90, -180)).toEqual([-90, -180]);
            expect(validateCoordinates(0, 0)).toEqual([0, 0]);
        });

        it("should reject non-number latitude", () => {
            expect(() => validateCoordinates("45", -73)).toThrow(TypeError);
        });

        it("should reject non-number longitude", () => {
            expect(() => validateCoordinates(45, "-73")).toThrow(TypeError);
        });

        it("should reject NaN", () => {
            expect(() => validateCoordinates(NaN, 0)).toThrow(RangeError);
        });

        it("should reject Infinity", () => {
            expect(() => validateCoordinates(Infinity, 0)).toThrow(RangeError);
        });

        it("should reject latitude out of range (high)", () => {
            expect(() => validateCoordinates(91, 0)).toThrow("between -90 and 90");
        });

        it("should reject latitude out of range (low)", () => {
            expect(() => validateCoordinates(-91, 0)).toThrow("between -90 and 90");
        });

        it("should reject longitude out of range (high)", () => {
            expect(() => validateCoordinates(0, 181)).toThrow("between -180 and 180");
        });

        it("should reject longitude out of range (low)", () => {
            expect(() => validateCoordinates(0, -181)).toThrow("between -180 and 180");
        });
    });
});

describe("Security - Dangerous HTML Detection", () => {
    describe("containsDangerousHtml", () => {
        it("should detect script tags", () => {
            expect(containsDangerousHtml("<script>alert(1)</script>")).toBe(true);
            expect(containsDangerousHtml("<SCRIPT>alert(1)</SCRIPT>")).toBe(true);
        });

        it("should detect javascript: protocol", () => {
            expect(containsDangerousHtml("javascript:alert(1)")).toBe(true);
            expect(containsDangerousHtml("JAVASCRIPT:alert(1)")).toBe(true);
        });

        it("should detect event handlers", () => {
            expect(containsDangerousHtml("onclick=alert(1)")).toBe(true);
            expect(containsDangerousHtml("onerror=alert(1)")).toBe(true);
            expect(containsDangerousHtml("onload=alert(1)")).toBe(true);
        });

        it("should detect iframe tags", () => {
            expect(containsDangerousHtml('<iframe src="evil"></iframe>')).toBe(true);
        });

        it("should detect object tags", () => {
            expect(containsDangerousHtml('<object data="evil"></object>')).toBe(true);
        });

        it("should detect embed tags", () => {
            expect(containsDangerousHtml('<embed src="evil">')).toBe(true);
        });

        it("should detect data:text/html", () => {
            expect(containsDangerousHtml("data:text/html,<script></script>")).toBe(true);
        });

        it("should return false for safe HTML", () => {
            expect(containsDangerousHtml("<p>Hello World</p>")).toBe(false);
            expect(containsDangerousHtml('<a href="http://example.com">Link</a>')).toBe(false);
        });

        it("should handle non-string", () => {
            expect(containsDangerousHtml(123)).toBe(false);
            expect(containsDangerousHtml(null)).toBe(false);
        });
    });
});

describe("Security - Safe Element Creation", () => {
    describe("createSafeElement", () => {
        it("should create element with className", () => {
            const el = createSafeElement("div", { className: "test-class" });
            expect(el.className).toBe("test-class");
        });

        it("should create element with id", () => {
            const el = createSafeElement("div", { id: "test-id" });
            expect(el.id).toBe("test-id");
        });

        it("should escape textContent", () => {
            const el = createSafeElement("div", {
                textContent: "<script>alert(1)</script>",
            });
            expect(el.innerHTML).toContain("&lt;script");
        });

        it("should escape attributes", () => {
            const el = createSafeElement("div", {
                attributes: {
                    title: 'Test"Title',
                },
            });
            expect(el.getAttribute("title")).toContain("&quot;");
        });

        it("should append children", () => {
            const child1 = document.createElement("span");
            const child2 = document.createElement("span");
            const el = createSafeElement("div", {
                children: [child1, child2],
            });
            expect(el.children.length).toBe(2);
        });

        it("should handle all options together", () => {
            const child = document.createElement("span");
            const el = createSafeElement("div", {
                className: "wrapper",
                id: "container",
                textContent: "Safe text",
                attributes: { role: "main" },
                children: [child],
            });
            expect(el.className).toBe("wrapper");
            expect(el.id).toBe("container");
            expect(el.textContent).toBe("Safe text");
            expect(el.getAttribute("role")).toContain("main");
            expect(el.children.length).toBe(1);
        });
    });
});

describe("Security - SVG Sanitization", () => {
    describe("sanitizeSvgContent", () => {
        it("should parse valid SVG", () => {
            const svg = '<svg><circle cx="10" cy="10" r="5"/></svg>';
            const result = sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            expect(result.tagName.toLowerCase()).toBe("svg");
        });

        it("should remove script tags", () => {
            const svg = '<svg><circle r="5"/><script>alert(1)</script></svg>';
            const result = sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            const scripts = result.querySelectorAll("script");
            expect(scripts.length).toBe(0);
        });

        it("should remove event handlers", () => {
            const svg = '<svg><circle onclick="alert(1)" r="5"/></svg>';
            const result = sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            const circle = result.querySelector("circle");
            expect(circle.hasAttribute("onclick")).toBe(false);
        });

        it("should remove javascript: hrefs", () => {
            const svg = '<svg><a href="javascript:alert(1)">Link</a></svg>';
            const result = sanitizeSvgContent(svg);
            expect(result).not.toBeNull();
            const link = result.querySelector("a");
            expect(link.hasAttribute("href")).toBe(false);
        });

        it("should return null for invalid SVG", () => {
            const result = sanitizeSvgContent("<div>Not SVG</div>");
            expect(result).toBeNull();
        });

        it("should return null for malformed XML", () => {
            const result = sanitizeSvgContent("<svg><unclosed>");
            expect(result).toBeNull();
        });

        it("should return null for empty input", () => {
            expect(sanitizeSvgContent("")).toBeNull();
            expect(sanitizeSvgContent(null)).toBeNull();
        });
    });
});

describe("Security - Number Validation", () => {
    describe("validateNumber", () => {
        it("should validate valid number", () => {
            expect(validateNumber(123)).toBe(123);
            expect(validateNumber("456")).toBe(456);
            expect(validateNumber(0)).toBe(0);
        });

        it("should validate within range", () => {
            expect(validateNumber(50, 0, 100)).toBe(50);
            expect(validateNumber(0, 0, 100)).toBe(0);
            expect(validateNumber(100, 0, 100)).toBe(100);
        });

        it("should reject out of range", () => {
            expect(validateNumber(-1, 0, 100)).toBeNull();
            expect(validateNumber(101, 0, 100)).toBeNull();
        });

        it("should reject NaN", () => {
            expect(validateNumber(NaN)).toBeNull();
            expect(validateNumber("abc")).toBeNull();
        });

        it("should reject Infinity", () => {
            expect(validateNumber(Infinity)).toBeNull();
            expect(validateNumber(-Infinity)).toBeNull();
        });

        it("should handle default range", () => {
            expect(validateNumber(1e10)).toBe(1e10);
            expect(validateNumber(-1e10)).toBe(-1e10);
        });

        it("should reject XSS attempts", () => {
            expect(validateNumber("<script>alert(1)</script>")).toBeNull();
        });
    });
});

describe("Security - Namespace Export", () => {
    it("should export all functions in Security namespace", () => {
        expect(Security.sanitizeHTML).toBe(sanitizeHTML);
        expect(Security.escapeHtml).toBe(escapeHtml);
        expect(Security.escapeAttribute).toBe(escapeAttribute);
        expect(Security.validateUrl).toBe(validateUrl);
        expect(Security.validateCoordinates).toBe(validateCoordinates);
        expect(Security.containsDangerousHtml).toBe(containsDangerousHtml);
        expect(Security.stripHtml).toBe(stripHtml);
        expect(Security.createSafeElement).toBe(createSafeElement);
        expect(Security.sanitizeSvgContent).toBe(sanitizeSvgContent);
        expect(Security.validateNumber).toBe(validateNumber);
        expect(Security.parseHtmlSafely).toBe(parseHtmlSafely);
    });
});
