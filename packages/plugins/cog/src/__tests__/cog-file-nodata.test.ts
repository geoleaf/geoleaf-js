/*!
 * GeoLeaf COG Plugin — Tests: the file's own nodata value, end to end
 *
 * The loader is mocked (no network), the renderer is REAL: the pixels read here are the ones
 * `addLayer` hands to the engine. A seam test on the options alone would stay green while the
 * renderer ignored them.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCogInfo, mockLoadViewportRasters, drawn } = vi.hoisted(() => ({
    mockGetCogInfo: vi.fn(),
    mockLoadViewportRasters: vi.fn(),
    drawn: [] as Array<HTMLCanvasElement | OffscreenCanvas>,
}));

vi.mock("../cog-loader.js", () => ({
    getCogInfo: mockGetCogInfo,
    selectOverview: () => 0,
    loadViewportRasters: mockLoadViewportRasters,
}));

vi.mock("../cog-renderer.js", async (importOriginal) => {
    const real = await importOriginal<typeof import("../cog-renderer.js")>();
    return {
        ...real,
        // Keep the real drawing, record the surface it produced.
        rastersToCanvas: (...args: Parameters<typeof real.rastersToCanvas>) => {
            const canvas = real.rastersToCanvas(...args);
            drawn.push(canvas);
            return canvas;
        },
        canvasToImageUrl: vi.fn(async () => "geoleaf-cog://test"),
        injectImageSource: vi.fn(),
        removeImageSource: vi.fn(),
    };
});

import { addLayer } from "../cog-api.js";

// ─── Minimal 2D context: stores the last ImageData put on each canvas ─────────

const stored = new WeakMap<object, Uint8ClampedArray>();

beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
        if (type !== "2d") return null;
        const canvas = this;
        return {
            createImageData: (w: number, h: number) => ({
                data: new Uint8ClampedArray(w * h * 4),
                width: w,
                height: h,
            }),
            putImageData: (id: { data: Uint8ClampedArray }) => stored.set(canvas, id.data),
        } as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;
});

function lastPixels(): Uint8ClampedArray {
    const canvas = drawn.at(-1);
    const px = canvas ? stored.get(canvas) : undefined;
    if (!px) throw new Error("nothing drawn");
    return px;
}

const MAP = {
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    getLayer: vi.fn(),
    getSource: vi.fn(),
};

/** A 2×2 single-band uint16 window: one nodata pixel (0), then 100, 200, 200. */
function rasterWithFileNodata(nodata: number | null): void {
    mockGetCogInfo.mockResolvedValue({
        url: "https://example.com/mono16.tif",
        bounds: [0, 0, 1, 1],
        width: 2,
        height: 2,
        bandCount: 1,
        nodata,
        overviewCount: 0,
        epsg: 4326,
    });
    mockLoadViewportRasters.mockResolvedValue({
        rasters: [new Uint16Array([0, 100, 200, 200])],
        width: 2,
        height: 2,
        bounds: [0, 0, 1, 1],
    });
}

beforeEach(() => {
    drawn.length = 0;
});

describe("addLayer — nodata declared by the file", () => {
    it("leaves the file's nodata pixels transparent without any option", async () => {
        rasterWithFileNodata(0);
        await addLayer("https://example.com/mono16.tif", MAP);
        const px = lastPixels();
        expect(Array.from(px.slice(0, 4))).toEqual([0, 0, 0, 0]);
        expect(px[7]).toBe(255);
    });

    it("keeps the file's nodata out of the min/max: the lowest valid value maps to 0", async () => {
        rasterWithFileNodata(0);
        await addLayer("https://example.com/mono16.tif", MAP);
        const px = lastPixels();
        // 100 is the lowest VALID value → black; 200 the highest → white.
        expect(Array.from(px.slice(4, 8))).toEqual([0, 0, 0, 255]);
        expect(Array.from(px.slice(8, 12))).toEqual([255, 255, 255, 255]);
    });

    it("lets an explicit option override the file's value", async () => {
        rasterWithFileNodata(0);
        await addLayer("https://example.com/mono16.tif", MAP, { nodata: 200 });
        const px = lastPixels();
        // 0 is now a valid value, painted opaque; 200 is transparent and out of the min/max,
        // so 100 is the highest valid value → white.
        expect(px[3]).toBe(255);
        expect(px[4]).toBe(255);
        expect(px[11]).toBe(0);
        expect(px[15]).toBe(0);
    });

    it("paints every pixel when neither the file nor the caller declares nodata", async () => {
        rasterWithFileNodata(null);
        await addLayer("https://example.com/mono16.tif", MAP);
        const px = lastPixels();
        expect([px[3], px[7], px[11], px[15]]).toEqual([255, 255, 255, 255]);
    });

    it("keeps the file's value on handle.update() when the update does not set one", async () => {
        rasterWithFileNodata(0);
        const handle = await addLayer("https://example.com/mono16.tif", MAP);
        await handle.update({ opacity: 0.5 });
        expect(lastPixels()[3]).toBe(0);
    });
});
