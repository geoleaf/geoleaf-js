/*!
 * @geoleaf-plugins/routing — Provider transport
 *
 * The one place a routing engine is actually called over the network, and the one place a
 * failure is turned into a reason the caller can act on.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteFailure } from "../model.js";

/**
 * ## Why the failures are NAMED and not collapsed
 *
 * A route that does not come back has at least four causes, and they call for four different
 * things from the person in front of the screen:
 *
 * - **timeout** — the engine is slow or unreachable: retrying may work.
 * - **http** — the engine answered, and refused. A 429 is a quota; a 400 is a bad request. The
 *   user can do nothing about either, but the message must not suggest they can.
 * - **malformed** — the engine answered something this adapter cannot read. That is a bug on one
 *   of the two sides, and it must not look like "no route exists".
 * - **no-route** — an ordinary answer. Two points on different islands have no route, and telling
 *   the user "an error occurred" would be a lie.
 *
 * 🛑 **Collapsing them into `null` was the sprint-1 contract, and it was wrong** — not because it
 * loses information in the abstract, but because every one of the four ends up rendered as the
 * same sentence, and three of those sentences would be false.
 */

/** What a transport call answers. */
export type FetchOutcome =
    | { readonly ok: true; readonly body: unknown }
    | { readonly ok: false; readonly reason: RouteFailure; readonly status?: number };

/** Default time a routing engine is given to answer, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Calls a routing engine and reads its JSON body.
 *
 * ⚠️ The timeout is enforced with an `AbortController` and NOT with a racing promise: a race
 * leaves the request running, so a slow engine keeps a connection and a quota slot for a response
 * nobody will read. Aborting is what makes a timeout cost the engine nothing.
 *
 * @param url Absolute URL. Callers are expected to have gone through `resolveEndpoint`, which is
 *            what refuses anything that is not HTTPS.
 * @param init Request init, minus the signal.
 * @param timeoutMs How long the engine is given.
 * @returns The parsed body, or a named reason.
 */
export async function fetchRouteJson(
    url: string,
    init: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<FetchOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (!res.ok) return { ok: false, reason: "http", status: res.status };
        try {
            return { ok: true, body: await res.json() };
        } catch {
            // A 200 whose body is not JSON. Distinct from `http` on purpose: the engine believed
            // it answered, so the fault is in the shape, not in the request.
            return { ok: false, reason: "malformed" };
        }
    } catch (err) {
        // `AbortError` is the timeout we armed; anything else is the network refusing. They are
        // reported apart because only the first is worth retrying unchanged.
        const aborted = err instanceof Error && err.name === "AbortError";
        return { ok: false, reason: aborted ? "timeout" : "network" };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The credit both built-in engines owe, because both route on the same data.
 *
 * 🛑 **Shared rather than written twice, and that is the point of putting it here.** Two copies of
 * a legal notice drift: one gets a typo fixed, the other keeps it, and the map that shows the
 * stale one is still the map that ships. The ODbL wording is not ours to paraphrase per adapter.
 *
 * ⚠️ It credits **OpenStreetMap**, not the engine. Valhalla and OSRM are MIT and BSD software;
 * what requires attribution is the DATA they route on. An integrator pointing `endpoint` at an
 * instance fed with something else must register their own provider with their own credit — which
 * is exactly why `attribution` is a required field of `IRouteProvider` and not a constant.
 */
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
