/*!
 * @geoleaf-plugins/routing — Engine URL
 *
 * The one place an engine URL is read or composed. Everything goes through the `URL` API: no
 * string is concatenated into a query, so nothing has to be escaped by hand.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Reads an engine address, or refuses it.
 *
 * 🛑 **Anything that is not `https://` is REFUSED, never corrected.** A routing request carries
 * where someone is and where they are going; over plain HTTP every hop on the path reads it. An
 * address carrying credentials (`https://user:secret@host`) is refused too: it would put a secret
 * in a value that profiles and logs are allowed to show.
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
export function buildEngineUrl(
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
