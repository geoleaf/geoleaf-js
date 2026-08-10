/*!
 * @geoleaf-plugins/offline-ui — French i18n dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** Storage plugin labels (FR — fallback locale). */
const langStorageFr = {
    // Toolbar + modal shell
    "storage.toolbar.button": "Cache hors ligne",
    "storage.modal.title": "Gestion du cache hors ligne",
    "storage.modal.tab.import": "Import",
    "storage.modal.tab.export": "Export",
    "storage.modal.close": "Fermer",
    // Generic dialog buttons
    "storage.btn.cancel": "Annuler",
    "storage.btn.confirm": "Confirmer",
    "storage.btn.delete": "Supprimer",
    // Confirmation dialogs
    "storage.confirm.sync.message": "Synchroniser les POI en attente avec le serveur ?",
    "storage.confirm.clearPois.message": "Vider le cache local des entités déjà synchronisées ?",
    "storage.confirm.clearPois.detail":
        "{cached} entité(s) en cache seront supprimées ; {pending} saisie(s) en attente seront CONSERVÉES. Les entités supprimées se re-téléchargent.",
    "storage.confirm.deleteCache.message": "Supprimer le cache hors ligne de ce profil ?",
    "storage.confirm.stopDownload.message": "Arrêter le téléchargement en cours ?",
    // Notifications
    "storage.notif.export.success": "Export JSON réussi",
    "storage.notif.export.error": "Échec de l'export JSON",
    "storage.notif.clipboard.success": "Copié dans le presse-papiers",
    "storage.notif.clipboard.error": "Échec de la copie",
    "storage.notif.sync.unavailable": "Module de synchronisation indisponible",
    "storage.notif.sync.offline": "Aucune connexion Internet",
    "storage.notif.sync.empty": "Aucun POI à synchroniser",
    "storage.notif.sync.done": "Synchronisation terminée",
    "storage.notif.sync.error": "Erreur lors de la synchronisation",
    "storage.notif.clearPois.success": "POI locaux supprimés",
    "storage.notif.clearPois.error": "Échec de la suppression",
    "storage.notif.disk.insufficient": "Espace de stockage insuffisant",
    // Download zone (vector offline — S3)
    "storage.zone.title": "Zone hors ligne",
    "storage.zone.useCurrentView": "Utiliser la vue actuelle",
    "storage.zone.useProfileArea": "Zone du profil",
    "storage.zone.zoomCeiling": "Plafond de zoom",
    "storage.zone.note": "Plus haut = plus net mais plus volumineux.",
    "storage.zone.noZone": "Aucune zone sélectionnée.",
    "storage.zone.summary": "Zone",
    "storage.zone.estimate": "Estimation",
    "storage.zone.tiles": "tuiles",
    // Layer selection table (S7)
    "storage.layers.selectAll": "Tout sélectionner / désélectionner",
    "storage.layers.col.name": "Nom",
    "storage.layers.col.geometry": "Géométrie",
    "storage.layers.col.style": "Style",
    "storage.layers.col.size": "Taille",
    "storage.layers.col.cache": "Cache",
    "storage.layers.loadError": "Erreur lors du chargement des couches",
    "storage.layers.profileCacheOff": "Cache de profil désactivé (enableProfileCache: false)",
    "storage.layers.tileCacheOff": "Cache de tuiles désactivé (enableTileCache: false)",
    "storage.layers.cached": "En cache",
    "storage.layers.notCached": "Non téléchargé",
    "storage.layers.tilesCached": "Tuiles en cache",
    "storage.layers.tilesNotCached": "Tuiles non téléchargées",
    "storage.layers.tileCacheDisabled": "Cache de tuiles désactivé",
    "storage.layers.noCacheConfig": "Pas de configuration de cache",
    "storage.layers.raster": "Raster",
    "storage.geometry.point": "Point",
    "storage.geometry.line": "Ligne",
    "storage.geometry.polygon": "Polygone",
    "storage.geometry.collection": "Collection",
    // Download-size warning banner (S7)
    "storage.warn.insufficient": "ERREUR : espace insuffisant",
    "storage.warn.required": "Requis",
    "storage.warn.missing": "Manque",
    "storage.warn.critical": "AVERTISSEMENT :",
    "storage.warn.attention": "ATTENTION :",
    "storage.warn.largeDownload": "téléchargement volumineux",
    "storage.warn.significantDownload": "téléchargement important",
    "storage.warn.wifiStrong":
        "WiFi FORTEMENT recommandé. Une connexion 4G/5G peut être interrompue.",
    "storage.warn.wifiAdvised": "WiFi recommandé pour éviter les interruptions.",
    "storage.warn.btn.blocked": "Espace de stockage insuffisant",
    "storage.warn.btn.ready": "Télécharger le profil pour une utilisation hors ligne",
    // Download / clear (S7)
    "storage.download.inProgress": "Téléchargement...",
    "storage.download.btn": "Télécharger le profil",
    "storage.download.resources": "ressources",
    "storage.download.done": "ressources téléchargées",
    "storage.download.error": "Erreur",
    "storage.download.clearing": "Effacement...",
    "storage.download.deleting": "Suppression en cours...",
    "storage.download.clearBtn": "Vider le cache",
    "storage.download.err.tooLarge":
        "Configuration trop volumineuse (erreur mémoire). Réduisez cacheMaxZoom ou offlineBounds dans profile.json",
    "storage.download.err.outOfMemory":
        "Mémoire insuffisante. Réduisez la taille du téléchargement ou fermez d'autres onglets.",
    "storage.notif.offline.unavailable": "Stockage hors ligne non disponible",
    "storage.notif.noProfile": "Aucun profil actif",
    "storage.notif.download.success": "Profil téléchargé",
    "storage.notif.download.error": "Erreur de téléchargement",
    "storage.notif.clear.success": "Cache vidé",
    "storage.notif.clear.error": "Erreur d'effacement",
    "storage.notif.resourcesDeleted": "ressources supprimées",
    // Signaux du MOTEUR rendus visibles (B-72) — le quota est une ERREUR (une écriture
    // a été REFUSÉE), l'éviction un AVERTISSEMENT (des données demandées ne sont plus là).
    "storage.notif.quotaExceeded":
        "Stockage plein : la dernière donnée n'a pas pu être enregistrée",
    "storage.notif.cacheEvicted":
        "{count} élément(s) hors ligne supprimé(s) pour libérer de la place",
    // POI sync section (S7)
    "storage.sync.title": "DONNÉES SAISIES",
    "storage.sync.toggle": "Basculer la synchronisation",
    "storage.sync.loading": "Chargement...",
    "storage.sync.btn": "Synchroniser avec le serveur",
    "storage.sync.btn.running": "Synchronisation en cours...",
    "storage.sync.unavailable": "Module de synchronisation non disponible",
    "storage.sync.upToDate": "Aucune modification en attente",
    "storage.sync.pending.title": "Opérations en attente :",
    "storage.sync.pending.add": "POI à ajouter",
    "storage.sync.pending.update": "POI à modifier",
    "storage.sync.pending.delete": "POI à supprimer",
    "storage.sync.warn.intro": "Vous allez",
    "storage.sync.warn.outro":
        "sur le serveur. Les données locales sont prioritaires et écraseront celles du serveur.",
    "storage.sync.loadError": "Erreur lors du chargement",
} satisfies Record<string, string>;

export default langStorageFr;
/**
 * Shape of the offline-UI translation table, derived from the French one.
 *
 * Typed from the reference table rather than declared: a translation missing a key becomes a
 * compile error instead of an `undefined` label at runtime.
 */
export type StorageLangDict = typeof langStorageFr;
