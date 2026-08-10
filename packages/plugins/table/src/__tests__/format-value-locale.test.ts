/**
 * Tests for formatValue's locale — CAPACITÉS B.26 remainder.
 *
 * Number and date cells were formatted with a hard-coded `"fr-FR"`, so an English or
 * German user read French-grouped numbers and `JJ/MM/AAAA` dates. These are DATA cells:
 * unlike a scale denominator (see `plugin-print/scale-format.ts`, where B.26 settled on a
 * locale-independent space), they must follow the profile's language.
 */
import { describe, it, expect, afterEach } from "vitest";
import { formatValue } from "../format-value.js";

const g = globalThis as { GeoLeaf?: unknown };

function withLang(lang: string | undefined): void {
    g.GeoLeaf = lang === undefined ? {} : { I18n: { getActiveLang: () => lang } };
}

afterEach(() => {
    delete g.GeoLeaf;
});

describe("formatValue — locale of data cells", () => {
    it("groups a number in the profile language, not in French", () => {
        withLang("en");
        const en = formatValue(1234567, "number");
        withLang("de");
        const de = formatValue(1234567, "number");
        // Discriminating: a hard-coded "fr-FR" returns the SAME string for both.
        expect(en).not.toBe(de);
        expect(en).toBe("1,234,567");
        expect(de).toBe("1.234.567");
    });

    it("formats a date in the profile language", () => {
        // Built in LOCAL time on purpose: `new Date("2026-07-23")` parses as UTC midnight,
        // so the rendered day flips west of Greenwich and the test would fail on the clock
        // rather than on the code.
        const d = new Date(2026, 6, 23);
        withLang("en");
        const en = formatValue(d, "date");
        withLang("fr");
        const fr = formatValue(d, "date");
        // Discriminating: a hard-coded "fr-FR" returns the SAME string for both.
        expect(en).not.toBe(fr);
        expect(fr).toBe("23/07/2026");
        expect(en).toBe("7/23/2026");
    });

    it("falls back to French when the core is absent", () => {
        withLang(undefined);
        expect(formatValue(1234567, "number")).toBe((1234567).toLocaleString("fr"));
    });

    it("leaves non-numeric and empty values untouched", () => {
        withLang("en");
        expect(formatValue(null, "number")).toBe("—");
        expect(formatValue("", "number")).toBe("—");
        expect(formatValue("abc", "number")).toBe("abc");
        expect(formatValue("not-a-date", "date")).toBe("not-a-date");
    });
});
