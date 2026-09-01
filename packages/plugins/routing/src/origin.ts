/*!
 * @geoleaf-plugins/routing — "Your position" as an origin
 *
 * Reads the core's geolocation state and turns it into a waypoint, or says why it could not.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Waypoint } from "./model.js";

/**
 * ## Why this reads the CORE's state and never `navigator.geolocation`
 *
 * The core already owns a geolocation capability: it holds the permission, the watch, and the
 * last known fix. Asking the browser a second time from here would open a second watch, prompt a
 * second time on some browsers, and give two answers that drift apart — with no way for a user to
 * tell which one the route was computed from.
 *
 * ## Why a refusal is not an error
 *
 * A user who declines the permission has answered the question. The panel must say so and keep
 * going: **manual entry stays available at all times**, and a plugin that made "your position"
 * the only way in would have made a route impossible for anyone who said no once.
 */

/** What asking for the user's position answers. */
export type OriginOutcome =
    | { readonly ok: true; readonly waypoint: Waypoint }
    | { readonly ok: false; readonly reason: OriginRefusal };

/** Why the position could not be used. */
export type OriginRefusal =
    /** The core exposes no geolocation capability — the host is older, or it is disabled. */
    | "unavailable"
    /** The user declined, or the browser refuses. Manual entry stays open. */
    | "denied"
    /** Permission is there, but no fix has been acquired yet. Retrying later may work. */
    | "no-fix";

/** The slice of the core's geolocation state this reads. */
interface GeolocationState {
    /** Whether the capability holds a usable permission. */
    readonly permission?: string;
    /** Last known position, when one has been acquired. */
    readonly position?: { readonly lng?: number; readonly lat?: number } | null;
    /** Some hosts expose the raw pair instead. */
    readonly coordinates?: readonly number[] | null;
}

/**
 * The user's position as a waypoint.
 *
 * @param label What to call it in the step list. Passed in rather than hard-coded so the caller
 *              can use the interface language — this module holds no strings.
 * @returns The waypoint, or why not.
 */
export function originFromUserPosition(label: string): OriginOutcome {
    const geo = (globalThis as { GeoLeaf?: { Geolocation?: { getState?(): GeolocationState } } })
        .GeoLeaf?.Geolocation;
    if (typeof geo?.getState !== "function") return { ok: false, reason: "unavailable" };

    const state = geo.getState();
    // `denied` is checked BEFORE the fix: a denied permission with a stale fix from an earlier
    // session would otherwise route from a place the user has revoked access to.
    if (state?.permission === "denied") return { ok: false, reason: "denied" };

    const coordinates = readCoordinates(state);
    if (!coordinates) return { ok: false, reason: "no-fix" };

    return { ok: true, waypoint: { coordinates, name: label } };
}

/**
 * `[longitude, latitude]` from whichever shape the host exposes.
 *
 * ⚠️ Two shapes are read because two exist: `position: {lng, lat}` and a raw `coordinates` pair.
 * Reading only one would work on the host it was written against and answer `no-fix` forever on
 * the other — a failure that looks like a permission problem and is not one.
 *
 * @param state The core's geolocation state.
 * @returns The pair, or `null` when neither shape carries a usable one.
 */
function readCoordinates(state: GeolocationState | undefined): [number, number] | null {
    const p = state?.position;
    if (p && typeof p.lng === "number" && typeof p.lat === "number") {
        return [p.lng, p.lat];
    }
    const c = state?.coordinates;
    if (Array.isArray(c) && c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") {
        return [c[0], c[1]];
    }
    return null;
}
