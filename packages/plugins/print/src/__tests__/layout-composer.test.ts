/**
 * Tests for layout-composer.ts
 *
 * Verifies zone drawing, overlay calls, slot invocation, and cache behaviour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf } from "./setup.js";

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock("../overlays/scale-overlay.js", () => ({
    drawScaleOverlay: vi.fn(),
}));

vi.mock("../overlays/north-arrow.js", () => ({
    drawNorthArrow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../overlays/legend-inline.js", () => ({
    drawLegendInline: vi.fn().mockResolvedValue(20),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createComposedCanvas, registerSlot } from "../layout-composer.js";
import { drawScaleOverlay } from "../overlays/scale-overlay.js";
import { drawNorthArrow } from "../overlays/north-arrow.js";
import { drawLegendInline } from "../overlays/legend-inline.js";
import type { ComposeSlot, PageZones } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeZones(): PageZones {
    return {
        map: { x: 10, y: 24, width: 190, height: 220 },
        title: { x: 10, y: 10, width: 190, height: 14 },
        legend: { x: 10, y: 244, width: 190, height: 24 },
        footer: { x: 10, y: 268, width: 190, height: 0 },
    };
}

function makeTargetPixels() {
    return {
        map: { widthPx: 2480, heightPx: 2866 },
        title: { widthPx: 2480, heightPx: 182 },
        legend: { widthPx: 2480, heightPx: 312 },
        footer: { widthPx: 2480, heightPx: 0 },
    };
}

const BASE_OPTS = {
    title: "Test map",
    description: "",
    scaleDenominator: 25_000,
    dpi: 300,
    includeScale: false,
    includeNorthArrow: false,
    includeLegend: false,
    pageSizeMm: { widthMm: 210, heightMm: 297 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createComposedCanvas", () => {
    let mapCanvas: HTMLCanvasElement;

    beforeEach(() => {
        installMockGeoLeaf();
        mapCanvas = document.createElement("canvas");
        mapCanvas.width = 2480;
        mapCanvas.height = 2866;
        vi.clearAllMocks();
    });

    afterEach(() => {
        uninstallMockGeoLeaf();
    });

    it("returns a canvas element", async () => {
        const result = await createComposedCanvas(
            mapCanvas,
            makeZones(),
            makeTargetPixels(),
            BASE_OPTS
        );
        expect(result).toBeInstanceOf(HTMLCanvasElement);
    });

    it("calls drawImage once for the map zone", async () => {
        const result = await createComposedCanvas(
            mapCanvas,
            makeZones(),
            makeTargetPixels(),
            BASE_OPTS
        );
        const ctx = result.getContext("2d") as any;
        // Source larger than the zone → centre-crop form (9 args), see below.
        expect(ctx.drawImage).toHaveBeenCalledWith(
            mapCanvas,
            expect.any(Number),
            expect.any(Number),
            expect.any(Number),
            expect.any(Number),
            expect.any(Number),
            expect.any(Number),
            expect.any(Number),
            expect.any(Number)
        );
    });

    // ------------------------------------------------------------------
    // Scale fidelity (PLUGINS S6) — the map must never be rescaled to fit.
    // ------------------------------------------------------------------

    it("centre-crops the capture at 1:1 pixel instead of stretching it", async () => {
        // Zone: 190 × 220 mm at 300 DPI → 2244 × 2598 px, inside a 2480 × 2866 capture.
        const result = await createComposedCanvas(
            mapCanvas,
            makeZones(),
            makeTargetPixels(),
            BASE_OPTS
        );
        const ctx = result.getContext("2d") as any;
        const [src, sx, sy, sw, sh, , , dw, dh] = ctx.drawImage.mock.calls[0];

        expect(src).toBe(mapCanvas);
        // Source and destination rects are the same size ⇒ no rescaling ⇒ the
        // locked scale printed is the locked scale requested.
        expect(sw).toBe(dw);
        expect(sh).toBe(dh);
        // ...and the surplus is split evenly, so the framed centre stays centred.
        expect(sx).toBe(Math.round((mapCanvas.width - dw) / 2));
        expect(sy).toBe(Math.round((mapCanvas.height - dh) / 2));
    });

    it("falls back to a scaled draw when the capture is smaller than the zone", async () => {
        // Mobile DPI clamp (_boundedDpi) is the real case: nothing to crop.
        const small = document.createElement("canvas");
        small.width = 800;
        small.height = 600;

        const result = await createComposedCanvas(
            small,
            makeZones(),
            makeTargetPixels(),
            BASE_OPTS
        );
        const ctx = result.getContext("2d") as any;

        expect(ctx.drawImage.mock.calls[0]).toHaveLength(5);
    });

    it("does NOT call drawScaleOverlay when includeScale is false", async () => {
        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            includeScale: false,
        });
        expect(drawScaleOverlay).not.toHaveBeenCalled();
    });

    it("calls drawScaleOverlay when includeScale is true", async () => {
        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            includeScale: true,
        });
        expect(drawScaleOverlay).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ widthPx: expect.any(Number) }),
            BASE_OPTS.scaleDenominator,
            BASE_OPTS.dpi
        );
    });

    it("does NOT call drawNorthArrow when includeNorthArrow is false", async () => {
        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            includeNorthArrow: false,
        });
        expect(drawNorthArrow).not.toHaveBeenCalled();
    });

    it("calls drawNorthArrow when includeNorthArrow is true", async () => {
        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            includeNorthArrow: true,
        });
        expect(drawNorthArrow).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ widthPx: expect.any(Number) }),
            BASE_OPTS.dpi
        );
    });

    it("does NOT call drawLegendInline when includeLegend is false", async () => {
        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            includeLegend: false,
        });
        expect(drawLegendInline).not.toHaveBeenCalled();
    });

    it("calls drawLegendInline when includeLegend is true and legend zone has height", async () => {
        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            includeLegend: true,
        });
        expect(drawLegendInline).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ widthPx: expect.any(Number) }),
            BASE_OPTS.dpi
        );
    });

    it("calls fillText with the title when title is non-empty", async () => {
        const result = await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            title: "Hello World",
        });
        const ctx = result.getContext("2d") as any;
        expect(ctx.fillText).toHaveBeenCalledWith(
            "Hello World",
            expect.any(Number),
            expect.any(Number),
            expect.any(Number)
        );
    });

    it("does not call fillText when title is empty", async () => {
        const result = await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            title: "",
        });
        const ctx = result.getContext("2d") as any;
        expect(ctx.fillText).not.toHaveBeenCalled();
    });

    it("draws the description in the footer when the footer zone has height", async () => {
        const zones = { ...makeZones(), footer: { x: 10, y: 268, width: 190, height: 10 } };
        const targetPx = { ...makeTargetPixels(), footer: { widthPx: 2480, heightPx: 118 } };
        const result = await createComposedCanvas(mapCanvas, zones, targetPx, {
            ...BASE_OPTS,
            title: "",
            description: "Footer description text",
        });
        const ctx = result.getContext("2d") as any;
        expect(ctx.fillText).toHaveBeenCalledWith(
            expect.stringContaining("Footer description text"),
            expect.any(Number),
            expect.any(Number),
            expect.any(Number)
        );
    });

    it("does NOT draw the footer when the footer zone has zero height", async () => {
        // makeZones() footer.height === 0 → _drawFooterZone is never reached.
        const result = await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), {
            ...BASE_OPTS,
            title: "",
            description: "Should not appear",
        });
        const ctx = result.getContext("2d") as any;
        expect(ctx.fillText).not.toHaveBeenCalled();
    });
});

describe("registerSlot", () => {
    let mapCanvas: HTMLCanvasElement;

    beforeEach(() => {
        installMockGeoLeaf();
        mapCanvas = document.createElement("canvas");
        vi.clearAllMocks();
    });

    afterEach(() => {
        uninstallMockGeoLeaf();
    });

    it("calls slot.render during composition", async () => {
        const renderFn = vi.fn();
        const slot: ComposeSlot = {
            id: "test-slot",
            placement: "overlay-tl",
            render: renderFn,
        };
        registerSlot(slot);

        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), BASE_OPTS);
        expect(renderFn).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
            undefined
        );

        // Cleanup: re-register with a no-op so subsequent tests are not affected
        registerSlot({ ...slot, render: vi.fn() });
    });

    it("replaces a slot with the same id", async () => {
        const render1 = vi.fn();
        const render2 = vi.fn();
        const slot: ComposeSlot = { id: "dup-slot", placement: "overlay-br", render: render1 };
        registerSlot(slot);
        registerSlot({ ...slot, render: render2 });

        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), BASE_OPTS);
        expect(render1).not.toHaveBeenCalled();
        expect(render2).toHaveBeenCalled();

        // Cleanup
        registerSlot({ ...slot, render: vi.fn() });
    });

    it("calls slot.render for overlay-tr placement", async () => {
        const renderFn = vi.fn();
        const slot: ComposeSlot = { id: "slot-tr", placement: "overlay-tr", render: renderFn };
        registerSlot(slot);

        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), BASE_OPTS);
        expect(renderFn).toHaveBeenCalled();

        registerSlot({ ...slot, render: vi.fn() });
    });

    it("calls slot.render for overlay-bl placement", async () => {
        const renderFn = vi.fn();
        const slot: ComposeSlot = { id: "slot-bl", placement: "overlay-bl", render: renderFn };
        registerSlot(slot);

        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), BASE_OPTS);
        expect(renderFn).toHaveBeenCalled();

        registerSlot({ ...slot, render: vi.fn() });
    });

    it("calls slot.render for title placement", async () => {
        const renderFn = vi.fn();
        const slot: ComposeSlot = { id: "slot-title", placement: "title", render: renderFn };
        registerSlot(slot);

        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), BASE_OPTS);
        expect(renderFn).toHaveBeenCalled();

        registerSlot({ ...slot, render: vi.fn() });
    });

    it("calls slot.render for legend placement", async () => {
        const renderFn = vi.fn();
        const slot: ComposeSlot = { id: "slot-legend", placement: "legend", render: renderFn };
        registerSlot(slot);

        await createComposedCanvas(mapCanvas, makeZones(), makeTargetPixels(), BASE_OPTS);
        expect(renderFn).toHaveBeenCalled();

        registerSlot({ ...slot, render: vi.fn() });
    });

    it("calls slot.render for footer placement when footer zone has height", async () => {
        const renderFn = vi.fn();
        const slot: ComposeSlot = { id: "slot-footer", placement: "footer", render: renderFn };
        registerSlot(slot);

        const zonesWithFooter = {
            ...makeZones(),
            footer: { x: 10, y: 268, width: 190, height: 10 },
        };
        const tpWithFooter = {
            ...makeTargetPixels(),
            footer: { widthPx: 2480, heightPx: 130 },
        };
        await createComposedCanvas(mapCanvas, zonesWithFooter, tpWithFooter, BASE_OPTS);
        expect(renderFn).toHaveBeenCalled();

        registerSlot({ ...slot, render: vi.fn() });
    });
});
