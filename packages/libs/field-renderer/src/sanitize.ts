/*!
 * @geoleaf/field-renderer — HTML sanitization
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Same algorithms as packages/core/src/kernel/security/escaping.ts
 * and security/validators.ts — verbatim copy, no runtime dependency on core.
 * https://geoleaf.dev
 */

const _ALLOWED_DATA_MIME = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/svg+xml",
    "image/webp",
];

/**
 * Escape HTML characters to prevent XSS.
 * Null/undefined → "". Non-strings are coerced.
 */
export function escapeHtml(str: string | null | undefined): string {
    if (str == null) return "";
    if (typeof str !== "string") str = String(str);
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Validate a URL strictly against an allowed-protocol whitelist.
 * Allowed: http:, https:, data:<image-mime>.
 * Throws on javascript:, vbscript:, data:text/html, or malformed URLs.
 */
export function validateUrl(url: string): string {
    if (!url || typeof url !== "string") throw new TypeError("URL must be a non-empty string");
    url = url.trim();
    const base =
        typeof globalThis !== "undefined" && "location" in globalThis
            ? (globalThis as unknown as { location: { origin: string } }).location.origin
            : "https://localhost";
    const parsed = new URL(url, base);
    const allowed = ["http:", "https:", "data:"];
    if (!allowed.includes(parsed.protocol)) {
        throw new Error(`Protocol "${parsed.protocol}" not allowed`);
    }
    if (parsed.protocol === "data:") {
        const [dataPrefix = ""] = url.split(",");
        const mime = dataPrefix.match(/data:([^;,]+)/)?.[1];
        if (mime === undefined || !_ALLOWED_DATA_MIME.includes(mime)) {
            throw new Error(
                `data: URL type not allowed. Allowed: ${_ALLOWED_DATA_MIME.join(", ")}`
            );
        }
    }
    return parsed.href;
}

/**
 * Like validateUrl but returns "" instead of throwing — safe for DOM attributes.
 * Use for href/src attributes where an invalid URL should produce a no-op, not a crash.
 */
export function safeUrl(url: string): string {
    try {
        return validateUrl(url);
    } catch {
        return "";
    }
}
