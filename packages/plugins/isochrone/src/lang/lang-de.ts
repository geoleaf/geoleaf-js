/*!
 * @geoleaf-plugins/isochrone — German dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * German dictionary for `@geoleaf-plugins/isochrone`.
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
const langTemplateDe = {
    "isochrone.toolbar.button": "Isochronen",
    "isochrone.panel.title": "Isochronen",
    "isochrone.panel.close": "Fenster schließen",
    "isochrone.panel.collapse": "Fenster einklappen",
    "isochrone.panel.expand": "Fenster ausklappen",
    "isochrone.form.mode": "Modus",
    "isochrone.form.durations": "Dauer",
    "isochrone.form.minutes": "{minutes} Min.",
    "isochrone.form.pick": "Punkt setzen",
    "isochrone.form.myPosition": "Mein Standort",
    "isochrone.form.cancel": "Abbrechen",
    "isochrone.origin.label": "Startpunkt",
    "isochrone.mode.car": "Auto",
    "isochrone.mode.foot": "Zu Fuß",
    "isochrone.mode.bike": "Fahrrad",
    "isochrone.status.computing": "Berechnung läuft…",
    "isochrone.status.locating": "Standort wird ermittelt…",
    "isochrone.status.picking":
        "Klicken Sie auf die Karte, um den Punkt zu setzen — Esc zum Abbrechen",
    "isochrone.status.done": "Zonen hinzugefügt: {count}",
    "isochrone.status.cancelled": "Berechnung abgebrochen",
    "isochrone.status.cleared": "Alle Zonen wurden entfernt",
    "isochrone.list.label": "Angezeigte Zonen",
    "isochrone.list.empty": "Keine Zone angezeigt",
    "isochrone.list.clear": "Alle entfernen",
    "isochrone.list.row": "{minutes} Min. · {mode}",
    "isochrone.list.color": "Farbe — {row}",
    "isochrone.list.opacity": "Transparenz — {row}",
    "isochrone.list.hide": "Ausblenden — {row}",
    "isochrone.list.up": "Nach oben — {row}",
    "isochrone.list.down": "Nach unten — {row}",
    "isochrone.list.remove": "Entfernen — {row}",
    "isochrone.list.moved": "{row}: Rang {rank} von {count}",
    "isochrone.error.timeout": "Der Dienst hat nicht rechtzeitig geantwortet",
    "isochrone.error.network":
        "Der Dienst ist nicht erreichbar — Netzwerk, Adresse oder abgelehnter Schlüssel",
    "isochrone.error.http": "Der Dienst hat die Anfrage abgelehnt (Status {status})",
    "isochrone.error.httpCode":
        "Der Dienst hat die Anfrage abgelehnt (Status {status}, Code {code})",
    "isochrone.error.malformed": "Die Antwort des Dienstes ist nicht lesbar",
    "isochrone.error.noEngine": "Kein Routing-Dienst ist konfiguriert",
    "isochrone.error.noMap": "Keine Karte wird angezeigt",
    "isochrone.error.busy": "Eine Berechnung läuft bereits",
    "isochrone.error.tooLong": "Dauer auf {limit} Minuten durch diesen Dienst begrenzt",
    "isochrone.error.capReached": "Grenze von {limit} Ebenen erreicht",
    "isochrone.error.invalid": "Die Anfrage ist nicht lesbar: Punkt, Modus und Dauern prüfen",
    "isochrone.error.noDuration": "Mindestens eine Dauer auswählen",
    "isochrone.error.noPosition":
        "Standort nicht verfügbar — GPS verweigert, fehlt oder zu langsam",
} satisfies Record<string, string>;

export default langTemplateDe;
