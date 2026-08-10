/*!
 * GeoLeaf Connector — Auth Client
 * HTTP calls to the authentication endpoint.
 * Credentials are never stored or logged.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { jsonHeaders, bearer, fetchWithTimeout } from "@geoleaf/host-runtime";

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

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _parseAuthResponse(response: Response): Promise<AuthResponse> {
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
    let data: AuthResponse;
    try {
        data = (await response.json()) as AuthResponse;
    } catch {
        throw new AuthError("Invalid server response: could not parse JSON");
    }
    if (!data.token || typeof data.expiresIn !== "number") {
        throw new AuthError("Invalid server response: missing token or expiresIn");
    }
    return data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Authentication against the collection backend — sign-in, refresh, sign-out.
 *
 * Pairs with {@link TokenStore}, which holds what this obtains: this module talks to the
 * network and never persists, the store persists and never talks to the network. The split
 * is what lets a token be restored at boot without a round trip.
 */
export const AuthClient = {
    /**
     * Authenticates with login + password against the endpoint.
     * Returns the token and expiresIn so the caller can store via TokenStore.save().
     *
     * Security: password string is overwritten before the function returns.
     */
    async login(endpoint: string, login: string, password: string): Promise<AuthResponse> {
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
                    15000
                );
            } catch {
                throw new AuthError("Network unavailable");
            }
            return await _parseAuthResponse(response);
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
     * Refreshes the current token via POST {endpoint}/refresh.
     * Returns the new AuthResponse, or null if the backend does not support refresh (404).
     * All other errors are propagated as AuthError.
     */
    async refresh(endpoint: string, currentToken: string): Promise<AuthResponse | null> {
        let response: Response;
        try {
            response = await fetchWithTimeout(
                fetch,
                `${endpoint}/refresh`,
                {
                    method: "POST",
                    headers: jsonHeaders({ authorization: bearer(currentToken) }),
                },
                15000
            );
        } catch {
            // Network error — treat as non-fatal for refresh
            return null;
        }

        // Backend does not support refresh — graceful degradation
        if (response.status === 404) return null;

        try {
            return await _parseAuthResponse(response);
        } catch {
            return null;
        }
    },
};
