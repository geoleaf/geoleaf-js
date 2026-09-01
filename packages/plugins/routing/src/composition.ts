/*!
 * @geoleaf-plugins/routing — Itinerary composition
 *
 * The ordered list of waypoints an itinerary is made of, and the four operations that change it.
 * Pure: no DOM, no globals, no network. The panel drives it; it does not drive the panel.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Waypoint } from "./model.js";
import { getPluginConfig } from "./config.js";

/**
 * ## Why the step NUMBER is derived and never stored
 *
 * The requirement says a removal "renumbers the following ones", and a reorder does too. That
 * phrasing invites an `order` field on each waypoint, kept in step with the array — and that is
 * exactly the shape where renumbering becomes something you can forget. One code path updates the
 * array without touching the field, and the list renders "1, 2, 2, 4" with nothing to explain it.
 *
 * Here the number IS the position: `index + 1`, computed at the moment of display. Renumbering is
 * therefore not an operation at all, which is the only way to be sure it never goes wrong.
 *
 * ## Why every operation answers a REASON when it refuses
 *
 * An add beyond the cap, a move to nowhere, a removal of an index that is not there — each has
 * one right message, and a boolean `false` would collapse them into "it did not work". The cap in
 * particular is a configured limit, so the message must be able to say what the limit IS.
 */

/** What an operation answers. */
export type CompositionResult =
    | { readonly ok: true; readonly waypoints: readonly Waypoint[] }
    | { readonly ok: false; readonly reason: CompositionRefusal; readonly limit?: number };

/** Why an operation refused. */
export type CompositionRefusal =
    /** The cap on the number of waypoints was reached. `limit` carries it. */
    | "cap-reached"
    /** An index named a position the itinerary does not have. */
    | "no-such-index"
    /** A move whose source and target are the same — refused rather than silently ignored. */
    | "no-op";

/** The default cap, when the profile names none. */
export const DEFAULT_MAX_WAYPOINTS = 10;

/**
 * The configured cap on the number of waypoints.
 *
 * ⚠️ Read at CALL time, not at module load: a plugin loaded before `GeoLeaf.boot()` has merged
 * the profile would otherwise freeze the default, and the integrator's setting would do nothing.
 *
 * @returns The cap.
 */
export function maxWaypoints(): number {
    const v = getPluginConfig().maxWaypoints;
    // A cap below 2 cannot describe any itinerary — an origin and a destination are the minimum —
    // so a value that low is a configuration mistake and falls back rather than being honoured.
    return typeof v === "number" && Number.isFinite(v) && v >= 2
        ? Math.floor(v)
        : DEFAULT_MAX_WAYPOINTS;
}

/**
 * Appends a waypoint at the end of the list.
 *
 * @param waypoints The current list.
 * @param waypoint The point to append.
 * @param cap The maximum length. Defaults to the configured one.
 * @returns The new list, or the refusal.
 */
export function addWaypoint(
    waypoints: readonly Waypoint[],
    waypoint: Waypoint,
    cap: number = maxWaypoints()
): CompositionResult {
    if (waypoints.length >= cap) return { ok: false, reason: "cap-reached", limit: cap };
    return { ok: true, waypoints: [...waypoints, waypoint] };
}

/**
 * Removes the waypoint at `index`.
 *
 * ⚠️ Removing down to one waypoint, or to none, is ALLOWED. A one-point itinerary is not a route
 * and nothing will be computed from it, but refusing the removal would trap someone who wants to
 * replace their origin: they would have to add the new one first, which the cap may forbid.
 *
 * @param waypoints The current list.
 * @param index Position to remove.
 * @returns The new list, or the refusal.
 */
export function removeWaypoint(waypoints: readonly Waypoint[], index: number): CompositionResult {
    if (!Number.isInteger(index) || index < 0 || index >= waypoints.length) {
        return { ok: false, reason: "no-such-index" };
    }
    return { ok: true, waypoints: waypoints.filter((_, i) => i !== index) };
}

/**
 * Moves the waypoint at `from` to position `to`.
 *
 * This is what a drag-and-drop in the list performs. The numbers the user sees follow, because
 * they are read from the positions and never stored.
 *
 * @param waypoints The current list.
 * @param from Current position.
 * @param to Target position.
 * @returns The new list, or the refusal.
 */
export function moveWaypoint(
    waypoints: readonly Waypoint[],
    from: number,
    to: number
): CompositionResult {
    const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < waypoints.length;
    if (!valid(from) || !valid(to)) return { ok: false, reason: "no-such-index" };
    // Refused rather than answered with an unchanged list: a caller that redraws on `ok` would
    // otherwise repaint on every drag that ends where it started.
    if (from === to) return { ok: false, reason: "no-op" };

    const next = [...waypoints];
    const moved = next[from];
    // `from` was validated above, so this holds — but the compiler cannot see it and an
    // assertion here would be the kind that survives a later edit to the validation.
    if (!moved) return { ok: false, reason: "no-such-index" };
    next.splice(from, 1);
    next.splice(to, 0, moved);
    return { ok: true, waypoints: next };
}

/**
 * Empties the itinerary.
 *
 * @returns An empty list. Never refuses — clearing an empty itinerary is not an error, it is
 *          what the user asked for and it is already true.
 */
export function clearWaypoints(): CompositionResult {
    return { ok: true, waypoints: [] };
}

/**
 * Whether a list can be sent to a provider.
 *
 * @param waypoints The list.
 * @returns `true` from two waypoints up.
 */
export function isRoutable(waypoints: readonly Waypoint[]): boolean {
    return waypoints.length >= 2;
}

/**
 * The role a waypoint plays, from its position alone.
 *
 * ⚠️ Derived, like the number. A stored role would have to be updated on every add, remove and
 * move — and the one that gets forgotten is the destination, which stops being the last one.
 *
 * @param index Position in the list.
 * @param total Length of the list.
 * @returns The role.
 */
export function roleAt(index: number, total: number): "origin" | "via" | "destination" {
    if (index === 0) return "origin";
    if (index === total - 1) return "destination";
    return "via";
}
