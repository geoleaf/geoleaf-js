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
     * Must start with https://: `configure()` and `createConnector()` refuse any other value
     * with a `ConfigError`.
     * http:// is tolerated, with a console.warn, only when the URL itself TARGETS a development
     * host — `localhost`, `*.localhost`, the loopback `127.0.0.0/8` or `::1`, or `*.test`. The
     * page it is served from does not matter: a page on `localhost` may not send its token
     * over http:// to a remote host. A relative URL targets the page's own host.
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
     * `_resolveToken`), again when a 401 sends it through the retry path, and for **every tile**
     * and **every GeoJSON load the worker makes** (`maplibre-bridge.ts`, `getWorkerHeaders`).
     * The host therefore always returns the token that is current *at that instant*: it never
     * has to predict expiry, and there is no stale copy of the token anywhere in the plugin.
     * Caching and refreshing stay on the host side, which is where the credential lives.
     *
     * ## Synchronous or not, and what a failure does
     *
     * A synchronous provider reaches every path. One that answers with a promise reaches the
     * tiles on MapLibre 5.21 or later, and the worker on a core that announces it takes one
     * (`@geoleaf/core` 3.4.0); on older ones those requests go without a token. A provider
     * that throws or rejects fails the page's request with its error, while tiles and worker
     * loads go without a token — the next request asks again.
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
     * ## The pre-departure check does not learn the session from here
     *
     * In this mode the plugin knows nothing of the token's expiry, so it tells the core's
     * `Storage.preflight()` nothing — its `session` stays `null`. The host, which knows, tells
     * it itself through `GeoLeaf.Sync.registerSessionReader` (core ≥ 3.11.0).
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
         * Full URL of the sign-in endpoint: `POST { login, password }`.
         *
         * Under the default contract (`"token"`) it answers `{ token, expiresIn }`, and the
         * renewal is `POST {endpoint}/refresh`. Under `"pair"` it answers
         * `{ access_token, refresh_token, expires_in, refresh_expires_in? }` — see `contract`.
         *
         * It receives the password, so it is held to the rule of `baseUrl`: `https://`, or
         * `http://` toward a development host — any other value is a `ConfigError`.
         */
        endpoint: string;
        /**
         * The token contract the server speaks. Default: `"token"`.
         *
         * - `"token"` — one token, `{ token, expiresIn }`, renewed at `POST {endpoint}/refresh`
         *   with the current token as `Bearer`; signing out is local.
         * - `"pair"` — an access token and a SINGLE-USE refresh token (the shape of RFC 6749
         *   §5.1). The access token is held in memory only, the refresh token is persisted. The
         *   renewal posts `{ refresh_token }` to `refreshEndpoint` without `Bearer`, and every
         *   answer carries a new refresh token. One renewal at a time per device, across tabs
         *   (`navigator.locks`), and the new pair is shared with the other tabs
         *   (`BroadcastChannel`). Signing out posts `{ token: <refresh token> }` to
         *   `revokeEndpoint` when one is set, and erases the session whatever it answers.
         */
        contract?: "token" | "pair";
        /**
         * Full URL of the renewal, under `contract: "pair"` — required there, refused otherwise.
         * It receives the refresh token: held to the rule of `endpoint`.
         */
        refreshEndpoint?: string;
        /**
         * Full URL of the revocation, under `contract: "pair"` — optional there (without it,
         * signing out is local), refused otherwise. Held to the rule of `endpoint`.
         */
        revokeEndpoint?: string;
        /**
         * The login window. `true` (or an object) renders it when no valid session is found at
         * startup, and again when a session ends; `false` or absent leaves it to the host.
         *
         * The object form configures it — see {@link LoginUiOptions}. `true` is `{}`: a modal.
         */
        ui?: boolean | LoginUiOptions;
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

/**
 * How the login window is presented — the object form of `auth.ui`.
 *
 * Every member is optional; `{}` is the modal the boolean form renders.
 */
export interface LoginUiOptions {
    /**
     * An element of the host to render the form INTO, instead of a modal — a side panel, a
     * drawer. A function is called each time the window opens, so the element may be created
     * after `configure()`.
     *
     * In this presentation there is no backdrop and no page-wide focus trap: the focus goes to
     * the first field, and `Escape` (on the form) and the close button call `onDismiss`. The
     * form is removed from the element when it closes.
     */
    mount?: HTMLElement | (() => HTMLElement);
    /**
     * Called when the user closes the window without signing in — `Escape` or the close button,
     * in both presentations. The host hides its panel there.
     */
    onDismiss?: () => void;
    /**
     * A warning shown above the fields, as text — for instance "do not use a shared device".
     */
    notice?: string;
    /**
     * Reload the page once a sign-in succeeds. Default: false.
     *
     * For a host that loads a third-party script while signed out (an anti-robot challenge):
     * that script must never run in a page that holds a token, and a reload is the only way to
     * be rid of it.
     */
    reloadOnSuccess?: boolean;
}

/** The login window options in force — `null` when `auth.ui` does not ask for a window. */
export function loginUiOf(config: ConnectorConfig): LoginUiOptions | null {
    const ui = config.auth?.ui;
    if (!ui) return null;
    return ui === true ? {} : ui;
}

/** Whether `config` speaks the `"pair"` token contract. */
export function isPairContract(config: ConnectorConfig | null): boolean {
    return config?.auth?.contract === "pair";
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

    // `auth.endpoint` receives the password: held to the same rule as `baseUrl`, which
    // receives the token. `_validateAuthMode` has already refused an empty one.
    if (config.auth) _requireSecureUrl(config.auth.endpoint, "auth.endpoint");
    _validateContract(config);
    _validateUi(config);

    // Validate external URLs (HTTPS, http tolerated toward a development host)
    _validateExternalUrl(config.auth?.signupUrl, "auth.signupUrl");
    _validateExternalUrl(config.auth?.forgotPasswordUrl, "auth.forgotPasswordUrl");

    // iconVariant silent fallback (no throw, no warn)
    _normalizeIconVariant(config);
}

/**
 * Whether `hostname` can only be a development host — never one a production page is served
 * from — so that `http://` may be tolerated there.
 *
 * The rule exists to keep the token out of cleartext in production; it tolerates a name ONLY
 * when no production host can carry it:
 * - `localhost`, `*.localhost`, the IPv4 loopback range `127.0.0.0/8` and `::1` — the hosts a
 *   browser itself treats as potentially trustworthy (secure contexts);
 * - `*.test` — reserved for testing by RFC 6761 and never delegated in the public DNS, so a name
 *   under it resolves only through the operator's own configuration.
 *
 * ⚠️ `.local` is deliberately NOT in the list: it names real intranets, production included.
 * And the suffix is matched WITH its dot — `latest` or `localhost.example.com` are not hosts of
 * development.
 */
function _isDevHostname(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    return (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".test") ||
        _isLoopbackIPv4(host) ||
        host === "[::1]" ||
        host === "::1"
    );
}

/** `127.0.0.0/8` — split rather than one regex, which would nest a quantifier in a group. */
function _isLoopbackIPv4(host: string): boolean {
    const parts = host.split(".");
    return parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p));
}

/**
 * Whether `url` targets a development host (see `_isDevHostname`), where http:// is tolerated.
 *
 * 🛑 It judges the DESTINATION, not the page. The rule keeps a credential out of cleartext,
 * and what decides that is where the credential goes: judged on the page, a page served
 * locally could send its token over http:// to any host, remote ones included.
 *
 * A relative URL has no host of its own: it targets the page's. An absolute one that cannot
 * be parsed targets nothing this rule can vouch for.
 */
function _targetsDevHost(url: string): boolean {
    let hostname: string;
    try {
        hostname = new URL(url).hostname;
    } catch {
        if (/^[a-z][a-z0-9+.-]*:/i.test(url) || typeof location === "undefined") return false;
        hostname = location.hostname;
    }
    return _isDevHostname(hostname);
}

/**
 * Holds a URL that carries a credential to HTTPS (OWASP A05): `https://`, or `http://`
 * toward a development host — tolerated with a warning.
 *
 * @throws ConfigError for any other value.
 */
function _requireSecureUrl(url: string, fieldName: string): void {
    if (url.startsWith("https://")) return;
    if (!_targetsDevHost(url)) {
        throw new ConfigError(
            `[GeoLeaf Connector] ${fieldName} must use HTTPS in production. Received: ${url}`
        );
    }
    console.warn(
        `[GeoLeaf Connector] ${fieldName} should use HTTPS in production. Current value: ${url}`
    );
}

/** Validates `baseUrl`: non-empty string + HTTPS enforcement (OWASP A05). */
function _validateBaseUrl(config: ConnectorConfig): void {
    if (!config || typeof config.baseUrl !== "string" || !config.baseUrl.trim()) {
        throw new ConfigError("[GeoLeaf Connector] baseUrl must be a non-empty string.");
    }
    _requireSecureUrl(config.baseUrl, "baseUrl");
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

/**
 * Validates `auth.contract` and the endpoints that belong to it: `refreshEndpoint` required
 * under `"pair"`, and neither it nor `revokeEndpoint` accepted under `"token"` — where they would
 * be silently ignored, and a renewal the integrator believes configured would go elsewhere.
 */
function _validateContract(config: ConnectorConfig): void {
    const auth = config.auth;
    if (!auth) return;
    const contract = auth.contract ?? "token";
    if (contract !== "token" && contract !== "pair") {
        throw new ConfigError(
            `[GeoLeaf Connector] auth.contract must be "token" or "pair". Received: ${String(contract)}`
        );
    }
    if (contract === "token") {
        for (const field of ["refreshEndpoint", "revokeEndpoint"] as const) {
            if (auth[field] !== undefined) {
                throw new ConfigError(
                    `[GeoLeaf Connector] auth.${field} belongs to contract "pair"; ` +
                        `it is not read under contract "token".`
                );
            }
        }
        return;
    }
    if (typeof auth.refreshEndpoint !== "string" || !auth.refreshEndpoint.trim()) {
        throw new ConfigError(
            '[GeoLeaf Connector] auth.refreshEndpoint is required under contract "pair".'
        );
    }
    _requireSecureUrl(auth.refreshEndpoint, "auth.refreshEndpoint");
    _validateExternalUrl(auth.revokeEndpoint, "auth.revokeEndpoint");
}

/** Validates the object form of `auth.ui`: its members are what they say. */
function _validateUi(config: ConnectorConfig): void {
    const ui = config.auth?.ui;
    if (ui === undefined || typeof ui === "boolean") return;
    if (typeof ui !== "object" || ui === null) {
        throw new ConfigError("[GeoLeaf Connector] auth.ui must be a boolean or an object.");
    }
    const { mount, onDismiss, notice } = ui;
    if (mount !== undefined && typeof mount !== "function" && !_isElement(mount)) {
        throw new ConfigError(
            "[GeoLeaf Connector] auth.ui.mount must be an element or a function returning one."
        );
    }
    if (onDismiss !== undefined && typeof onDismiss !== "function") {
        throw new ConfigError("[GeoLeaf Connector] auth.ui.onDismiss must be a function.");
    }
    if (notice !== undefined && typeof notice !== "string") {
        throw new ConfigError("[GeoLeaf Connector] auth.ui.notice must be a string.");
    }
}

/** Whether `value` is a DOM element — `HTMLElement` may be absent outside a browser. */
function _isElement(value: unknown): boolean {
    return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
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
 * Must start with https://; http:// is tolerated toward a development host.
 */
function _validateExternalUrl(url: string | undefined, fieldName: string): void {
    if (url === undefined || url === null) return;
    if (typeof url !== "string" || !url.trim()) {
        throw new ConfigError(
            `[GeoLeaf Connector] ${fieldName} must be a non-empty string when provided.`
        );
    }
    _requireSecureUrl(url, fieldName);
}
