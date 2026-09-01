/**
 * Tests for the export modules:
 *  - format-registry (registerExporter / getExporter)
 *  - exporters/image-exporter (JPEG Blob via toBlob)
 *  - exporters/pdf-exporter (PDF Blob via jsPDF lazy import)
 *
 * Download and server-fallback tests live in download-server.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

const { mockJsPDFInstance } = vi.hoisted(() => ({
    mockJsPDFInstance: {
        addImage: vi.fn(),
        output: vi.fn(() => new Blob(["%PDF-1.4"], { type: "application/pdf" })),
    },
}));

vi.mock("jspdf", () => ({
    // Vitest 4: `new jsPDF()` needs a constructable mock (class returning the fake).
    jsPDF: vi.fn().mockImplementation(
        class {
            constructor() {
                return mockJsPDFInstance;
            }
        } as unknown as (...args: unknown[]) => unknown
    ),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerExporter, getExporter } from "../format-registry.js";
import { imageExporterFn } from "../exporters/image-exporter.js";
import { pdfExporterFn } from "../exporters/pdf-exporter.js";
import type { ComposedExportOpts } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 100;
    c.height = 100;
    return c;
}

function makeExportOpts(format = "jpg"): ComposedExportOpts {
    return { format, orientation: "portrait", widthMm: 210, heightMm: 297, quality: 0.92 };
}

// ---------------------------------------------------------------------------
// format-registry
// ---------------------------------------------------------------------------

describe("format-registry", () => {
    it("pre-seeds jpg and pdf exporters", () => {
        expect(getExporter("jpg")).toBe(imageExporterFn);
        expect(getExporter("pdf")).toBe(pdfExporterFn);
    });

    it("registerExporter adds a new format", () => {
        const pngFn = vi.fn();
        registerExporter("png", pngFn);
        expect(getExporter("png")).toBe(pngFn);
    });

    it("registerExporter is case-insensitive", () => {
        const fn = vi.fn();
        registerExporter("WEBP", fn);
        expect(getExporter("webp")).toBe(fn);
        expect(getExporter("WEBP")).toBe(fn);
    });

    it("registerExporter overwrites an existing format", () => {
        const custom = vi.fn();
        registerExporter("jpg", custom);
        expect(getExporter("jpg")).toBe(custom);
        // Restore default after test to avoid polluting other tests
        registerExporter("jpg", imageExporterFn);
    });

    it("getExporter returns undefined for unknown format", () => {
        expect(getExporter("xyz-unknown-format")).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// image-exporter
// ---------------------------------------------------------------------------

describe("imageExporterFn", () => {
    it("calls toBlob with image/jpeg and the provided quality", async () => {
        const canvas = makeCanvas();
        const blob = new Blob(["fake"], { type: "image/jpeg" });
        canvas.toBlob = vi.fn((cb, _mime, _q) => {
            cb(blob);
        });

        const result = await imageExporterFn(canvas, makeExportOpts("jpg"));

        expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.92);
        expect(result).toBe(blob);
    });

    it("uses quality from opts", async () => {
        const canvas = makeCanvas();
        const blob = new Blob(["x"], { type: "image/jpeg" });
        canvas.toBlob = vi.fn((cb) => {
            cb(blob);
        });

        await imageExporterFn(canvas, { ...makeExportOpts(), quality: 0.5 });

        expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.5);
    });

    it("rejects when toBlob returns null", async () => {
        const canvas = makeCanvas();
        canvas.toBlob = vi.fn((cb) => {
            cb(null);
        });

        await expect(imageExporterFn(canvas, makeExportOpts())).rejects.toThrow();
    });
});

// ---------------------------------------------------------------------------
// pdf-exporter
// ---------------------------------------------------------------------------

describe("pdfExporterFn", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockJsPDFInstance.output.mockReturnValue(
            new Blob(["%PDF-1.4"], { type: "application/pdf" })
        );
    });

    it("lazy-imports jsPDF and calls addImage + output", async () => {
        const canvas = makeCanvas();
        canvas.toDataURL = vi.fn(() => "data:image/jpeg;base64,/9j/fake");

        const result = await pdfExporterFn(canvas, makeExportOpts("pdf"));

        expect(mockJsPDFInstance.addImage).toHaveBeenCalledWith(
            "data:image/jpeg;base64,/9j/fake",
            "JPEG",
            0,
            0,
            210,
            297
        );
        expect(mockJsPDFInstance.output).toHaveBeenCalledWith("blob");
        expect(result).toBeInstanceOf(Blob);
    });

    it("passes orientation 'l' for landscape", async () => {
        const { jsPDF } = await import("jspdf");
        const canvas = makeCanvas();
        canvas.toDataURL = vi.fn(() => "data:image/jpeg;base64,fake");

        await pdfExporterFn(canvas, {
            ...makeExportOpts("pdf"),
            orientation: "landscape",
            widthMm: 297,
            heightMm: 210,
        });

        expect(jsPDF).toHaveBeenCalledWith(
            expect.objectContaining({ orientation: "l", format: [297, 210] })
        );
    });

    it("passes orientation 'p' for portrait", async () => {
        const { jsPDF } = await import("jspdf");
        const canvas = makeCanvas();
        canvas.toDataURL = vi.fn(() => "data:image/jpeg;base64,fake");

        await pdfExporterFn(canvas, makeExportOpts("pdf"));

        expect(jsPDF).toHaveBeenCalledWith(expect.objectContaining({ orientation: "p" }));
    });
});
