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
        // ⚠️ Préfixe `_` = « interne » par convention du dépôt, et pourtant PUBLIÉ sur
        // `GeoLeaf.Print` (B-71). La convention et la surface réelle se contredisent ici.
        // Il est consommé par les tests : le retirer demande de leur donner une autre voie,
        // ce qui n'est pas un geste de documentation. Marqué plutôt que déplacé en douce.
        _getExporter,
    };
}
