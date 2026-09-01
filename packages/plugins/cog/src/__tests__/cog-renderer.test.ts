/*!
 * GeoLeaf COG Plugin â€” Tests: cog-renderer
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    canvasToDataUrl,
    injectImageSource,
    rastersToCanvas,
    removeImageSource,
} from "../cog-renderer.js";
import type { CogRasterData } from "../types.js";

// â”€â”€â”€ jsdom canvas mock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// jsdom does not implement HTMLCanvasElement.getContext('2d').
// We provide a minimal mock that stores pixel data so assertions can be made.

interface MockContext {
    imageData: { data: Uint8ClampedArray; width: number; height: number } | null;
    createImageData(
        w: number,
        h: number
    ): { data: Uint8ClampedArray; width: number; height: number };
    putImageData(id: { data: Uint8ClampedArray }): void;
    getImageData(): { data: Uint8ClampedArray; width: number; height: number } | null;
}

const contextStore = new WeakMap<HTMLCanvasElement, MockContext>();

beforeAll(() => {
    // Mock getContext to return a stored in-memory context per canvas element
    HTMLCanvasElement.prototype.getContext = function (type: string) {
        if (type !== "2d") return null;
        if (!contextStore.has(this)) {
            const ctx: MockContext = {
                imageData: null,
                createImageData(w: number, h: number) {
                    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
                },
                putImageData(id: { data: Uint8ClampedArray; width: number; height: number }) {
                    ctx.imageData = id;
                },
                getImageData() {
                    return ctx.imageData;
                },
            };
            contextStore.set(this, ctx);
        }
        return contextStore.get(this) as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;

    // Mock toDataURL for canvasToDataUrl tests
    HTMLCanvasElement.prototype.toDataURL = function () {
        return "data:image/png;base64,MOCK";
    };
});

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeBand(length: number, fill: number): Uint8Array {
    return new Uint8Array(length).fill(fill);
}

function makeRasterData(
    bandCount: number,
    width = 4,
    height = 4,
    fills: number[] = []
): CogRasterData {
    const rasters = Array.from({ length: bandCount }, (_, i) =>
        makeBand(width * height, fills[i] ?? 128)
    );
    return {
        rasters,
        width,
        height,
        bounds: [0, 0, 10, 10],
    };
}

function getPixels(canvas: HTMLCanvasElement | OffscreenCanvas): { data: Uint8ClampedArray } {
    const ctx = contextStore.get(canvas as HTMLCanvasElement);
    if (!ctx?.imageData) throw new Error("No pixel data stored");
    return ctx.imageData;
}

// â”€â”€â”€ Mock MapLibre map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeMockMap() {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        getLayer: vi.fn(() => ({})),
        getSource: vi.fn(() => ({})),
    };
}

// â”€â”€â”€ rastersToCanvas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("rastersToCanvas", () => {
    it("handles 1-band grayscale â€” all channels equal", () => {
        const data = makeRasterData(1, 2, 2, [200]);
        const canvas = rastersToCanvas(data, {});
        expect(canvas.width).toBe(2);
        expect(canvas.height).toBe(2);
        const { data: pixels } = getPixels(canvas);
        // All pixels should be R=G=B, A=255
        for (let i = 0; i < pixels.length; i += 4) {
            expect(pixels[i]).toBe(pixels[i + 1]);
            expect(pixels[i + 1]).toBe(pixels[i + 2]);
            expect(pixels[i + 3]).toBe(255);
        }
    });

    it("handles 3-band RGB â€” alpha is 255 for all pixels", () => {
        const data = makeRasterData(3, 2, 2, [255, 0, 128]);
        const canvas = rastersToCanvas(data, {});
        const { data: pixels } = getPixels(canvas);
        for (let i = 0; i < pixels.length; i += 4) {
            expect(pixels[i + 3]).toBe(255);
        }
    });

    it("handles 4-band RGBA â€” alpha channel from band 4", () => {
        const rasters = [
            makeBand(4, 100),
            makeBand(4, 150),
            makeBand(4, 200),
            makeBand(4, 128), // alpha
        ];
        const data: CogRasterData = { rasters, width: 2, height: 2, bounds: [0, 0, 1, 1] };
        const canvas = rastersToCanvas(data, {});
        const { data: pixels } = getPixels(canvas);
        for (let i = 0; i < pixels.length; i += 4) {
            expect(pixels[i + 3]).toBe(128);
        }
    });

    it("nodata value â†’ fully transparent pixel", () => {
        const rasters = [makeBand(4, 0)]; // all nodata
        const data: CogRasterData = { rasters, width: 2, height: 2, bounds: [0, 0, 1, 1] };
        const canvas = rastersToCanvas(data, { nodata: 0 });
        const { data: pixels } = getPixels(canvas);
        for (let i = 0; i < pixels.length; i += 4) {
            expect(pixels[i + 3]).toBe(0);
        }
    });

    it("colorMap LUT applied for single-band rendering", () => {
        const rasters = [new Uint8Array([0, 128, 255, 64])];
        const data: CogRasterData = { rasters, width: 2, height: 2, bounds: [0, 0, 1, 1] };
        // All LUT entries map to red (255, 0, 0, 255)
        const colorMap: Array<[number, number, number, number]> = Array.from(
            { length: 256 },
            () => [255, 0, 0, 255] as [number, number, number, number]
        );
        const canvas = rastersToCanvas(data, { colorMap });
        const { data: pixels } = getPixels(canvas);
        for (let i = 0; i < pixels.length; i += 4) {
            expect(pixels[i]).toBe(255); // R
            expect(pixels[i + 1]).toBe(0); // G
            expect(pixels[i + 2]).toBe(0); // B
        }
    });

    it("respects explicit band selection (bands option)", () => {
        const data = makeRasterData(3, 2, 2, [10, 240, 50]);
        const canvas = rastersToCanvas(data, { bands: [2] });
        expect(canvas.width).toBe(2);
        const { data: pixels } = getPixels(canvas);
        // Single-band selection â†’ R=G=B (grayscale)
        for (let i = 0; i < pixels.length; i += 4) {
            expect(pixels[i]).toBe(pixels[i + 1]);
        }
    });

    it("remaps channels with explicit 3-band selection (false color)", () => {
        // Three bands with intra-band variation so normalisation is non-trivial.
        const bandA = new Uint8Array([0, 100, 0, 100]); // index 0, range 0..100
        const bandB = new Uint8Array([50, 50, 200, 200]); // index 1, range 50..200
        const bandC = new Uint8Array([255, 255, 255, 0]); // index 2, range 0..255
        const data: CogRasterData = {
            rasters: [bandA, bandB, bandC],
            width: 2,
            height: 2,
            bounds: [0, 0, 1, 1],
        };
        // bands [3,2,1] (1-based) -> red=bandC, green=bandB, blue=bandA
        const canvas = rastersToCanvas(data, { bands: [3, 2, 1] });
        const { data: pixels } = getPixels(canvas);
        // Pixel 0: R=norm(bandC[0]=255)=255 ; default order would give R=norm(bandA[0]=0)=0.
        expect(pixels[0]).toBe(255);
        expect(pixels[1]).toBe(0); // green = norm(bandB[0]=50, min50) = 0
        expect(pixels[2]).toBe(0); // blue = norm(bandA[0]=0, min0) = 0
        expect(pixels[3]).toBe(255); // RGB path -> opaque
    });

    it("colorMap + nodata: nodata stays transparent, others get the LUT color", () => {
        const rasters = [new Uint8Array([0, 5, 10, 0])]; // values 0 are nodata
        const data: CogRasterData = { rasters, width: 2, height: 2, bounds: [0, 0, 1, 1] };
        const colorMap: Array<[number, number, number, number]> = Array.from(
            { length: 256 },
            () => [0, 255, 0, 255] as [number, number, number, number]
        );
        const canvas = rastersToCanvas(data, { colorMap, nodata: 0 });
        const { data: pixels } = getPixels(canvas);
        // Pixel 0 (value 0 = nodata) -> fully transparent
        expect(pixels[3]).toBe(0);
        // Pixel 1 (value 5) -> LUT green, opaque
        expect(pixels[4]).toBe(0); // R
        expect(pixels[5]).toBe(255); // G
        expect(pixels[7]).toBe(255); // A
        // Pixel 3 (value 0 = nodata) -> transparent
        expect(pixels[15]).toBe(0);
    });
});

// â”€â”€â”€ canvasToDataUrl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// The constructor exists, so a `typeof` guard admits it, but getContext("2d")
// yields null for want of a 2D backend — happy-dom >= 20.11 without a canvasAdapter.
// This pins the fallback WHATEVER version of happy-dom the root install resolves;
// the suite must not depend on which one it gets.

describe("rastersToCanvas — OffscreenCanvas present but unusable", () => {
    const g = globalThis as { OffscreenCanvas?: unknown };
    let originalOffscreenCanvas: unknown;

    beforeEach(() => {
        originalOffscreenCanvas = g.OffscreenCanvas;
        g.OffscreenCanvas = class UnusableOffscreenCanvas {
            width: number;
            height: number;
            constructor(w: number, h: number) {
                this.width = w;
                this.height = h;
            }
            getContext(): null {
                return null;
            }
        };
    });

    afterEach(() => {
        g.OffscreenCanvas = originalOffscreenCanvas;
    });

    it("falls back to the DOM canvas instead of throwing", () => {
        const data = makeRasterData(1, 2, 2, [200]);
        const canvas = rastersToCanvas(data, {});
        // Proof the fallback actually ran, not merely that nothing threw.
        expect(canvas).toBeInstanceOf(HTMLCanvasElement);
        expect(getPixels(canvas).data.length).toBe(2 * 2 * 4);
    });
});

describe("canvasToDataUrl", () => {
    it("returns a string from HTMLCanvasElement.toDataURL", async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        const url = await canvasToDataUrl(canvas);
        expect(typeof url).toBe("string");
        expect(url.length).toBeGreaterThan(0);
    });
});

// â”€â”€â”€ injectImageSource â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("injectImageSource", () => {
    it("calls map.addSource and map.addLayer with correct arguments", () => {
        const map = makeMockMap();
        injectImageSource(map, "test-layer", "data:image/png;base64,AA==", [-10, -5, 10, 5], {
            opacity: 0.8,
        });

        expect(map.addSource).toHaveBeenCalledTimes(1);
        const sourceCall = map.addSource.mock.calls[0];
        expect(sourceCall[0]).toBe("test-layer");
        expect(sourceCall[1]).toMatchObject({ type: "image", url: "data:image/png;base64,AA==" });
        // Coordinates: [[west,north],[east,north],[east,south],[west,south]]
        const coords = sourceCall[1].coordinates as Array<[number, number]>;
        expect(coords[0]).toEqual([-10, 5]);
        expect(coords[1]).toEqual([10, 5]);
        expect(coords[2]).toEqual([10, -5]);
        expect(coords[3]).toEqual([-10, -5]);

        expect(map.addLayer).toHaveBeenCalledTimes(1);
        const layerCall = map.addLayer.mock.calls[0];
        expect(layerCall[0]).toMatchObject({
            id: "test-layer",
            type: "raster",
            source: "test-layer",
            paint: { "raster-opacity": 0.8 },
        });
    });

    it("defaults opacity to 1 when not provided", () => {
        const map = makeMockMap();
        injectImageSource(map, "layer-a", "data:image/png;base64,AA==", [0, 0, 1, 1], {});
        const layerCall = map.addLayer.mock.calls[0];
        expect(layerCall[0].paint?.["raster-opacity"]).toBe(1);
    });
});

// â”€â”€â”€ removeImageSource â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("removeImageSource", () => {
    it("calls map.removeLayer and map.removeSource", () => {
        const map = makeMockMap();
        removeImageSource(map, "my-cog");
        expect(map.removeLayer).toHaveBeenCalledWith("my-cog");
        expect(map.removeSource).toHaveBeenCalledWith("my-cog");
    });

    it("does not throw when layer/source do not exist", () => {
        const map = {
            ...makeMockMap(),
            getLayer: vi.fn(() => undefined),
            getSource: vi.fn(() => undefined),
            removeLayer: vi.fn(() => {
                throw new Error("not found");
            }),
            removeSource: vi.fn(() => {
                throw new Error("not found");
            }),
        };
        expect(() => removeImageSource(map, "ghost-layer")).not.toThrow();
    });
});
