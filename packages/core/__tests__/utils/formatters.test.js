/**
 * @fileoverview Unit tests for formatters — formatDateTime, formatFileSize, toMB, toGB
 */

import { formatDateTime, formatFileSize, toMB, toGB } from "../../src/utils/general/formatters.js";

describe("formatters", () => {
    describe("formatDateTime", () => {
        test("should format date and time", () => {
            const d = new Date("2025-12-19T14:30:00");
            const out = formatDateTime(d);
            expect(out).toBeTruthy();
        });

        test("should return empty string for invalid date", () => {
            expect(formatDateTime(new Date("invalid"))).toBe("");
        });

        test("should fall back to medium format for unknown style in formatDateTime", () => {
            const d = new Date("2025-12-19T14:30:00");
            const out = formatDateTime(d, { style: "unknown_style" });
            expect(out).toBeTruthy();
        });
    });

    describe("formatFileSize", () => {
        test("should format bytes", () => {
            expect(formatFileSize(0)).toBe("0 B");
            expect(formatFileSize(500)).toMatch(/\d+\s*B/);
        });

        test("should format KB", () => {
            const out = formatFileSize(1024);
            expect(out).toMatch(/\d+[,.]?\d*\s*KB/);
        });

        test("should format MB", () => {
            const out = formatFileSize(1024 * 1024 * 1.5);
            expect(out).toMatch(/\d+[,.]?\d*\s*MB/);
        });

        test('should return "0 B" for null, NaN or 0', () => {
            expect(formatFileSize(null)).toBe("0 B");
            expect(formatFileSize(NaN)).toBe("0 B");
            expect(formatFileSize(0)).toBe("0 B");
        });

        test("should respect precision option", () => {
            const out = formatFileSize(1536, { precision: 0 });
            expect(out).toMatch(/\d+\s*KB/);
        });
    });

    describe("toMB", () => {
        test("should return MB value as string", () => {
            expect(toMB(1024 * 1024)).toBe("1.0");
            expect(toMB(1024 * 1024 * 512)).toBe("512.0");
        });

        test('should return "0" for 0 or falsy', () => {
            expect(toMB(0)).toBe("0");
            expect(toMB(null)).toBe("0");
        });

        test("should respect precision", () => {
            expect(toMB(1024 * 1024 * 100, 2)).toBe("100.00");
        });
    });

    describe("toGB", () => {
        test("should return GB value as string", () => {
            expect(toGB(1024 * 1024 * 1024)).toBe("1.00");
        });

        test('should return "0" for 0 or falsy', () => {
            expect(toGB(0)).toBe("0");
            expect(toGB(null)).toBe("0");
        });

        test("should respect precision", () => {
            expect(toGB(1024 * 1024 * 1024 * 2.5, 1)).toBe("2.5");
        });
    });
});
