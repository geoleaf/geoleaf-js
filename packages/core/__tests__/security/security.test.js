/**
 * @fileoverview Security tests for GeoLeaf — ESM, no global.GeoLeaf (migrated from legacy CJS bridge).
 * Validates XSS prevention, URL validation, sanitization
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

describe("Security Module", () => {
    describe("escapeHtml", () => {
        test("should escape script tags", () => {
            const input = '<script>alert("XSS")</script>';
            const escaped = Security.escapeHtml(input);

            expect(escaped).not.toContain("<script");
            expect(escaped).toContain("&lt;script&gt;");
        });

        test("should escape XSS attack vectors", () => {
            const attacks = [
                "<script>alert(1)</script>",
                '<img src=x onerror="alert(1)">',
                "<svg/onload=alert(1)>",
                '<iframe src="javascript:alert(1)"></iframe>',
                "<body onload=alert(1)>",
                "<input onfocus=alert(1) autofocus>",
                "<select onfocus=alert(1) autofocus>",
                "<textarea onfocus=alert(1) autofocus>",
                "<marquee onstart=alert(1)>",
            ];

            attacks.forEach((attack) => {
                const escaped = Security.escapeHtml(attack);

                expect(escaped).not.toContain("<script");
                expect(escaped).not.toMatch(/<img[^>]*>/);
                expect(escaped).not.toMatch(/<iframe[^>]*>/);
                expect(escaped).not.toMatch(/<body[^>]*>/);
                expect(escaped).toContain("&lt;");
            });
        });

        test("should handle null and undefined", () => {
            expect(Security.escapeHtml(null)).toBe("");
            expect(Security.escapeHtml(undefined)).toBe("");
        });

        test("should convert non-strings to strings", () => {
            expect(Security.escapeHtml(123)).toBe("123");
            expect(Security.escapeHtml(true)).toBe("true");
        });

        test("should preserve safe text", () => {
            const safe = "Hello World 123";
            expect(Security.escapeHtml(safe)).toBe(safe);
        });
    });

    describe("escapeAttribute", () => {
        test("should escape quotes", () => {
            const input = 'value"onclick="alert(1)';
            const escaped = Security.escapeAttribute(input);

            expect(escaped).toContain("&quot;");
            expect(escaped).not.toContain('"');
        });

        test("should escape all dangerous characters", () => {
            const input = "&<>\"'";
            const escaped = Security.escapeAttribute(input);

            expect(escaped).toBe("&amp;&lt;&gt;&quot;&#39;");
        });
    });

    describe("validateUrl", () => {
        test("should accept valid https URLs", () => {
            const url = "https://example.com/api/data.json";
            expect(Security.validateUrl(url)).toBe(url);
        });

        test("should accept valid http URLs", () => {
            const url = "http://example.com/data.json";
            expect(Security.validateUrl(url)).toBe(url);
        });

        test("should reject javascript: protocol", () => {
            const jsUrl = "javascript" + ":alert(1)";
            expect(() => {
                Security.validateUrl(jsUrl);
            }).toThrow("Protocol");
        });

        test("should reject vbscript: protocol", () => {
            expect(() => {
                Security.validateUrl("vbscript:alert(1)");
            }).toThrow("Protocol");
        });

        test("should reject file: protocol", () => {
            expect(() => {
                Security.validateUrl("file:///etc/passwd");
            }).toThrow("Protocol");
        });

        test("should accept valid data: image URLs", () => {
            const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
            const result = Security.validateUrl(dataUrl);
            expect(result).toBe(dataUrl);
        });

        test("should reject data:text/html URLs", () => {
            expect(() => {
                Security.validateUrl("data:text/html,<script>alert(1)</script>");
            }).toThrow("Data URL type");
        });

        test("should reject data:text/javascript URLs", () => {
            expect(() => {
                Security.validateUrl("data:text/javascript,alert(1)");
            }).toThrow("Data URL type");
        });

        test("should throw on empty URL", () => {
            expect(() => {
                Security.validateUrl("");
            }).toThrow("non-empty string");
        });

        test("should throw on non-string URL", () => {
            expect(() => {
                Security.validateUrl(null);
            }).toThrow("non-empty string");
        });

        test("should handle relative URLs with base", () => {
            const result = Security.validateUrl("/api/data.json", "https://example.com");
            expect(result).toBe("https://example.com/api/data.json");
        });
    });

    describe("validateCoordinates", () => {
        test("should accept valid coordinates", () => {
            const [lat, lng] = Security.validateCoordinates(45.5, -73.6);
            expect(lat).toBe(45.5);
            expect(lng).toBe(-73.6);
        });

        test("should accept boundary coordinates", () => {
            expect(() => {
                Security.validateCoordinates(90, 180);
            }).not.toThrow();

            expect(() => {
                Security.validateCoordinates(-90, -180);
            }).not.toThrow();
        });

        test("should reject latitude > 90", () => {
            expect(() => {
                Security.validateCoordinates(91, 0);
            }).toThrow("Latitude");
        });

        test("should reject latitude < -90", () => {
            expect(() => {
                Security.validateCoordinates(-91, 0);
            }).toThrow("Latitude");
        });

        test("should reject longitude > 180", () => {
            expect(() => {
                Security.validateCoordinates(0, 181);
            }).toThrow("Longitude");
        });

        test("should reject longitude < -180", () => {
            expect(() => {
                Security.validateCoordinates(0, -181);
            }).toThrow("Longitude");
        });

        test("should reject NaN coordinates", () => {
            expect(() => {
                Security.validateCoordinates(NaN, 0);
            }).toThrow("finite");
        });

        test("should reject Infinity coordinates", () => {
            expect(() => {
                Security.validateCoordinates(Infinity, 0);
            }).toThrow("finite");
        });

        test("should reject non-number coordinates", () => {
            expect(() => {
                Security.validateCoordinates("45", "-73");
            }).toThrow("must be numbers");
        });
    });

    describe("containsDangerousHtml", () => {
        test("should detect script tags", () => {
            expect(Security.containsDangerousHtml("<script>alert(1)</script>")).toBe(true);
        });

        test("should detect event handlers", () => {
            expect(Security.containsDangerousHtml('onerror="alert(1)"')).toBe(true);
            expect(Security.containsDangerousHtml('onclick="alert(1)"')).toBe(true);
            expect(Security.containsDangerousHtml('onload="alert(1)"')).toBe(true);
        });

        test("should detect javascript: protocol", () => {
            const jsStr = "javascript" + ":alert(1)";
            expect(Security.containsDangerousHtml(jsStr)).toBe(true);
        });

        test("should detect dangerous tags", () => {
            expect(Security.containsDangerousHtml("<iframe>")).toBe(true);
            expect(Security.containsDangerousHtml("<object>")).toBe(true);
            expect(Security.containsDangerousHtml("<embed>")).toBe(true);
        });

        test("should return false for safe content", () => {
            expect(Security.containsDangerousHtml("Hello World")).toBe(false);
            expect(Security.containsDangerousHtml("<p>Safe paragraph</p>")).toBe(false);
        });

        test("should handle non-strings", () => {
            expect(Security.containsDangerousHtml(123)).toBe(false);
            expect(Security.containsDangerousHtml(null)).toBe(false);
        });
    });

    describe("stripHtml", () => {
        test("should remove all HTML tags", () => {
            const html = "<p>Hello <b>World</b></p>";
            expect(Security.stripHtml(html)).toBe("Hello World");
        });

        test("should handle nested tags", () => {
            const html = "<div><p><span>Test</span></p></div>";
            expect(Security.stripHtml(html)).toBe("Test");
        });

        test("should handle empty tags", () => {
            const html = "<p></p>";
            expect(Security.stripHtml(html)).toBe("");
        });

        test("should return empty string for non-strings", () => {
            expect(Security.stripHtml(null)).toBe("");
            expect(Security.stripHtml(undefined)).toBe("");
        });
    });

    describe("Integration - Real Attack Scenarios", () => {
        test("should prevent data URL XSS", () => {
            expect(() => {
                Security.validateUrl("data:text/html,<script>alert(document.cookie)</script>");
            }).toThrow();
        });
    });
});
