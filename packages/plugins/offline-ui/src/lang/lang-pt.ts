/*!
 * @geoleaf-plugins/offline-ui — Portuguese i18n dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { StorageLangDict } from "./lang-fr.js";

/** Storage plugin labels (PT). */
const langStoragePt: StorageLangDict = {
    // Toolbar + modal shell
    "storage.toolbar.button": "Cache offline",
    "storage.modal.title": "Gestão do cache offline",
    "storage.modal.tab.import": "Importar",
    "storage.modal.tab.export": "Exportar",
    "storage.modal.close": "Fechar",
    // Generic dialog buttons
    "storage.btn.cancel": "Cancelar",
    "storage.btn.confirm": "Confirmar",
    "storage.btn.delete": "Eliminar",
    // Confirmation dialogs
    "storage.confirm.sync.message": "Sincronizar os POI pendentes com o servidor?",
    "storage.confirm.clearPois.message": "Limpar a cache local das entidades já sincronizadas?",
    "storage.confirm.clearPois.detail":
        "{cached} entidade(s) em cache serão eliminadas; {pending} captura(s) pendente(s) serão MANTIDAS. As entidades eliminadas podem ser transferidas novamente.",
    "storage.confirm.deleteCache.message": "Eliminar o cache offline deste perfil?",
    "storage.confirm.stopDownload.message": "Parar o download em curso?",
    // Notifications
    "storage.notif.export.success": "Exportação JSON concluída",
    "storage.notif.export.error": "Falha na exportação JSON",
    "storage.notif.clipboard.success": "Copiado para a área de transferência",
    "storage.notif.clipboard.error": "Falha ao copiar",
    "storage.notif.sync.unavailable": "Módulo de sincronização indisponível",
    "storage.notif.sync.offline": "Sem ligação à Internet",
    "storage.notif.sync.empty": "Nenhum POI para sincronizar",
    "storage.notif.sync.done": "Sincronização concluída",
    "storage.notif.sync.error": "Erro durante a sincronização",
    "storage.notif.clearPois.success": "POI locais eliminados",
    "storage.notif.clearPois.error": "Falha na eliminação",
    "storage.notif.disk.insufficient": "Espaço de armazenamento insuficiente",
    // Download zone (vector offline — S3)
    "storage.zone.title": "Área offline",
    "storage.zone.useCurrentView": "Usar a vista atual",
    "storage.zone.useProfileArea": "Área do perfil",
    "storage.zone.useRouteCorridor": "Corredor do trajeto",
    "storage.zone.corridorSummary": "Corredor",
    "storage.zone.corridor.no-engine": "O motor offline não está disponível.",
    "storage.zone.corridor.no-route": "Nenhum trajeto preparado.",
    "storage.zone.corridor.degenerate-line":
        "O trajeto guardado é demasiado curto para um corredor.",
    "storage.zone.corridor.over-quota":
        "Demasiado grande para o espaço restante. Reduza um dos dois:",
    "storage.zone.lever.zoom": "zoom",
    "storage.zone.lever.buffer": "margem (m)",
    "storage.zone.zoomCeiling": "Zoom máximo",
    "storage.zone.note": "Mais alto = mais nítido mas mais pesado.",
    "storage.zone.noZone": "Nenhuma área selecionada.",
    "storage.zone.summary": "Área",
    "storage.zone.estimate": "Estimativa",
    "storage.zone.tiles": "telas",
    // Layer selection table (S7)
    "storage.layers.selectAll": "Selecionar tudo / desmarcar",
    "storage.layers.col.name": "Nome",
    "storage.layers.col.geometry": "Geometria",
    "storage.layers.col.style": "Estilo",
    "storage.layers.col.size": "Tamanho",
    "storage.layers.col.cache": "Cache",
    "storage.layers.loadError": "Erro ao carregar as camadas",
    "storage.layers.profileCacheOff": "Cache de perfil desativada (enableProfileCache: false)",
    "storage.layers.tileCacheOff": "Cache de blocos desativada (enableTileCache: false)",
    "storage.layers.cached": "Em cache",
    "storage.layers.notCached": "Não baixado",
    "storage.layers.tilesCached": "Blocos em cache",
    "storage.layers.tilesNotCached": "Blocos não baixados",
    "storage.layers.tileCacheDisabled": "Cache de blocos desativada",
    "storage.layers.noCacheConfig": "Sem configuração de cache",
    "storage.layers.raster": "Raster",
    "storage.geometry.point": "Ponto",
    "storage.geometry.line": "Linha",
    "storage.geometry.polygon": "Polígono",
    "storage.geometry.collection": "Coleção",
    // Download-size warning banner (S7)
    "storage.warn.insufficient": "ERRO: espaço insuficiente",
    "storage.warn.required": "Necessário",
    "storage.warn.missing": "Faltam",
    "storage.warn.critical": "AVISO:",
    "storage.warn.attention": "ATENÇÃO:",
    "storage.warn.largeDownload": "download volumoso",
    "storage.warn.significantDownload": "download considerável",
    "storage.warn.wifiStrong":
        "WiFi FORTEMENTE recomendado. Uma ligação 4G/5G pode ser interrompida.",
    "storage.warn.wifiAdvised": "WiFi recomendado para evitar interrupções.",
    "storage.warn.btn.blocked": "Espaço de armazenamento insuficiente",
    "storage.warn.btn.ready": "Baixar o perfil para uso offline",
    // Download / clear (S7)
    "storage.download.inProgress": "A baixar...",
    "storage.download.btn": "Baixar perfil",
    "storage.download.resources": "recursos",
    "storage.download.done": "recursos baixados",
    "storage.download.error": "Erro",
    "storage.download.clearing": "A apagar...",
    "storage.download.deleting": "A eliminar...",
    "storage.download.clearBtn": "Limpar cache",
    "storage.download.err.tooLarge":
        "Configuração demasiado grande (erro de memória). Reduza cacheMaxZoom ou offlineBounds em profile.json",
    "storage.download.err.outOfMemory":
        "Memória insuficiente. Reduza o tamanho do download ou feche outros separadores.",
    "storage.notif.offline.unavailable": "Armazenamento offline indisponível",
    "storage.notif.noProfile": "Nenhum perfil ativo",
    "storage.notif.download.success": "Perfil baixado",
    "storage.notif.download.error": "Erro de download",
    "storage.notif.clear.success": "Cache limpa",
    "storage.notif.clear.error": "Erro ao limpar",
    "storage.notif.resourcesDeleted": "recursos eliminados",
    // ENGINE signals made visible — the quota is an ERROR (a write was REFUSED),
    // eviction a WARNING (requested data is no longer there).
    "storage.notif.quotaExceeded": "Armazenamento cheio: o último item não pôde ser guardado",
    "storage.notif.cacheEvicted": "{count} item(ns) offline removidos para libertar espaço",
    // POI sync section (S7)
    "storage.sync.title": "DADOS INTRODUZIDOS",
    "storage.sync.toggle": "Alternar sincronização",
    "storage.sync.loading": "A carregar...",
    "storage.sync.btn": "Sincronizar com o servidor",
    "storage.sync.btn.running": "A sincronizar...",
    "storage.sync.unavailable": "Módulo de sincronização indisponível",
    "storage.sync.upToDate": "Nenhuma alteração pendente",
    "storage.sync.pending.title": "Operações pendentes:",
    "storage.sync.pending.add": "POI a adicionar",
    "storage.sync.pending.update": "POI a modificar",
    "storage.sync.pending.delete": "POI a eliminar",
    "storage.sync.warn.intro": "Está prestes a",
    "storage.sync.warn.outro":
        "no servidor. Os dados locais têm prioridade e substituirão os do servidor.",
    "storage.sync.loadError": "Erro ao carregar",
};

export default langStoragePt;
