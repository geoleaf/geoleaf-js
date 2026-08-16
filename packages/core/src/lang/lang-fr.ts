/*!
 * GeoLeaf Core — Language: French (fr)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Canonical reference file. All other lang files translate these strings.
 * Template variables use {0}, {1}, ... positional placeholders.
 * https://geoleaf.dev
 */

/**
 * Shape of a core translation table: flat key → translated string.
 *
 * Deliberately flat rather than nested — keys carry their own namespace (`toast.geoloc.…`),
 * so a missing key is a missing key rather than a traversal into `undefined`.
 */
export type LangDict = Record<string, string>;

const lang_fr: LangDict = {
    // ── Toasts / Geolocation ─────────────────────────────────────────────────
    "toast.geoloc.position_found": "Position trouv\u00e9e",
    "toast.geoloc.locating": "Localisation en cours\u2026",
    "toast.geoloc.error.default": "Impossible d\u2019obtenir votre position",
    "toast.geoloc.error.permission_denied": "Permission de g\u00e9olocalisation refus\u00e9e",
    "toast.geoloc.error.position_unavailable": "Position indisponible",
    "toast.geoloc.error.timeout": "D\u00e9lai de g\u00e9olocalisation d\u00e9pass\u00e9",

    // ── Toasts / Init ────────────────────────────────────────────────────────
    "toast.init.loading": "Chargement des donn\u00e9es\u2026",
    "toast.profile.loaded": "{0} charg\u00e9",
    "toast.theme.applied":
        "Th\u00e8me \u00ab\u202f{0}\u202f\u00bb appliqu\u00e9 ({1} couches visibles)",

    // ── Toasts / Cache ───────────────────────────────────────────────────────

    // ── Aria / Fullscreen ────────────────────────────────────────────────────

    // ── Aria / Geolocation ───────────────────────────────────────────────────
    "aria.geoloc.toggle": "G\u00e9olocalisation ON/OFF",
    "aria.geoloc.toggle_label": "Activer/D\u00e9sactiver le suivi GPS",
    "aria.geoloc.recenter": "Revenir \u00e0 ma position",

    // ── Aria / POI Add ───────────────────────────────────────────────────────
    "aria.poi_add.title": "Ajouter un POI",
    "aria.poi_add.label": "Ajouter un nouveau point d\u2019int\u00e9r\u00eat",

    // ── Aria / Toolbar ───────────────────────────────────────────────────────
    "aria.toolbar.root": "Outils carte",
    "aria.toolbar.scroll_up": "D\u00e9filer vers le haut",
    "aria.toolbar.scroll_down": "D\u00e9filer vers le bas",
    "aria.toolbar.fullscreen": "Plein \u00e9cran",
    "aria.toolbar.zoom_in": "Zoom avant",
    "aria.toolbar.zoom_out": "Zoom arri\u00e8re",
    "aria.toolbar.geoloc": "Ma position",
    "aria.toolbar.themes": "Th\u00e8mes",
    "tooltip.toolbar.themes": "Th\u00e8mes / options th\u00e8mes secondaires",
    "aria.toolbar.legend": "L\u00e9gende",
    "tooltip.toolbar.legend": "L\u00e9gende de la carte",
    "aria.toolbar.layers": "Couches",
    "tooltip.toolbar.layers": "Gestionnaire de couches",
    "aria.toolbar.poi_add": "Ajouter un POI",
    "tooltip.toolbar.poi_add": "Ajouter un point d\u2019int\u00e9r\u00eat",
    "aria.toolbar.proximity": "Proximit\u00e9",
    "tooltip.toolbar.proximity": "Recherche par proximit\u00e9",
    "aria.toolbar.filters": "Filtres",
    "aria.toolbar.reset_filters": "R\u00e9initialiser tous les filtres",
    "tooltip.toolbar.filters": "Filtres avanc\u00e9s",

    // \u2500\u2500 Share / Partage de vue (A.7) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    "share.toolbar.button": "Partager la vue",
    "share.modal.title": "Partager cette vue",
    "share.modal.url": "Lien de partage",
    "share.modal.copy": "Copier",
    "share.modal.copied": "Copi\u00e9\u00a0!",
    "share.modal.copy_failed": "\u00c9chec de la copie",
    "share.modal.show_qr": "Afficher le QR code",
    "share.modal.qr_loading": "Chargement\u2026",
    "share.modal.qr_failed": "Erreur QR",
    "share.modal.close": "Fermer",
    "pwa.install.button": "Installer",
    "pwa.install.close": "Fermer la bannière d'installation",
    "pwa.install.title": "Installer l'application {0}",
    "pwa.ios.title": "Installer {0}",
    "pwa.ios.close": "Fermer",
    "pwa.ios.instructions_pre": "Appuyez sur l'icône ",
    "pwa.ios.instructions_mid": " de partage, puis sélectionnez ",
    "pwa.ios.home_screen": "« Sur l'écran d'accueil »",
    "pwa.ios.aria": "Ajouter {0} à l'écran d'accueil",

    // ── Aria / Search bar ────────────────────────────────────────────────────
    "aria.search.bar": "Recherche textuelle",
    "aria.search.input": "Texte de recherche",
    "aria.search.submit": "Valider la recherche",
    "aria.search.clear": "Effacer la recherche",
    "placeholder.search.input": "Rechercher...",

    // ── Aria / Sheet ─────────────────────────────────────────────────────────
    "aria.sheet.close": "Fermer",

    // ── Aria / Proximity ─────────────────────────────────────────────────────
    "aria.proximity.region": "Configuration de la recherche par proximit\u00e9",
    "aria.proximity.slider": "Rayon de recherche en kilom\u00e8tres",
    "aria.proximity.validate": "Valider la recherche par proximit\u00e9",
    "aria.proximity.cancel": "Annuler la recherche par proximit\u00e9",

    // ── Aria / Layer manager ─────────────────────────────────────────────────
    "aria.layer.toggle": "Afficher / masquer la couche",
    "aria.layer.style_select": "Sélecteur de style de la couche",
    "aria.layer.basemap_select": "Sélecteur de fond de carte",

    // ── Aria / Themes ────────────────────────────────────────────────────────
    "aria.themes.nav_prev": "Th\u00e8mes pr\u00e9c\u00e9dents",
    "aria.themes.nav_next": "Th\u00e8mes suivants",
    "aria.themes.prev_title": "Th\u00e8me pr\u00e9c\u00e9dent",
    "aria.themes.next_title": "Th\u00e8me suivant",
    "aria.themes.secondary_select": "S\u00e9lecteur de th\u00e8me secondaire",

    // ── Aria / Filter panel ──────────────────────────────────────────────────
    "aria.filter_panel.open": "Ouvrir le panel de filtres",
    "aria.filter_panel.close": "Fermer le panel de filtres",
    "aria.filter_panel.close_inner": "Fermer le panel",

    // ── Aria / Desktop Panel ─────────────────────────────────────────────────
    "aria.panel.nav": "Panneau de navigation",
    "aria.panel.lateral": "Panneau lat\u00e9ral",

    // ── Aria / Side Panel (POI) ──────────────────────────────────────────────
    "aria.sidepanel.close": "Fermer",
    "aria.sidepanel.landmark": "Fiche d\u00e9taill\u00e9e du point d\u2019int\u00e9r\u00eat",

    // ── Aria / Lightbox ───────────────────────────────────────────────────────
    "aria.lightbox.title": "Galerie d\u2019images",
    "aria.lightbox.close": "Fermer",
    "aria.lightbox.prev": "Image pr\u00e9c\u00e9dente",
    "aria.lightbox.next": "Image suivante",
    "aria.lightbox.counter": "Image {0} sur {1}",

    // ── Aria / Legend ────────────────────────────────────────────────────────
    "aria.legend.toggle": "Basculer la l\u00e9gende",

    // ── Aria / Labels ────────────────────────────────────────────────────────
    "aria.labels.toggle": "Afficher/masquer les \u00e9tiquettes",

    // ── Aria / Theme toggle ──────────────────────────────────────────────────
    "aria.theme.toggle_to_light": "Basculer en th\u00e8me clair",
    "aria.theme.toggle_to_dark": "Basculer en th\u00e8me sombre",

    // ── Aria / Notifications ─────────────────────────────────────────────────
    "aria.notification.close_label": "Fermer la notification",
    "aria.notification.close_title": "Fermer",

    // ── Aria / Cache ─────────────────────────────────────────────────────────

    // ── UI texts / Proximity ─────────────────────────────────────────────────
    "ui.proximity.point_placed": "\u2713 Ajustez le rayon",
    "ui.proximity.instruction_initial": "Toucher la carte",
    // ── UI texts / Filter actions ────────────────────────────────────────────
    "ui.filter.activate": "Activer",
    "ui.filter.disable": "D\u00e9sactiver",

    // ── UI texts / Sheet titles ──────────────────────────────────────────────
    "sheet.title.zoom": "Zoom",
    "sheet.title.geoloc": "Ma position",
    "sheet.title.search": "Recherche",
    "sheet.title.proximity": "Proximit\u00e9",
    "sheet.title.filters": "Filtres",
    "sheet.title.legend": "L\u00e9gende",
    "sheet.title.layers": "Couches",
    "sheet.title.themes": "Th\u00e8mes (principales et secondaire)",

    // ── UI texts / Layer manager ─────────────────────────────────────────────
    "ui.layer_manager.title": "Gestionnaire de couches",
    "ui.profile_switcher.label": "Profil",
    "aria.profile_switcher.select": "Sélecteur de profil de données",
    "ui.language.button": "Langue",
    "aria.language.select": "Sélecteur de langue",
    "ui.palette.button": "Palette de couleurs",
    "ui.palette.title": "Couleur d’accent",
    "aria.palette.select": "Sélecteur de palette",
    "ui.layer_manager.basemap_section": "Fond de carte",
    "ui.layer_manager.geojson_section": "Couches GeoJSON",
    "ui.layer_manager.empty": "Aucune couche \u00e0 afficher.",

    // ── Feature-info / side-panel ─────────────────────────
    "feature-info.sidepanel.landmark": "Panneau de d\u00e9tails",
    "feature-info.sidepanel.close": "Fermer",

    // ── UI texts / Filter panel ──────────────────────────────────────────────
    "ui.filter_panel.title": "Filtres",
    "ui.legend.title": "L\u00e9gende",
    "ui.filter_panel.close": "Fermer",
    "ui.filter_panel.apply": "Appliquer",
    "ui.filter_panel.reset": "R\u00e9initialiser",
    "ui.filter_panel.categories_title_fallback": "Afficher les cat\u00e9gories",
    "ui.filter_panel.tags_title_fallback": "Afficher les tags",
    "ui.filter_panel.no_categories": "Aucune cat\u00e9gorie disponible sur les layers visibles",
    "ui.filter_panel.no_tags": "Aucun tag disponible sur les layers visibles",
    "ui.filter_panel.loading": "Chargement...",

    // ── UI texts / Notifications ─────────────────────────────────────────────
    "ui.notification.close_char": "\u00d7",

    // ── UI texts / Branding ──────────────────────────────────────────────────
    "ui.branding.default_text": "Propuls\u00e9 par \u00a9 GeoLeaf with MapLibre",
    "ui.branding.not_configured": "\u26a0 Branding non configur\u00e9",

    // ── UI texts / Cache ─────────────────────────────────────────────────────
    // B-163 — l'éviction est un AVERTISSEMENT (des données demandées ne sont plus là).
    // ⚠️ `{0}` et non `{count}` : `getLabel()` interpole POSITIONNELLEMENT (`i18n.ts:163`).
    // `offline-ui` porte la même clé avec `{count}` parce qu'il fait un `.replace()` manuel,
    // ce qui n'est pas la convention du moteur — copier sa graphie afficherait « {count} ».
    "storage.notif.cacheEvicted": "{0} élément(s) hors ligne supprimé(s) pour libérer de la place",
    // ── UI texts / Offline ───────────────────────────────────────────────────
    "ui.offline.badge": "\u26a0\ufe0f Hors ligne",
    "aria.offline.badge_title": "Mode hors ligne actif",
    // ── UI texts / Themes ────────────────────────────────────────────────────
    "ui.theme.select_placeholder": "S\u00e9lectionner un th\u00e8me...",

    // ── UI texts / Themes nav chars ──────────────────────────────────────────
    "ui.themes.nav_prev_char": "\u276e",
    "ui.themes.nav_next_char": "\u276f",

    // ── Formats ──────────────────────────────────────────────────────────────
    "format.proximity.radius": "{0} km",
    "format.scale.unit_km": "{0} km",
    "format.scale.unit_m": "{0} m",
    "format.zoom.level": "Zoom : {0}",
};

export default lang_fr;
