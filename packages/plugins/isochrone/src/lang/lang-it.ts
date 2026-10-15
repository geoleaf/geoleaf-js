/*!
 * @geoleaf-plugins/isochrone — Italian dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Italian dictionary for `@geoleaf-plugins/isochrone`.
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
const langTemplateIt = {
    "isochrone.toolbar.button": "Isocrone",
    "isochrone.panel.title": "Isocrone",
    "isochrone.panel.close": "Chiudi la finestra",
    "isochrone.panel.collapse": "Comprimi la finestra",
    "isochrone.panel.expand": "Espandi la finestra",
    "isochrone.form.mode": "Modalità",
    "isochrone.form.durations": "Durata",
    "isochrone.form.minutes": "{minutes} min",
    "isochrone.form.pick": "Posiziona il punto",
    "isochrone.form.myPosition": "La mia posizione",
    "isochrone.form.cancel": "Annulla",
    "isochrone.origin.label": "Punto di partenza",
    "isochrone.mode.car": "Auto",
    "isochrone.mode.foot": "A piedi",
    "isochrone.mode.bike": "Bicicletta",
    "isochrone.status.computing": "Calcolo in corso…",
    "isochrone.status.locating": "Ricerca della posizione…",
    "isochrone.status.picking": "Fai clic sulla mappa per posizionare il punto — Esc per annullare",
    "isochrone.status.done": "Zone aggiunte: {count}",
    "isochrone.status.cancelled": "Calcolo annullato",
    "isochrone.status.cleared": "Tutte le zone sono state rimosse",
    "isochrone.list.label": "Zone visualizzate",
    "isochrone.list.empty": "Nessuna zona visualizzata",
    "isochrone.list.clear": "Rimuovi tutto",
    "isochrone.list.row": "{minutes} min · {mode}",
    "isochrone.list.color": "Colore — {row}",
    "isochrone.list.opacity": "Trasparenza — {row}",
    "isochrone.list.hide": "Nascondi — {row}",
    "isochrone.list.up": "Sposta su — {row}",
    "isochrone.list.down": "Sposta giù — {row}",
    "isochrone.list.remove": "Rimuovi — {row}",
    "isochrone.list.moved": "{row}: posizione {rank} di {count}",
    "isochrone.error.timeout": "Il motore non ha risposto in tempo",
    "isochrone.error.network": "Il motore non è raggiungibile — rete, indirizzo o chiave rifiutata",
    "isochrone.error.http": "Il motore ha rifiutato la richiesta (stato {status})",
    "isochrone.error.httpCode":
        "Il motore ha rifiutato la richiesta (stato {status}, codice {code})",
    "isochrone.error.malformed": "La risposta del motore è illeggibile",
    "isochrone.error.noEngine": "Nessun motore di calcolo è configurato",
    "isochrone.error.noMap": "Nessuna mappa è visualizzata",
    "isochrone.error.busy": "Un calcolo è già in corso",
    "isochrone.error.tooLong": "Durata limitata a {limit} minuti da questo motore",
    "isochrone.error.capReached": "Limite di {limit} livelli raggiunto",
    "isochrone.error.invalid":
        "La richiesta è illeggibile: verifica il punto, la modalità e le durate",
    "isochrone.error.noDuration": "Seleziona almeno una durata",
    "isochrone.error.noPosition": "Posizione non disponibile — GPS negato, assente o troppo lento",
} satisfies Record<string, string>;

export default langTemplateIt;
