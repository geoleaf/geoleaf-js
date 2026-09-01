/*!
 * @geoleaf-plugins/print — PDF exporter (jsPDF lazy chunk)
 *
 * jsPDF is loaded via a dynamic import() so it lands in a separate lazy chunk
 * (geoleaf-print.jspdf-<hash>.js) that the browser only downloads on the first
 * PDF export — it never weighs on the plugin's load-time cost. The chunk ships
 * alongside the plugin entry (see scripts/build-deploy.cjs) so the import resolves.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { ComposedExportOpts, ExporterFn } from "../types.js";

/**
 * Exports the composed canvas as a PDF Blob.
 *
 * jsPDF is dynamically imported here so it is only fetched on the first PDF
 * export. jsPDF orientation shorthand: 'p' = portrait, 'l' = landscape.
 */
export const pdfExporterFn: ExporterFn = async (
    canvas: HTMLCanvasElement,
    opts: ComposedExportOpts
): Promise<Blob> => {
    const { jsPDF } = await import("jspdf");
    const { widthMm, heightMm, orientation } = opts;

    const doc = new jsPDF({
        unit: "mm",
        format: [widthMm, heightMm],
        orientation: orientation === "landscape" ? "l" : "p",
    });

    // Use JPEG for the image data — smaller file size, acceptable quality for maps.
    const dataUrl = canvas.toDataURL("image/jpeg", opts.quality ?? 0.92);
    doc.addImage(dataUrl, "JPEG", 0, 0, widthMm, heightMm);

    return doc.output("blob");
};
