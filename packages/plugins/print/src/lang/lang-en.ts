/*!
 * @geoleaf-plugins/print — EN dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const langPrintEn = {
    "print.toolbar.button": "Print / Export",
    "print.emprise.hint": "Click and drag to define the print area",
    "print.emprise.hint.adjust": "Adjust handles then click OK",
    "print.modal.title": "Print / Export",
    "print.modal.field.title": "Title",
    "print.modal.field.description": "Description",
    "print.modal.check.legend": "Legend",
    "print.modal.check.scale": "Scale bar",
    "print.modal.check.northArrow": "North arrow",
    "print.modal.check.annotations": "Annotations",
    "print.modal.format": "Paper format",
    "print.modal.scaleLocked": "Locked scale",
    "print.modal.redefineExtent": "Redefine extent",
    "print.btn.pdf": "PDF",
    "print.btn.jpg": "JPG",
    "print.btn.export": "Export",
    "print.btn.cancel": "Cancel",
    "print.btn.ok": "OK",
    "print.error.tainted":
        "Cannot export: a tile source does not support CORS. Configure a server endpoint or use CORS-compatible sources.",
    "print.error.render": "Error rendering the map.",
    "print.error.noMap": "No map available.",
    "print.error.serverEndpoint": "The render server URL is invalid.",
    "print.error.serverFailed": "The render server returned an error.",
    "print.spinner.rendering": "Rendering…",
    "print.orientation.portrait": "Portrait",
    "print.orientation.landscape": "Landscape",
    "print.aria.scaleLocked": "Scale locked at",
    "print.aria.toolbar.print": "Print / Export the map",
} satisfies Record<string, string>;

export default langPrintEn;
