/*!
 * @geoleaf-plugins/measure — Spanish dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_es: Record<string, string> = {
    "measure.toolbar.button": "Medir y anotar",
    "measure.menu.title": "Herramientas de medición",
    "measure.menu.handle": "Mover menú",
    "measure.menu.close": "Cerrar",
    "measure.tool.distance": "Medir distancia",
    "measure.tool.distance.hint":
        "Haga clic para añadir vértices. Doble clic o Espacio para terminar.",
    "measure.tool.rect": "Superficie — rectángulo",
    "measure.tool.rect.hint": "Arrastre desde la esquina superior izquierda a la inferior derecha.",
    "measure.tool.circle": "Superficie — círculo",
    "measure.tool.circle.hint": "Arrastre desde el centro para definir el radio.",
    "measure.tool.polygon": "Superficie — polígono",
    "measure.tool.polygon.hint":
        "Haga clic para añadir vértices. Enganche al 1er vértice, doble clic o C para cerrar.",
    "measure.tool.gps": "Medición GPS",
    "measure.tool.gps.hint":
        "Active la geolocalización y muévase. Pulse Espacio o haga clic en GPS para detener.",
    "measure.tool.annotationTooltip": "Tooltip",
    "measure.tool.annotationTooltip.hint":
        "Haga clic en el mapa para colocar un tooltip redimensionable.",
    "measure.unit.m": "m",
    "measure.unit.km": "km",
    "measure.unit.m2": "m²",
    "measure.unit.ha": "ha",
    "measure.unit.km2": "km²",
    "measure.unit.distance.label": "Distancias",
    "measure.unit.area.label": "Superficies",
    "measure.recap.header.index": "N°",
    "measure.recap.header.coord": "Coord X;Y",
    "measure.recap.header.length": "Longitud",
    "measure.recap.total": "Total",
    "measure.recap.area": "Superficie",
    "measure.recap.perimeter": "Perímetro",
    "measure.recap.radius": "Radio",
    "measure.recap.circumference": "Circunferencia",
    "measure.gps.permissionDenied": "Acceso a la geolocalización denegado.",
    "measure.gps.unavailable": "Posición GPS no disponible.",
    "measure.gps.closePrompt":
        "Está cerca del punto de partida. ¿Cerrar como polígono para obtener el área?",
    "measure.gps.closeYes": "Cerrar",
    "measure.gps.closeNo": "Continuar",
    "measure.gps.tracking": "Seguimiento GPS activo…",
    "measure.gps.stop": "Detener seguimiento",
    "measure.btn.clear": "Borrar",
    "measure.btn.export": "Exportar GeoJSON",
    "measure.btn.linear": "Lineal",
    "measure.btn.surface": "Superficie",
    "measure.btn.annotation": "Anotación",
    "measure.annotation.labelPlaceholder": "Escriba una etiqueta…",
    "measure.annotation.tooltipPlaceholder": "Escriba una nota…",
    "measure.error.maxFeatures":
        "Número máximo de mediciones alcanzado ({max}). Borre algunas para continuar.",
    "measure.error.exportFailed": "Error al exportar GeoJSON.",
    "measure.error.gpsFailed": "Error de geolocalización.",
    "measure.aria.menuDragHandle": "Controlador de arrastre del menú",
    "measure.aria.closeMenu": "Cerrar menú de medición",
    "measure.aria.distanceTool": "Herramienta de medición de distancia",
    "measure.aria.rectTool": "Herramienta de superficie rectangular",
    "measure.aria.circleTool": "Herramienta de superficie circular",
    "measure.aria.polygonTool": "Herramienta de superficie poligonal",
    "measure.aria.gpsTool": "Herramienta de medición GPS",
    "measure.aria.annotationTooltipTool": "Herramienta de tooltip",
    "measure.aria.clearBtn": "Borrar todas las mediciones",
    "measure.aria.exportBtn": "Exportar mediciones como GeoJSON",
    "measure.aria.deleteAnnotation": "Eliminar anotación",
};

export default lang_es;
