/*!
 * @geoleaf-plugins/isochrone — French dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * French dictionary for `@geoleaf-plugins/isochrone`.
 *
 * Flat, dotted keys merged into the host's i18n table at registration. It is a data module:
 * no logic lives here, and every key it declares must exist in the sibling dictionaries —
 * a key present in one language only falls back silently, which reads as a translation bug
 * long after the fact. `{name}` placeholders are filled by the window.
 */

// Keys MUST be flat and dotted ("<plugin>.toolbar.button"). `GeoLeaf.I18n.getLabel`
// indexes the merged table directly and never splits on "." — a nested dictionary
// resolves to nothing and silently falls back to French.
// `satisfies Record<string, string>` makes that a compile error rather than a
// runtime surprise; keep it.
const langTemplateFr = {
    "isochrone.toolbar.button": "Isochrones",
    "isochrone.panel.title": "Isochrones",
    "isochrone.panel.close": "Fermer la fenêtre",
    "isochrone.panel.collapse": "Replier la fenêtre",
    "isochrone.panel.expand": "Déplier la fenêtre",
    "isochrone.form.mode": "Mode",
    "isochrone.form.durations": "Durée",
    "isochrone.form.minutes": "{minutes} min",
    "isochrone.form.pick": "Placer le point",
    "isochrone.form.myPosition": "Ma position",
    "isochrone.form.cancel": "Annuler",
    "isochrone.origin.label": "Point de départ",
    "isochrone.mode.car": "Voiture",
    "isochrone.mode.foot": "À pied",
    "isochrone.mode.bike": "Vélo",
    "isochrone.status.computing": "Calcul en cours…",
    "isochrone.status.locating": "Recherche de votre position…",
    "isochrone.status.picking": "Cliquez sur la carte pour placer le point — Échap pour annuler",
    "isochrone.status.done": "Zones ajoutées : {count}",
    "isochrone.status.cancelled": "Calcul annulé",
    "isochrone.status.cleared": "Toutes les zones sont supprimées",
    "isochrone.list.label": "Zones affichées",
    "isochrone.list.empty": "Aucune zone affichée",
    "isochrone.list.clear": "Tout supprimer",
    "isochrone.list.row": "{minutes} min · {mode}",
    "isochrone.list.color": "Couleur — {row}",
    "isochrone.list.opacity": "Transparence — {row}",
    "isochrone.list.hide": "Masquer — {row}",
    "isochrone.list.up": "Monter — {row}",
    "isochrone.list.down": "Descendre — {row}",
    "isochrone.list.remove": "Supprimer — {row}",
    "isochrone.list.moved": "{row} : rang {rank} sur {count}",
    "isochrone.error.timeout": "Le moteur n'a pas répondu à temps",
    "isochrone.error.network": "Le moteur est injoignable — réseau, adresse ou clé refusée",
    "isochrone.error.http": "Le moteur a refusé la demande (statut {status})",
    "isochrone.error.httpCode": "Le moteur a refusé la demande (statut {status}, code {code})",
    "isochrone.error.malformed": "La réponse du moteur est illisible",
    "isochrone.error.noEngine": "Aucun moteur de calcul n'est configuré",
    "isochrone.error.noMap": "Aucune carte n'est affichée",
    "isochrone.error.busy": "Un calcul est déjà en cours",
    "isochrone.error.tooLong": "Durée limitée à {limit} minutes par ce moteur",
    "isochrone.error.capReached": "Limite de {limit} couches atteinte",
    "isochrone.error.invalid":
        "La demande est illisible : vérifiez le point, le mode et les durées",
    "isochrone.error.noDuration": "Cochez au moins une durée",
    "isochrone.error.noPosition": "Position indisponible — GPS refusé, absent ou trop lent",
} satisfies Record<string, string>;

export default langTemplateFr;
