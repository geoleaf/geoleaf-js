/**
 * Campagne tests unitaires — security (escapeHtml, escapeAttribute, validateUrl)
 */

import { escapeHtml, escapeAttribute, validateUrl } from "../src/kernel/security/index.js";

vi.mock("../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Coverage — security", () => {
    describe("escapeHtml", () => {
        it("escapes < and >", () => {
            expect(escapeHtml("<script>")).toContain("&lt;");
            expect(escapeHtml(">")).toContain("&gt;");
        });
        it("returns empty string for null/undefined", () => {
            expect(escapeHtml(null)).toBe("");
            expect(escapeHtml(undefined)).toBe("");
        });
        it("converts non-string to string then escapes", () => {
            expect(escapeHtml(123)).toBe("123");
        });
    });

    describe("escapeAttribute", () => {
        it("escapes quotes and ampersand", () => {
            expect(escapeAttribute('"')).toContain("&quot;");
            expect(escapeAttribute("&")).toContain("&amp;");
            expect(escapeAttribute("<")).toContain("&lt;");
        });
        it("returns empty string for null/undefined", () => {
            expect(escapeAttribute(null)).toBe("");
        });
    });

    describe("validateUrl", () => {
        it("returns url for valid https", () => {
            expect(validateUrl("https://example.com/")).toBe("https://example.com/");
        });
        it("throws for invalid protocol", () => {
            expect(() => validateUrl("javascript:alert(1)")).toThrow();
        });
        it("throws for empty string", () => {
            expect(() => validateUrl("")).toThrow(TypeError);
        });
        it("httpsOnly: accepts https and data:image", () => {
            expect(validateUrl("https://example.com/", undefined, { httpsOnly: true })).toBe(
                "https://example.com/"
            );
            expect(
                validateUrl("data:image/png;base64,iVBORw0KGgo=", undefined, { httpsOnly: true })
            ).toContain("data:image/png");
        });
        it("httpsOnly: rejects http", () => {
            expect(() =>
                validateUrl("http://example.com/", undefined, { httpsOnly: true })
            ).toThrow(/security.httpsOnly|Only https/);
        });
    });
});
