/*!
 * @geoleaf-plugins/routing — English dictionary
 *
 * The English counterpart of `lang-fr.ts`. A shape test asserts both files declare the SAME key
 * set — a key present on one side only resolves to nothing and falls back silently.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

// Keys MUST be flat and dotted ("<plugin>.toolbar.button"). `GeoLeaf.I18n.getLabel`
// indexes the merged table directly and never splits on "." — a nested dictionary
// resolves to nothing and silently falls back to French (audit C-5).
// `satisfies Record<string, string>` makes that a compile error rather than a
// runtime surprise; keep it.
const langTemplateEn = {
    "routing.toolbar.button": "Route",
    "routing.panel.title": "Route",
    "routing.panel.close": "Close",
    "routing.add.field": "Address or coordinates (lat, lon)",
    "routing.add.submit": "Add",
    "routing.add.pick": "Pick on the map",
    "routing.add.picking": "Click on the map…",
    "routing.add.notCoordinates": "Enter an address, or coordinates as “latitude, longitude”.",
    "routing.add.outOfRange":
        "Those coordinates are not a place: latitude runs −90 to 90, longitude −180 to 180.",
    "routing.add.noMatch": "No place matches that search.",
    "routing.add.searchFailed":
        "The address search did not answer. Try again, or enter coordinates.",
    "routing.panel.clear": "Clear route",
    "routing.panel.compute": "Compute",
    "routing.panel.startGuidance": "Start guidance",
    "routing.panel.empty": "No stops yet. Add a start and a destination.",
    "routing.step.origin": "Start",
    "routing.step.via": "Stop",
    "routing.step.destination": "Destination",
    "routing.step.moveUp": "Move this stop up",
    "routing.step.moveDown": "Move this stop down",
    "routing.step.remove": "Remove this stop",
    "routing.origin.you": "Your position",
    "routing.error.timeout": "The routing service did not answer in time. Try again.",
    "routing.error.network": "The request could not be sent. Check your connection.",
    "routing.error.http": "The routing service refused the request.",
    "routing.error.malformed": "The service answered something unreadable.",
    "routing.error.noRoute": "No route between these points.",
    "routing.error.refused": "The routing service configuration was refused.",
    "routing.error.capReached": "Maximum number of stops reached.",
    "routing.error.noLayer": "The profile declares no layer to draw the route on.",
    "routing.error.originDenied": "Position denied. Enter a starting point.",
    "routing.error.originNoFix": "Position not known yet. Try again or enter a starting point.",
    "routing.error.originUnavailable": "Geolocation is not available here.",
    "routing.origin.denied": "Position denied. Enter a starting point.",
    "routing.origin.noFix": "Position not known yet. Try again or enter a starting point.",
    "routing.origin.unavailable": "Geolocation is not available here.",
} satisfies Record<string, string>;

export default langTemplateEn;
