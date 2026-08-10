/*!
 * @geoleaf-plugins/print — IT dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const langPrintIt = {
    "print.toolbar.button": "Stampa / Esporta",
    "print.emprise.hint": "Fai clic e trascina per definire l'area di stampa",
    "print.emprise.hint.adjust": "Regola i punti di controllo e fai clic su OK",
    "print.modal.title": "Stampa / Esportazione",
    "print.modal.field.title": "Titolo",
    "print.modal.field.description": "Descrizione",
    "print.modal.check.legend": "Legenda",
    "print.modal.check.scale": "Barra della scala",
    "print.modal.check.northArrow": "Freccia nord",
    "print.modal.check.annotations": "Annotazioni",
    "print.modal.format": "Formato carta",
    "print.modal.scaleLocked": "Scala bloccata",
    "print.modal.redefineExtent": "Ridefinire l'estensione",
    "print.btn.pdf": "PDF",
    "print.btn.jpg": "JPG",
    "print.btn.export": "Esporta",
    "print.btn.cancel": "Annulla",
    "print.btn.ok": "OK",
    "print.error.tainted":
        "Impossibile esportare: una sorgente di tile non supporta CORS. Configura un endpoint server o utilizza sorgenti compatibili con CORS.",
    "print.error.render": "Errore durante il rendering della mappa.",
    "print.error.noMap": "Nessuna mappa disponibile.",
    "print.error.serverEndpoint": "L'URL del server di rendering non è valido.",
    "print.error.serverFailed": "Il server di rendering ha restituito un errore.",
    "print.spinner.rendering": "Rendering in corso…",
    "print.orientation.portrait": "Ritratto",
    "print.orientation.landscape": "Paesaggio",
    "print.aria.scaleLocked": "Scala bloccata a",
    "print.aria.toolbar.print": "Stampa / Esporta la mappa",
} satisfies Record<string, string>;

export default langPrintIt;
