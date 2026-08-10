/*!
 * @geoleaf-plugins/offline-ui — English i18n dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { StorageLangDict } from "./lang-fr.js";

/** Storage plugin labels (EN). */
const langStorageEn: StorageLangDict = {
    // Toolbar + modal shell
    "storage.toolbar.button": "Offline cache",
    "storage.modal.title": "Offline cache management",
    "storage.modal.tab.import": "Import",
    "storage.modal.tab.export": "Export",
    "storage.modal.close": "Close",
    // Generic dialog buttons
    "storage.btn.cancel": "Cancel",
    "storage.btn.confirm": "Confirm",
    "storage.btn.delete": "Delete",
    // Confirmation dialogs
    "storage.confirm.sync.message": "Sync pending POIs with the server?",
    "storage.confirm.clearPois.message": "Clear the local cache of already-synchronised entities?",
    "storage.confirm.clearPois.detail":
        "{cached} cached entity(ies) will be deleted; {pending} pending capture(s) will be KEPT. Deleted entities can be downloaded again.",
    "storage.confirm.deleteCache.message": "Delete the offline cache for this profile?",
    "storage.confirm.stopDownload.message": "Stop the ongoing download?",
    // Notifications
    "storage.notif.export.success": "JSON export successful",
    "storage.notif.export.error": "JSON export failed",
    "storage.notif.clipboard.success": "Copied to clipboard",
    "storage.notif.clipboard.error": "Copy failed",
    "storage.notif.sync.unavailable": "Sync module unavailable",
    "storage.notif.sync.offline": "No internet connection",
    "storage.notif.sync.empty": "No POI to sync",
    "storage.notif.sync.done": "Sync complete",
    "storage.notif.sync.error": "Error during sync",
    "storage.notif.clearPois.success": "Local POIs deleted",
    "storage.notif.clearPois.error": "Deletion failed",
    "storage.notif.disk.insufficient": "Insufficient storage space",
    // Download zone (vector offline — S3)
    "storage.zone.title": "Offline area",
    "storage.zone.useCurrentView": "Use current view",
    "storage.zone.useProfileArea": "Profile area",
    "storage.zone.zoomCeiling": "Zoom ceiling",
    "storage.zone.note": "Higher = sharper but larger.",
    "storage.zone.noZone": "No area selected.",
    "storage.zone.summary": "Area",
    "storage.zone.estimate": "Estimate",
    "storage.zone.tiles": "tiles",
    // Layer selection table (S7)
    "storage.layers.selectAll": "Select all / deselect all",
    "storage.layers.col.name": "Name",
    "storage.layers.col.geometry": "Geometry",
    "storage.layers.col.style": "Style",
    "storage.layers.col.size": "Size",
    "storage.layers.col.cache": "Cache",
    "storage.layers.loadError": "Error loading layers",
    "storage.layers.profileCacheOff": "Profile cache disabled (enableProfileCache: false)",
    "storage.layers.tileCacheOff": "Tile cache disabled (enableTileCache: false)",
    "storage.layers.cached": "Cached",
    "storage.layers.notCached": "Not downloaded",
    "storage.layers.tilesCached": "Tiles cached",
    "storage.layers.tilesNotCached": "Tiles not downloaded",
    "storage.layers.tileCacheDisabled": "Tile cache disabled",
    "storage.layers.noCacheConfig": "No cache configuration",
    "storage.layers.raster": "Raster",
    "storage.geometry.point": "Point",
    "storage.geometry.line": "Line",
    "storage.geometry.polygon": "Polygon",
    "storage.geometry.collection": "Collection",
    // Download-size warning banner (S7)
    "storage.warn.insufficient": "ERROR: insufficient space",
    "storage.warn.required": "Required",
    "storage.warn.missing": "Missing",
    "storage.warn.critical": "WARNING:",
    "storage.warn.attention": "CAUTION:",
    "storage.warn.largeDownload": "large download",
    "storage.warn.significantDownload": "significant download",
    "storage.warn.wifiStrong": "WiFi STRONGLY recommended. A 4G/5G connection may be interrupted.",
    "storage.warn.wifiAdvised": "WiFi recommended to avoid interruptions.",
    "storage.warn.btn.blocked": "Insufficient storage space",
    "storage.warn.btn.ready": "Download the profile for offline use",
    // Download / clear (S7)
    "storage.download.inProgress": "Downloading...",
    "storage.download.btn": "Download profile",
    "storage.download.resources": "resources",
    "storage.download.done": "resources downloaded",
    "storage.download.error": "Error",
    "storage.download.clearing": "Clearing...",
    "storage.download.deleting": "Deleting...",
    "storage.download.clearBtn": "Clear cache",
    "storage.download.err.tooLarge":
        "Configuration too large (memory error). Reduce cacheMaxZoom or offlineBounds in profile.json",
    "storage.download.err.outOfMemory":
        "Not enough memory. Reduce the download size or close other tabs.",
    "storage.notif.offline.unavailable": "Offline storage unavailable",
    "storage.notif.noProfile": "No active profile",
    "storage.notif.download.success": "Profile downloaded",
    "storage.notif.download.error": "Download error",
    "storage.notif.clear.success": "Cache cleared",
    "storage.notif.clear.error": "Clear failed",
    "storage.notif.resourcesDeleted": "resources deleted",
    // Signaux du MOTEUR rendus visibles (B-72) — le quota est une ERREUR (une écriture
    // a été REFUSÉE), l'éviction un AVERTISSEMENT (des données demandées ne sont plus là).
    "storage.notif.quotaExceeded": "Storage full: the last item could not be saved",
    "storage.notif.cacheEvicted": "{count} offline item(s) removed to free space",
    // POI sync section (S7)
    "storage.sync.title": "ENTERED DATA",
    "storage.sync.toggle": "Toggle synchronisation",
    "storage.sync.loading": "Loading...",
    "storage.sync.btn": "Sync with server",
    "storage.sync.btn.running": "Syncing...",
    "storage.sync.unavailable": "Synchronisation module unavailable",
    "storage.sync.upToDate": "No pending change",
    "storage.sync.pending.title": "Pending operations:",
    "storage.sync.pending.add": "POI to add",
    "storage.sync.pending.update": "POI to modify",
    "storage.sync.pending.delete": "POI to delete",
    "storage.sync.warn.intro": "You are about to",
    "storage.sync.warn.outro":
        "on the server. Local data takes priority and will overwrite the server.",
    "storage.sync.loadError": "Loading failed",
};

export default langStorageEn;
