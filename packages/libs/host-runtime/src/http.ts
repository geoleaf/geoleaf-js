/*!
 * @geoleaf/host-runtime — domain-neutral HTTP wire primitives
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The genuinely-duplicated, error-agnostic fetch primitives used by the editor
 * and connector plugins. By design this module never builds domain errors (the
 * editor's `PersistenceError`, the connector's `AuthError`) and never touches
 * i18n — callers map the neutral outcomes back into their own taxonomy. HTTP
 * status interpretation (409 conflict, 401/404 auth flows) stays per-plugin,
 * where the dialects genuinely diverge.
 *
 * Was the standalone `@geoleaf/http-helpers` package until STRUCT S1: 100 lines
 * of source carried 6 packaging files, a workspace entry and 6 pins across the
 * gates, for two consumers that already declared `@geoleaf/host-runtime`.
 * Imports nothing — the load-bearing contract of this package (no value from
 * `@geoleaf/core`) is untouched by the move.
 */

/** Options for {@link jsonHeaders}. */
export interface JsonHeadersOptions {
    /** Full `Authorization` header value (e.g. `Bearer <jwt>`). Omitted when falsy. */
    authorization?: string | null;
    /** When `true`, adds `X-Force-Update: true` (client-wins conflict override). */
    force?: boolean;
}

/**
 * Builds JSON request headers: always `Content-Type: application/json`, plus an
 * optional `Authorization` and `X-Force-Update`.
 */
export function jsonHeaders(opts: JsonHeadersOptions = {}): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.authorization) h["Authorization"] = opts.authorization;
    if (opts.force) h["X-Force-Update"] = "true";
    return h;
}

/** Formats a bearer `Authorization` value from a raw token. */
export function bearer(token: string): string {
    return `Bearer ${token}`;
}

/** Discriminates the two failure modes {@link fetchWithTimeout} can signal. */
export type HttpFetchFailureKind = "timeout" | "network";

/**
 * Neutral transport error thrown by {@link fetchWithTimeout}. Carries a
 * {@link HttpFetchFailureKind} discriminant so callers can map it into their
 * own domain error (timeout vs network) without coupling to this module.
 */
export class HttpFetchError extends Error {
    readonly kind: HttpFetchFailureKind;
    constructor(kind: HttpFetchFailureKind, message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = "HttpFetchError";
        this.kind = kind;
        if (options?.cause !== undefined) {
            (this as { cause?: unknown }).cause = options.cause;
        }
    }
}

/**
 * Runs a fetch with an {@link AbortController} timeout.
 *
 * @param doFetch - The fetch implementation to use (injected for testability /
 *   interception). A non-function value throws `HttpFetchError("network")`.
 * @param url - Request URL.
 * @param init - Request init; a `signal` is added internally.
 * @param timeoutMs - Abort the request after this many milliseconds.
 * @throws {HttpFetchError} `kind: "timeout"` when the timeout fires, otherwise
 *   `kind: "network"`. The original error is attached as `cause`.
 */
export async function fetchWithTimeout(
    doFetch: typeof fetch,
    url: string,
    init: RequestInit,
    timeoutMs: number
): Promise<Response> {
    if (typeof doFetch !== "function") {
        throw new HttpFetchError("network", "fetch is not available");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await doFetch(url, { ...init, signal: controller.signal });
    } catch (err) {
        if (controller.signal.aborted) {
            throw new HttpFetchError("timeout", "request timed out", { cause: err });
        }
        throw new HttpFetchError("network", "network request failed", { cause: err });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Parses a JSON response body, tolerating an empty body (returns `{}`).
 * Propagates the raw `SyntaxError` on malformed JSON so the caller can map it
 * into a domain error with its own status context.
 */
export async function parseJsonBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
}

/**
 * Does `url` really belong to the same origin as `baseUrl`, under its base path?
 * The single guard every credential-injection point must pass before a token is
 * attached (bug no. 4, fixed on 02/08/2026).
 *
 * 🛑 WHY NOT `url.startsWith(baseUrl)`. For `baseUrl = "https://api.exemple.fr"`,
 * the string `"https://api.exemple.fr.attaquant.tld/vol"` DOES start with it — a
 * credential (bearer token, worker header, tile request) would thus leave for a
 * **suffix host**. A string prefix knows nothing of hostname boundaries; only an
 * ORIGIN comparison does.
 *
 * ⚠️ The path is then compared on top of the origin, with a segment boundary:
 * otherwise `https://api.exemple.fr/v1` would allow `https://api.exemple.fr/v1betrayal`.
 *
 * @param url - The candidate URL, absolute or relative (resolved against the document).
 * @param baseUrl - The connector's configured, trusted base.
 * @returns `true` when `url` is on the same origin as `baseUrl` AND under its base path.
 */
export function isSameOrigin(url: string, baseUrl: string): boolean {
    try {
        const target = new URL(url, globalThis.location?.href);
        const base = new URL(baseUrl, globalThis.location?.href);
        if (target.origin !== base.origin) return false;
        // Base path normalised without a trailing `/`, then an explicit segment boundary.
        const basePath = base.pathname.replace(/\/+$/, "");
        if (basePath === "") return true;
        return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
    } catch {
        // An unreadable URL belongs to nobody — no credential is sent there.
        return false;
    }
}
