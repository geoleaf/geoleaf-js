/**
 * Unit tests for maplibre-hatch-patterns.
 *
 * Covers: buildHatchPatternId, generateHatchImage (all 6 types),
 * registerHatchPattern (skip / addImage paths), reregisterHatchPatterns and
 * removeHatchPatterns (what a style rebuild loses, and what a removed layer must not
 * get back), _createCanvas OffscreenCanvas branch.
 *
 * Coverage consolidation for adapters/maplibre.
 */

import {
    buildHatchPatternId,
    generateHatchImage,
    registerHatchPattern,
    reregisterHatchPatterns,
    removeHatchPatterns,
} from "../../src/adapters/maplibre/maplibre-hatch-patterns.js";

// ── Canvas mock ──────────────────────────────────────────────────────────────

const mockImageData = {
    data: new Uint8ClampedArray(20 * 20 * 4),
    width: 20,
    height: 20,
};
const mockCtx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    getImageData: vi.fn(() => mockImageData),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: "butt",
};
HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);

// (Module imported above via static import)

// ─── buildHatchPatternId ──────────────────────────────────────────────────────

describe("buildHatchPatternId", () => {
    it("produces a deterministic ID with all config fields", () => {
        const id = buildHatchPatternId("my-layer", {
            type: "diagonal",
            angleDeg: 45,
            spacingPx: 10,
            stroke: { color: "#ff0000", widthPx: 2, opacity: 0.8 },
        });
        expect(id).toBe("gl-hatch-my-layer-diagonal-45-10-ff0000-2-0.8");
    });

    it("uses default values when optional fields are missing", () => {
        const id = buildHatchPatternId("layer", {});
        // type=diagonal, angleDeg=0, spacingPx=10, color=000000, widthPx=1, opacity=1
        expect(id).toBe("gl-hatch-layer-diagonal-0-10-000000-1-1");
    });

    it("strips the # from color in the ID", () => {
        const id = buildHatchPatternId("l", { stroke: { color: "#aabbcc" } });
        expect(id).toContain("aabbcc");
        expect(id).not.toContain("#");
    });

    it("encodes dot type correctly", () => {
        const id = buildHatchPatternId("l", { type: "dot" });
        expect(id).toContain("dot");
    });

    it("encodes cross type correctly", () => {
        const id = buildHatchPatternId("l", { type: "cross" });
        expect(id).toContain("cross");
    });

    it("starts with the gl-hatch- prefix followed by layerId", () => {
        const id = buildHatchPatternId("my-layer", { type: "x" });
        expect(id.startsWith("gl-hatch-my-layer-")).toBe(true);
    });
});

// ─── generateHatchImage ───────────────────────────────────────────────────────

describe("generateHatchImage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns imageData, width, height, pixelRatio for diagonal type", () => {
        const result = generateHatchImage({ type: "diagonal" });
        expect(result).toHaveProperty("imageData");
        expect(result).toHaveProperty("width");
        expect(result).toHaveProperty("height");
        expect(result).toHaveProperty("pixelRatio");
        expect(result.pixelRatio).toBe(2);
    });

    it("generates diagonal type without throwing", () => {
        expect(() => generateHatchImage({ type: "diagonal", angleDeg: 30 })).not.toThrow();
    });

    it("generates diagonal type with default angle (undefined angleDeg)", () => {
        expect(() => generateHatchImage({ type: "diagonal" })).not.toThrow();
        // _drawDiagonal should have been called (ctx.save was called)
        expect(mockCtx.save).toHaveBeenCalled();
    });

    it("generates dot type without throwing", () => {
        expect(() => generateHatchImage({ type: "dot", spacingPx: 8 })).not.toThrow();
        expect(mockCtx.arc).toHaveBeenCalled();
    });

    it("generates cross type without throwing", () => {
        expect(() => generateHatchImage({ type: "cross" })).not.toThrow();
        expect(mockCtx.beginPath).toHaveBeenCalled();
    });

    it("generates x type without throwing", () => {
        expect(() => generateHatchImage({ type: "x" })).not.toThrow();
    });

    it("generates horizontal type without throwing", () => {
        expect(() => generateHatchImage({ type: "horizontal" })).not.toThrow();
    });

    it("generates vertical type without throwing", () => {
        expect(() => generateHatchImage({ type: "vertical" })).not.toThrow();
    });

    it("respects custom pixelRatio argument", () => {
        const result = generateHatchImage({ type: "diagonal" }, 1);
        expect(result.pixelRatio).toBe(1);
    });

    it("applies strokeOpacity via globalAlpha", () => {
        generateHatchImage({ type: "horizontal", stroke: { opacity: 0.5 } });
        expect(mockCtx.globalAlpha).toBe(0.5);
    });

    it("clearRect is called to initialise transparent canvas", () => {
        generateHatchImage({ type: "dot" });
        expect(mockCtx.clearRect).toHaveBeenCalled();
    });
});

// ─── registerHatchPattern ─────────────────────────────────────────────────────

describe("registerHatchPattern", () => {
    let map;

    beforeEach(() => {
        map = {
            hasImage: vi.fn().mockReturnValue(false),
            addImage: vi.fn(),
        };
    });

    it("calls map.addImage with the pattern data when image is not yet registered", () => {
        const patternId = registerHatchPattern(map, "gl-hatch-test-diagonal-0-10-000000-1-1", {
            type: "diagonal",
        });
        expect(map.addImage).toHaveBeenCalledWith(
            "gl-hatch-test-diagonal-0-10-000000-1-1",
            expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
            expect.objectContaining({ pixelRatio: expect.any(Number) })
        );
        expect(patternId).toBe("gl-hatch-test-diagonal-0-10-000000-1-1");
    });

    it("skips map.addImage when hasImage returns true (already registered)", () => {
        map.hasImage.mockReturnValue(true);
        registerHatchPattern(map, "already-registered", { type: "dot" });
        expect(map.addImage).not.toHaveBeenCalled();
    });

    it("returns the patternId when skipping (hasImage=true)", () => {
        map.hasImage.mockReturnValue(true);
        const result = registerHatchPattern(map, "my-id", { type: "cross" });
        expect(result).toBe("my-id");
    });

    it("passes correct pixelRatio to map.addImage", () => {
        registerHatchPattern(map, "pid", { type: "horizontal" }, 3);
        const addImageCall = map.addImage.mock.calls[0];
        expect(addImageCall[2].pixelRatio).toBe(3);
    });
});

// ─── _createCanvas OffscreenCanvas branch ─────────────────────────────────────

describe("generateHatchImage — OffscreenCanvas branch", () => {
    let originalOffscreenCanvas;

    beforeEach(() => {
        originalOffscreenCanvas = globalThis.OffscreenCanvas;
        // Provide a minimal OffscreenCanvas stub
        const getCtxMock = vi.fn(() => mockCtx);
        globalThis.OffscreenCanvas = class MockOffscreenCanvas {
            constructor(w, h) {
                this.width = w;
                this.height = h;
            }
            getContext() {
                return getCtxMock();
            }
        };
    });

    afterEach(() => {
        globalThis.OffscreenCanvas = originalOffscreenCanvas;
    });

    it("uses OffscreenCanvas when available", () => {
        expect(() => generateHatchImage({ type: "vertical" })).not.toThrow();
    });
});

// ─── _createCanvas: OffscreenCanvas present but UNUSABLE ─────────────────────
// The symmetric case of the block above: the constructor exists, so a
// `typeof` guard admits it, but getContext("2d") yields null for want of a 2D
// backend. That is happy-dom >= 20.11 without a canvasAdapter — and this test
// pins the fallback WHATEVER version of happy-dom the root install resolves,
// which is the point: the suite must not depend on which one it gets.

describe("generateHatchImage — OffscreenCanvas present but unusable", () => {
    let originalOffscreenCanvas;

    beforeEach(() => {
        originalOffscreenCanvas = globalThis.OffscreenCanvas;
        globalThis.OffscreenCanvas = class UnusableOffscreenCanvas {
            constructor(w, h) {
                this.width = w;
                this.height = h;
            }
            getContext() {
                return null;
            }
        };
    });

    afterEach(() => {
        globalThis.OffscreenCanvas = originalOffscreenCanvas;
    });

    it("falls back to the DOM canvas instead of throwing", () => {
        HTMLCanvasElement.prototype.getContext.mockClear();
        expect(() => generateHatchImage({ type: "diagonal" })).not.toThrow();
        // Proof the fallback actually ran, not merely that nothing threw.
        expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
    });
});

// ─── What a style rebuild loses, and gets back ───────────────────────────────
// An image is not part of the style. When the engine rebuilds a style from scratch its image
// store starts empty: the fill layers carried into the new style name patterns that are gone.
// The double below keeps a real store, so "the engine lost its images" is `images.clear()`.

/** A map double with a real image store. */
function makeImageStore() {
    const images = new Set();
    return {
        images,
        hasImage: vi.fn((id) => images.has(id)),
        addImage: vi.fn((id) => images.add(id)),
        removeImage: vi.fn((id) => images.delete(id)),
        listImages: vi.fn(() => [...images]),
    };
}

const DIAGONAL = { type: "diagonal", angleDeg: 45, spacingPx: 10 };
const DOTS = { type: "dot", spacingPx: 8 };

describe("reregisterHatchPatterns", () => {
    it("draws again every pattern the map lost, and says how many", () => {
        const map = makeImageStore();
        const a = registerHatchPattern(map, buildHatchPatternId("zones", DIAGONAL), DIAGONAL);
        const b = registerHatchPattern(map, buildHatchPatternId("pluie", DOTS), DOTS);
        expect([...map.images].sort()).toEqual([a, b].sort());

        map.images.clear(); // the engine rebuilt the style
        map.addImage.mockClear();

        expect(reregisterHatchPatterns(map)).toBe(2);
        expect([...map.images].sort()).toEqual([a, b].sort());
        expect(map.addImage).toHaveBeenCalledTimes(2);
    });

    it("adds nothing when the map still holds its patterns (the engine diffed the style)", () => {
        const map = makeImageStore();
        registerHatchPattern(map, buildHatchPatternId("zones", DIAGONAL), DIAGONAL);
        map.addImage.mockClear();

        expect(reregisterHatchPatterns(map)).toBe(0);
        expect(map.addImage).not.toHaveBeenCalled();
    });

    it("puts back only what is missing", () => {
        const map = makeImageStore();
        const kept = registerHatchPattern(map, buildHatchPatternId("zones", DIAGONAL), DIAGONAL);
        const lost = registerHatchPattern(map, buildHatchPatternId("pluie", DOTS), DOTS);
        map.images.delete(lost);
        map.addImage.mockClear();

        expect(reregisterHatchPatterns(map)).toBe(1);
        expect(map.addImage).toHaveBeenCalledTimes(1);
        expect(map.addImage.mock.calls[0][0]).toBe(lost);
        expect(map.images.has(kept)).toBe(true);
    });

    it("remembers a pattern the map already held when it was registered", () => {
        // The early return on `hasImage` must not skip the bookkeeping: the pattern is as
        // lost as any other once the store is emptied.
        const map = makeImageStore();
        const id = buildHatchPatternId("zones", DIAGONAL);
        map.images.add(id);
        registerHatchPattern(map, id, DIAGONAL);
        expect(map.addImage).not.toHaveBeenCalled();

        map.images.clear();
        expect(reregisterHatchPatterns(map)).toBe(1);
        expect(map.images.has(id)).toBe(true);
    });

    it("redraws at the pixel ratio the pattern was registered with", () => {
        const map = makeImageStore();
        const id = registerHatchPattern(map, buildHatchPatternId("zones", DIAGONAL), DIAGONAL, 3);
        map.images.clear();
        map.addImage.mockClear();

        reregisterHatchPatterns(map);
        expect(map.addImage).toHaveBeenCalledWith(id, expect.any(Object), { pixelRatio: 3 });
    });

    it("returns 0 for a map nothing was registered on", () => {
        const map = makeImageStore();
        expect(reregisterHatchPatterns(map)).toBe(0);
        expect(map.addImage).not.toHaveBeenCalled();
    });

    it("keeps each map's patterns to itself", () => {
        const first = makeImageStore();
        const second = makeImageStore();
        registerHatchPattern(first, buildHatchPatternId("zones", DIAGONAL), DIAGONAL);

        expect(reregisterHatchPatterns(second)).toBe(0);
        expect(second.images.size).toBe(0);
    });
});

describe("removeHatchPatterns", () => {
    it("takes the layer's patterns off the map, and leaves the others", () => {
        const map = makeImageStore();
        const gone = registerHatchPattern(map, buildHatchPatternId("zones", DIAGONAL), DIAGONAL);
        const kept = registerHatchPattern(map, buildHatchPatternId("pluie", DOTS), DOTS);

        removeHatchPatterns(map, "zones");

        expect(map.removeImage).toHaveBeenCalledWith(gone);
        expect(map.removeImage).not.toHaveBeenCalledWith(kept);
        expect([...map.images]).toEqual([kept]);
    });

    it("forgets them: a later style rebuild does not bring a removed layer's pattern back", () => {
        const map = makeImageStore();
        registerHatchPattern(map, buildHatchPatternId("zones", DIAGONAL), DIAGONAL);
        const kept = registerHatchPattern(map, buildHatchPatternId("pluie", DOTS), DOTS);

        removeHatchPatterns(map, "zones");
        map.images.clear(); // the engine rebuilt the style

        expect(reregisterHatchPatterns(map)).toBe(1);
        expect([...map.images]).toEqual([kept]);
    });

    it("forgets a pattern the map had ALREADY lost when the layer was removed", () => {
        // Between a rebuild and the `style.load` that puts the patterns back, the image is not
        // in `listImages()`. Forgetting must not depend on finding it there.
        const map = makeImageStore();
        registerHatchPattern(map, buildHatchPatternId("zones", DIAGONAL), DIAGONAL);
        map.images.clear();

        removeHatchPatterns(map, "zones");

        expect(reregisterHatchPatterns(map)).toBe(0);
        expect(map.images.size).toBe(0);
    });

    it("forgets even when the engine exposes no `listImages()`", () => {
        const map = makeImageStore();
        registerHatchPattern(map, buildHatchPatternId("zones", DIAGONAL), DIAGONAL);
        map.listImages = undefined;

        expect(() => removeHatchPatterns(map, "zones")).not.toThrow();
        expect(map.removeImage).not.toHaveBeenCalled();

        map.images.clear();
        expect(reregisterHatchPatterns(map)).toBe(0);
    });

    it("does nothing for a map nothing was registered on", () => {
        const map = makeImageStore();
        expect(() => removeHatchPatterns(map, "zones")).not.toThrow();
        expect(map.removeImage).not.toHaveBeenCalled();
    });
});
