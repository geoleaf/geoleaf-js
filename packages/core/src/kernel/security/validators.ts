/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description URL, coordinate and number validation. Pure functions (no DOM, no logging).
 */

// ── URL Validation ──

export interface ValidateUrlOptions {
    /** When true, only https: and data: (images) allowed; http: rejected. Default false. */
    httpsOnly?: boolean;
}

/**
 * Resolve the base URL for relative URL parsing, defaulting to the current origin.
 *
 * @param baseUrl - Optional explicit base URL.
 * @returns The resolved base URL string.
 */
export function resolveBaseUrl(baseUrl?: string): string {
    const _loc =
        typeof globalThis !== "undefined" && "location" in globalThis
            ? (globalThis as unknown as { location: { origin?: string } }).location
            : typeof location !== "undefined"
              ? location
              : null;

    return baseUrl ?? _loc?.origin ?? "https://localhost";
}

const _ALLOWED_DATA_TYPES = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/svg+xml",
    "image/webp",
];

/**
 * The MIME types accepted inside a `data:` URL, as an exact whitelist.
 *
 * @remarks
 * Canonical source for every `data:` check in the codebase. A prefix test such as
 * `startsWith("image/")` is NOT equivalent: it admits arbitrary subtypes
 * (`image/bmp`, `image/x-anything`) that no renderer here is expected to handle.
 */
export const ALLOWED_DATA_URL_TYPES: readonly string[] = Object.freeze([..._ALLOWED_DATA_TYPES]);

/**
 * Report whether a `data:` URL MIME type is on the whitelist.
 *
 * @param mimeType - The MIME type extracted from a `data:` URL, e.g. `image/png`.
 * @returns `true` when the type is explicitly allowed.
 *
 * @remarks
 * Exposed so callers that need a different failure mode (a result object rather
 * than a throw, as in `utils/validators/general-validators.ts`) can share this
 * whitelist instead of re-deriving one.
 */
export function isAllowedDataUrlType(mimeType: string): boolean {
    return _ALLOWED_DATA_TYPES.includes(mimeType);
}

/**
 * Extract the MIME type from a `data:` URL.
 *
 * @param url - A full `data:` URL, e.g. `data:image/png;base64,iVBOR…`.
 * @returns The MIME type (`image/png`), or `null` when the URL is malformed.
 *
 * @remarks
 * Stops at the first `;` or `,`, so encoding parameters stay out of the result.
 * Exported as the single parser for this format: a hand-rolled variant in
 * `utils/validators/general-validators.ts` used to return `image/png;base64`
 * — harmless against a `startsWith("image/")` test, but wrong against an exact
 * whitelist. Sharing the parser is what makes sharing the whitelist safe.
 */
export function extractDataUrlMimeType(url: string): string | null {
    const [dataPrefix = ""] = url.split(",");

    return dataPrefix.match(/data:([^;,]+)/)?.[1] ?? null;
}

function _validateDataUrl(url: string): void {
    const mimeType = extractDataUrlMimeType(url);

    if (!mimeType) throw new Error("Invalid data URL format");

    if (!isAllowedDataUrlType(mimeType)) {
        throw new Error(
            `Data URL type "${mimeType}" not allowed. Allowed: ${_ALLOWED_DATA_TYPES.join(", ")}`
        );
    }
}

/**
 * Validate a URL strictly against a protocol whitelist (http, https, data:image).
 *
 * @security Rejects javascript:, vbscript:, data:text/html and other dangerous protocols.
 * @param url - The URL string to validate.
 * @param baseUrl - Optional base URL for relative URL resolution. Defaults to `location.origin`.
 * @param options - Optional: set `httpsOnly: true` to reject http: (production hardening).
 * @returns The normalized absolute URL string.
 * @throws {Error} If the URL is invalid or the protocol is not allowed.
 */
export function validateUrl(url: string, baseUrl?: string, options?: ValidateUrlOptions): string {
    if (!url || typeof url !== "string") {
        throw new TypeError("URL must be a non-empty string");
    }

    url = url.trim();

    const base = resolveBaseUrl(baseUrl);

    try {
        const parsed = new URL(url, base);

        const allowedProtocols = options?.httpsOnly
            ? ["https:", "data:"]
            : ["http:", "https:", "data:"];

        if (!allowedProtocols.includes(parsed.protocol)) {
            throw new Error(
                options?.httpsOnly
                    ? "Only https: and data: (images) URLs are allowed when security.httpsOnly is enabled."
                    : `Protocol "${parsed.protocol}" not allowed. Allowed protocols: ${allowedProtocols.join(", ")}`
            );
        }

        if (parsed.protocol === "data:") {
            _validateDataUrl(url);
        }

        return parsed.href;
    } catch (e) {
        const err = e as Error;

        if (err.message?.includes("not allowed")) {
            throw e;
        }

        throw new Error(`Invalid URL "${url}": ${err.message}`, { cause: e });
    }
}

/**
 * Validate geographic coordinates (latitude and longitude).
 *
 * @security Rejects non-finite, NaN, Infinity, and out-of-range coordinate values.
 * @param lat - Latitude value, must be in range [-90, 90].
 * @param lng - Longitude value, must be in range [-180, 180].
 * @returns A tuple `[lat, lng]` if valid.
 * @throws {TypeError} If values are not finite numbers.
 * @throws {RangeError} If values are out of the allowed range.
 */
export function validateCoordinates(lat: number, lng: number): [number, number] {
    if (typeof lat !== "number" || typeof lng !== "number") {
        throw new TypeError(
            `Coordinates must be numbers, got lat=${typeof lat}, lng=${typeof lng}`
        );
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new RangeError("Coordinates must be finite numbers (not NaN or Infinity)");
    }

    if (lat < -90 || lat > 90) {
        throw new RangeError(`Latitude must be between -90 and 90, got ${lat}`);
    }

    if (lng < -180 || lng > 180) {
        throw new RangeError(`Longitude must be between -180 and 180, got ${lng}`);
    }

    return [lat, lng];
}

/**
 * Validate that a value is a finite number within a given range.
 *
 * @security Rejects NaN, Infinity, and out-of-range values from untrusted input (URL params, config).
 * @param value - The value to validate; coerced to number via `Number()`.
 * @param min - Minimum allowed value (inclusive). Defaults to `-Infinity`.
 * @param max - Maximum allowed value (inclusive). Defaults to `Infinity`.
 * @returns The validated number, or null if invalid or out of range.
 */
export function validateNumber(
    value: unknown,
    min: number = -Infinity,
    max: number = Infinity
): number | null {
    const num = Number(value);

    if (!Number.isFinite(num)) return null;

    if (num < min || num > max) return null;

    return num;
}
