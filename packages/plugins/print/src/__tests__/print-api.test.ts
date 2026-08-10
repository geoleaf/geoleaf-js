/**
 * Tests for print-api.ts — the capture→compose→export pipeline behind `GeoLeaf.Print.*`.
 *
 * This module carried NO tests before PLUGINS B.12. It is not new code: it lived in
 * `public-api.ts`, which the package excludes from coverage, so its 0 % never showed.
 * That blind spot is not hypothetical here — S6 found the printed scale drifting up to
 * 17 % from the locked one precisely because nothing compared the rendered zones to the
 * composed ones. Splitting the facade made this measurable; these tests close the gap.
 *
 * The zone invariant is pinned explicitly below: the flags and zones handed to
 * `computeZones` must be the same ones handed to `createComposedCanvas`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/** Shapes the mocks are asserted against — the pipeline's two ends (see S6 invariant). */
interface ZoneFlags {
    includeTitle: boolean;
    includeLegend: boolean;
    includeScale: boolean;
    includeNorthArrow: boolean;
    includeFooter: boolean;
}
interface ComposeOpts {
    includeLegend: boolean;
    includeScale: boolean;
    includeNorthArrow: boolean;
    scaleDenominator: number;
    dpi: number;
    pageSizeMm: { widthMm: number; heightMm: number };
}
interface PrintCfg {
    dpi: number;
    defaultFormat: string;
    jpgQuality: number;
    includeLegend?: boolean;
    includeScale?: boolean;
    includeNorthArrow?: boolean;
}

const mocks = vi.hoisted(() => ({
    _warnNoCore: vi.fn(() => false),
    openPrintFlow: vi.fn(async () => null),
    captureExtent: vi.fn(),
    captureViewport: vi.fn(),
    registerPageFormat: vi.fn(),
    computeZones: vi.fn<(format: string, orientation: string, flags: ZoneFlags) => unknown>(() => ({
        map: { x: 0, y: 0, w: 100, h: 100 },
    })),
    computeTargetPixels: vi.fn<(zones: unknown, dpi: number) => unknown>(() => ({
        w: 1000,
        h: 1000,
    })),
    resolvePageDimensions: vi.fn<(f: string, o: string) => unknown>(() => ({
        widthMm: 297,
        heightMm: 210,
    })),
    createComposedCanvas: vi.fn<
        (canvas: unknown, zones: unknown, targetPx: unknown, opts: ComposeOpts) => Promise<unknown>
    >(async () => ({ tag: "composed-canvas" })),
    registerSlot: vi.fn(),
    registerExporter: vi.fn(),
    getExporter: vi.fn<(f: string) => unknown>(),
    downloadBlob: vi.fn<(blob: Blob, filename: string) => Promise<void>>(async () => {}),
    getPrintConfig: vi.fn<() => PrintCfg>(() => ({
        dpi: 300,
        defaultFormat: "A4",
        jpgQuality: 0.9,
    })),
}));

vi.mock("../internal.js", () => ({ _warnNoCore: mocks._warnNoCore }));
vi.mock("../flow.js", () => ({ openPrintFlow: mocks.openPrintFlow }));
vi.mock("../offscreen-render.js", () => ({
    captureExtent: mocks.captureExtent,
    captureViewport: mocks.captureViewport,
}));
vi.mock("../page-format.js", () => ({
    registerPageFormat: mocks.registerPageFormat,
    computeZones: mocks.computeZones,
    computeTargetPixels: mocks.computeTargetPixels,
    resolvePageDimensions: mocks.resolvePageDimensions,
}));
vi.mock("../layout-composer.js", () => ({
    createComposedCanvas: mocks.createComposedCanvas,
    registerSlot: mocks.registerSlot,
}));
vi.mock("../format-registry.js", () => ({
    registerExporter: mocks.registerExporter,
    getExporter: mocks.getExporter,
}));
vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    downloadBlob: mocks.downloadBlob,
}));
vi.mock("../config.js", () => ({ getPrintConfig: mocks.getPrintConfig }));

import {
    openPrintFlow,
    captureExtent,
    captureViewport,
    exportImage,
    exportPDF,
    registerExporter,
    registerPageFormat,
    registerSlot,
    _getExporter,
} from "../print-api.js";

const BBOX_WIDE = { minLng: 0, minLat: 0, maxLng: 10, maxLat: 2 };
const BBOX_TALL = { minLng: 0, minLat: 0, maxLng: 2, maxLat: 10 };

function okCapture(bbox = BBOX_WIDE): Record<string, unknown> {
    return { canvas: { tag: "map-canvas" }, bbox, scaleDenominator: 25000 };
}

describe("print-api", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks._warnNoCore.mockReturnValue(false);
        mocks.getPrintConfig.mockReturnValue({ dpi: 300, defaultFormat: "A4", jpgQuality: 0.9 });
        mocks.resolvePageDimensions.mockReturnValue({ widthMm: 297, heightMm: 210 });
        mocks.captureViewport.mockResolvedValue(okCapture());
        mocks.captureExtent.mockResolvedValue(okCapture());
        mocks.getExporter.mockReturnValue(vi.fn(async () => new Blob(["x"])));
    });

    // ── delegation ───────────────────────────────────────────────────────────
    describe("delegation", () => {
        it("openPrintFlow substitutes an empty options object when called bare", async () => {
            await openPrintFlow();
            expect(mocks.openPrintFlow).toHaveBeenCalledWith({});
        });

        it("openPrintFlow forwards the options it is given", async () => {
            await openPrintFlow({ title: "T" } as never);
            expect(mocks.openPrintFlow).toHaveBeenCalledWith({ title: "T" });
        });

        it("registerExporter / registerPageFormat / registerSlot forward verbatim", () => {
            const fn = vi.fn();
            registerExporter("png", fn as never);
            registerPageFormat("A2", { w: 1 } as never);
            registerSlot({ id: "s" } as never);
            expect(mocks.registerExporter).toHaveBeenCalledWith("png", fn);
            expect(mocks.registerPageFormat).toHaveBeenCalledWith("A2", { w: 1 });
            expect(mocks.registerSlot).toHaveBeenCalledWith({ id: "s" });
        });

        it("_getExporter forwards to the registry", () => {
            const fn = vi.fn();
            mocks.getExporter.mockReturnValue(fn);
            expect(_getExporter("pdf")).toBe(fn);
        });
    });

    // ── capture guards ───────────────────────────────────────────────────────
    describe("capture", () => {
        it("captureExtent returns null and does not capture when the core is absent", async () => {
            mocks._warnNoCore.mockReturnValue(true);
            expect(await captureExtent(BBOX_WIDE as never)).toBeNull();
            expect(mocks.captureExtent).not.toHaveBeenCalled();
        });

        it("captureViewport returns null and does not capture when the core is absent", async () => {
            mocks._warnNoCore.mockReturnValue(true);
            expect(await captureViewport()).toBeNull();
            expect(mocks.captureViewport).not.toHaveBeenCalled();
        });

        it("captureExtent swallows a renderer throw and returns null", async () => {
            mocks.captureExtent.mockRejectedValueOnce(new Error("gl lost"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(await captureExtent(BBOX_WIDE as never)).toBeNull();
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it("captureViewport swallows a renderer throw and returns null", async () => {
            mocks.captureViewport.mockRejectedValueOnce(new Error("gl lost"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(await captureViewport()).toBeNull();
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it("captureViewport defaults its options to an empty object", async () => {
            await captureViewport();
            expect(mocks.captureViewport).toHaveBeenCalledWith({});
        });
    });

    // ── orientation ──────────────────────────────────────────────────────────
    describe("orientation derivation", () => {
        it("derives landscape from a wider-than-tall bbox", async () => {
            mocks.captureExtent.mockResolvedValue(okCapture(BBOX_WIDE));
            await exportImage({ bbox: BBOX_WIDE } as never);
            expect(mocks.resolvePageDimensions).toHaveBeenCalledWith("A4", "landscape");
        });

        it("derives portrait from a taller-than-wide bbox", async () => {
            mocks.captureExtent.mockResolvedValue(okCapture(BBOX_TALL));
            await exportImage({ bbox: BBOX_TALL } as never);
            expect(mocks.resolvePageDimensions).toHaveBeenCalledWith("A4", "portrait");
        });

        it("an explicit orientation wins over the bbox aspect ratio", async () => {
            mocks.captureExtent.mockResolvedValue(okCapture(BBOX_WIDE));
            await exportImage({ bbox: BBOX_WIDE, orientation: "portrait" } as never);
            expect(mocks.resolvePageDimensions).toHaveBeenCalledWith("A4", "portrait");
        });

        it("captures the viewport when no bbox is supplied", async () => {
            await exportImage({} as never);
            expect(mocks.captureViewport).toHaveBeenCalled();
            expect(mocks.captureExtent).not.toHaveBeenCalled();
        });
    });

    // ── the S6 invariant ─────────────────────────────────────────────────────
    describe("zone invariant (S6 — rendered zones must equal composed zones)", () => {
        it("passes the SAME include flags to computeZones and createComposedCanvas", async () => {
            await exportImage({
                title: "Titre",
                description: "Pied",
                includeLegend: true,
                includeScale: false,
                includeNorthArrow: false,
            } as never);

            const zoneArgs = mocks.computeZones.mock.calls[0][2];
            const composeArgs = mocks.createComposedCanvas.mock.calls[0][3];
            expect(zoneArgs.includeLegend).toBe(composeArgs.includeLegend);
            expect(zoneArgs.includeScale).toBe(composeArgs.includeScale);
            expect(zoneArgs.includeNorthArrow).toBe(composeArgs.includeNorthArrow);
            // And they are the values the caller asked for, not defaults.
            expect(zoneArgs).toMatchObject({
                includeLegend: true,
                includeScale: false,
                includeNorthArrow: false,
                includeTitle: true,
                includeFooter: true,
            });
        });

        it("treats a blank title/description as absent, so no band is reserved", async () => {
            await exportImage({ title: "   ", description: "" } as never);
            expect(mocks.computeZones.mock.calls[0][2]).toMatchObject({
                includeTitle: false,
                includeFooter: false,
            });
        });

        it("falls back to config then to built-in defaults for the include flags", async () => {
            mocks.getPrintConfig.mockReturnValue({
                dpi: 300,
                defaultFormat: "A4",
                jpgQuality: 0.9,
                includeLegend: true,
            });
            await exportImage({} as never);
            expect(mocks.computeZones.mock.calls[0][2]).toMatchObject({
                includeLegend: true, // from config
                includeScale: true, // built-in default
                includeNorthArrow: true, // built-in default
            });
        });

        it("composes with the captured scale denominator and the resolved page size", async () => {
            await exportImage({} as never);
            expect(mocks.createComposedCanvas.mock.calls[0][3]).toMatchObject({
                scaleDenominator: 25000,
                dpi: 300,
                pageSizeMm: { widthMm: 297, heightMm: 210 },
            });
        });
    });

    // ── export ───────────────────────────────────────────────────────────────
    describe("exportImage / exportPDF", () => {
        it.each([
            ["exportImage", exportImage, "jpg"],
            ["exportPDF", exportPDF, "pdf"],
        ])("%s returns null when the core is absent", async (_n, fn) => {
            mocks._warnNoCore.mockReturnValue(true);
            expect(await fn({} as never)).toBeNull();
            expect(mocks.createComposedCanvas).not.toHaveBeenCalled();
        });

        it.each([
            ["exportImage", exportImage],
            ["exportPDF", exportPDF],
        ])("%s returns null when the capture fails", async (_n, fn) => {
            mocks.captureViewport.mockRejectedValue(new Error("nope"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(await fn({} as never)).toBeNull();
            warn.mockRestore();
        });

        it.each([
            ["exportImage", exportImage],
            ["exportPDF", exportPDF],
        ])("%s returns null on an unknown paper format", async (_n, fn) => {
            mocks.resolvePageDimensions.mockReturnValue(undefined);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(await fn({ format: "A9" } as never)).toBeNull();
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining("Unknown paper format"),
                "A9"
            );
            warn.mockRestore();
        });

        it.each([
            ["exportImage", exportImage],
            ["exportPDF", exportPDF],
        ])("%s returns null when no exporter is registered", async (_n, fn) => {
            mocks.getExporter.mockReturnValue(undefined);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(await fn({} as never)).toBeNull();
            warn.mockRestore();
        });

        it.each([
            ["exportImage", exportImage],
            ["exportPDF", exportPDF],
        ])("%s returns null when the exporter throws", async (_n, fn) => {
            mocks.getExporter.mockReturnValue(
                vi.fn(async () => {
                    throw new Error("encode failed");
                })
            );
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(await fn({} as never)).toBeNull();
            warn.mockRestore();
        });

        it("exportImage downloads as <title>.jpg, slugging a blank title to 'carte'", async () => {
            await exportImage({ title: "  " } as never);
            expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "carte.jpg");
        });

        it("exportPDF downloads as <title>.pdf when a title is given", async () => {
            await exportPDF({ title: "Mon plan" } as never);
            expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "Mon plan.pdf");
        });

        it("an explicit filename wins over the title", async () => {
            await exportImage({ title: "Ignoré", filename: "export-01" } as never);
            expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "export-01.jpg");
        });

        it("passes the requested quality, falling back to the configured one", async () => {
            const exporter = vi.fn<
                (canvas: unknown, opts: Record<string, unknown>) => Promise<Blob>
            >(async () => new Blob(["x"]));
            mocks.getExporter.mockReturnValue(exporter);
            await exportImage({ quality: 0.5 } as never);
            expect(exporter.mock.calls[0][1]).toMatchObject({ quality: 0.5 });
            await exportImage({} as never);
            expect(exporter.mock.calls[1][1]).toMatchObject({ quality: 0.9 });
        });

        it("hands the exporter the composed canvas and the page geometry", async () => {
            const exporter = vi.fn<
                (canvas: unknown, opts: Record<string, unknown>) => Promise<Blob>
            >(async () => new Blob(["x"]));
            mocks.getExporter.mockReturnValue(exporter);
            await exportPDF({} as never);
            expect(exporter.mock.calls[0][0]).toEqual({ tag: "composed-canvas" });
            expect(exporter.mock.calls[0][1]).toMatchObject({
                format: "pdf",
                widthMm: 297,
                heightMm: 210,
            });
        });

        it("returns the exported blob on success", async () => {
            const blob = await exportImage({} as never);
            expect(blob).toBeInstanceOf(Blob);
        });
    });
});
