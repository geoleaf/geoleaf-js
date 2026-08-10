/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview URL validation guard for cache fetch operations.
 * Prevents forbidden-scheme requests (file:, javascript:, data:, blob:, …)
 * before any fetch() call in the Storage plugin.
 *
 * Relative URLs are intentionally allowed: the browser resolves them to the
 * current page origin, so they are same-origin by construction.
 */

/**
 * Validates a URL before it is used in a fetch() call.
 *
 * - Relative URLs pass immediately (browser resolves to same origin).
 * - Absolute URLs must use the `http:` or `https:` scheme.
 *
 * @param {string} url - URL to validate.
 * @throws {Error} If the URL is empty, or if it is absolute with a
 *   non-http/https scheme.
 *
 * @example
 * validateFetchUrl('https://tiles.openstreetmap.org/...');   // OK
 * validateFetchUrl('../profiles/tourism/profile.json');       // OK (relative)
 * validateFetchUrl('javascript:alert(1)');                    // throws
 * validateFetchUrl('file:///etc/passwd');                     // throws
 * validateFetchUrl('data:text/html,<h1>x</h1>');             // throws
 */
export function validateFetchUrl(url: string): void {
    if (typeof url !== "string" || url.trim() === "") {
        throw new Error("[GeoLeaf] Fetch blocked: URL must be a non-empty string");
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        // Relative URL — browser resolves to same origin, safe to proceed
        return;
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error(
            `[GeoLeaf] Fetch blocked: scheme "${parsed.protocol}" is not allowed (only http/https)`
        );
    }
}
