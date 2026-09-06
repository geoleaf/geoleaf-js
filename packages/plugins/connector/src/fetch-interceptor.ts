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
import { detectFormat } from "./format-detector.js";

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
 * MVT and PMTiles are routed to the MapLibre bridge instead.
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
    const fmt = detectFormat(url);
    return fmt !== "pmtiles" && fmt !== "mvt";
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

/**
 * Handles a 401 response: attempts one token refresh, retries the request.
 * Never loops — if refresh fails, emits connector:auth-error and returns a synthetic 401.
 */
async function _handleUnauthorized(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    if (!_config) return new Response(null, { status: 401, statusText: "Unauthorized" });

    let newToken: string | null = null;

    try {
        if (_config.getToken) {
            // App-managed token — simply re-call; it is the app's responsibility to rotate it
            newToken = await Promise.resolve(_config.getToken());
        } else {
            // 🛑 REFRESH FIRST, ERASE ONLY AFTER — the order IS the fix.
            //
            // This branch used to call `TokenStore.clear()` under a comment claiming it
            // "forces an IDB re-read by clearing the RAM cache". It clears BOTH, so the
            // re-read that followed found nothing, `getTokenAsync` fell to its "no token
            // at all" branch, and the refresh delegate was never reached. A session was
            // therefore unrecoverable the moment it expired — and worse for a field
            // drain: from that entry on, no request carried an `Authorization` header at
            // all, so the rest of the queue burned its budget against a server that
            // could only answer 401.
            newToken = await TokenStore.forceRefresh(_config.baseUrl);
            if (!newToken) {
                // Now — and only now — the stored token is proven dead. Keeping it would
                // have it presented indefinitely on every later request.
                await TokenStore.clear(_config.baseUrl);
            }
        }
    } catch {
        // ignore — fall through to error dispatch
    }

    if (newToken) {
        const headers: Record<string, string> = {
            ...(init.headers as Record<string, string>),
            Authorization: bearer(newToken),
        };
        return _originalFetch(input, { ...init, headers });
    }

    // Refresh failed — notify and return 401 without looping
    if (typeof document !== "undefined") {
        document.dispatchEvent(
            new CustomEvent("geoleaf:connector:auth-error", {
                detail: {
                    baseUrl: _config.baseUrl,
                    error: "Authentication failed — 401 after token refresh attempt.",
                },
            })
        );
    }

    return new Response(null, { status: 401, statusText: "Unauthorized" });
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
            if (token) {
                init = {
                    ...init,
                    headers: {
                        ...(init.headers as Record<string, string>),
                        Authorization: bearer(token),
                    },
                };
            }
            const response = await _originalFetch(input, init);
            if (response.status === 401) {
                return _handleUnauthorized(input, init);
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
 * Called by ConnectorInstance.destroy().
 */
export function uninstall(): void {
    globalThis.fetch = _originalFetch;
    // Remove Worker headers hook installed by entry.ts
    delete (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"];
    _config = null;
}

/**
 * Returns Authorization headers for a given URL if it falls within the baseUrl scope.
 * Called via the __GEOLEAF_WORKER_HEADERS_HOOK__ global hook from worker-manager.ts.
 * Uses only the RAM cache (sync) — IDB is never accessed in this path.
 */
export function getWorkerHeaders(url: string, baseUrl: string): Record<string, string> | undefined {
    if (!isSameOrigin(url, baseUrl)) return undefined;
    const token = TokenStore.getTokenSync(baseUrl);
    if (!token) return undefined;
    return { Authorization: bearer(token) };
}
