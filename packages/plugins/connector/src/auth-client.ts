/*!
 * GeoLeaf Connector — Auth Client
 * HTTP calls to the authentication endpoint.
 * Credentials are never stored or logged.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { jsonHeaders, bearer, fetchWithTimeout, HttpFetchError } from "@geoleaf/host-runtime";

/** Thrown when authentication or refresh fails. */
export class AuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AuthError";
    }
}

interface AuthResponse {
    token: string;
    expiresIn: number;
}

/**
 * How long one exchange with the authentication endpoint may take.
 *
 * ⚠️ It bounds the WHOLE exchange, body included — a renewal and a sign-in alike.
 * `fetchWithTimeout` stops its clock once the headers arrive, and a body that stalls after them
 * held the renewal — hence every request that joins it — or the login window, for as long as
 * the connection stayed open.
 *
 * The token store also reads it as the pause between two renewal attempts during an outage:
 * one attempt per exchange window, a figure that is the exchange's own and not a second one.
 */
export const EXCHANGE_TIMEOUT_MS = 15000;

/**
 * The statuses after which a renewal is worth trying again — the server is there and says
 * "not now".
 *
 * ⚠️ **Written twice, and held equal by a guard.** The core's write drain waits out the same
 * statuses (`TRANSIENT_SERVER_STATUSES`, `capabilities/offline/write/push-engine.ts`), and
 * neither side may import the other: this plugin never imports the core, and the core does not
 * import `@geoleaf/host-runtime`. The core guard `renewal-transient-statuses.guard.test.ts`
 * fails the day the two lists differ. `501` is absent on purpose: "not implemented" does not
 * pass with time.
 */
const TRANSIENT_RENEWAL_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/**
 * What a renewal attempt concluded — the session's fate is decided from it.
 *
 * - `renewed` — a readable 2xx: the new token and its lifetime.
 * - `unavailable` — the exchange did not conclude IN TRANSIT: no network, the time budget
 *   spent, a body cut or stalled, or one of {@link TRANSIENT_RENEWAL_STATUSES}. Waiting may
 *   fix it, so the session is kept.
 * - `refused` — the server answered and the answer cannot renew: any other non-2xx (401, 403,
 *   404 when no renewal is offered, 501…), or a 2xx received whole but unusable — HTML,
 *   another JSON shape, an `expiresIn` that is not a positive number. Under HTTPS such a body
 *   comes from the server or its proxy: a permanent misconfiguration, which waiting will not
 *   fix — keeping the session would lock the device out with no login window.
 */
type RefreshResult =
    | { readonly verdict: "renewed"; readonly token: string; readonly expiresIn: number }
    | { readonly verdict: "refused"; readonly status: number; readonly reason: string }
    | { readonly verdict: "unavailable"; readonly reason: string };

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Reads what a sign-in answered, within what is left of the exchange's budget.
 *
 * The body is held to the rules of a renewal ({@link _sessionFrom}): a token that is not a
 * string, or a lifetime that is not a positive number, would be stored already expired.
 */
async function _parseAuthResponse(response: Response, deadline: number): Promise<AuthResponse> {
    if (response.status === 401) {
        throw new AuthError("Invalid credentials");
    }
    if (response.status === 404) {
        throw new AuthError("Endpoint not found (404)");
    }
    if (response.status >= 500) {
        throw new AuthError("Server error (" + response.status + ")");
    }
    if (!response.ok) {
        throw new AuthError("Authentication failed (" + response.status + ")");
    }
    let text: string;
    try {
        text = await _readWithin(response, deadline);
    } catch {
        // Cut or stalled in transit: the same class as a network error.
        throw new AuthError("Network unavailable");
    }
    const session = _sessionFrom(text);
    if (!session) {
        throw new AuthError("Invalid server response: missing token or expiresIn");
    }
    return session;
}

/**
 * Reads the whole body within what is left of the exchange's budget.
 *
 * ⚠️ It does not cancel a body that stalls — `text()` holds the stream's lock — it stops
 * WAITING for it. The race keeps the late read handled, so its eventual rejection cannot
 * surface as an unhandled one.
 */
async function _readWithin(response: Response, deadline: number): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () => reject(new HttpFetchError("timeout", "response body timed out")),
            Math.max(0, deadline - Date.now())
        );
    });
    try {
        return await Promise.race([response.text(), expired]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The session a body carries — `null` when it carries none a client could use. One rule for
 * the two exchanges: what a renewal refuses, a sign-in refuses too.
 */
function _sessionFrom(text: string): AuthResponse | null {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof data !== "object" || data === null) return null;
    const { token, expiresIn } = data as { token?: unknown; expiresIn?: unknown };
    if (typeof token !== "string" || token === "") return null;
    if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
    return { token, expiresIn };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * The two exchanges with the authentication endpoint — sign-in and renewal.
 *
 * Pairs with {@link TokenStore}, which holds what this obtains: this module talks to the
 * network and never persists, the store persists and never talks to the network. The split
 * is what lets a token be restored at boot without a round trip. Signing out needs no
 * exchange: it is the store's erasure (`logout()` in `connector-api.ts`).
 */
export const AuthClient = {
    /**
     * Authenticates with login + password against the endpoint.
     * Returns the token and expiresIn so the caller can store via TokenStore.save().
     *
     * The whole exchange is bounded by {@link EXCHANGE_TIMEOUT_MS}, body included, and the
     * answer is held to the rules of a renewal: a non-string token, or a lifetime that is not
     * a positive number, is refused rather than stored.
     *
     * @throws AuthError `"Invalid credentials"` on a 401, `"Network unavailable"` when the
     *   exchange does not conclude in time or in transit, another message otherwise.
     *
     * Security: password string is overwritten before the function returns.
     */
    async login(endpoint: string, login: string, password: string): Promise<AuthResponse> {
        const deadline = Date.now() + EXCHANGE_TIMEOUT_MS;
        let pwd = password;
        try {
            let response: Response;
            try {
                response = await fetchWithTimeout(
                    fetch,
                    endpoint,
                    {
                        method: "POST",
                        headers: jsonHeaders(),
                        body: JSON.stringify({ login, password: pwd }),
                    },
                    EXCHANGE_TIMEOUT_MS
                );
            } catch {
                throw new AuthError("Network unavailable");
            }
            return await _parseAuthResponse(response, deadline);
        } finally {
            // Overwrite password in memory after use (OWASP A02).
            // The write has no data-flow purpose — nothing reads `pwd` afterwards,
            // which is exactly what `no-useless-assignment` detects. Its purpose is
            // memory hygiene, so removing it would drop a security measure the rule
            // cannot see. Directive must stay glued to the statement below.
            // eslint-disable-next-line no-useless-assignment
            pwd = "";
        }
    },

    /**
     * Renews a token via `POST {endpoint}/refresh`, and says what the attempt concluded.
     *
     * 🛑 **It never throws, and it never answers with a bare `null`.** Every failure used to
     * come back as the same `null` — a network error, a 503 and a refusal alike — and the
     * caller erased the session on it: one minute of an unavailable authentication server
     * signed the device out. The caller now decides from a {@link RefreshResult}, where only a
     * refusal ends a session.
     *
     * @param endpoint - The authentication endpoint; `/refresh` is appended.
     * @param currentToken - The token presented for renewal. Expired or not, the server decides.
     * @returns The verdict, with the new token when renewed.
     */
    async refresh(endpoint: string, currentToken: string): Promise<RefreshResult> {
        const deadline = Date.now() + EXCHANGE_TIMEOUT_MS;
        let response: Response;
        try {
            response = await fetchWithTimeout(
                fetch,
                `${endpoint}/refresh`,
                {
                    method: "POST",
                    headers: jsonHeaders({ authorization: bearer(currentToken) }),
                },
                EXCHANGE_TIMEOUT_MS
            );
        } catch (error) {
            return {
                verdict: "unavailable",
                reason: error instanceof HttpFetchError ? error.kind : "network",
            };
        }

        if (TRANSIENT_RENEWAL_STATUSES.has(response.status)) {
            return { verdict: "unavailable", reason: `status ${response.status}` };
        }
        if (!response.ok) {
            return {
                verdict: "refused",
                status: response.status,
                reason: `status ${response.status}`,
            };
        }

        let text: string;
        try {
            text = await _readWithin(response, deadline);
        } catch {
            // Cut or stalled in transit: the same class as a network error.
            return { verdict: "unavailable", reason: "body" };
        }
        const renewal = _sessionFrom(text);
        if (!renewal) {
            return { verdict: "refused", status: response.status, reason: "unusable body" };
        }
        return { verdict: "renewed", token: renewal.token, expiresIn: renewal.expiresIn };
    },
};
