/*!
 * @geoleaf-plugins/offline-ui — Spanish i18n dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { StorageLangDict } from "./lang-fr.js";

/** Storage plugin labels (ES). */
const langStorageEs: StorageLangDict = {
    // Toolbar + modal shell
    "storage.toolbar.button": "Caché sin conexión",
    "storage.modal.title": "Gestión del caché sin conexión",
    "storage.modal.tab.import": "Importar",
    "storage.modal.tab.export": "Exportar",
    "storage.modal.close": "Cerrar",
    // Generic dialog buttons
    "storage.btn.cancel": "Cancelar",
    "storage.btn.confirm": "Confirmar",
    "storage.btn.delete": "Eliminar",
    // Confirmation dialogs
    "storage.confirm.sync.message": "¿Sincronizar los POI pendientes con el servidor?",
    "storage.confirm.clearPois.message":
        "¿Vaciar la caché local de las entidades ya sincronizadas?",
    "storage.confirm.clearPois.detail":
        "Se eliminarán {cached} entidad(es) en caché; se CONSERVARÁN {pending} captura(s) pendiente(s). Las entidades eliminadas se pueden volver a descargar.",
    "storage.confirm.deleteCache.message": "¿Eliminar el caché sin conexión de este perfil?",
    "storage.confirm.stopDownload.message": "¿Detener la descarga en curso?",
    // Notifications
    "storage.notif.export.success": "Exportación JSON correcta",
    "storage.notif.export.error": "Error en la exportación JSON",
    "storage.notif.clipboard.success": "Copiado al portapapeles",
    "storage.notif.clipboard.error": "Error al copiar",
    "storage.notif.sync.unavailable": "Módulo de sincronización no disponible",
    "storage.notif.sync.offline": "Sin conexión a Internet",
    "storage.notif.sync.empty": "No hay POI para sincronizar",
    "storage.notif.sync.done": "Sincronización completada",
    "storage.notif.sync.error": "Error durante la sincronización",
    "storage.notif.clearPois.success": "POI locales eliminados",
    "storage.notif.clearPois.error": "Error al eliminar",
    "storage.notif.disk.insufficient": "Espacio de almacenamiento insuficiente",
    // Download zone (vector offline — S3)
    "storage.zone.title": "Área sin conexión",
    "storage.zone.useCurrentView": "Usar la vista actual",
    "storage.zone.useProfileArea": "Área del perfil",
    "storage.zone.useRouteCorridor": "Corredor de la ruta",
    "storage.zone.corridorSummary": "Corredor",
    "storage.zone.corridor.no-engine": "El motor sin conexión no está disponible.",
    "storage.zone.corridor.no-route": "No se ha preparado ninguna ruta.",
    "storage.zone.corridor.degenerate-line":
        "La ruta guardada es demasiado corta para un corredor.",
    "storage.zone.corridor.over-quota":
        "Demasiado grande para el espacio restante. Reduzca uno de los dos:",
    "storage.zone.lever.zoom": "zoom",
    "storage.zone.lever.buffer": "margen (m)",
    "storage.zone.zoomCeiling": "Zoom máximo",
    "storage.zone.note": "Más alto = más nítido pero más pesado.",
    "storage.zone.noZone": "Ninguna área seleccionada.",
    "storage.zone.summary": "Área",
    "storage.zone.estimate": "Estimación",
    "storage.zone.tiles": "teselas",
    // Layer selection table (S7)
    "storage.layers.selectAll": "Seleccionar todo / deseleccionar",
    "storage.layers.col.name": "Nombre",
    "storage.layers.col.geometry": "Geometría",
    "storage.layers.col.style": "Estilo",
    "storage.layers.col.size": "Tamaño",
    "storage.layers.col.cache": "Caché",
    "storage.layers.loadError": "Error al cargar las capas",
    "storage.layers.profileCacheOff": "Caché de perfil desactivada (enableProfileCache: false)",
    "storage.layers.tileCacheOff": "Caché de teselas desactivada (enableTileCache: false)",
    "storage.layers.cached": "En caché",
    "storage.layers.notCached": "No descargado",
    "storage.layers.tilesCached": "Teselas en caché",
    "storage.layers.tilesNotCached": "Teselas no descargadas",
    "storage.layers.tileCacheDisabled": "Caché de teselas desactivada",
    "storage.layers.noCacheConfig": "Sin configuración de caché",
    "storage.layers.raster": "Ráster",
    "storage.geometry.point": "Punto",
    "storage.geometry.line": "Línea",
    "storage.geometry.polygon": "Polígono",
    "storage.geometry.collection": "Colección",
    // Download-size warning banner (S7)
    "storage.warn.insufficient": "ERROR: espacio insuficiente",
    "storage.warn.required": "Necesario",
    "storage.warn.missing": "Falta",
    "storage.warn.critical": "ADVERTENCIA:",
    "storage.warn.attention": "ATENCIÓN:",
    "storage.warn.largeDownload": "descarga voluminosa",
    "storage.warn.significantDownload": "descarga considerable",
    "storage.warn.wifiStrong": "WiFi MUY recomendado. Una conexión 4G/5G puede interrumpirse.",
    "storage.warn.wifiAdvised": "WiFi recomendado para evitar interrupciones.",
    "storage.warn.btn.blocked": "Espacio de almacenamiento insuficiente",
    "storage.warn.btn.ready": "Descargar el perfil para uso sin conexión",
    // Download / clear (S7)
    "storage.download.inProgress": "Descargando...",
    "storage.download.btn": "Descargar perfil",
    "storage.download.resources": "recursos",
    "storage.download.done": "recursos descargados",
    "storage.download.error": "Error",
    "storage.download.clearing": "Borrando...",
    "storage.download.deleting": "Eliminando...",
    "storage.download.clearBtn": "Vaciar caché",
    "storage.download.err.tooLarge":
        "Configuración demasiado grande (error de memoria). Reduzca cacheMaxZoom u offlineBounds en profile.json",
    "storage.download.err.outOfMemory":
        "Memoria insuficiente. Reduzca el tamaño de la descarga o cierre otras pestañas.",
    "storage.notif.offline.unavailable": "Almacenamiento sin conexión no disponible",
    "storage.notif.noProfile": "Ningún perfil activo",
    "storage.notif.download.success": "Perfil descargado",
    "storage.notif.download.error": "Error de descarga",
    "storage.notif.clear.success": "Caché vaciada",
    "storage.notif.clear.error": "Error al vaciar",
    "storage.notif.resourcesDeleted": "recursos eliminados",
    // ENGINE signals made visible — the quota is an ERROR (a write was REFUSED),
    // eviction a WARNING (requested data is no longer there).
    "storage.notif.quotaExceeded": "Almacenamiento lleno: no se pudo guardar el último elemento",
    "storage.notif.cacheEvicted":
        "{count} elemento(s) sin conexión eliminados para liberar espacio",
    // POI sync section (S7)
    "storage.sync.title": "DATOS INTRODUCIDOS",
    "storage.sync.toggle": "Alternar sincronización",
    "storage.sync.loading": "Cargando...",
    "storage.sync.btn": "Sincronizar con el servidor",
    "storage.sync.btn.running": "Sincronizando...",
    "storage.sync.unavailable": "Módulo de sincronización no disponible",
    "storage.sync.upToDate": "Ningún cambio pendiente",
    "storage.sync.pending.title": "Operaciones pendientes:",
    "storage.sync.pending.add": "POI para añadir",
    "storage.sync.pending.update": "POI para modificar",
    "storage.sync.pending.delete": "POI para eliminar",
    "storage.sync.warn.intro": "Está a punto de",
    "storage.sync.warn.outro":
        "en el servidor. Los datos locales tienen prioridad y sobrescribirán el servidor.",
    "storage.sync.loadError": "Error al cargar",
};

export default langStorageEs;
