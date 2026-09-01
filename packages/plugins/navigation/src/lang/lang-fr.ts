/*!
 * @geoleaf-plugins/navigation — French dictionary
 *
 * The plugin's visible strings in French: the toolbar button, and the guidance
 * banner's maneuver vocabulary. Registered at the entry so the labels resolve
 * during boot, before anything reads them.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

// Keys MUST be flat and dotted ("<plugin>.toolbar.button"). `GeoLeaf.I18n.getLabel`
// indexes the merged table directly and never splits on "." — a nested dictionary
// resolves to nothing and silently falls back to French (audit C-5).
// `satisfies Record<string, string>` makes that a compile error rather than a
// runtime surprise; keep it.
//
// ⚠️ The maneuver keys carry `@geoleaf-plugins/routing`'s NORMALISED
// vocabulary, not an engine's. An OSRM modifier contains spaces
// (`slight left`): it is reduced to a token (`slight-left`) before indexing
// this table. Without that, the key would not resolve and the user would read
// the `unknown` fallback, which is worse than a generic sentence — it is a
// generic sentence believed correct.
const langTemplateFr = {
    "navigation.toolbar.button": "Navigation",
    "navigation.maneuver.depart": "Départ",
    "navigation.maneuver.arrive": "Arrivée",
    "navigation.maneuver.continue": "Continuez tout droit",
    "navigation.maneuver.turn.left": "Tournez à gauche",
    "navigation.maneuver.turn.right": "Tournez à droite",
    "navigation.maneuver.turn.slight-left": "Serrez à gauche",
    "navigation.maneuver.turn.slight-right": "Serrez à droite",
    "navigation.maneuver.turn.sharp-left": "Tournez franchement à gauche",
    "navigation.maneuver.turn.sharp-right": "Tournez franchement à droite",
    "navigation.maneuver.uturn": "Faites demi-tour",
    "navigation.maneuver.merge": "Insérez-vous",
    "navigation.maneuver.fork.left": "Prenez à gauche à l'embranchement",
    "navigation.maneuver.fork.right": "Prenez à droite à l'embranchement",
    "navigation.maneuver.roundabout": "Prenez le rond-point",
    "navigation.notice.road":
        "Le code de la route et les conditions réelles priment sur l'itinéraire proposé.",
    "navigation.notice.background":
        "⚠️ Le guidage s'arrête si vous quittez l'application ou verrouillez l'écran : gardez cette page au premier plan.",
    "navigation.notice.dismiss": "J'ai compris",
    "navigation.unit.metres": "m",
    "navigation.unit.kilometres": "km",
    // 🛑 SPOKEN units, deliberately distinct from the banner's. A synthesiser reads "m" as the
    // LETTER m, so "in two hundred m" is not a sentence. Two sets exist because there are two
    // outputs, not because one was duplicated.
    "navigation.voice.unit.metres": "mètres",
    "navigation.voice.unit.kilometres": "kilomètres",
    // {0} = the already-formatted distance, {1} = the manoeuvre. A pattern rather than a
    // concatenation: the two swap order between languages.
    "navigation.voice.ahead": "Dans {0}, {1}",
    "navigation.maneuver.unknown": "Poursuivez",
    "navigation.reroute.network":
        "Hors trajet — recalcul indisponible sans réseau. Le guidage continue sur l'itinéraire préparé.",
    "navigation.reroute.timeout":
        "Hors trajet — le calcul n'a pas répondu à temps. Nouvel essai automatique.",
    "navigation.reroute.no-route": "Hors trajet — aucun itinéraire depuis votre position.",
    "navigation.reroute.refused": "Hors trajet — recalcul refusé par le service.",
    "navigation.reroute.http": "Hors trajet — le service de calcul a renvoyé une erreur.",
    "navigation.reroute.malformed": "Hors trajet — réponse du service illisible.",
} satisfies Record<string, string>;

export default langTemplateFr;
