/*!
 * @geoleaf-plugins/measure — French dictionary (fallback)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_fr: Record<string, string> = {
    // Toolbar
    "measure.toolbar.button": "Mesure & annotation",

    // Menu
    "measure.menu.title": "Outils de mesure",
    "measure.menu.handle": "Déplacer le menu",
    "measure.menu.close": "Fermer",

    // Tools
    "measure.tool.distance": "Mesure distance",
    "measure.tool.distance.hint":
        "Cliquez pour poser des sommets. Double-clic ou Espace pour terminer.",
    "measure.tool.rect": "Surface — rectangle",
    "measure.tool.rect.hint": "Cliquer-glisser du coin haut-gauche vers le coin bas-droit.",
    "measure.tool.circle": "Surface — cercle",
    "measure.tool.circle.hint": "Cliquer-glisser depuis le centre pour définir le rayon.",
    "measure.tool.polygon": "Surface — polygone",
    "measure.tool.polygon.hint":
        "Cliquez pour poser des sommets. Raccrochez le 1er sommet, double-clic ou touche C pour clore.",
    "measure.tool.gps": "Mesure GPS",
    "measure.tool.gps.hint":
        "Activez la géolocalisation et déplacez-vous. Appuyez Espace ou re-cliquez GPS pour arrêter.",
    "measure.tool.annotationTooltip": "Étiquette tooltip",
    "measure.tool.annotationTooltip.hint":
        "Cliquez sur la carte pour poser une étiquette redimensionnable.",

    // Units — distance
    "measure.unit.m": "m",
    "measure.unit.km": "km",

    // Units — area
    "measure.unit.m2": "m²",
    "measure.unit.ha": "ha",
    "measure.unit.km2": "km²",

    // Unit selector labels
    "measure.unit.distance.label": "Distances",
    "measure.unit.area.label": "Surfaces",

    // Recap box
    "measure.recap.header.index": "N°",
    "measure.recap.header.coord": "Coord X;Y",
    "measure.recap.header.length": "Longueur",
    "measure.recap.total": "Total",
    "measure.recap.area": "Superficie",
    "measure.recap.perimeter": "Périmètre",
    "measure.recap.radius": "Rayon",
    "measure.recap.circumference": "Circonférence",

    // GPS
    "measure.gps.permissionDenied": "Accès à la géolocalisation refusé.",
    "measure.gps.unavailable": "Position GPS indisponible.",
    "measure.gps.closePrompt":
        "Vous êtes proche du point de départ. Refermer en polygone pour obtenir la superficie ?",
    "measure.gps.closeYes": "Refermer",
    "measure.gps.closeNo": "Continuer",
    "measure.gps.tracking": "Suivi GPS actif…",
    "measure.gps.stop": "Arrêter le suivi",

    // Buttons
    "measure.btn.clear": "Effacer",
    "measure.btn.export": "Exporter GeoJSON",
    "measure.btn.linear": "Linéaire",
    "measure.btn.surface": "Surface",
    "measure.btn.annotation": "Annotation",

    // Annotations
    "measure.annotation.labelPlaceholder": "Saisissez un label…",
    "measure.annotation.tooltipPlaceholder": "Saisissez une note…",

    // Errors
    "measure.error.maxFeatures":
        "Nombre maximum de mesures atteint ({max}). Effacez des mesures pour continuer.",
    "measure.error.exportFailed": "Échec de l'export GeoJSON.",
    "measure.error.gpsFailed": "Erreur de géolocalisation.",

    // Aria / accessibility
    "measure.aria.menuDragHandle": "Poignée de déplacement du menu",
    "measure.aria.closeMenu": "Fermer le menu de mesure",
    "measure.aria.distanceTool": "Outil mesure distance",
    "measure.aria.rectTool": "Outil surface rectangle",
    "measure.aria.circleTool": "Outil surface cercle",
    "measure.aria.polygonTool": "Outil surface polygone",
    "measure.aria.gpsTool": "Outil mesure GPS",
    "measure.aria.annotationTooltipTool": "Outil étiquette tooltip",
    "measure.aria.clearBtn": "Effacer toutes les mesures",
    "measure.aria.exportBtn": "Exporter les mesures en GeoJSON",
    "measure.aria.deleteAnnotation": "Supprimer l'annotation",
};

export default lang_fr;
