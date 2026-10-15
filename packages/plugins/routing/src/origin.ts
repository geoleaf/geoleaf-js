/*!
 * @geoleaf-plugins/routing — "Your position" as an origin
 *
 * Reads the core's geolocation state and turns it into a waypoint, or says why it could not.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { isGeolocationEnabled, requestUserPosition } from "@geoleaf/host-runtime";
import type { Waypoint } from "./model.js";

/**
 * ## Why this reads the CORE's state and never `navigator.geolocation`
 *
 * The core already owns a geolocation capability: it holds the permission, the watch, and the
 * last known fix. Asking the browser a second time from here would open a second watch, prompt a
 * second time on some browsers, and give two answers that drift apart — with no way for a user to
 * tell which one the route was computed from. The core is read through `@geoleaf/host-runtime`,
 * which declares its state ONCE: this module used to declare its own — `permission`, `position`,
 * `coordinates`, three names the core never had —, and « your position » answered `no-fix`
 * whatever the watch, with no test turning red, the tests faking the same wrong shape.
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
    /** The core exposes no geolocation capability — the host is older, or the profile turns it off. */
    | "unavailable"
    /** The user declined, or the browser refuses. Manual entry stays open. */
    | "denied"
    /** No fix came — no device, or too slow. Retrying later may work. */
    | "no-fix";

/**
 * The user's position as a waypoint — switching the core's GPS on when it is off.
 *
 * @param label What to call it in the step list. Passed in rather than hard-coded so the caller
 *              can use the interface language — this module holds no strings.
 * @returns The waypoint, or why not.
 */
export async function originFromUserPosition(label: string): Promise<OriginOutcome> {
    if (!isGeolocationEnabled()) return { ok: false, reason: "unavailable" };
    const fix = await requestUserPosition();
    if (fix) return { ok: true, waypoint: { coordinates: [fix.lng, fix.lat], name: label } };
    return { ok: false, reason: (await permissionDenied()) ? "denied" : "no-fix" };
}

/**
 * Whether the browser holds the geolocation permission as refused.
 *
 * ⚠️ Asked only AFTER no fix came, and only to name the refusal: the core stops its watch with
 * `active: false` on a refusal and on a timeout alike, and tells them apart to nobody. The
 * Permissions API reads the answer the user gave; it asks the device nothing.
 *
 * @returns `true` on a refusal; `false` when the answer is anything else, or cannot be read.
 */
async function permissionDenied(): Promise<boolean> {
    try {
        const status = await globalThis.navigator?.permissions?.query({ name: "geolocation" });
        return status?.state === "denied";
    } catch {
        return false;
    }
}
