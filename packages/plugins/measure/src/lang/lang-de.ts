/*!
 * @geoleaf-plugins/measure — German dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_de: Record<string, string> = {
    "measure.toolbar.button": "Messen & Annotieren",
    "measure.menu.title": "Messwerkzeuge",
    "measure.menu.handle": "Menü verschieben",
    "measure.menu.close": "Schließen",
    "measure.tool.distance": "Distanz messen",
    "measure.tool.distance.hint":
        "Klicken Sie, um Stützpunkte zu setzen. Letzten Punkt erneut antippen, Doppelklick oder Leertaste zum Beenden.",
    "measure.tool.rect": "Fläche — Rechteck",
    "measure.tool.rect.hint": "Von der oberen linken zur unteren rechten Ecke ziehen.",
    "measure.tool.circle": "Fläche — Kreis",
    "measure.tool.circle.hint": "Vom Mittelpunkt ziehen, um den Radius zu definieren.",
    "measure.tool.polygon": "Fläche — Polygon",
    "measure.tool.polygon.hint":
        "Klicken zum Setzen von Stützpunkten. Am 1. Punkt einrasten, Doppelklick oder C zum Schließen.",
    "measure.tool.gps": "GPS-Messung",
    "measure.tool.gps.hint":
        "Geolokalisierung aktivieren und bewegen. Leertaste oder erneut GPS klicken zum Stoppen.",
    "measure.tool.annotationTooltip": "Tooltip",
    "measure.tool.annotationTooltip.hint":
        "Auf die Karte klicken, um einen skalierbaren Tooltip zu platzieren.",
    "measure.unit.m": "m",
    "measure.unit.km": "km",
    "measure.unit.m2": "m²",
    "measure.unit.ha": "ha",
    "measure.unit.km2": "km²",
    "measure.unit.distance.label": "Abstände",
    "measure.unit.area.label": "Flächen",
    "measure.recap.header.index": "Nr.",
    "measure.recap.header.coord": "Koord. X;Y",
    "measure.recap.header.length": "Länge",
    "measure.recap.total": "Gesamt",
    "measure.recap.area": "Fläche",
    "measure.recap.perimeter": "Umfang",
    "measure.recap.radius": "Radius",
    "measure.recap.circumference": "Umfang",
    "measure.gps.permissionDenied": "Zugriff auf Geolokalisierung verweigert.",
    "measure.gps.unavailable": "GPS-Position nicht verfügbar.",
    "measure.gps.closePrompt":
        "Sie sind in der Nähe des Startpunkts. Als Polygon schließen, um die Fläche zu erhalten?",
    "measure.gps.closeYes": "Schließen",
    "measure.gps.closeNo": "Weiter",
    "measure.gps.tracking": "GPS-Verfolgung aktiv…",
    "measure.gps.stop": "Verfolgung stoppen",
    "measure.btn.clear": "Löschen",
    "measure.btn.export": "GeoJSON exportieren",
    "measure.btn.linear": "Linear",
    "measure.btn.surface": "Fläche",
    "measure.btn.annotation": "Annotation",
    "measure.annotation.labelPlaceholder": "Label eingeben…",
    "measure.annotation.tooltipPlaceholder": "Notiz eingeben…",
    "measure.error.maxFeatures":
        "Maximale Anzahl an Messungen erreicht ({max}). Löschen Sie einige, um fortzufahren.",
    "measure.error.exportFailed": "GeoJSON-Export fehlgeschlagen.",
    "measure.error.gpsFailed": "Geolokalisierungsfehler.",
    "measure.aria.menuDragHandle": "Ziehpunkt des Menüs",
    "measure.aria.closeMenu": "Messmenü schließen",
    "measure.aria.distanceTool": "Distanzmesswerkzeug",
    "measure.aria.rectTool": "Rechteck-Flächenwerkzeug",
    "measure.aria.circleTool": "Kreis-Flächenwerkzeug",
    "measure.aria.polygonTool": "Polygon-Flächenwerkzeug",
    "measure.aria.gpsTool": "GPS-Messwerkzeug",
    "measure.aria.annotationTooltipTool": "Tooltip-Werkzeug",
    "measure.aria.clearBtn": "Alle Messungen löschen",
    "measure.aria.exportBtn": "Messungen als GeoJSON exportieren",
    "measure.aria.deleteAnnotation": "Anmerkung löschen",
};

export default lang_de;
