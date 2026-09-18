/*!
 * GeoLeaf Connector — the host's token, pulled for the paths that cannot fail with it
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The host's token for the GeoJSON worker and the tile bridge — pulled, never kept.
 *
 * In `getToken` mode the token belongs to the host, and the plugin keeps no copy of it: it is
 * PULLED at each request (`ConnectorConfig.getToken`). The page's `fetch` lets a provider's
 * failure through — the request rejects, and the core's drain reads that as the network failing.
 * The two other paths cannot: an exception inside MapLibre's `transformRequest`, or inside the
 * core's worker manager, would fail a load for a reason that is not the network's. There, a
 * provider that throws, rejects, or answers anything but a non-empty string gives NO token, and
 * the request goes without one — when the host can answer again, the next request carries it.
 *
 * ⚠️ **The answer keeps the provider's timing.** A synchronous provider is answered
 * synchronously, so that a path which cannot wait — a MapLibre older than 5.21, a core older than
 * the worker hook's capability argument — still gets the token; an asynchronous one yields a
 * promise, which each caller hands on only where it is awaited.
 */

/** Reported once per page: a provider failing offline fails for every tile. */
let _reported = false;

function _report(error: unknown): void {
    if (_reported) return;
    _reported = true;
    console.warn(
        "[GeoLeaf Connector] getToken failed — requests go without a token until it answers:",
        error
    );
}

/** A usable token, or `null`. */
function _asToken(value: unknown): string | null {
    return typeof value === "string" && value !== "" ? value : null;
}

/**
 * True for anything a `then` can be chained on — a promise from another realm, or a thenable an
 * SDK returns, fails `instanceof Promise`.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { then?: unknown }).then === "function"
    );
}

/**
 * Pulls the host's token — synchronously when the provider answers synchronously, as a promise
 * otherwise. Never throws, and the promise never rejects: a failure is `null`.
 *
 * @param getToken - The host's provider (`ConnectorConfig.getToken`).
 * @returns The token, or `null` when there is none to present.
 */
export function pullHostToken(
    getToken: () => string | null | Promise<string | null>
): string | null | Promise<string | null> {
    let answer: unknown;
    try {
        answer = getToken();
    } catch (error) {
        _report(error);
        return null;
    }
    if (!isThenable(answer)) return _asToken(answer);
    return Promise.resolve(answer).then(_asToken, (error: unknown) => {
        _report(error);
        return null;
    });
}
