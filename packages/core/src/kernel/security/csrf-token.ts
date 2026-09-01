/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description CSRF Token Manager — generates and validates CSRF tokens.
 */

import { Log } from "../../utils/log/index.js";

const _g =
    typeof globalThis !== "undefined"
        ? (globalThis as Window & typeof globalThis)
        : typeof window !== "undefined"
          ? window
          : ({} as Window);

interface SecureCookieOptions {
    maxAge?: number;
    path?: string;
    sameSite?: "Strict" | "Lax" | "None";
    /**
     * Whether to add the `Secure` cookie flag.
     * Only applies on HTTPS — ignored silently on HTTP with a console warning.
     * @default true
     * @since v2.0.0
     */
    secure?: boolean;
}

interface CSRFTokenInfo {
    hasToken: boolean;
    expiresIn: number;
    isValid: boolean;
}

/**
 * ⚠ Must stay EXPORTED. `CSRFToken` is part of the barrel's `Security` object
 * (`security/index.ts`); TypeScript must therefore be able to NAME this type to
 * emit `Security`'s declaration, otherwise TS4023 ("has or is using name … but
 * cannot be named"). Same constraint as `FetchHelperOptions` for `Utils`.
 */
export interface CSRFTokenInternal {
    _token: string | null;
    _tokenExpiry: number | null;
    _tokenDuration: number;
    _refreshIntervalId: ReturnType<typeof setInterval> | null;
    init(): void;
    _generateToken(): string;
    getToken(): string | null;
    validateToken(token: string | null | undefined): boolean;
    addTokenToData<T extends FormData | Record<string, unknown>>(data: T): T;
    addTokenToHeaders(options?: Record<string, unknown>): Record<string, unknown>;
    createTokenInput(): HTMLInputElement;
    addTokenToForm(form: HTMLFormElement): void;
    validateFormToken(data: FormData | Record<string, unknown>): boolean;
    setSecureCookie(cookieName: string, value: string, options?: SecureCookieOptions): void;
    _startAutoRefresh(): void;
    destroy(): void;
    rotateToken(): void;
    getTokenInfo(): CSRFTokenInfo;
}

/**
 * CSRF token issuance and verification for state-changing requests.
 *
 * Holds a token per session and exposes it for outgoing requests. The token is minted in
 * THIS browser (`crypto.getRandomValues`) and checked in the same context — it is never a
 * server secret verified across the network — so {@link CSRFTokenInternal.validateToken}
 * compares by direct equality. There is no cross-origin timing oracle here that a
 * constant-time comparison would defend against; do not add that complexity on the strength
 * of the word alone.
 */
export const CSRFToken: CSRFTokenInternal = {
    _token: null,
    _tokenExpiry: null,
    _tokenDuration: 3600000,
    _refreshIntervalId: null,

    /**
     * Generates the first token and arms the auto-refresh timer.
     * Idempotent: a second call is a no-op while a token is live.
     */
    init(): void {
        try {
            this._token = this._generateToken();
            this._tokenExpiry = Date.now() + this._tokenDuration;
            this._startAutoRefresh();
            Log.info("[CSRF] Token initialized");
        } catch (e) {
            Log.error(
                "[CSRF] Init failed — crypto.getRandomValues unavailable:",
                (e as Error).message
            );
            this._token = null;
        }
    },

    /**
     * Produces a fresh 256-bit token from the crypto RNG.
     * @returns The hex-encoded token.
     * @internal Use `rotateToken()` to replace the live token.
     */
    _generateToken(): string {
        if (_g.crypto && _g.crypto.getRandomValues) {
            const array = new Uint8Array(32);
            _g.crypto.getRandomValues(array);
            return btoa(String.fromCharCode(...array))
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=/g, "");
        }
        Log.error("[CSRF] crypto.getRandomValues not available — CSRF protection disabled");
        throw new Error("[CSRF] Secure random number generation not available");
    },

    /**
     * Returns the live CSRF token.
     * @returns The token, or `null` when `init()` has not run.
     */
    getToken(): string | null {
        if (!this._token || Date.now() >= (this._tokenExpiry ?? 0)) {
            Log.info("[CSRF] Token expired, generating new one");
            try {
                this._token = this._generateToken();
                this._tokenExpiry = Date.now() + this._tokenDuration;
            } catch (e) {
                Log.error("[CSRF] Token generation failed:", (e as Error).message);
                this._token = null;
            }
        }
        return this._token;
    },

    /** @security Validates CSRF token integrity; rejects expired or mismatched tokens. */
    validateToken(token: string | null | undefined): boolean {
        if (!token || typeof token !== "string") return false;
        if (token === this._token && Date.now() < (this._tokenExpiry ?? 0)) return true;
        Log.warn("[CSRF] Token validation failed");
        return false;
    },

    addTokenToData<T extends FormData | Record<string, unknown>>(data: T): T {
        const token = this.getToken();
        if (data instanceof FormData) {
            data.append("csrf_token", token ?? "");
        } else if (typeof data === "object" && data !== null) {
            data.csrf_token = token;
        }
        return data;
    },

    /**
     * Adds the `X-CSRF-Token` header to a fetch options object.
     * @param options - Existing fetch options. Not mutated.
     * @returns A new options object carrying the token header.
     */
    addTokenToHeaders(options: Record<string, unknown> = {}): Record<string, unknown> {
        const token = this.getToken();
        if (!options.headers) options.headers = {};
        (options.headers as Record<string, string>)["X-CSRF-Token"] = token ?? "";
        return options;
    },

    /**
     * Builds a hidden `<input name="csrf_token">` carrying the live token.
     * @returns The detached input element, ready to append to a form.
     */
    createTokenInput(): HTMLInputElement {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "csrf_token";
        input.value = this.getToken() ?? "";
        input.className = "csrf-token-input";
        return input;
    },

    /**
     * Appends (or refreshes) the hidden CSRF input on a form.
     * @param form - Target form. A pre-existing token input is updated in place.
     */
    addTokenToForm(form: HTMLFormElement): void {
        if (!form || !(form instanceof HTMLFormElement)) {
            Log.error("[CSRF] Invalid form element");
            return;
        }
        const existingInput = form.querySelector('input[name="csrf_token"]');
        if (existingInput) {
            (existingInput as HTMLInputElement).value = this.getToken() ?? "";
            return;
        }
        form.appendChild(this.createTokenInput());
    },

    /**
     * Validates the token carried by a submitted payload.
     * @param data - `FormData` or a plain object holding a `csrf_token` field.
     * @returns `true` when the token matches the live one.
     */
    validateFormToken(data: FormData | Record<string, unknown>): boolean {
        let token: string | unknown;
        if (data instanceof FormData) {
            token = data.get("csrf_token");
        } else if (typeof data === "object" && data !== null) {
            token = data.csrf_token;
        } else {
            token = undefined;
        }
        return this.validateToken(token as string | null | undefined);
    },

    /**
     * Sets a cookie with security attributes for CSRF protection.
     * - `Secure` flag is added by default on HTTPS contexts (`secure: true`).
     * - `SameSite=Strict` is the default — change to `Lax` for cross-site OAuth flows.
     * @security Breaking change (v2.0.0): `secure` defaults to `true`. Consumers
     * relying on HTTP-only deployments must explicitly pass `{ secure: false }`.
     */
    setSecureCookie(cookieName: string, value: string, options: SecureCookieOptions = {}): void {
        const { maxAge = 3600, path = "/", sameSite = "Strict", secure = true } = options;

        let cookie = `${encodeURIComponent(cookieName)}=${encodeURIComponent(value)}`;
        cookie += `; Max-Age=${maxAge}`;
        cookie += `; Path=${path}`;
        cookie += `; SameSite=${sameSite}`;

        if (secure && _g.location?.protocol === "https:") {
            cookie += "; Secure";
        } else if (secure) {
            Log.warn(
                "[CSRF] setSecureCookie: 'secure' option ignored — HTTP context detected. Cookie will not have the Secure flag."
            );
        }

        document.cookie = cookie;
        Log.info(`[CSRF] Secure cookie set: ${cookieName}`);
    },

    /**
     * Arms the rotation timer. Cleared by `destroy()`.
     *
     * Emits `geoleaf:csrf:refreshed` on `document` after each refresh, with the
     * new token in `detail.token`.
     *
     * @internal
     */
    _startAutoRefresh(): void {
        const refreshInterval = this._tokenDuration - 5 * 60 * 1000;
        this._refreshIntervalId = setInterval(() => {
            Log.info("[CSRF] Auto-refreshing token");
            // Guarded like the two other call sites (`init()` and `getToken()`).
            // Unguarded, a `crypto.getRandomValues` that disappears after boot made this
            // timer throw every ~55 min instead of degrading — and the throw escaped into
            // the timer queue, where nothing could catch it. Backlog B.15.
            try {
                this._token = this._generateToken();
                this._tokenExpiry = Date.now() + this._tokenDuration;
            } catch (e) {
                Log.error("[CSRF] Auto-refresh failed:", (e as Error).message);
                this._token = null;
                // No event: announcing a refresh that did not happen would hand
                // subscribers a null token. The timer stays armed, so a transient
                // failure recovers on the next tick.
                return;
            }

            if (typeof CustomEvent !== "undefined") {
                const event = new CustomEvent("geoleaf:csrf:refreshed", {
                    detail: { token: this._token },
                });
                document.dispatchEvent(event);
            }
        }, refreshInterval);
    },

    /** Clears the rotation timer and drops the live token. */
    destroy(): void {
        if (this._refreshIntervalId !== null) {
            clearInterval(this._refreshIntervalId);
            this._refreshIntervalId = null;
        }
        this._token = null;
        this._tokenExpiry = null;
        Log.debug("[CSRF] Destroyed");
    },

    /**
     * Replaces the live token and emits `geoleaf:csrf:rotated`.
     * Pending requests holding the previous token will fail validation.
     */
    rotateToken(): void {
        Log.info("[CSRF] Rotating token");
        this._token = this._generateToken();
        this._tokenExpiry = Date.now() + this._tokenDuration;

        if (typeof CustomEvent !== "undefined") {
            const event = new CustomEvent("geoleaf:csrf:rotated", {
                detail: { token: this._token },
            });
            document.dispatchEvent(event);
        }
    },

    /**
     * Reports token state for diagnostics.
     * @returns Presence, age and time remaining before the next rotation.
     */
    getTokenInfo(): CSRFTokenInfo {
        return {
            hasToken: !!this._token,
            expiresIn: this._tokenExpiry ? Math.max(0, this._tokenExpiry - Date.now()) : 0,
            isValid: !!(this._token && Date.now() < (this._tokenExpiry ?? 0)),
        };
    },
};
