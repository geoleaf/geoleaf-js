/*!
 * @geoleaf-plugins/measure — Portuguese dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_pt: Record<string, string> = {
    "measure.toolbar.button": "Medir e anotar",
    "measure.menu.title": "Ferramentas de medição",
    "measure.menu.handle": "Mover menu",
    "measure.menu.close": "Fechar",
    "measure.tool.distance": "Medir distância",
    "measure.tool.distance.hint":
        "Clique para adicionar vértices. Toque novamente no último, duplo clique ou Espaço para terminar.",
    "measure.tool.rect": "Superfície — retângulo",
    "measure.tool.rect.hint": "Arraste do canto superior esquerdo para o inferior direito.",
    "measure.tool.circle": "Superfície — círculo",
    "measure.tool.circle.hint": "Arraste a partir do centro para definir o raio.",
    "measure.tool.polygon": "Superfície — polígono",
    "measure.tool.polygon.hint":
        "Clique para adicionar vértices. Encaixe no 1º vértice, duplo clique ou C para fechar.",
    "measure.tool.gps": "Medição GPS",
    "measure.tool.gps.hint":
        "Ative a geolocalização e mova-se. Pressione Espaço ou clique em GPS para parar.",
    "measure.tool.annotationTooltip": "Tooltip",
    "measure.tool.annotationTooltip.hint":
        "Clique no mapa para colocar um tooltip redimensionável.",
    "measure.unit.m": "m",
    "measure.unit.km": "km",
    "measure.unit.m2": "m²",
    "measure.unit.ha": "ha",
    "measure.unit.km2": "km²",
    "measure.unit.distance.label": "Distâncias",
    "measure.unit.area.label": "Superfícies",
    "measure.recap.header.index": "N°",
    "measure.recap.header.coord": "Coord X;Y",
    "measure.recap.header.length": "Comprimento",
    "measure.recap.total": "Total",
    "measure.recap.area": "Superfície",
    "measure.recap.perimeter": "Perímetro",
    "measure.recap.radius": "Raio",
    "measure.recap.circumference": "Circunferência",
    "measure.gps.permissionDenied": "Acesso à geolocalização negado.",
    "measure.gps.unavailable": "Posição GPS indisponível.",
    "measure.gps.closePrompt":
        "Está perto do ponto de partida. Fechar como polígono para obter a área?",
    "measure.gps.closeYes": "Fechar",
    "measure.gps.closeNo": "Continuar",
    "measure.gps.tracking": "Rastreamento GPS ativo…",
    "measure.gps.stop": "Parar rastreamento",
    "measure.btn.clear": "Limpar",
    "measure.btn.export": "Exportar GeoJSON",
    "measure.btn.linear": "Linear",
    "measure.btn.surface": "Superfície",
    "measure.btn.annotation": "Anotação",
    "measure.annotation.labelPlaceholder": "Digite uma etiqueta…",
    "measure.annotation.tooltipPlaceholder": "Digite uma nota…",
    "measure.error.maxFeatures":
        "Número máximo de medições atingido ({max}). Limpe algumas para continuar.",
    "measure.error.exportFailed": "Falha ao exportar GeoJSON.",
    "measure.error.gpsFailed": "Erro de geolocalização.",
    "measure.aria.menuDragHandle": "Alça de arrastar do menu",
    "measure.aria.closeMenu": "Fechar menu de medição",
    "measure.aria.distanceTool": "Ferramenta de medição de distância",
    "measure.aria.rectTool": "Ferramenta de superfície retangular",
    "measure.aria.circleTool": "Ferramenta de superfície circular",
    "measure.aria.polygonTool": "Ferramenta de superfície poligonal",
    "measure.aria.gpsTool": "Ferramenta de medição GPS",
    "measure.aria.annotationTooltipTool": "Ferramenta de tooltip",
    "measure.aria.clearBtn": "Limpar todas as medições",
    "measure.aria.exportBtn": "Exportar medições como GeoJSON",
    "measure.aria.deleteAnnotation": "Eliminar anotação",
};

export default lang_pt;
