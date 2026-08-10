/*!
 * @geoleaf-plugins/print — API implementation
 * © 2026 Mattieu Pottier — MIT License
 *
 * The print pipeline behind `GeoLeaf.Print.*`: the shared capture→compose stage
 * (`_capture`), the zone/include resolution, and the exported operations.
 *
 * Split out of `public-api.ts` (backlog B.12), which held 13 functions and 19 branches —
 * the entire pipeline, not a facade. `public-api.ts` now only shapes the API object
 * (INV-FACADE). The S6 invariant still holds here: the zones `_capture` renders must
 * match the zones `buildComposeArgs` composes, or the printed scale drifts from the
 * locked one.
 * https://geoleaf.dev
 */
import type {
    PrintFlowOptions,
    CaptureOptions,
    CaptureResult,
    ComposeSlot,
    ExportOptions,
    ExporterFn,
    PageFormatDef,
    PageOrientation,
} from "./types.js";
import type { EmpriseBbox } from "./types.js";
import { _warnNoCore } from "./internal.js";
import { openPrintFlow as _openPrintFlow } from "./flow.js";
import {
    captureExtent as _captureExtent,
    captureViewport as _captureViewport,
} from "./offscreen-render.js";
import {
    registerPageFormat as _registerPageFormat,
    computeZones,
    computeTargetPixels,
    resolvePageDimensions,
} from "./page-format.js";
import { createComposedCanvas, registerSlot as _registerSlot } from "./layout-composer.js";
import { registerExporter as _registerExporter, getExporter } from "./format-registry.js";
import { downloadBlob } from "@geoleaf/host-runtime";
import { getPrintConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derives page orientation from bbox aspect ratio when not explicitly provided. */
function _orientationFromBbox(bbox: EmpriseBbox): PageOrientation {
    return bbox.maxLng - bbox.minLng >= bbox.maxLat - bbox.minLat ? "landscape" : "portrait";
}

/**
 * Shared pipeline for exportImage() and exportPDF():
 * capture → compose → return canvas + metadata.
 */
async function _capture(opts: ExportOptions): Promise<{
    composed: HTMLCanvasElement;
    widthMm: number;
    heightMm: number;
    orientation: PageOrientation;
} | null> {
    const config = getPrintConfig();
    const dpi = opts.dpi ?? config.dpi ?? 300;
    const format = opts.format ?? config.defaultFormat ?? "A4";

    // 1 — Off-screen render
    const capture = await _runCapture(opts, format, dpi);
    if (!capture) return null;

    // 2 — Orientation (from opts, or re-derived from captured bbox)
    const orientation: PageOrientation = opts.orientation ?? _orientationFromBbox(capture.bbox);

    // 3 — Page dimensions (after orientation swap)
    const dims = resolvePageDimensions(format, orientation);
    if (!dims) {
        console.warn("[GeoLeaf.Print] Unknown paper format:", format);
        return null;
    }
    const { widthMm, heightMm } = dims;

    // 4 — Zones + composition
    const flags = _resolveIncludeFlags(opts, config);
    const zones = computeZones(format, orientation, {
        includeTitle: !!(opts.title ?? "").trim(),
        includeLegend: flags.includeLegend,
        includeScale: flags.includeScale,
        includeNorthArrow: flags.includeNorthArrow,
        includeFooter: !!(opts.description ?? "").trim(),
    });
    const targetPx = computeTargetPixels(zones, dpi);

    const composed = await createComposedCanvas(capture.canvas, zones, targetPx, {
        title: opts.title ?? "",
        description: opts.description ?? "",
        scaleDenominator: capture.scaleDenominator,
        dpi,
        includeScale: flags.includeScale,
        includeNorthArrow: flags.includeNorthArrow,
        includeLegend: flags.includeLegend,
        pageSizeMm: { widthMm, heightMm },
    });

    return { composed, widthMm, heightMm, orientation };
}

/** Runs the off-screen capture (by bbox or current viewport), returning null on failure. */
async function _runCapture(
    opts: ExportOptions,
    format: string,
    dpi: number
): Promise<CaptureResult | null> {
    try {
        if (opts.bbox) {
            const orientation: PageOrientation =
                opts.orientation ?? _orientationFromBbox(opts.bbox);
            return await _captureExtent(opts.bbox, { format, orientation, dpi });
        }
        return await _captureViewport({
            format,
            ...(opts.orientation !== undefined && { orientation: opts.orientation }),
            dpi,
        });
    } catch (err) {
        console.warn("[GeoLeaf.Print] capture failed:", err);
        return null;
    }
}

/** Resolves the include flags (legend / scale / north arrow) from opts then config defaults. */
function _resolveIncludeFlags(
    opts: ExportOptions,
    config: ReturnType<typeof getPrintConfig>
): { includeLegend: boolean; includeScale: boolean; includeNorthArrow: boolean } {
    return {
        includeLegend: opts.includeLegend ?? config.includeLegend ?? false,
        includeScale: opts.includeScale ?? config.includeScale ?? true,
        includeNorthArrow: opts.includeNorthArrow ?? config.includeNorthArrow ?? true,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Opens the interactive print flow: emprise selector → preview modal → export.
 * Resolves with the exported Blob, or null if the user cancels.
 */
export function openPrintFlow(opts?: PrintFlowOptions): Promise<Blob | null> {
    return _openPrintFlow(opts ?? {});
}

/**
 * Re-renders the map off-screen over the given geographic extent at the
 * requested format and DPI. Returns the map zone canvas (before composition).
 */
export async function captureExtent(
    bbox: EmpriseBbox,
    opts: CaptureOptions = {}
): Promise<CaptureResult | null> {
    if (_warnNoCore("captureExtent")) return null;
    try {
        return await _captureExtent(bbox, opts);
    } catch (err) {
        console.warn("[GeoLeaf.Print] captureExtent failed:", err);
        return null;
    }
}

/**
 * Captures the extent matching the current viewport (format from config, A4 by default).
 */
export async function captureViewport(opts?: CaptureOptions): Promise<CaptureResult | null> {
    if (_warnNoCore("captureViewport")) return null;
    try {
        return await _captureViewport(opts ?? {});
    } catch (err) {
        console.warn("[GeoLeaf.Print] captureViewport failed:", err);
        return null;
    }
}

/**
 * Composes and exports the map as a JPEG image, then downloads it.
 * Returns the Blob, or null on failure.
 */
export async function exportImage(opts: ExportOptions): Promise<Blob | null> {
    if (_warnNoCore("exportImage")) return null;
    const config = getPrintConfig();
    const result = await _capture(opts);
    if (!result) return null;

    const exporter = getExporter("jpg");
    if (!exporter) {
        console.warn("[GeoLeaf.Print] exportImage: JPG exporter not registered.");
        return null;
    }

    try {
        const blob = await exporter(result.composed, {
            format: "jpg",
            orientation: result.orientation,
            widthMm: result.widthMm,
            heightMm: result.heightMm,
            quality: opts.quality ?? config.jpgQuality,
        });
        const slug = (opts.title ?? "").trim() || "carte";
        const filename = opts.filename ? `${opts.filename}.jpg` : `${slug}.jpg`;
        await downloadBlob(blob, filename);
        return blob;
    } catch (err) {
        console.warn("[GeoLeaf.Print] exportImage failed:", err);
        return null;
    }
}

/**
 * Composes and exports the map as a PDF (loads jsPDF dynamically), then downloads it.
 * Returns the Blob, or null on failure.
 */
export async function exportPDF(opts: ExportOptions): Promise<Blob | null> {
    if (_warnNoCore("exportPDF")) return null;
    const config = getPrintConfig();
    const result = await _capture(opts);
    if (!result) return null;

    const exporter = getExporter("pdf");
    if (!exporter) {
        console.warn("[GeoLeaf.Print] exportPDF: PDF exporter not registered.");
        return null;
    }

    try {
        const blob = await exporter(result.composed, {
            format: "pdf",
            orientation: result.orientation,
            widthMm: result.widthMm,
            heightMm: result.heightMm,
            quality: opts.quality ?? config.jpgQuality,
        });
        const slug = (opts.title ?? "").trim() || "carte";
        const filename = opts.filename ? `${opts.filename}.pdf` : `${slug}.pdf`;
        await downloadBlob(blob, filename);
        return blob;
    } catch (err) {
        console.warn("[GeoLeaf.Print] exportPDF failed:", err);
        return null;
    }
}

/**
 * Registers a custom export format.
 * @param format - Case-insensitive format identifier (e.g. `"png"`).
 * @param fn - Exporter function that receives the composed canvas and returns a Blob.
 */
export function registerExporter(format: string, fn: ExporterFn): void {
    _registerExporter(format, fn);
}

/**
 * Registers a custom paper format (A2, A1, A0, …).
 * @param name - Format identifier (e.g. `"A2"`).
 * @param def - Format definition with dimensions and zone computation.
 */
export function registerPageFormat(name: string, def: PageFormatDef): void {
    _registerPageFormat(name, def);
}

/**
 * Registers a custom composition slot (cartouche, extra fields, …).
 * Slots are drawn after all built-in zones, at the requested `placement`.
 * Registering twice with the same `id` replaces the previous slot.
 * @param slot - Slot definition: id, placement, and a canvas render callback.
 */
export function registerSlot(slot: ComposeSlot): void {
    _registerSlot(slot);
}

/**
 * Returns the registered ExporterFn for the given format.
 * @internal Used by modal-open._tryExport.
 */
export function _getExporter(format: string): ExporterFn | undefined {
    return getExporter(format);
}
