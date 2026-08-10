/*!
 * @geoleaf-plugins/offline-ui — German i18n dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { StorageLangDict } from "./lang-fr.js";

/** Storage plugin labels (DE). */
const langStorageDe: StorageLangDict = {
    // Toolbar + modal shell
    "storage.toolbar.button": "Offline-Cache",
    "storage.modal.title": "Offline-Cache-Verwaltung",
    "storage.modal.tab.import": "Import",
    "storage.modal.tab.export": "Export",
    "storage.modal.close": "Schließen",
    // Generic dialog buttons
    "storage.btn.cancel": "Abbrechen",
    "storage.btn.confirm": "Bestätigen",
    "storage.btn.delete": "Löschen",
    // Confirmation dialogs
    "storage.confirm.sync.message": "Ausstehende POIs mit dem Server synchronisieren?",
    "storage.confirm.clearPois.message": "Lokalen Cache bereits synchronisierter Objekte leeren?",
    "storage.confirm.clearPois.detail":
        "{cached} zwischengespeicherte Objekte werden gelöscht; {pending} ausstehende Erfassung(en) werden BEIBEHALTEN. Gelöschte Objekte können erneut geladen werden.",
    "storage.confirm.deleteCache.message": "Offline-Cache dieses Profils löschen?",
    "storage.confirm.stopDownload.message": "Laufenden Download abbrechen?",
    // Notifications
    "storage.notif.export.success": "JSON-Export erfolgreich",
    "storage.notif.export.error": "JSON-Export fehlgeschlagen",
    "storage.notif.clipboard.success": "In die Zwischenablage kopiert",
    "storage.notif.clipboard.error": "Kopieren fehlgeschlagen",
    "storage.notif.sync.unavailable": "Synchronisierungsmodul nicht verfügbar",
    "storage.notif.sync.offline": "Keine Internetverbindung",
    "storage.notif.sync.empty": "Keine POIs zum Synchronisieren",
    "storage.notif.sync.done": "Synchronisierung abgeschlossen",
    "storage.notif.sync.error": "Fehler bei der Synchronisierung",
    "storage.notif.clearPois.success": "Lokale POIs gelöscht",
    "storage.notif.clearPois.error": "Löschen fehlgeschlagen",
    "storage.notif.disk.insufficient": "Unzureichender Speicherplatz",
    // Download zone (vector offline — S3)
    "storage.zone.title": "Offline-Bereich",
    "storage.zone.useCurrentView": "Aktuelle Ansicht verwenden",
    "storage.zone.useProfileArea": "Profilbereich",
    "storage.zone.zoomCeiling": "Maximaler Zoom",
    "storage.zone.note": "Höher = schärfer, aber größer.",
    "storage.zone.noZone": "Kein Bereich ausgewählt.",
    "storage.zone.summary": "Bereich",
    "storage.zone.estimate": "Schätzung",
    "storage.zone.tiles": "Kacheln",
    // Layer selection table (S7)
    "storage.layers.selectAll": "Alle aus-/abwählen",
    "storage.layers.col.name": "Name",
    "storage.layers.col.geometry": "Geometrie",
    "storage.layers.col.style": "Stil",
    "storage.layers.col.size": "Größe",
    "storage.layers.col.cache": "Cache",
    "storage.layers.loadError": "Fehler beim Laden der Ebenen",
    "storage.layers.profileCacheOff": "Profil-Cache deaktiviert (enableProfileCache: false)",
    "storage.layers.tileCacheOff": "Kachel-Cache deaktiviert (enableTileCache: false)",
    "storage.layers.cached": "Im Cache",
    "storage.layers.notCached": "Nicht heruntergeladen",
    "storage.layers.tilesCached": "Kacheln im Cache",
    "storage.layers.tilesNotCached": "Kacheln nicht heruntergeladen",
    "storage.layers.tileCacheDisabled": "Kachel-Cache deaktiviert",
    "storage.layers.noCacheConfig": "Keine Cache-Konfiguration",
    "storage.layers.raster": "Raster",
    "storage.geometry.point": "Punkt",
    "storage.geometry.line": "Linie",
    "storage.geometry.polygon": "Polygon",
    "storage.geometry.collection": "Sammlung",
    // Download-size warning banner (S7)
    "storage.warn.insufficient": "FEHLER: Nicht genügend Speicher",
    "storage.warn.required": "Erforderlich",
    "storage.warn.missing": "Fehlend",
    "storage.warn.critical": "WARNUNG:",
    "storage.warn.attention": "ACHTUNG:",
    "storage.warn.largeDownload": "großer Download",
    "storage.warn.significantDownload": "umfangreicher Download",
    "storage.warn.wifiStrong":
        "WLAN DRINGEND empfohlen. Eine 4G/5G-Verbindung kann unterbrochen werden.",
    "storage.warn.wifiAdvised": "WLAN empfohlen, um Unterbrechungen zu vermeiden.",
    "storage.warn.btn.blocked": "Nicht genügend Speicherplatz",
    "storage.warn.btn.ready": "Profil für die Offline-Nutzung herunterladen",
    // Download / clear (S7)
    "storage.download.inProgress": "Wird heruntergeladen...",
    "storage.download.btn": "Profil herunterladen",
    "storage.download.resources": "Ressourcen",
    "storage.download.done": "Ressourcen heruntergeladen",
    "storage.download.error": "Fehler",
    "storage.download.clearing": "Wird gelöscht...",
    "storage.download.deleting": "Löschen läuft...",
    "storage.download.clearBtn": "Cache leeren",
    "storage.download.err.tooLarge":
        "Konfiguration zu groß (Speicherfehler). Reduzieren Sie cacheMaxZoom oder offlineBounds in profile.json",
    "storage.download.err.outOfMemory":
        "Nicht genügend Arbeitsspeicher. Verringern Sie die Downloadgröße oder schließen Sie andere Tabs.",
    "storage.notif.offline.unavailable": "Offline-Speicher nicht verfügbar",
    "storage.notif.noProfile": "Kein aktives Profil",
    "storage.notif.download.success": "Profil heruntergeladen",
    "storage.notif.download.error": "Downloadfehler",
    "storage.notif.clear.success": "Cache geleert",
    "storage.notif.clear.error": "Fehler beim Leeren",
    "storage.notif.resourcesDeleted": "Ressourcen gelöscht",
    // Signaux du MOTEUR rendus visibles (B-72) — le quota est une ERREUR (une écriture
    // a été REFUSÉE), l'éviction un AVERTISSEMENT (des données demandées ne sont plus là).
    "storage.notif.quotaExceeded":
        "Speicher voll: das letzte Element konnte nicht gespeichert werden",
    "storage.notif.cacheEvicted": "{count} Offline-Element(e) entfernt, um Platz zu schaffen",
    // POI sync section (S7)
    "storage.sync.title": "ERFASSTE DATEN",
    "storage.sync.toggle": "Synchronisierung umschalten",
    "storage.sync.loading": "Wird geladen...",
    "storage.sync.btn": "Mit Server synchronisieren",
    "storage.sync.btn.running": "Synchronisierung läuft...",
    "storage.sync.unavailable": "Synchronisierungsmodul nicht verfügbar",
    "storage.sync.upToDate": "Keine ausstehenden Änderungen",
    "storage.sync.pending.title": "Ausstehende Vorgänge:",
    "storage.sync.pending.add": "POI zum Hinzufügen",
    "storage.sync.pending.update": "POI zum Ändern",
    "storage.sync.pending.delete": "POI zum Löschen",
    "storage.sync.warn.intro": "Sie sind dabei,",
    "storage.sync.warn.outro":
        "auf dem Server. Lokale Daten haben Vorrang und überschreiben den Server.",
    "storage.sync.loadError": "Fehler beim Laden",
};

export default langStorageDe;
