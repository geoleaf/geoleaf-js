/*!
 * GeoLeaf Connector — Config Schema
 * Types + validation for ConnectorConfig. Zero external dependencies.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Configuration for @geoleaf-plugins/connector.
 * Either `getToken` or `auth` must be provided — they are mutually exclusive.
 */
export interface ConnectorConfig {
    /**
     * URL prefix. All requests starting with this URL will have the token injected.
     * Must start with https:// in production.
     * http:// triggers a console.warn on localhost / 127.0.0.1.
     */
    baseUrl: string;

    /**
     * Async or sync token provider callback — **the supported way to inject a host token.**
     *
     * Return `null` to skip header injection for a given request. Mutually exclusive with
     * `auth`.
     *
     * ## It is a PULL, and that is the security property
     *
     * The plugin calls this on **every intercepted request** (`fetch-interceptor.ts`,
     * `_resolveToken`), and again when a 401 sends it through the retry path. The host
     * therefore always returns the token that is current *at that instant*: it never has to
     * predict expiry, and there is no stale copy of the token anywhere in the plugin.
     * Caching and refreshing stay on the host side, which is where the credential lives.
     *
     * ## Why there is no `Connector.setToken` nor `onTokenExpiring`
     *
     * 🛑 **They will not be written** — this is an arbitrated refusal, not an omission,
     * and re-opening it needs a
     * new argument rather than a new request.
     *
     * `setToken` would be a **PUSH**: a credential handed to the global namespace, persisted,
     * and replayed onto the `Authorization` header of every matching request until something
     * replaces it. That inverts the direction of control — the plugin would hold a copy of a
     * secret whose validity only the host knows. `onTokenExpiring` exists only to patch that
     * inversion, by asking the host to predict what the PULL already reads at the right time.
     *
     * `getToken` covers both, under a form that is strictly more general and keeps the
     * credential on one side of the boundary.
     *
     * @returns The current token, or `null` to leave the request unauthenticated.
     *
     * @example
     * ```ts
     * // Passé tel quel à `GeoLeaf.Connector.configure(...)`.
     * const connectorConfig = {
     *     baseUrl: "https://api.example.org",
     *     getToken: () => sessionStorage.getItem("access_token"),
     * };
     * ```
     */
    getToken?: () => string | null | Promise<string | null>;

    /**
     * Autonomous auth configuration.
     * The plugin will call the endpoint to obtain a JWT and manage its lifecycle
     * (storage in IndexedDB, silent refresh, optional login modal).
     * Mutually exclusive with `getToken`.
     */
    auth?: {
        /**
         * Full URL of the auth endpoint.
         * POST { login, password } → { token: string, expiresIn: number }
         */
        endpoint: string;
        /**
         * If true, renders a login modal when no valid token is found at startup.
         * Default: false.
         */
        ui?: boolean;
        /** External signup page URL. Shown as a link in the login modal. Must be HTTPS in production. */
        signupUrl?: string;
        /** External forgot-password page URL. Shown as a link in the login modal. Must be HTTPS in production. */
        forgotPasswordUrl?: string;
        /**
         * Credential button auto-injection configuration.
         * The button is injected into the desktop panel tabs and mobile toolbar.
         */
        credentialButton?: {
            /** Enable credential button injection. Default false. */
            enabled?: boolean;
            /** Icon variant: "lock" (default) or "user". */
            iconVariant?: "lock" | "user";
        };
    };
}

/** Thrown when ConnectorConfig fails validation. */
export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

/**
 * Validates a ConnectorConfig object.
 * Throws ConfigError on any constraint violation.
 */
export function validateConfig(config: ConnectorConfig): void {
    _validateBaseUrl(config);
    _validateAuthMode(config);

    // Validate external URLs (HTTPS in production, http allowed on localhost)
    _validateExternalUrl(config.auth?.signupUrl, "auth.signupUrl");
    _validateExternalUrl(config.auth?.forgotPasswordUrl, "auth.forgotPasswordUrl");

    // iconVariant silent fallback (no throw, no warn)
    _normalizeIconVariant(config);
}

/** True when running on a local dev host (localhost / 127.0.0.1), where http:// is tolerated. */
function _isDevHost(): boolean {
    return (
        typeof location !== "undefined" &&
        (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    );
}

/** Validates `baseUrl`: non-empty string + HTTPS enforcement (OWASP A05). */
function _validateBaseUrl(config: ConnectorConfig): void {
    if (!config || typeof config.baseUrl !== "string" || !config.baseUrl.trim()) {
        throw new ConfigError("[GeoLeaf Connector] baseUrl must be a non-empty string.");
    }
    if (!config.baseUrl.startsWith("https://")) {
        if (_isDevHost()) {
            console.warn(
                "[GeoLeaf Connector] baseUrl should use HTTPS in production. " +
                    "Current value: " +
                    config.baseUrl
            );
        } else {
            throw new ConfigError(
                "[GeoLeaf Connector] baseUrl must use HTTPS in production. " +
                    "Received: " +
                    config.baseUrl
            );
        }
    }
}

/** Validates the auth mode: getToken/auth are mutually exclusive and one is required. */
function _validateAuthMode(config: ConnectorConfig): void {
    const hasGetToken = typeof config.getToken === "function";
    const hasAuth = config.auth !== undefined && config.auth !== null;

    if (!hasGetToken && !hasAuth) {
        throw new ConfigError("[GeoLeaf Connector] Either getToken or auth must be provided.");
    }
    if (hasGetToken && hasAuth) {
        throw new ConfigError(
            "[GeoLeaf Connector] getToken and auth are mutually exclusive. Provide only one."
        );
    }
    if (hasAuth && !config.auth?.endpoint?.trim()) {
        throw new ConfigError(
            "[GeoLeaf Connector] auth.endpoint must be a non-empty string when auth is configured."
        );
    }
}

/** Silently coerces an unknown credential-button iconVariant back to the "lock" default. */
function _normalizeIconVariant(config: ConnectorConfig): void {
    if (
        config.auth?.credentialButton?.iconVariant &&
        config.auth.credentialButton.iconVariant !== "lock" &&
        config.auth.credentialButton.iconVariant !== "user"
    ) {
        (config.auth.credentialButton as { iconVariant: string }).iconVariant = "lock";
    }
}

/**
 * Validates an optional external URL field.
 * Must start with https:// in production. http:// allowed on localhost/127.0.0.1.
 */
function _validateExternalUrl(url: string | undefined, fieldName: string): void {
    if (url === undefined || url === null) return;
    if (typeof url !== "string" || !url.trim()) {
        throw new ConfigError(
            `[GeoLeaf Connector] ${fieldName} must be a non-empty string when provided.`
        );
    }
    if (!url.startsWith("https://")) {
        if (_isDevHost()) {
            console.warn(
                `[GeoLeaf Connector] ${fieldName} should use HTTPS in production. Current value: ${url}`
            );
        } else {
            throw new ConfigError(
                `[GeoLeaf Connector] ${fieldName} must use HTTPS in production. Received: ${url}`
            );
        }
    }
}
