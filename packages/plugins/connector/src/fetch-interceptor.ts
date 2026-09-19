/*!
 * GeoLeaf Connector — Fetch Interceptor
 * Monkey-patches window.fetch to inject Authorization headers on matching URLs.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { bearer, isSameOrigin } from "@geoleaf/host-runtime";
import type { ConnectorConfig } from "./config.js";
import { TokenStore } from "./token-store.js";
import type { RefreshOutcome } from "./token-store.js";
import { detectFormat } from "./format-detector.js";
import { armRenewalRetry } from "./renewal-retry.js";
import { isThenable, pullHostToken } from "./host-token.js";

// ─── State ────────────────────────────────────────────────────────────────────

// Capture the original fetch before any patching (globalThis.fetch is always available in browser)
const _originalFetch: typeof fetch = globalThis.fetch;

let _config: ConnectorConfig | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _extractUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
    return "";
}

/**
 * Returns true if the request URL should have a token injected via window.fetch.
 * Vector tiles (`mvt`, `pbf`) are left to the MapLibre bridge: MapLibre loads them in its own
 * worker, which this patch never sees.
 *
 * 🛑 **PMTiles archives are NOT — they were, and carried a token in neither mode.** The
 * `pmtiles` library reads an archive through THIS `fetch`, on the main thread; the bridge only
 * ever sees its `pmtiles://` URL, whose origin is `"null"` to `isSameOrigin`, and the protocol
 * ignores a request's headers anyway. Excluded here "because the bridge handles it", the archive
 * was handled by nobody.
 *
 * Origin validation is delegated to `isSameOrigin` (@geoleaf/host-runtime), the
 * single guard shared by every credential-injection point — window.fetch here,
 * the worker header hook, and the MapLibre tile bridge — so none can drift back
 * to the suffix-host leak `url.startsWith(baseUrl)` let through (bug no. 4).
 */
function _shouldIntercept(url: string): boolean {
    if (!_config) return false;
    if (!isSameOrigin(url, _config.baseUrl)) return false;
    // 🛑 THE AUTHENTICATION ENDPOINT IS OUT OF SCOPE, and it is not a convenience.
    // `AuthClient` posts to `${endpoint}` and `${endpoint}/refresh` through the GLOBAL
    // `fetch`, i.e. through this very patch. Intercepting it commits two faults at once:
    //   • it resolves a token — which, on the recovery path, means AWAITING the refresh
    //     promise that this very request is meant to settle. A deadlock, and one that no
    //     timeout of ours would name correctly;
    //   • it OVERWRITES the `Authorization` header the request already carries — the
    //     expired token it exists to present. The renewal would go out bearing the
    //     header of a token it is trying to replace.
    // Excluding it here rather than reaching for the pre-patch `fetch` keeps the rule
    // where the perimeter is decided, in one readable predicate.
    if (_config.auth?.endpoint && isSameOrigin(url, _config.auth.endpoint)) return false;
    return detectFormat(url) !== "mvt";
}

/**
 * Resolves the current token using either the getToken callback or TokenStore.
 * This is the single routing point for the two auth modes.
 */
async function _resolveToken(): Promise<string | null> {
    if (!_config) return null;
    if (_config.getToken) {
        return _config.getToken();
    }
    return TokenStore.getTokenAsync(_config.baseUrl);
}

/** The answer a request gets when its session could not be renewed. */
function _unauthorized(): Response {
    return new Response(null, { status: 401, statusText: "Unauthorized" });
}

/**
 * Handles a 401 response: attempts one token refresh, retries the request.
 * Never loops — a renewal is attempted once per request, and its verdict decides the session.
 *
 * @param input - The request, as the caller passed it.
 * @param init - Its init, the rejected `Authorization` included.
 * @param response - The 401 itself — returned untouched when there is no session at all.
 */
async function _handleUnauthorized(
    input: RequestInfo | URL,
    init: RequestInit,
    response: Response
): Promise<Response> {
    if (!_config) return _unauthorized();

    if (_config.getToken) {
        // App-managed token — simply re-call; it is the app's responsibility to rotate it
        let newToken: string | null = null;
        try {
            newToken = await Promise.resolve(_config.getToken());
        } catch {
            // ignore — fall through to error dispatch
        }
        if (newToken) return _retryWith(input, init, newToken);
        // The host has no token to give after a 401: its session is gone.
        _dispatchAuthError(
            _config.baseUrl,
            "Authentication failed — 401 after token refresh attempt."
        );
        return _unauthorized();
    }

    // 🛑 REFRESH FIRST, AND ERASE ONLY ON A REFUSAL — the order was the first fix, the verdict
    // is the second.
    //
    // This branch used to call `TokenStore.clear()` BEFORE any renewal, so the re-read that
    // followed found nothing and the refresh delegate was never reached: a session was
    // unrecoverable the moment it expired. It then erased on ANY failed renewal — a network
    // error or a 503 as surely as a refusal — so one minute of an unavailable authentication
    // server signed the device out. Only an explicit refusal ends a session now; a renewal
    // that could not conclude keeps it, and the 401 goes back to the caller (the core's drain
    // reads it as `authRequired` and waits for the session to come back).
    let outcome: RefreshOutcome;
    try {
        outcome = await TokenStore.forceRefresh(_config.baseUrl);
    } catch {
        // An exception proves nothing about the session — it is not a refusal.
        outcome = { verdict: "unavailable" };
    }

    switch (outcome.verdict) {
        case "renewed": {
            const replayed = await _retryWith(input, init, outcome.token);
            // The server refused the token it had just issued: no new renewal before the window
            // ends — else every 401 renewed, and every renewal resumed the queue.
            if (replayed.status === 401) TokenStore.holdRenewals(_config.baseUrl);
            return replayed;
        }
        case "refused":
            await TokenStore.declareSessionDead(
                _config.baseUrl,
                outcome.presented,
                "Authentication failed — 401, and the renewal was refused."
            );
            return _unauthorized();
        case "absent":
            // No session is stored: nothing to renew, and nothing died — `auth-error` would
            // reopen the login window on every protected request after a sign-out.
            return response;
        case "unavailable":
            // Kept — and retried at the moments the halted drain no longer listens to.
            armRenewalRetry(_config.baseUrl);
            return _unauthorized();
        case "superseded":
            return _unauthorized();
    }
}

/**
 * The init a request is sent with once `token` is injected — with the semantics of `fetch`
 * itself: `init.headers` when given (they REPLACE a `Request`'s own, as `fetch` would), else
 * the `Request`'s headers; then `Authorization`.
 *
 * 🛑 The headers used to be spread as a plain object, `{ ...init.headers }` — which EMPTIES a
 * `Headers` instance. Invisible while nothing intercepted sent one; fatal for a PMTiles archive,
 * whose `Range` travels in a `Headers` object: without it the server sends the whole archive,
 * and the reader refuses it. And a `Request`'s own headers were replaced by `Authorization`
 * alone.
 */
function _withAuthorization(
    input: RequestInfo | URL,
    init: RequestInit,
    token: string
): RequestInit {
    const headers = new Headers(
        init.headers !== undefined
            ? init.headers
            : input instanceof Request
              ? input.headers
              : undefined
    );
    headers.set("Authorization", bearer(token));
    return { ...init, headers };
}

/** Replays a request once, with a new token — every other header it carried kept. */
function _retryWith(input: RequestInfo | URL, init: RequestInit, token: string): Promise<Response> {
    return _originalFetch(input, _withAuthorization(input, init, token));
}

/** Tells the host its session ended — `geoleaf:connector:auth-error`. */
function _dispatchAuthError(baseUrl: string, error: string): void {
    if (typeof document === "undefined") return;
    document.dispatchEvent(
        new CustomEvent("geoleaf:connector:auth-error", { detail: { baseUrl, error } })
    );
}

// ─── Install / Uninstall ──────────────────────────────────────────────────────

/**
 * Installs the window.fetch monkey-patch.
 * All requests starting with config.baseUrl (except MVT/PMTiles) will have
 * an Authorization: Bearer <token> header injected.
 */
export function install(config: ConnectorConfig): void {
    _config = config;

    globalThis.fetch = async function (
        input: RequestInfo | URL,
        init: RequestInit = {}
    ): Promise<Response> {
        const url = _extractUrl(input);

        if (_shouldIntercept(url)) {
            const token = await _resolveToken();
            // A `Request` carrying a body is spent by its first send: the 401 replay needs a
            // fresh one, taken BEFORE that send.
            const replayable =
                input instanceof Request && input.body !== null ? input.clone() : input;
            if (token) init = _withAuthorization(input, init, token);
            const response = await _originalFetch(input, init);
            if (response.status === 401) {
                return _handleUnauthorized(replayable, init, response);
            }
            return response;
        }

        return _originalFetch(input, init);
    };

    // Warn for static (non-JWT) tokens — dev/demo indicator (§16 S6)
    if (config.getToken) {
        const maybeToken = config.getToken();
        const checkToken = (t: string | null) => {
            if (t && !t.includes(".")) {
                console.warn(
                    "[GeoLeaf Connector] Static token detected. " +
                        "This provides NO real security — use only for dev/demo with non-sensitive data."
                );
            }
        };
        if (maybeToken instanceof Promise) {
            maybeToken.then(checkToken).catch(() => {
                /* ignore */
            });
        } else {
            checkToken(maybeToken);
        }
    }
}

/**
 * Restores window.fetch to its original implementation and removes the Worker hook.
 * Called by `configure()` when it replaces the connector already installed.
 */
export function uninstall(): void {
    globalThis.fetch = _originalFetch;
    // Remove the Worker headers hook `configure()` installed
    delete (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"];
    _config = null;
}

/** What the core says its worker header hook can take — the hook's second argument. */
interface HookCapabilities {
    /** Set by a core that posts the worker's request once a promised answer settles. */
    readonly acceptsPromise?: boolean;
}

/** The `Authorization` header for `token`, or none. */
function _authorization(token: string | null): Record<string, string> | undefined {
    return token ? { Authorization: bearer(token) } : undefined;
}

/**
 * Returns Authorization headers for a given URL if it falls within the baseUrl scope.
 * Called via the __GEOLEAF_WORKER_HEADERS_HOOK__ global hook from worker-manager.ts.
 *
 * - `auth.endpoint` mode: the memory cache only — IndexedDB is never read on this path.
 * - `getToken` mode: the host's token, PULLED at each load (it read the plugin's store, which
 *   the host never fills: every GeoJSON layer loaded by URL left without the host's token). A
 *   synchronous provider answers synchronously; an asynchronous one yields a promise — but ONLY
 *   to a core that announced it takes one: an older core hands the answer to `postMessage`,
 *   which cannot clone a promise, and gets no header instead.
 *
 * @param url - The URL the worker is about to fetch.
 * @param config - The connector's configuration.
 * @param capabilities - What the calling core accepts (its second argument to the hook).
 * @returns The headers, a promise of them, or `undefined` for a URL out of scope.
 */
export function getWorkerHeaders(
    url: string,
    config: ConnectorConfig,
    capabilities?: HookCapabilities
): Record<string, string> | undefined | Promise<Record<string, string> | undefined> {
    if (!isSameOrigin(url, config.baseUrl)) return undefined;
    if (!config.getToken) return _authorization(TokenStore.getTokenSync(config.baseUrl));
    const pulled = pullHostToken(config.getToken);
    if (!isThenable(pulled)) return _authorization(pulled);
    return capabilities?.acceptsPromise === true ? pulled.then(_authorization) : undefined;
}
