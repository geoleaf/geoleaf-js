/*!
 * @geoleaf-plugins/isochrone — Request URL
 *
 * The one place a URL is read, composed, or prepared for a log. Everything goes through the
 * `URL` API: no string is concatenated into a query, so nothing has to be escaped by hand.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Reads an engine address, or refuses it.
 *
 * 🛑 **Anything that is not `https://` is REFUSED, never corrected.** The request carries a
 * point someone chose on a map; over plain HTTP every hop on the path reads it. An address
 * carrying credentials (`https://user:secret@host`) is refused too: it would put a secret in a
 * value that profiles, logs and error messages are allowed to show.
 *
 * @param value The address, as written in a profile or given at runtime.
 * @returns The parsed address, or `null` when it is refused.
 */
export function parseEndpoint(value: unknown): URL | null {
    if (typeof value !== "string" || !value.startsWith("https://")) return null;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.username !== "" || url.password !== "") return null;
    return url;
}

/**
 * Composes the URL of one request.
 *
 * @param endpoint Base address of the engine, already accepted by `parseEndpoint`.
 * @param action Path of the engine's action, with its leading slash.
 * @param params Query parameters. A parameter already present on `endpoint` is replaced.
 * @returns The URL to call, or `null` when `endpoint` cannot be read.
 */
export function buildRequestUrl(
    endpoint: string,
    action: string,
    params: Readonly<Record<string, string>>
): string | null {
    const url = parseEndpoint(endpoint);
    if (url === null) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}${action}`;
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return url.toString();
}

/**
 * The form of a URL that may reach a log: its origin and its path, never its query.
 *
 * ⚠️ A key travels in the query string. A URL that cannot be read is not echoed either — the
 * text that failed to parse is exactly where a mistyped secret would be.
 *
 * @param url Any URL.
 * @returns Origin and path, or a fixed marker.
 */
export function maskUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return "<unreadable url>";
    }
}
