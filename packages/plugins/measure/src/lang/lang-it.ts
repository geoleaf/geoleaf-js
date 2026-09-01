/*!
 * @geoleaf-plugins/measure — Italian dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_it: Record<string, string> = {
    "measure.toolbar.button": "Misura e annota",
    "measure.menu.title": "Strumenti di misura",
    "measure.menu.handle": "Sposta menu",
    "measure.menu.close": "Chiudi",
    "measure.tool.distance": "Misura distanza",
    "measure.tool.distance.hint":
        "Clicca per aggiungere vertici. Riclicca l'ultimo, doppio clic o Spazio per terminare.",
    "measure.tool.rect": "Superficie — rettangolo",
    "measure.tool.rect.hint": "Trascina dall'angolo in alto a sinistra a quello in basso a destra.",
    "measure.tool.circle": "Superficie — cerchio",
    "measure.tool.circle.hint": "Trascina dal centro per definire il raggio.",
    "measure.tool.polygon": "Superficie — poligono",
    "measure.tool.polygon.hint":
        "Clicca per aggiungere vertici. Aggancia al 1° vertice, doppio clic o C per chiudere.",
    "measure.tool.gps": "Misura GPS",
    "measure.tool.gps.hint":
        "Attiva la geolocalizzazione e spostati. Premi Spazio o ri-clicca GPS per fermare.",
    "measure.tool.annotationTooltip": "Tooltip",
    "measure.tool.annotationTooltip.hint":
        "Clicca sulla mappa per aggiungere un tooltip ridimensionabile.",
    "measure.unit.m": "m",
    "measure.unit.km": "km",
    "measure.unit.m2": "m²",
    "measure.unit.ha": "ha",
    "measure.unit.km2": "km²",
    "measure.unit.distance.label": "Distanze",
    "measure.unit.area.label": "Superfici",
    "measure.recap.header.index": "N°",
    "measure.recap.header.coord": "Coord X;Y",
    "measure.recap.header.length": "Lunghezza",
    "measure.recap.total": "Totale",
    "measure.recap.area": "Superficie",
    "measure.recap.perimeter": "Perimetro",
    "measure.recap.radius": "Raggio",
    "measure.recap.circumference": "Circonferenza",
    "measure.gps.permissionDenied": "Accesso alla geolocalizzazione negato.",
    "measure.gps.unavailable": "Posizione GPS non disponibile.",
    "measure.gps.closePrompt":
        "Sei vicino al punto di partenza. Chiudere come poligono per ottenere l'area?",
    "measure.gps.closeYes": "Chiudi",
    "measure.gps.closeNo": "Continua",
    "measure.gps.tracking": "Tracciamento GPS attivo…",
    "measure.gps.stop": "Ferma tracciamento",
    "measure.btn.clear": "Cancella",
    "measure.btn.export": "Esporta GeoJSON",
    "measure.btn.linear": "Lineare",
    "measure.btn.surface": "Superficie",
    "measure.btn.annotation": "Annotazione",
    "measure.annotation.labelPlaceholder": "Inserisci un'etichetta…",
    "measure.annotation.tooltipPlaceholder": "Inserisci una nota…",
    "measure.error.maxFeatures":
        "Numero massimo di misure raggiunto ({max}). Cancella alcune per continuare.",
    "measure.error.exportFailed": "Esportazione GeoJSON fallita.",
    "measure.error.gpsFailed": "Errore di geolocalizzazione.",
    "measure.aria.menuDragHandle": "Maniglia di trascinamento del menu",
    "measure.aria.closeMenu": "Chiudi menu di misura",
    "measure.aria.distanceTool": "Strumento misura distanza",
    "measure.aria.rectTool": "Strumento superficie rettangolare",
    "measure.aria.circleTool": "Strumento superficie circolare",
    "measure.aria.polygonTool": "Strumento superficie poligonale",
    "measure.aria.gpsTool": "Strumento misura GPS",
    "measure.aria.annotationTooltipTool": "Strumento tooltip",
    "measure.aria.clearBtn": "Cancella tutte le misure",
    "measure.aria.exportBtn": "Esporta misure come GeoJSON",
    "measure.aria.deleteAnnotation": "Elimina annotazione",
};

export default lang_it;
