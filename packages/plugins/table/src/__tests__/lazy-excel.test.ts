/**
 * Unit coverage for the lazy Excel chunk:
 *   - src/lazy/xlsx-writer.ts  (buildXlsx — pure OOXML/stored-ZIP builder)
 *   - src/lazy/export-excel.ts (buildExcelBuffer — features → xlsx)
 *
 * Neither module is mocked. Assertions exercise the real branches: numeric vs
 * inline-string vs empty cells, null values, multi-column overflow (columnLetter
 * AA path), sheet-name sanitization, empty data, and the ZIP container shape.
 */
import { describe, it, expect } from "vitest";

import { buildXlsx } from "../lazy/xlsx-writer.js";
import { buildExcelBuffer } from "../lazy/export-excel.js";

/** Decodes the produced bytes to a string for substring assertions on the XML. */
function decode(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

/** Little-endian uint32 read at byte offset. */
function u32(bytes: Uint8Array, off: number): number {
    return (
        (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0
    );
}

describe("lazy/xlsx-writer.ts — buildXlsx", () => {
    it("returns a non-empty Uint8Array with a ZIP local-file signature", () => {
        const out = buildXlsx(["name"], [{ name: "Alice" }]);
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out.length).toBeGreaterThan(0);
        // Local file header signature PK\x03\x04 = 0x04034b50
        expect(u32(out, 0)).toBe(0x04034b50);
    });

    it("ends with the End-Of-Central-Directory record (PK\\x05\\x06)", () => {
        const out = buildXlsx(["a"], [{ a: 1 }]);
        const eocdSig = 0x06054b50;
        // EOCD is the last 22 bytes for a comment-less archive.
        expect(u32(out, out.length - 22)).toBe(eocdSig);
    });

    it("packages the five expected OOXML parts", () => {
        const text = decode(buildXlsx(["a"], [{ a: 1 }]));
        expect(text).toContain("[Content_Types].xml");
        expect(text).toContain("_rels/.rels");
        expect(text).toContain("xl/workbook.xml");
        expect(text).toContain("xl/_rels/workbook.xml.rels");
        expect(text).toContain("xl/worksheets/sheet1.xml");
    });

    it("emits numeric cells as <v> (no inlineStr) for finite numbers", () => {
        const text = decode(buildXlsx(["n"], [{ n: 42 }]));
        expect(text).toContain("<v>42</v>");
    });

    it("emits inline-string cells for text values", () => {
        const text = decode(buildXlsx(["s"], [{ s: "hello" }]));
        expect(text).toContain('t="inlineStr"');
        expect(text).toContain('<t xml:space="preserve">hello</t>');
    });

    it("emits an empty self-closing cell for empty string and null values", () => {
        const text = decode(buildXlsx(["x", "y"], [{ x: "", y: null }]));
        // Empty / null both map to value "" → self-closing <c r="..."/>
        expect(text).toMatch(/<c r="A2"\/>/);
        expect(text).toMatch(/<c r="B2"\/>/);
    });

    it("escapes XML-significant characters in strings", () => {
        const text = decode(buildXlsx(["s"], [{ s: 'a&b<c>d"e' }]));
        expect(text).toContain("a&amp;b&lt;c&gt;d&quot;e");
    });

    it("drops illegal C0 control bytes but keeps tab/newline", () => {
        // \x00 illegal (dropped), \t kept
        const text = decode(buildXlsx(["s"], [{ s: "a\x00b\tc" }]));
        // The illegal NUL must be stripped → "ab\tc"
        expect(text).toContain("ab\tc");
        expect(text).not.toContain("a\x00b");
    });

    it("computes spreadsheet column letters past Z (AA path via 28 columns)", () => {
        const headers = Array.from({ length: 28 }, (_, i) => "h" + i);
        const row: Record<string, unknown> = {};
        headers.forEach((h, i) => (row[h] = i));
        const text = decode(buildXlsx(headers, [row]));
        // 27th column (index 26) → "AA", header row is row 1 → "AA1"
        expect(text).toContain('r="AA1"');
        // 28th column (index 27) → "AB"
        expect(text).toContain('r="AB1"');
    });

    it("treats non-finite numbers (NaN/Infinity) as strings, not numeric cells", () => {
        const text = decode(buildXlsx(["n"], [{ n: Number.NaN }]));
        // NaN is not finite → String(NaN) = "NaN" → inline string
        expect(text).toContain("NaN");
        expect(text).toContain('t="inlineStr"');
    });

    it("sanitizes illegal characters in the sheet name", () => {
        const text = decode(buildXlsx(["a"], [{ a: 1 }], "My:Sheet/Name?*"));
        // colon, slash, ? and * are replaced with spaces
        expect(text).toContain('name="My Sheet Name  "');
    });

    it("falls back to 'Sheet1' when the name is an empty string", () => {
        // Illegal chars are replaced with spaces (not removed), so the only way
        // the sanitized name is empty is an already-empty input.
        const text = decode(buildXlsx(["a"], [{ a: 1 }], ""));
        expect(text).toContain('name="Sheet1"');
    });

    it("truncates sheet names longer than 31 characters", () => {
        const long = "x".repeat(50);
        const text = decode(buildXlsx(["a"], [{ a: 1 }], long));
        expect(text).toContain('name="' + "x".repeat(31) + '"');
    });

    it("produces a valid container for empty rows (header only)", () => {
        const out = buildXlsx(["a", "b"], []);
        expect(out.length).toBeGreaterThan(0);
        const text = decode(out);
        // Header row present, no data rows.
        expect(text).toContain('<row r="1">');
        expect(text).not.toContain('<row r="2">');
    });

    it("defaults the sheet name to 'Sheet1' when omitted", () => {
        const text = decode(buildXlsx(["a"], [{ a: 1 }]));
        expect(text).toContain('name="Sheet1"');
    });
});

describe("lazy/export-excel.ts — buildExcelBuffer", () => {
    it("returns a non-empty Uint8Array (valid ZIP signature) for features", () => {
        const out = buildExcelBuffer([{ properties: { name: "A", pop: 100 } }]);
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out.length).toBeGreaterThan(0);
        expect(u32(out, 0)).toBe(0x04034b50);
    });

    it("collects the union of property keys across features", () => {
        const text = decode(
            buildExcelBuffer([{ properties: { a: 1 } }, { properties: { b: 2, c: 3 } }])
        );
        // Header row carries every key seen across all features.
        expect(text).toContain("a");
        expect(text).toContain("b");
        expect(text).toContain("c");
    });

    it("stringifies object-valued properties (geometry excluded)", () => {
        const text = decode(
            buildExcelBuffer([{ properties: { meta: { k: "v" } }, geometry: { type: "Point" } }])
        );
        // Object property → JSON.stringify; appears as an inline string.
        expect(text).toContain("{&quot;k&quot;:&quot;v&quot;}");
        // Geometry must not become a column.
        expect(text).not.toContain("Point");
    });

    it("maps null/undefined property values to empty cells", () => {
        const text = decode(buildExcelBuffer([{ properties: { a: null, b: undefined } }]));
        // a (row2 col A) and b (row2 col B) both become empty self-closing cells.
        expect(text).toMatch(/<c r="A2"\/>/);
        expect(text).toMatch(/<c r="B2"\/>/);
    });

    it("keeps numeric property values as numeric cells", () => {
        const text = decode(buildExcelBuffer([{ properties: { pop: 250 } }]));
        expect(text).toContain("<v>250</v>");
    });

    it("handles features with no properties (skips key collection)", () => {
        const out = buildExcelBuffer([{ geometry: { type: "Point" } }]);
        expect(out.length).toBeGreaterThan(0);
    });

    it("handles an empty feature array", () => {
        const out = buildExcelBuffer([]);
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out.length).toBeGreaterThan(0);
    });
});
