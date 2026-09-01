/*!
 * @geoleaf-plugins/routing — Entry point from a POI
 *
 * Listens for the profile-declared action button and turns a clicked POI into a destination.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Waypoint } from "./model.js";
import { getPluginConfig } from "./config.js";

/**
 * ## Why the button is declared in the PROFILE and not here
 *
 * The seam already exists: `feature-info` renders an `action` widget on both the popup and the
 * side panel, from a single dispatch table, and its guard is written. Placing the button from the
 * plugin would mean the core referencing a plugin — the boundary the repository keeps.
 *
 * ## Why the POI becomes the DESTINATION and not a via
 *
 * The operator starts from a POI they are already looking at, and wants to go there. The original
 * specification made this a P2 convenience that "adds it as a stop"; that is the wrong way round —
 * adding a stop to an itinerary that does not exist yet has no meaning, and being taken to a
 * destination does.
 *
 * ## Why `close()` comes from the event and is never `FeatureInfo.close()`
 *
 * The detail carries a `close` closure that shuts **the surface the button was rendered in** —
 * the popup or the side panel, never both. `GeoLeaf.FeatureInfo.close()` closes both and emits a
 * panel-close event: a popup button calling it would shut an unrelated side panel and announce
 * something nobody did.
 *
 * ## What `payloadFields` costs if it is forgotten
 *
 * Without it, `properties` arrives as `{}` — the default goes to confidentiality, because this is
 * a document event any script on the page can hear. The destination would then carry coordinates
 * and no name, and the step list would read "Étape 2" with nothing beside it. The profile must
 * NAME the label field; this module reads which one from its own configuration.
 */

/** The slice of the action event this module reads. */
export interface ActionDetail {
    readonly actionId: string;
    readonly properties: Record<string, unknown>;
    readonly lngLat?: { readonly lat: number; readonly lng: number };
    readonly close?: () => void;
}

/** What the plugin answers to a click on its button. */
export type EntryOutcome =
    | { readonly ok: true; readonly destination: Waypoint }
    | { readonly ok: false; readonly reason: "not-ours" | "no-position" };

/** The `actionId` the profile must declare for this plugin's button. */
const ACTION_ID = "routing.destination";

/**
 * The `actionId` a profile must declare on its `feature-info` action widget.
 *
 * A function and not the constant, because the façade may only DELEGATE — `check-facade-purity`
 * refuses a member that returns a value rather than calling something, and it is right to: the
 * day this stops being a literal, a façade that had inlined it would be the one place nobody
 * thinks to look.
 *
 * @returns The identifier.
 */
export function actionId(): string {
    return ACTION_ID;
}

/**
 * Turns one action event into a destination.
 *
 * ⚠️ NOT exported. It was, "so it can be tested without a document" — and that reason does not
 * survive contact with what the test should assert: the listener is the thing that has to filter,
 * close the surface and hand over in the right ORDER, and a test that calls this alone proves
 * none of it. It is exercised through `wireEntryPoint` and a dispatched event instead.
 *
 * @param detail The event detail.
 * @returns The destination, or why this event is not one.
 */
function destinationFromAction(detail: ActionDetail): EntryOutcome {
    if (detail?.actionId !== ACTION_ID) return { ok: false, reason: "not-ours" };

    const ll = detail.lngLat;
    // No position, no destination. Answering with `[0, 0]` would route the user to the Gulf of
    // Guinea, which is a real place and therefore a route that succeeds.
    if (!ll || typeof ll.lng !== "number" || typeof ll.lat !== "number") {
        return { ok: false, reason: "no-position" };
    }

    const name = resolveName(detail.properties);

    return {
        ok: true,
        destination: { coordinates: [ll.lng, ll.lat], ...(name ? { name } : {}) },
    };
}

/**
 * Subscribes to the action event.
 *
 * @param onDestination Called with the destination when the button is this plugin's.
 * @returns A function that unsubscribes.
 */
export function wireEntryPoint(onDestination: (destination: Waypoint) => void): () => void {
    const listener = (e: Event): void => {
        const detail = (e as CustomEvent<ActionDetail>).detail;
        const res = destinationFromAction(detail);
        if (!res.ok) return;
        // Close the surface FIRST: the panel that opens next takes focus, and closing a popup
        // after something else has claimed focus returns it to nowhere.
        detail.close?.();
        onDestination(res.destination);
    };

    // ⚠️ A raw `document` listener and not `GeoLeaf.Events.on`: the detail carries a live DOM node
    // and two closures, so the key lives in the RAW event map. The sanitising bus would have
    // delivered them as `{}` and `undefined` — without any error.
    document.addEventListener("geoleaf:popup:action", listener);
    return () => document.removeEventListener("geoleaf:popup:action", listener);
}

/**
 * Which feature properties may carry the POI's label, in order of preference.
 *
 * Configurable because profiles differ, and because guessing is worse than asking: picking "the
 * first string property" would name a destination after a status code or an identifier, and the
 * user would have no way to know why.
 *
 * ⚠️ A LIST since 26/08/2026, and it is not a convenience. The button is declared PER LAYER in
 * the profile, while this setting is global to the plugin — so a profile whose layers spell
 * their label differently could only ever name one of them. Measured on the tourism profile:
 * `Name`, `title`, `name`, `ville`, `place`, `vernacularName` — six layers, six spellings. The
 * single-string form still works and means a list of one.
 *
 * @returns The candidate property names.
 */
function labelFields(): readonly string[] {
    const v = getPluginConfig().labelField;
    if (typeof v === "string" && v.length > 0) return [v];
    if (Array.isArray(v)) {
        const named = v.filter((k): k is string => typeof k === "string" && k.length > 0);
        if (named.length > 0) return named;
    }
    return ["name"];
}

/**
 * The destination name, from the first candidate property the feature actually carries.
 *
 * ⚠️ Reads what the event DELIVERED, which the profile's `payloadFields` has already filtered.
 * A candidate named here but absent from that white-list can never match — the two lists have
 * to agree, and nothing but this comment says so.
 *
 * @param properties The filtered property bag from the action event.
 * @returns The name, or `undefined` when no candidate is present and non-empty.
 */
function resolveName(properties: Record<string, unknown> | undefined): string | undefined {
    for (const field of labelFields()) {
        const raw = properties?.[field];
        if (typeof raw === "string" && raw.length > 0) return raw;
    }
    return undefined;
}
