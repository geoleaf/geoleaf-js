/*!
 * @geoleaf-plugins/navigation — English dictionary
 *
 * The plugin's user-visible strings in English: the toolbar button, and the manoeuvre
 * vocabulary the guidance banner reads. Registered at entry time so labels resolve during
 * boot, before anything reads them.
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
const langTemplateEn = {
    "navigation.toolbar.button": "Navigation",
    "navigation.maneuver.depart": "Depart",
    "navigation.maneuver.arrive": "Arrive",
    "navigation.maneuver.continue": "Continue straight ahead",
    "navigation.maneuver.turn.left": "Turn left",
    "navigation.maneuver.turn.right": "Turn right",
    "navigation.maneuver.turn.slight-left": "Bear left",
    "navigation.maneuver.turn.slight-right": "Bear right",
    "navigation.maneuver.turn.sharp-left": "Turn sharply left",
    "navigation.maneuver.turn.sharp-right": "Turn sharply right",
    "navigation.maneuver.uturn": "Make a U-turn",
    "navigation.maneuver.merge": "Merge",
    "navigation.maneuver.fork.left": "Keep left at the fork",
    "navigation.maneuver.fork.right": "Keep right at the fork",
    "navigation.maneuver.roundabout": "Take the roundabout",
    "navigation.notice.road":
        "The highway code and actual conditions come before the suggested route.",
    "navigation.notice.background":
        "⚠️ Guidance stops if you leave the app or lock the screen: keep this page in front.",
    "navigation.notice.dismiss": "Got it",
    "navigation.unit.metres": "m",
    "navigation.unit.kilometres": "km",
    // Spoken units, deliberately distinct from the banner's: a synthesiser reads "m" as the
    // LETTER m. Two outputs, not one duplicated.
    "navigation.voice.unit.metres": "metres",
    "navigation.voice.unit.kilometres": "kilometres",
    // {0} = the already-formatted distance, {1} = the manoeuvre. A pattern rather than a
    // concatenation: the two swap order between languages.
    "navigation.voice.ahead": "In {0}, {1}",
    "navigation.maneuver.unknown": "Carry on",
    "navigation.reroute.network":
        "Off route — cannot recompute without a network. Guidance continues on the prepared route.",
    "navigation.reroute.timeout":
        "Off route — the routing service did not answer in time. Retrying automatically.",
    "navigation.reroute.no-route": "Off route — no route from your position.",
    "navigation.reroute.refused": "Off route — recomputation refused by the service.",
    "navigation.reroute.http": "Off route — the routing service returned an error.",
    "navigation.reroute.malformed": "Off route — unreadable answer from the service.",
} satisfies Record<string, string>;

export default langTemplateEn;
