/*!
 * @geoleaf-plugins/isochrone — English dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * English dictionary for `@geoleaf-plugins/isochrone`.
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
const langTemplateEn = {
    "isochrone.toolbar.button": "Isochrones",
    "isochrone.panel.title": "Isochrones",
    "isochrone.panel.close": "Close the window",
    "isochrone.panel.collapse": "Collapse the window",
    "isochrone.panel.expand": "Expand the window",
    "isochrone.form.mode": "Mode",
    "isochrone.form.durations": "Duration",
    "isochrone.form.minutes": "{minutes} min",
    "isochrone.form.pick": "Place the point",
    "isochrone.form.myPosition": "My position",
    "isochrone.form.cancel": "Cancel",
    "isochrone.origin.label": "Starting point",
    "isochrone.mode.car": "Car",
    "isochrone.mode.foot": "On foot",
    "isochrone.mode.bike": "Bike",
    "isochrone.status.computing": "Computing…",
    "isochrone.status.locating": "Finding your position…",
    "isochrone.status.picking": "Click on the map to place the point — Escape to cancel",
    "isochrone.status.done": "Zones added: {count}",
    "isochrone.status.cancelled": "Computation cancelled",
    "isochrone.status.cleared": "All zones removed",
    "isochrone.list.label": "Zones displayed",
    "isochrone.list.empty": "No zone displayed",
    "isochrone.list.clear": "Remove all",
    "isochrone.list.row": "{minutes} min · {mode}",
    "isochrone.list.color": "Colour — {row}",
    "isochrone.list.opacity": "Opacity — {row}",
    "isochrone.list.hide": "Hide — {row}",
    "isochrone.list.up": "Move up — {row}",
    "isochrone.list.down": "Move down — {row}",
    "isochrone.list.remove": "Remove — {row}",
    "isochrone.list.moved": "{row}: rank {rank} of {count}",
    "isochrone.error.timeout": "The engine did not answer in time",
    "isochrone.error.network": "The engine cannot be reached — network, address or refused key",
    "isochrone.error.http": "The engine refused the request (status {status})",
    "isochrone.error.httpCode": "The engine refused the request (status {status}, code {code})",
    "isochrone.error.malformed": "The engine's answer cannot be read",
    "isochrone.error.noEngine": "No routing engine is configured",
    "isochrone.error.noMap": "No map is displayed",
    "isochrone.error.busy": "A computation is already running",
    "isochrone.error.tooLong": "Duration limited to {limit} minutes by this engine",
    "isochrone.error.capReached": "Limit of {limit} layers reached",
    "isochrone.error.invalid":
        "The request cannot be read: check the point, the mode and the durations",
    "isochrone.error.noDuration": "Tick at least one duration",
    "isochrone.error.noPosition": "Position unavailable — GPS refused, missing or too slow",
} satisfies Record<string, string>;

export default langTemplateEn;
