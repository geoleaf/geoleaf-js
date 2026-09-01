/*!
 * @geoleaf-plugins/routing — Not asking twice
 *
 * A computed route, kept until a dozen newer ones push it out, so an identical request is free.
 *
 * ⚠️ This line said « kept for as long as the page lives » until the closing review, and it
 * contradicted `MAX_ENTRIES` three screens below. A header that promises more than the code
 * holds is the kind of sentence nobody re-reads once it sounds right.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteRequest, RouteResult } from "./model.js";

/**
 * ## 🛑 What this is actually for, which is NOT what the backlog line said
 *
 * The line said: *"a composition modified three times in a row emits three full computations"*.
 * **Measured, it emits none.** `compute()` is reached from one place — the panel's compute button.
 * Editing the list clears the drawn route and stops there; nothing recomputes on change.
 *
 * What DOES spend quota, measured on the same pass:
 *
 * - **pressing the button again** on an unchanged itinerary, which people do after a failure, after
 *   a slow answer, or simply twice;
 * - **recomputing after a round trip** — add a stop, remove it, press again.
 *
 * The cache answers both. It is a smaller win than the line claimed and a real one, and saying so
 * is the point: a mitigation justified by a burst that cannot happen is a mitigation nobody can
 * check.
 *
 * ## Why the key carries the language
 *
 * The narrative comes from the engine, in the language it was asked for. A key without it would
 * serve a French driver the English instructions computed a minute earlier — the same route, the
 * wrong voice, and nothing on screen to explain it.
 *
 * ## Why coordinates are rounded into the key
 *
 * A stop picked on the map carries full float precision, so re-picking the "same" place yields a
 * different key and the cache never hits. Rounded to about a metre, the key is stable against the
 * jitter of a click and still distinguishes two genuinely different stops.
 *
 * ## Why there is no expiry
 *
 * A route between fixed points does not change within a session for the engines this package
 * ships, which compute in free flow. ⚠️ **It would change for a traffic-aware engine** — and that
 * is exactly when this cache becomes wrong rather than merely stale. The day one is added, this
 * paragraph is the thing to come back to.
 */

/** How many routes are kept. Beyond it the oldest goes. */
const MAX_ENTRIES = 12;

/** Decimals kept per coordinate in the key — about a metre. */
const KEY_PRECISION = 5;

/** The kept routes, oldest first — a `Map` preserves insertion order, which is the whole LRU. */
const entries = new Map<string, RouteResult>();

/**
 * The cache key for a request.
 *
 * @param request What is being asked.
 * @returns A stable string. Two requests that differ in stops, order, mode or language differ
 *          here — and two that differ only in float noise do not.
 */
export function routeKey(request: RouteRequest): string {
    const stops = request.waypoints
        .map(
            (w) =>
                `${w.coordinates[0].toFixed(KEY_PRECISION)},${w.coordinates[1].toFixed(KEY_PRECISION)}`
        )
        .join("|");
    // ⚠️ The order is part of the key and must be: reversing the stops is a different journey, and
    // a provider answers it differently. `roleAt` derives origin and destination from position for
    // the same reason.
    return `${request.profile}/${request.language ?? ""}/${stops}`;
}

/**
 * The cached route for `request`, if there is one.
 *
 * @param request What is being asked.
 * @returns The route, or `undefined`.
 */
export function cachedRoute(request: RouteRequest): RouteResult | undefined {
    const key = routeKey(request);
    const hit = entries.get(key);
    if (!hit) return undefined;
    // Re-inserted so it counts as recently used: without this the map is insertion-ordered only,
    // and the route someone keeps recomputing would be the first one evicted.
    entries.delete(key);
    entries.set(key, hit);
    return hit;
}

/**
 * Remembers `route` as the answer to `request`.
 *
 * @param request What was asked.
 * @param route What came back.
 */
export function rememberRoute(request: RouteRequest, route: RouteResult): void {
    const key = routeKey(request);
    entries.delete(key);
    entries.set(key, route);
    while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
    }
}

/**
 * Empties the cache.
 *
 * Exists for the tests and for a host that changes provider at runtime — routes computed by one
 * engine must not be served as another's, if only because their attribution differs.
 */
export function clearRouteCache(): void {
    entries.clear();
}

/**
 * How many routes are held.
 *
 * @returns The count. Read by the request-count probe, which is the only thing that makes
 *          "the cache works" checkable rather than merely asserted.
 */
export function routeCacheSize(): number {
    return entries.size;
}
