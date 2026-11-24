/*!
 * GeoLeaf Connector — Auth Client, "pair" contract
 * HTTP calls for an access token + single-use refresh token pair.
 * Credentials are never stored or logged.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The three exchanges of `auth.contract: "pair"`: sign-in, renewal, revocation.
 *
 * The answer has the shape of RFC 6749 §5.1 — `access_token`, `refresh_token`, `expires_in`,
 * and optionally `refresh_expires_in` — and the revocation follows the spirit of RFC 7009. What
 * this module adds to the `"token"` contract's client is one rule, and it shapes everything:
 * **the refresh token changes at every renewal, and presenting a used one again may revoke the
 * whole family on the server** — the user signed out everywhere. This module only talks to the
 * network; the one-at-a-time rule is `pair-session.ts`'s.
 *
 * It reuses the `"token"` client's budget, statuses and readers (`auth-client.ts`) rather than
 * restating them: the two contracts must fail the same way in transit.
 */

import { jsonHeaders, fetchWithTimeout, HttpFetchError } from "@geoleaf/host-runtime";
import {
    AuthError,
    EXCHANGE_TIMEOUT_MS,
    TRANSIENT_RENEWAL_STATUSES,
    readWithin,
    refusalOf,
    signInRefusal,
} from "./auth-client.js";

/** A pair as the server issued it — lifetimes in seconds. */
export interface PairSession {
    readonly accessToken: string;
    /** Lifetime of the access token, seconds. */
    readonly expiresIn: number;
    readonly refreshToken: string;
    /** Lifetime of the refresh token, seconds — absent when the server does not say. */
    readonly refreshExpiresIn?: number;
}

/** What a renewal concluded — the verdicts of the `"token"` contract, read the same way. */
type PairRefreshResult =
    | { readonly verdict: "renewed"; readonly session: PairSession }
    | { readonly verdict: "refused"; readonly status: number; readonly reason: string }
    | { readonly verdict: "unavailable"; readonly reason: string };

/** A lifetime the store can use: a finite number of seconds greater than 0. */
function _isLifetime(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The pair a body carries — `null` when it carries none a client could use. A token that is
 * not a non-empty string, or a lifetime that is not positive, would be stored already dead.
 * An unusable `refresh_expires_in` is dropped rather than refusing the pair: it only bounds
 * what the host is told of the session.
 */
function pairFrom(text: string): PairSession | null {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof data !== "object" || data === null) return null;
    const body = data as Record<string, unknown>;
    const accessToken = body["access_token"];
    const refreshToken = body["refresh_token"];
    const expiresIn = body["expires_in"];
    const refreshExpiresIn = body["refresh_expires_in"];
    if (typeof accessToken !== "string" || accessToken === "") return null;
    if (typeof refreshToken !== "string" || refreshToken === "") return null;
    if (!_isLifetime(expiresIn)) return null;
    return {
        accessToken,
        expiresIn,
        refreshToken,
        ...(_isLifetime(refreshExpiresIn) && { refreshExpiresIn }),
    };
}

/** POSTs a JSON body within the exchange budget — the one transport of the three exchanges. */
function _post(url: string, body: unknown): Promise<Response> {
    return fetchWithTimeout(
        fetch,
        url,
        { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body) },
        EXCHANGE_TIMEOUT_MS
    );
}

/**
 * Signs in with login + password, and returns the pair for the caller to store.
 *
 * @param url - `auth.endpoint`.
 * @param login - The identifier typed.
 * @param password - The password typed — overwritten before the function returns.
 * @returns The pair issued.
 * @throws AuthError `"Invalid credentials"` on a 401, `"Too many attempts"` on a 429 (with
 *   `retryAfter` when the server said how long), `"Network unavailable"` when the exchange
 *   does not conclude in time or in transit, another message otherwise. A refusal carries its
 *   `status`, its `problem` and the application `code` it declared.
 */
async function loginPair(url: string, login: string, password: string): Promise<PairSession> {
    const deadline = Date.now() + EXCHANGE_TIMEOUT_MS;
    let pwd = password;
    try {
        let response: Response;
        try {
            response = await _post(url, { login, password: pwd });
        } catch {
            throw new AuthError("Network unavailable");
        }
        if (!response.ok) throw signInRefusal(await refusalOf(response, deadline));
        let text: string;
        try {
            text = await readWithin(response, deadline);
        } catch {
            throw new AuthError("Network unavailable");
        }
        const session = pairFrom(text);
        if (!session) {
            throw new AuthError(
                "Invalid server response: missing access_token, refresh_token or expires_in"
            );
        }
        return session;
    } finally {
        // Memory hygiene, as in `AuthClient.login`: nothing reads `pwd` afterwards, which is
        // exactly what the rule detects. Directive must stay glued to the statement below.
        // eslint-disable-next-line no-useless-assignment
        pwd = "";
    }
}

/**
 * Trades a refresh token for a new pair, and says what the attempt concluded.
 *
 * The token goes in the body, never as `Bearer`. 🛑 Whatever the verdict, the token presented
 * must be taken as SPENT: the server may have rotated it even when the answer never arrived.
 * Only `pair-session.ts` calls this, under its device-wide lock.
 *
 * It never throws.
 *
 * @param url - `auth.refreshEndpoint`.
 * @param refreshToken - The refresh token stored.
 * @returns The verdict, with the new pair when renewed.
 */
async function refreshPair(url: string, refreshToken: string): Promise<PairRefreshResult> {
    const deadline = Date.now() + EXCHANGE_TIMEOUT_MS;
    let response: Response;
    try {
        response = await _post(url, { refresh_token: refreshToken });
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
        return { verdict: "refused", status: response.status, reason: `status ${response.status}` };
    }
    let text: string;
    try {
        text = await readWithin(response, deadline);
    } catch {
        return { verdict: "unavailable", reason: "body" };
    }
    const session = pairFrom(text);
    if (!session) return { verdict: "refused", status: response.status, reason: "unusable body" };
    return { verdict: "renewed", session };
}

/**
 * Asks the server to revoke a refresh token — and its family.
 *
 * A 2xx is a success, and so is a `400`: RFC 7009 has the server answer 200 to an unknown
 * token, but a server that answers 400 "already revoked" has done what was asked. It never
 * throws: the caller erases the local session whatever this concludes.
 *
 * @param url - `auth.revokeEndpoint`.
 * @param refreshToken - The refresh token to revoke.
 * @returns `true` when the server confirmed.
 */
async function revokePair(url: string, refreshToken: string): Promise<boolean> {
    try {
        const response = await _post(url, { token: refreshToken });
        return response.ok || response.status === 400;
    } catch {
        return false;
    }
}

/** The `"pair"` contract's network side — see {@link PairSession}. */
export const PairAuthClient = { login: loginPair, refresh: refreshPair, revoke: revokePair };
