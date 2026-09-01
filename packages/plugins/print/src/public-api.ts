/*!
 * @geoleaf-plugins/print — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only (INV-FACADE): shapes the object mounted on `GeoLeaf.Print` by `entry.ts`
 * and forwards every member to `print-api.ts`, where the pipeline lives.
 * https://geoleaf.dev
 */
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
} from "./print-api.js";

/** @internal Returns all public API functions as an object. */
export function buildPublicApi() {
    return {
        openPrintFlow,
        captureExtent,
        captureViewport,
        exportImage,
        exportPDF,
        registerExporter,
        registerPageFormat,
        registerSlot,
        // ⚠️ `_` prefix = "internal" by repo convention, and yet PUBLISHED on
        // `GeoLeaf.Print`. Convention and real surface contradict each other
        // here. It is consumed by the tests: removing it means giving them
        // another way in, which is not a documentation act. Marked rather than
        // quietly moved.
        _getExporter,
    };
}
