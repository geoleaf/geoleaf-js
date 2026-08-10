/*!
 * @geoleaf-plugins/print — JPEG image exporter
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { ComposedExportOpts, ExporterFn } from "../types.js";

/**
 * Exports the composed canvas as a JPEG Blob.
 * Quality defaults to 0.92 if not specified in opts.
 */
export const imageExporterFn: ExporterFn = (
    canvas: HTMLCanvasElement,
    opts: ComposedExportOpts
): Promise<Blob> =>
    new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(
                        new Error("[GeoLeaf.Print] canvas.toBlob returned null for JPEG export.")
                    );
                }
            },
            "image/jpeg",
            opts.quality ?? 0.92
        );
    });
