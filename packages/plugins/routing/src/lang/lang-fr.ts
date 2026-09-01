/*!
 * @geoleaf-plugins/routing — French dictionary
 *
 * The plugin's user-visible strings in French: the toolbar button that opens route computation.
 * Registered at entry time so labels resolve during boot, before anything reads them.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

// Keys MUST be flat and dotted ("<plugin>.toolbar.button"). `GeoLeaf.I18n.getLabel`
// indexes the merged table directly and never splits on "." — a nested dictionary
// resolves to nothing and silently falls back to French (audit C-5).
// `satisfies Record<string, string>` makes that a compile error rather than a
// runtime surprise; keep it.
const langTemplateFr = {
    "routing.toolbar.button": "Itinéraire",
    "routing.panel.title": "Itinéraire",
    "routing.panel.close": "Fermer",
    "routing.add.field": "Adresse ou coordonnées (lat, lon)",
    "routing.add.submit": "Ajouter",
    "routing.add.pick": "Choisir sur la carte",
    "routing.add.picking": "Cliquez sur la carte…",
    "routing.add.notCoordinates":
        "Saisissez une adresse, ou des coordonnées « latitude, longitude ».",
    "routing.add.outOfRange":
        "Ces coordonnées ne désignent aucun lieu : la latitude va de −90 à 90, la longitude de −180 à 180.",
    "routing.add.noMatch": "Aucun lieu ne correspond à cette recherche.",
    "routing.add.searchFailed":
        "La recherche d'adresse n'a pas répondu. Réessayez, ou saisissez des coordonnées.",
    "routing.panel.clear": "Vider l'itinéraire",
    "routing.panel.compute": "Calculer",
    "routing.panel.startGuidance": "Démarrer le guidage",
    "routing.panel.empty": "Aucune étape. Ajoutez un point de départ et une destination.",
    "routing.step.origin": "Départ",
    "routing.step.via": "Étape",
    "routing.step.destination": "Arrivée",
    "routing.step.moveUp": "Monter cette étape",
    "routing.step.moveDown": "Descendre cette étape",
    "routing.step.remove": "Retirer cette étape",
    "routing.origin.you": "Votre position",
    "routing.error.timeout": "Le service d'itinéraire n'a pas répondu à temps. Réessayez.",
    "routing.error.network": "La requête n'a pas pu être envoyée. Vérifiez votre connexion.",
    "routing.error.http": "Le service d'itinéraire a refusé la requête.",
    "routing.error.malformed": "Le service a répondu quelque chose d'illisible.",
    "routing.error.noRoute": "Aucun itinéraire entre ces points.",
    "routing.error.refused": "La configuration du service d'itinéraire a été refusée.",
    "routing.error.capReached": "Nombre maximal d'étapes atteint.",
    "routing.error.noLayer": "Le profil ne déclare pas la couche où tracer l'itinéraire.",
    "routing.error.originDenied": "Position refusée. Saisissez un point de départ.",
    "routing.error.originNoFix":
        "Position pas encore connue. Réessayez ou saisissez un point de départ.",
    "routing.error.originUnavailable": "La géolocalisation n'est pas disponible ici.",
    "routing.origin.denied": "Position refusée. Saisissez un point de départ.",
    "routing.origin.noFix":
        "Position pas encore connue. Réessayez ou saisissez un point de départ.",
    "routing.origin.unavailable": "La géolocalisation n'est pas disponible ici.",
} satisfies Record<string, string>;

export default langTemplateFr;
