/*!
 * @geoleaf-plugins/print — DE dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const langPrintDe = {
    "print.toolbar.button": "Drucken / Exportieren",
    "print.emprise.hint": "Klicken und ziehen, um den Druckbereich festzulegen",
    "print.emprise.hint.adjust": "Ziehpunkte anpassen, dann OK klicken",
    "print.modal.title": "Drucken / Export",
    "print.modal.field.title": "Titel",
    "print.modal.field.description": "Beschreibung",
    "print.modal.check.legend": "Legende",
    "print.modal.check.scale": "Maßstabsleiste",
    "print.modal.check.northArrow": "Nordpfeil",
    "print.modal.check.annotations": "Anmerkungen",
    "print.modal.format": "Papierformat",
    "print.modal.scaleLocked": "Maßstab gesperrt",
    "print.modal.redefineExtent": "Ausdehnung neu definieren",
    "print.btn.pdf": "PDF",
    "print.btn.jpg": "JPG",
    "print.btn.export": "Exportieren",
    "print.btn.cancel": "Abbrechen",
    "print.btn.ok": "OK",
    "print.error.tainted":
        "Export nicht möglich: Eine Kachelquelle unterstützt kein CORS. Konfigurieren Sie einen Server-Endpunkt oder verwenden Sie CORS-kompatible Quellen.",
    "print.error.render": "Fehler beim Rendern der Karte.",
    "print.error.noMap": "Keine Karte verfügbar.",
    "print.error.serverEndpoint": "Die URL des Render-Servers ist ungültig.",
    "print.error.serverFailed": "Der Render-Server hat einen Fehler zurückgegeben.",
    "print.spinner.rendering": "Wird gerendert…",
    "print.orientation.portrait": "Hochformat",
    "print.orientation.landscape": "Querformat",
    "print.aria.scaleLocked": "Maßstab gesperrt bei",
    "print.aria.toolbar.print": "Karte drucken / exportieren",
} satisfies Record<string, string>;

export default langPrintDe;
