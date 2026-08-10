/*!
 * @geoleaf-plugins/offline-ui — Italian i18n dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { StorageLangDict } from "./lang-fr.js";

/** Storage plugin labels (IT). */
const langStorageIt: StorageLangDict = {
    // Toolbar + modal shell
    "storage.toolbar.button": "Cache offline",
    "storage.modal.title": "Gestione della cache offline",
    "storage.modal.tab.import": "Importa",
    "storage.modal.tab.export": "Esporta",
    "storage.modal.close": "Chiudi",
    // Generic dialog buttons
    "storage.btn.cancel": "Annulla",
    "storage.btn.confirm": "Conferma",
    "storage.btn.delete": "Elimina",
    // Confirmation dialogs
    "storage.confirm.sync.message": "Sincronizzare i POI in sospeso con il server?",
    "storage.confirm.clearPois.message": "Svuotare la cache locale delle entità già sincronizzate?",
    "storage.confirm.clearPois.detail":
        "{cached} entità in cache saranno eliminate; {pending} acquisizione/i in attesa saranno CONSERVATE. Le entità eliminate si riscaricano.",
    "storage.confirm.deleteCache.message": "Eliminare la cache offline di questo profilo?",
    "storage.confirm.stopDownload.message": "Interrompere il download in corso?",
    // Notifications
    "storage.notif.export.success": "Esportazione JSON riuscita",
    "storage.notif.export.error": "Esportazione JSON non riuscita",
    "storage.notif.clipboard.success": "Copiato negli appunti",
    "storage.notif.clipboard.error": "Copia non riuscita",
    "storage.notif.sync.unavailable": "Modulo di sincronizzazione non disponibile",
    "storage.notif.sync.offline": "Nessuna connessione a Internet",
    "storage.notif.sync.empty": "Nessun POI da sincronizzare",
    "storage.notif.sync.done": "Sincronizzazione completata",
    "storage.notif.sync.error": "Errore durante la sincronizzazione",
    "storage.notif.clearPois.success": "POI locali eliminati",
    "storage.notif.clearPois.error": "Eliminazione non riuscita",
    "storage.notif.disk.insufficient": "Spazio di archiviazione insufficiente",
    // Download zone (vector offline — S3)
    "storage.zone.title": "Area offline",
    "storage.zone.useCurrentView": "Usa la vista attuale",
    "storage.zone.useProfileArea": "Area del profilo",
    "storage.zone.zoomCeiling": "Zoom massimo",
    "storage.zone.note": "Più alto = più nitido ma più pesante.",
    "storage.zone.noZone": "Nessuna area selezionata.",
    "storage.zone.summary": "Area",
    "storage.zone.estimate": "Stima",
    "storage.zone.tiles": "tessere",
    // Layer selection table (S7)
    "storage.layers.selectAll": "Seleziona tutto / deseleziona",
    "storage.layers.col.name": "Nome",
    "storage.layers.col.geometry": "Geometria",
    "storage.layers.col.style": "Stile",
    "storage.layers.col.size": "Dimensione",
    "storage.layers.col.cache": "Cache",
    "storage.layers.loadError": "Errore durante il caricamento dei livelli",
    "storage.layers.profileCacheOff": "Cache del profilo disattivata (enableProfileCache: false)",
    "storage.layers.tileCacheOff": "Cache dei tasselli disattivata (enableTileCache: false)",
    "storage.layers.cached": "In cache",
    "storage.layers.notCached": "Non scaricato",
    "storage.layers.tilesCached": "Tasselli in cache",
    "storage.layers.tilesNotCached": "Tasselli non scaricati",
    "storage.layers.tileCacheDisabled": "Cache dei tasselli disattivata",
    "storage.layers.noCacheConfig": "Nessuna configurazione di cache",
    "storage.layers.raster": "Raster",
    "storage.geometry.point": "Punto",
    "storage.geometry.line": "Linea",
    "storage.geometry.polygon": "Poligono",
    "storage.geometry.collection": "Collezione",
    // Download-size warning banner (S7)
    "storage.warn.insufficient": "ERRORE: spazio insufficiente",
    "storage.warn.required": "Richiesto",
    "storage.warn.missing": "Mancante",
    "storage.warn.critical": "AVVERTENZA:",
    "storage.warn.attention": "ATTENZIONE:",
    "storage.warn.largeDownload": "download voluminoso",
    "storage.warn.significantDownload": "download importante",
    "storage.warn.wifiStrong":
        "WiFi FORTEMENTE consigliato. Una connessione 4G/5G può interrompersi.",
    "storage.warn.wifiAdvised": "WiFi consigliato per evitare interruzioni.",
    "storage.warn.btn.blocked": "Spazio di archiviazione insufficiente",
    "storage.warn.btn.ready": "Scarica il profilo per l'uso offline",
    // Download / clear (S7)
    "storage.download.inProgress": "Download in corso...",
    "storage.download.btn": "Scarica profilo",
    "storage.download.resources": "risorse",
    "storage.download.done": "risorse scaricate",
    "storage.download.error": "Errore",
    "storage.download.clearing": "Cancellazione...",
    "storage.download.deleting": "Eliminazione in corso...",
    "storage.download.clearBtn": "Svuota cache",
    "storage.download.err.tooLarge":
        "Configurazione troppo grande (errore di memoria). Riduci cacheMaxZoom o offlineBounds in profile.json",
    "storage.download.err.outOfMemory":
        "Memoria insufficiente. Riduci la dimensione del download o chiudi altre schede.",
    "storage.notif.offline.unavailable": "Archiviazione offline non disponibile",
    "storage.notif.noProfile": "Nessun profilo attivo",
    "storage.notif.download.success": "Profilo scaricato",
    "storage.notif.download.error": "Errore di download",
    "storage.notif.clear.success": "Cache svuotata",
    "storage.notif.clear.error": "Errore di cancellazione",
    "storage.notif.resourcesDeleted": "risorse eliminate",
    // Signaux du MOTEUR rendus visibles (B-72) — le quota est une ERREUR (une écriture
    // a été REFUSÉE), l'éviction un AVERTISSEMENT (des données demandées ne sont plus là).
    "storage.notif.quotaExceeded": "Spazio esaurito: l'ultimo elemento non è stato salvato",
    "storage.notif.cacheEvicted": "{count} elemento/i offline rimossi per liberare spazio",
    // POI sync section (S7)
    "storage.sync.title": "DATI INSERITI",
    "storage.sync.toggle": "Attiva/disattiva sincronizzazione",
    "storage.sync.loading": "Caricamento...",
    "storage.sync.btn": "Sincronizza con il server",
    "storage.sync.btn.running": "Sincronizzazione in corso...",
    "storage.sync.unavailable": "Modulo di sincronizzazione non disponibile",
    "storage.sync.upToDate": "Nessuna modifica in sospeso",
    "storage.sync.pending.title": "Operazioni in sospeso:",
    "storage.sync.pending.add": "POI da aggiungere",
    "storage.sync.pending.update": "POI da modificare",
    "storage.sync.pending.delete": "POI da eliminare",
    "storage.sync.warn.intro": "Stai per",
    "storage.sync.warn.outro":
        "sul server. I dati locali hanno priorità e sovrascriveranno il server.",
    "storage.sync.loadError": "Errore di caricamento",
};

export default langStorageIt;
