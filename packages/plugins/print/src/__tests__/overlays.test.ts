/**
 * Tests for overlays: scale-overlay.ts, north-arrow.ts, legend-inline.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { drawScaleOverlay } from "../overlays/scale-overlay.js";
import { drawNorthArrow } from "../overlays/north-arrow.js";
import { drawLegendInline } from "../overlays/legend-inline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(): CanvasRenderingContext2D {
    const canvas = document.createElement("canvas");
    canvas.width = 2000;
    canvas.height = 2000;
    return canvas.getContext("2d") as CanvasRenderingContext2D;
}

function makeMapZone() {
    return { x: 0, y: 0, widthPx: 2000, heightPx: 1500 };
}

function makeLegendZone() {
    return { x: 0, y: 1500, widthPx: 2000, heightPx: 400 };
}

// ---------------------------------------------------------------------------
// scale-overlay
// ---------------------------------------------------------------------------

describe("drawScaleOverlay", () => {
    it("calls ctx.save and ctx.restore", () => {
        const ctx = makeCtx();
        drawScaleOverlay(ctx, makeMapZone(), 25_000, 300);
        expect(ctx.save).toHaveBeenCalled();
        expect(ctx.restore).toHaveBeenCalled();
    });

    it("calls ctx.fillText with the scale denominator", () => {
        const ctx = makeCtx();
        drawScaleOverlay(ctx, makeMapZone(), 25_000, 300);
        const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
        const scaleCall = calls.find((c) => String(c[0]).includes("1:"));
        expect(scaleCall).not.toBeUndefined();
    });

    it("calls ctx.fillRect at least twice (panel + bar)", () => {
        const ctx = makeCtx();
        drawScaleOverlay(ctx, makeMapZone(), 25_000, 300);
        expect((ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(
            2
        );
    });

    it("outputs a distance label in metres for small scale", () => {
        const ctx = makeCtx();
        drawScaleOverlay(ctx, makeMapZone(), 5_000, 300);
        const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
        const distCall = calls.find((c) => String(c[0]).includes(" m"));
        expect(distCall).not.toBeUndefined();
    });

    it("outputs a distance label in km for large scale", () => {
        const ctx = makeCtx();
        drawScaleOverlay(ctx, makeMapZone(), 500_000, 300);
        const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
        const distCall = calls.find((c) => String(c[0]).includes("km"));
        expect(distCall).not.toBeUndefined();
    });

    it("works with 72 dpi (low resolution)", () => {
        const ctx = makeCtx();
        expect(() => drawScaleOverlay(ctx, makeMapZone(), 25_000, 72)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// north-arrow
// ---------------------------------------------------------------------------

describe("drawNorthArrow", () => {
    beforeEach(() => {
        // Stub Image so that setting src (a data: URI) fires onload asynchronously
        class MockImage {
            onload: (() => void) | null = null;
            onerror: ((e: unknown) => void) | null = null;
            width: number;
            height: number;
            _src = "";
            constructor(w = 0, h = 0) {
                this.width = w;
                this.height = h;
            }
            set src(v: string) {
                this._src = v;
                setTimeout(() => this.onload?.(), 0);
            }
            get src() {
                return this._src;
            }
        }
        vi.stubGlobal("Image", MockImage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("calls ctx.arc for the white background disc", async () => {
        const ctx = makeCtx();
        await drawNorthArrow(ctx, makeMapZone(), 300);
        expect(ctx.arc).toHaveBeenCalled();
    });

    it("calls ctx.drawImage with the rasterised SVG", async () => {
        const ctx = makeCtx();
        await drawNorthArrow(ctx, makeMapZone(), 300);
        expect(ctx.drawImage).toHaveBeenCalled();
    });

    it("passes a data: URI to the Image (CSP-safe, no blob:)", async () => {
        let capturedSrc = "";
        class CaptureSrcImage {
            onload: (() => void) | null = null;
            onerror: ((e: unknown) => void) | null = null;
            set src(v: string) {
                capturedSrc = v;
                setTimeout(() => this.onload?.(), 0);
            }
            get src() {
                return capturedSrc;
            }
        }
        vi.stubGlobal("Image", CaptureSrcImage);

        const ctx = makeCtx();
        await drawNorthArrow(ctx, makeMapZone(), 300);
        expect(capturedSrc).toMatch(/^data:image\/svg\+xml;base64,/);
    });

    it("rejects when image load fails", async () => {
        class FailImage {
            onload: (() => void) | null = null;
            onerror: ((e: unknown) => void) | null = null;
            set src(_v: string) {
                setTimeout(() => this.onerror?.(new Error("load error")), 0);
            }
            get src() {
                return "";
            }
        }
        vi.stubGlobal("Image", FailImage);
        const ctx = makeCtx();
        await expect(drawNorthArrow(ctx, makeMapZone(), 300)).rejects.toBeDefined();
    });

    it("works with different DPI values", async () => {
        const ctx = makeCtx();
        await expect(drawNorthArrow(ctx, makeMapZone(), 96)).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// legend-inline
// ---------------------------------------------------------------------------

describe("drawLegendInline", () => {
    afterEach(() => {
        delete (globalThis as any).GeoLeaf;
    });

    it("returns 0 when GeoLeaf is not present", async () => {
        const ctx = makeCtx();
        const result = await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(result).toBe(0);
    });

    it("returns 0 when GeoLeaf.Legend is absent", async () => {
        (globalThis as any).GeoLeaf = {};
        const ctx = makeCtx();
        const result = await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(result).toBe(0);
    });

    it("returns 0 when layers map is empty", async () => {
        (globalThis as any).GeoLeaf = { Legend: { getAllLayers: () => new Map() } };
        const ctx = makeCtx();
        const result = await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(result).toBe(0);
    });

    it("skips invisible layers without drawing", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: false,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                { symbol: { type: "circle" }, label: "Hidden" },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(ctx.arc).not.toHaveBeenCalled();
    });

    it("calls ctx.arc for a circle symbol", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                {
                                                    symbol: { type: "circle", fillColor: "#f00" },
                                                    label: "Circle",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(ctx.arc).toHaveBeenCalled();
    });

    it("calls ctx.arc for a marker symbol (fallthrough to circle)", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                { symbol: { type: "marker" }, label: "Marker" },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(ctx.arc).toHaveBeenCalled();
    });

    it("calls ctx.lineTo for a solid line symbol", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                {
                                                    symbol: { type: "line", color: "#333" },
                                                    label: "Line",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(ctx.lineTo).toHaveBeenCalled();
    });

    it("calls ctx.fillRect for a polygon symbol", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                {
                                                    symbol: { type: "polygon", fillColor: "#aaa" },
                                                    label: "Polygon",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(ctx.fillRect).toHaveBeenCalled();
    });

    it("calls ctx.fillRect for a fill symbol (alias for polygon)", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                {
                                                    symbol: { type: "fill", fillColor: "#bbb" },
                                                    label: "Fill",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(ctx.fillRect).toHaveBeenCalled();
    });

    it("calls ctx.fillText with '★' for a star symbol", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                {
                                                    symbol: { type: "star", color: "#f59e0b" },
                                                    label: "Star",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.find((c) => c[0] === "★")).not.toBeUndefined();
    });

    it("calls ctx.arc for an unknown symbol type (falls back to circle)", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                {
                                                    symbol: { type: "unknown-type" },
                                                    label: "Fallback",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(ctx.arc).toHaveBeenCalled();
    });

    it("renders section title with fillText", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "Section Title",
                                            items: [{ symbol: { type: "circle" }, label: "Item" }],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.find((c) => c[0] === "Section Title")).not.toBeUndefined();
    });

    it("returns a positive height when items are drawn", async () => {
        (globalThis as any).GeoLeaf = {
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [{ symbol: { type: "circle" }, label: "Item" }],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };
        const ctx = makeCtx();
        const height = await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(height).toBeGreaterThan(0);
    });

    it("handles complex (dashed) line symbol via renderSymbol fallback", async () => {
        const renderSymbol = vi.fn((div: HTMLElement) => {
            // Inject a minimal SVG into the container to simulate renderSymbol
            div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><line x1="0" y1="10" x2="20" y2="10"/></svg>`;
        });

        // Stub Image for the SVG→Image path
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:complex-sym");
        vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined as any);
        class SvgImage {
            onload: (() => void) | null = null;
            onerror: ((e: unknown) => void) | null = null;
            constructor(
                public width = 0,
                public height = 0
            ) {}
            set src(_v: string) {
                setTimeout(() => this.onload?.(), 0);
            }
            get src() {
                return "";
            }
        }
        vi.stubGlobal("Image", SvgImage);

        (globalThis as any).GeoLeaf = {
            _UIComponents: { renderSymbol },
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                {
                                                    symbol: { type: "line", style: "dashed" },
                                                    label: "Dashed",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };

        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        expect(renderSymbol).toHaveBeenCalled();

        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("draws fallback placeholder when renderSymbol produces no SVG", async () => {
        const renderSymbol = vi.fn(); // does nothing — no SVG injected

        (globalThis as any).GeoLeaf = {
            _UIComponents: { renderSymbol },
            Legend: {
                getAllLayers: () =>
                    new Map([
                        [
                            "l1",
                            {
                                visible: true,
                                legendData: {
                                    sections: [
                                        {
                                            title: "",
                                            items: [
                                                {
                                                    symbol: { type: "icon" },
                                                    label: "Icon",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    ]),
            },
        };

        const ctx = makeCtx();
        await drawLegendInline(ctx, makeLegendZone(), 300);
        // fillRect is called for the fallback placeholder
        expect(ctx.fillRect).toHaveBeenCalled();
    });
});
