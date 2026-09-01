/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf — General Validators
 * Generic validation functions (coordinates, URL, email, etc.)
 */

import { Errors } from "../errors/errors.js";
import {
    validateCoordinates as _secValidateCoordinates,
    isAllowedDataUrlType as _secIsAllowedDataUrlType,
    extractDataUrlMimeType as _secExtractDataUrlMimeType,
    resolveBaseUrl as _secResolveBaseUrl,
} from "../../kernel/security/index.js";

// ── Types ──

/**
 * Aggregate outcome of a batch validation.
 *
 * ⚠️ Distinct from the `{ valid, error }` shape the single-value validators return: this one
 * collects **all** the failures rather than stopping at the first, and its `errors` array is
 * empty — not absent — when everything passed.
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Options common to every validator: whether a failure is reported or thrown.
 */
export interface ValidatorOptions {
    /**
     * Throw a `ValidationError` instead of returning `{ valid: false }`. Defaults to `false`,
     * which is what makes the validators usable in a boolean expression.
     */
    throwOnError?: boolean;
}

/**
 * Options for URL validation, on top of {@link ValidatorOptions}.
 */
export interface ValidateUrlOptions extends ValidatorOptions {
    /** Protocols accepted, e.g. `["http:", "https:"]`. Note the trailing colon. */
    allowedProtocols?: string[];
    /** Accept `data:` URLs whose MIME type is an image. Other data URLs stay rejected. */
    allowDataImages?: boolean;
}

/**
 * Options for zoom validation, on top of {@link ValidatorOptions}.
 */
export interface ValidateZoomOptions extends ValidatorOptions {
    /** Lowest accepted zoom, inclusive. */
    min?: number;
    /** Highest accepted zoom, inclusive. */
    max?: number;
}

/**
 * One entry of a batch validation: the value, the validator to run on it, and how to name it.
 */
export interface ValidateBatchItem {
    /** The value to check. */
    value: unknown;
    /** Validator applied to `value`; must return the `{ valid, error }` shape. */
    validator: (
        value: unknown,
        options?: Record<string, unknown>
    ) => { valid: boolean; error?: string | null };
    /** Options forwarded to `validator`. */
    options?: Record<string, unknown>;
    /** Human-readable name used to prefix this entry's message in the aggregate result. */
    label?: string;
}

/**
 * Validates a latitude/longitude pair.
 *
 * Delegates the range check to the security module, so the bounds are the same ones the rest
 * of the kernel enforces. Like every validator here, it **reports** by default and only
 * throws when asked — which is what lets it be used directly in a condition.
 *
 * @param lat - Latitude, expected in [-90, 90].
 * @param lng - Longitude, expected in [-180, 180].
 * @param options - See {@link ValidatorOptions}.
 * @returns `{ valid, error }`; `error` is `null` when valid.
 * @throws {@link GeoLeafError} A `ValidationError` when the pair is invalid and
 *   `throwOnError` is set.
 *
 * @example
 * ```js
 * // Valid coordinates
 * const result = GeoLeaf.Validators.validateCoordinates(45.5017, -73.5673);
 * // Returns: { valid: true, error: null }
 *
 * // Latitude invalide (> 90)
 * const result2 = GeoLeaf.Validators.validateCoordinates(95, -73);
 * // Returns: { valid: false, error: 'Latitude must be between -90 and 90' }
 *
 * // Mode strict (lance exception)
 * try {
 *     GeoLeaf.Validators.validateCoordinates(95, -73, { throwOnError: true });
 * } catch (error) {
 *     console.error("Coordonnées invalides:", error.message);
 * }
 * ```
 */
function validateCoordinates(
    lat: number,
    lng: number,
    options: ValidatorOptions = {}
): { valid: boolean; error: string | null } {
    const { throwOnError = false } = options;
    try {
        _secValidateCoordinates(lat, lng);
        return { valid: true, error: null };
    } catch (err) {
        const error = new Errors.ValidationError((err as Error).message, { lat, lng });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }
}

function _validateDataUrl(url: string, allowDataImages: boolean): void {
    if (!allowDataImages) {
        throw new Errors.SecurityError("Data URLs are not allowed", { url, protocol: "data:" });
    }
    // Parser and whitelist both come from the security module. Prefix-testing
    // `image/` here admitted arbitrary subtypes (`image/bmp`, `image/x-anything`)
    // that `security.validateUrl` rejects, so the same URL got opposite verdicts
    // depending on which validator a caller reached for.
    const dataType = _secExtractDataUrlMimeType(url);

    if (!dataType || !_secIsAllowedDataUrlType(dataType)) {
        throw new Errors.SecurityError("Only data:image URLs are allowed", { url, dataType });
    }
}

/**
 * Validates a URL and returns it resolved.
 *
 * The protocol allow-list is the substance of the check: it is what keeps `javascript:` out
 * of an attribute built from profile data. `data:` URLs are refused unless
 * `allowDataImages` is set, and even then only image MIME types pass.
 *
 * On success the third field carries the **resolved absolute** URL, so a relative input comes
 * back usable; on failure it is `null`.
 *
 * @param url - The URL to check, absolute or relative.
 * @param options - Allowed protocols, data-image policy, and {@link ValidatorOptions}.
 * @returns `{ valid, error, url }`, where `url` is the resolved absolute form or `null`.
 * @throws {@link GeoLeafError} A `ValidationError` when rejected and `throwOnError` is set.
 *
 * @example
 * ```js
 * // URL HTTPS valide
 * const result = GeoLeaf.Validators.validateUrl("https://example.com/data.json");
 * // Returns: { valid: true, error: null, url: 'https://example.com/data.json' }
 *
 * // Disallowed protocol
 * const result2 = GeoLeaf.Validators.validateUrl("ftp://example.com/file");
 * // Returns: { valid: false, error: 'Protocol "ftp:" not allowed', url: null }
 *
 * // Autoriser seulement HTTPS
 * const result3 = GeoLeaf.Validators.validateUrl("http://example.com", {
 *     allowedProtocols: ["https:"],
 * });
 * // Returns: { valid: false, error: 'Protocol "http:" not allowed', url: null }
 * ```
 */
function validateUrl(
    url: string,
    options: ValidateUrlOptions = {}
): { valid: boolean; error: string | null; url: string | null } {
    const {
        allowedProtocols = ["http:", "https:", "data:"],
        allowDataImages = true,
        throwOnError = false,
    } = options;

    if (!url || typeof url !== "string") {
        const error = new Errors.ValidationError("URL must be a non-empty string", {
            url,
            type: typeof url,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message, url: null };
    }

    try {
        // Resolve relative URLs against the real origin, like `security.validateUrl`.
        // A hardcoded placeholder base made this validator return an invented
        // domain in `result.url` for any relative input.
        const parsed = new URL(url, _secResolveBaseUrl());
        const protocol = parsed.protocol;

        if (!allowedProtocols.includes(protocol)) {
            if (protocol === "data:") {
                _validateDataUrl(url, allowDataImages);
            } else {
                throw new Errors.SecurityError(`Protocol "${protocol}" not allowed`, {
                    url,
                    protocol,
                    allowed: allowedProtocols,
                });
            }
        }

        if (protocol === "data:") {
            _validateDataUrl(url, allowDataImages);
        }

        return { valid: true, error: null, url: parsed.href };
    } catch (err) {
        if (throwOnError) throw err;
        return { valid: false, error: (err as Error).message, url: null };
    }
}

/**
 * Validates an email address, structurally.
 *
 * ⚠️ The check is deliberately shallow — non-empty local part, `@`, a dotted domain. It
 * accepts addresses that no mail server would, and rejects a few exotic-but-legal ones. It is
 * a typo filter for POI attributes, **not** a deliverability check.
 *
 * @param email - Value to check; anything that is not a non-empty string fails.
 * @param options - See {@link ValidatorOptions}.
 * @returns `{ valid, error }`; `error` is `null` when valid.
 * @throws {@link GeoLeafError} A `ValidationError` when invalid and `throwOnError` is set.
 *
 * @example
 * ```js
 * // Email valide
 * GeoLeaf.Validators.validateEmail("user@example.com");
 * // Returns: { valid: true, error: null }
 *
 * // Email invalide
 * GeoLeaf.Validators.validateEmail("not-an-email");
 * // Returns: { valid: false, error: 'Invalid email format' }
 *
 * // Supported formats
 * GeoLeaf.Validators.validateEmail("user+tag@sub.example.com"); // valide
 * GeoLeaf.Validators.validateEmail("user@domain.co.uk"); // valide
 * ```
 */
function validateEmail(
    email: unknown,
    options: ValidatorOptions = {}
): { valid: boolean; error: string | null } {
    const { throwOnError = false } = options;

    if (!email || typeof email !== "string") {
        const error = new Errors.ValidationError("Email must be a non-empty string", {
            email,
            type: typeof email,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        const error = new Errors.ValidationError("Invalid email format", { email });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    return { valid: true, error: null };
}

/**
 * Validates a phone number by shape and digit count.
 *
 * Two successive checks: the string may only contain digits, spaces, `+`, `-`, `(` and `)`;
 * and once every non-digit is stripped, at least **10 digits** must remain. Formatting is
 * therefore free — `"+33 6 12 34 56 78"` and `"06-12-34-56-78"` both pass.
 *
 * ⚠️ No country-specific rule is applied: a 10-digit sequence passes regardless of whether it
 * could be dialled.
 *
 * @param phone - Value to check; anything that is not a non-empty string fails.
 * @param options - See {@link ValidatorOptions}.
 * @returns `{ valid, error }`; `error` is `null` when valid.
 * @throws {@link GeoLeafError} A `ValidationError` when invalid and `throwOnError` is set.
 *
 * @example
 * ```js
 * GeoLeaf.Validators.validatePhone("+33 6 12 34 56 78");
 * // Returns: { valid: true, error: null }
 *
 * GeoLeaf.Validators.validatePhone("06-12-34-56-78");
 * // Returns: { valid: true, error: null }
 *
 * // Trop peu de chiffres
 * GeoLeaf.Validators.validatePhone("123");
 * // Returns: { valid: false, error: 'Phone number must contain at least 10 digits' }
 * ```
 */
function validatePhone(
    phone: unknown,
    options: ValidatorOptions = {}
): { valid: boolean; error: string | null } {
    const { throwOnError = false } = options;

    if (!phone || typeof phone !== "string") {
        const error = new Errors.ValidationError("Phone must be a non-empty string", {
            phone,
            type: typeof phone,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    const phoneRegex = /^[\d\s+\-()]+$/;
    if (!phoneRegex.test(phone)) {
        const error = new Errors.ValidationError("Invalid phone format", { phone });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
        const error = new Errors.ValidationError("Phone number must contain at least 10 digits", {
            phone,
            digitCount: digits.length,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    return { valid: true, error: null };
}

/**
 * Validates a zoom level against a range.
 *
 * Defaults to `[0, 20]`, both inclusive. `NaN` and the infinities are rejected explicitly, so
 * a value that arithmetic produced rather than a user is caught here rather than downstream.
 *
 * @param zoom - The zoom level.
 * @param options - Range plus {@link ValidatorOptions}; `min` defaults to `0`, `max` to `20`.
 * @returns `{ valid, error }`; `error` is `null` when valid.
 * @throws {@link GeoLeafError} A `ValidationError` when out of range and `throwOnError` is set.
 *
 * @example
 * ```js
 * GeoLeaf.Validators.validateZoom(12);
 * // Returns: { valid: true, error: null }
 *
 * GeoLeaf.Validators.validateZoom(25);
 * // Returns: { valid: false, error: 'Zoom must be between 0 and 20' }
 *
 * // Custom range
 * GeoLeaf.Validators.validateZoom(15, { min: 5, max: 18 });
 * // Returns: { valid: true, error: null }
 * ```
 */
function validateZoom(
    zoom: number,
    options: ValidateZoomOptions = {}
): { valid: boolean; error: string | null } {
    const { min = 0, max = 20, throwOnError = false } = options;

    if (typeof zoom !== "number") {
        const error = new Errors.ValidationError("Zoom must be a number", {
            zoom,
            type: typeof zoom,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    if (!Number.isFinite(zoom)) {
        const error = new Errors.ValidationError("Zoom must be a finite number", { zoom });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    if (zoom < min || zoom > max) {
        const error = new Errors.ValidationError(`Zoom must be between ${min} and ${max}`, {
            zoom,
            min,
            max,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    return { valid: true, error: null };
}

/**
 * Checks that an object carries a set of required top-level fields.
 *
 * Reports **every** missing field at once through the extra `missing` array, rather than
 * stopping at the first — a configuration error is more useful complete.
 *
 * @param config - Object to inspect; null or undefined counts every field as missing.
 * @param requiredFields - Names that must be present.
 * @param options - See {@link ValidatorOptions}.
 * @returns `{ valid, error, missing }`, where `missing` lists the absent names.
 * @throws {@link GeoLeafError} A `ValidationError` when fields are missing and `throwOnError`
 *   is set.
 *
 * @example
 * ```js
 * const config = { map: { target: "my-map" } };
 *
 * const result = GeoLeaf.Validators.validateRequiredFields(config, ["map", "layers"]);
 * // Returns: { valid: false, error: 'Missing required fields: layers', missing: ['layers'] }
 *
 * const result2 = GeoLeaf.Validators.validateRequiredFields(config, ["map"]);
 * // Returns: { valid: true, error: null, missing: [] }
 * ```
 */
function validateRequiredFields(
    config: Record<string, unknown> | null | undefined,
    requiredFields: string[],
    options: ValidatorOptions = {}
): { valid: boolean; error: string | null; missing: string[] } {
    const { throwOnError = false } = options;

    if (!config || typeof config !== "object") {
        const error = new Errors.ConfigError("Config must be an object", {
            config,
            type: typeof config,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message, missing: requiredFields };
    }

    const missing = requiredFields.filter(
        (field) => !(field in config) || config[field] === null || config[field] === undefined
    );

    if (missing.length > 0) {
        const error = new Errors.ConfigError(`Missing required fields: ${missing.join(", ")}`, {
            config,
            missing,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message, missing };
    }

    return { valid: true, error: null, missing: [] };
}

const _VALID_GEOJSON_TYPES = new Set([
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
    "Feature",
    "FeatureCollection",
]);

function _geoJSONCheck(
    condition: boolean,
    ErrorClass: new (msg: string, ctx: Record<string, unknown>) => Error,
    message: string,
    ctx: Record<string, unknown>,
    throwOnError: boolean
): { valid: false; error: string } | null {
    if (!condition) return null;
    const err = new ErrorClass(message, ctx);
    if (throwOnError) throw err;
    return { valid: false, error: err.message };
}

/**
 * Validates the structure of a GeoJSON object.
 *
 * ⚠️ Structural only: it checks that the `type` is known and that a `FeatureCollection`
 * carries a `features` array. It does **not** walk the geometries, so coordinates are not
 * range-checked — pair it with {@link validateCoordinates} where that matters.
 *
 * Like its siblings it throws a `ValidationError` when `throwOnError` is set — but the throw
 * is delegated to the shared `_geoJSONCheck` helper rather than raised here, so this block
 * carries no `@throws` tag: TSD-03 requires the tag to sit above a literal `throw`, and it
 * does not follow the call graph.
 *
 * @param geojson - Candidate GeoJSON object.
 * @param options - See {@link ValidatorOptions}.
 * @returns `{ valid, error }`; `error` is `null` when valid.
 *
 * @example
 * ```js
 * // FeatureCollection valide
 * const geojson = {
 *     type: "FeatureCollection",
 *     features: [
 *         {
 *             type: "Feature",
 *             geometry: { type: "Point", coordinates: [-73.5673, 45.5017] },
 *             properties: { name: "Montreal" },
 *         },
 *     ],
 * };
 * GeoLeaf.Validators.validateGeoJSON(geojson);
 * // Returns: { valid: true, error: null }
 *
 * // GeoJSON invalide (features manquant)
 * GeoLeaf.Validators.validateGeoJSON({ type: "FeatureCollection" });
 * // Returns: { valid: false, error: 'FeatureCollection must have a features array' }
 * ```
 */
function validateGeoJSON(
    geojson: Record<string, unknown> | null | undefined,
    options: ValidatorOptions = {}
): { valid: boolean; error: string | null } {
    const { throwOnError = false } = options;
    const fail = (
        ErrorClass: new (msg: string, ctx: Record<string, unknown>) => Error,
        msg: string,
        ctx: Record<string, unknown>
    ) => _geoJSONCheck(true, ErrorClass, msg, ctx, throwOnError)!;

    if (!geojson || typeof geojson !== "object") {
        return fail(Errors.ValidationError, "GeoJSON must be an object", {
            geojson,
            type: typeof geojson,
        });
    }
    if (!geojson.type) {
        return fail(Errors.ValidationError, "GeoJSON must have a type field", { geojson });
    }
    if (!_VALID_GEOJSON_TYPES.has(geojson.type as string)) {
        return fail(Errors.ValidationError, "Invalid GeoJSON type", {
            type: geojson.type,
            validTypes: [..._VALID_GEOJSON_TYPES],
        });
    }
    if (geojson.type === "Feature" && !geojson.geometry) {
        return fail(Errors.ValidationError, "Feature must have a geometry", { geojson });
    }
    if (geojson.type === "FeatureCollection" && !Array.isArray(geojson.features)) {
        return fail(Errors.ValidationError, "FeatureCollection must have a features array", {
            geojson,
        });
    }
    return { valid: true, error: null };
}

/**
 * Low-level hex-colour predicate — the single regex source for the codebase.
 *
 * ⚠️ **The two callers deliberately disagree on shorthand `#RGB`, and that is preserved.**
 * Profile *style* JSON (`style-validator-helpers.ts`) requires the full `#RRGGBB` and says
 * so in its error message; GeoJSON *feature properties* (`geojson/feature-validator.ts`)
 * accept both and say so in theirs. Collapsing them into one predicate would silently
 * either loosen the style contract or reject feature data that validates today — so the
 * option is explicit rather than the divergence being re-implemented twice (S5 backlog B.2).
 *
 * Distinct from `validateColor()` below, which also accepts `rgb()`/`rgba()` and defers to
 * `CSS.supports` — a much wider surface, and public API.
 *
 * @param value - Candidate colour.
 * @param options.shorthand - Accept the 3-digit `#RGB` form. Defaults to `false`.
 */
export function isHexColor(value: unknown, options: { shorthand?: boolean } = {}): boolean {
    if (typeof value !== "string") return false;
    return options.shorthand
        ? /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(value)
        : /^#[0-9A-Fa-f]{6}$/.test(value);
}

/**
 * Validates a CSS colour.
 *
 * Three literal forms are recognised without help — `#RGB`/`#RRGGBB`, `rgb()` and `rgba()`.
 * Everything else (named colours, `hsl()`, modern syntaxes) is delegated to
 * `CSS.supports("color", …)`.
 *
 * ⚠️ **That fallback is browser-only.** Where `CSS` is undefined — Node, SSR, a bare test
 * runner — `"red"` and `"hsl(120, 100%, 50%)"` are reported **invalid**, while the three
 * literal forms keep working. A colour validated server-side is therefore not validated by
 * the same rule as one validated in the page.
 *
 * @param color - Value to check; anything that is not a non-empty string fails.
 * @param options - See {@link ValidatorOptions}.
 * @returns `{ valid, error }`; `error` is `null` when valid.
 * @throws {@link GeoLeafError} A `ValidationError` when invalid and `throwOnError` is set.
 *
 * @example
 * ```js
 * GeoLeaf.Validators.validateColor("#ff0000"); // valide
 * GeoLeaf.Validators.validateColor("rgb(255, 0, 0)"); // valide
 * GeoLeaf.Validators.validateColor("rgba(0,0,0,0.5)"); // valide
 * GeoLeaf.Validators.validateColor("red"); // valide en navigateur (CSS.supports)
 * GeoLeaf.Validators.validateColor("hsl(120, 100%, 50%)"); // valide en navigateur
 * GeoLeaf.Validators.validateColor("#gggggg"); // invalide
 * ```
 */
function validateColor(
    color: unknown,
    options: ValidatorOptions = {}
): { valid: boolean; error: string | null } {
    const { throwOnError = false } = options;

    if (!color || typeof color !== "string") {
        const error = new Errors.ValidationError("Color must be a non-empty string", {
            color,
            type: typeof color,
        });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    // Explicit alternation rather than `{3}(...)?`: strictly equivalent (matches #RGB
    // and #RRGGBB, nothing else), but it drops the optional-group-after-quantifier
    // shape that `safe-regex` flags. The warning was a false positive — the pattern is
    // anchored and every quantifier bounded — so the fix here is the disable comment
    // going away, not the risk.
    const hexRegex = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
    const rgbRegex = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/;
    const rgbaRegex = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/;

    const isValid =
        hexRegex.test(color) ||
        rgbRegex.test(color) ||
        rgbaRegex.test(color) ||
        (typeof CSS !== "undefined" && CSS.supports("color", color));

    if (!isValid) {
        const error = new Errors.ValidationError("Invalid color format", { color });
        if (throwOnError) throw error;
        return { valid: false, error: error.message };
    }

    return { valid: true, error: null };
}

/**
 * Runs several validations and collects every failure.
 *
 * Each entry names its own validator, so heterogeneous checks share one pass. Messages are
 * prefixed by the entry's `label`, which is what makes an aggregate report readable. Unlike
 * the single-value validators, this one never throws — it returns the full
 * {@link ValidationResult}.
 *
 * @param validations - The checks to run; see {@link ValidateBatchItem}.
 * @returns `{ valid, errors }`, where `errors` holds one labelled message per failure and is
 *   empty when everything passed.
 *
 * @example
 * ```js
 * const result = GeoLeaf.Validators.validateBatch([
 *     {
 *         value: 45.5017,
 *         // `value` is typed `unknown`: an adapter must re-narrow before calling
 *         // a validator expecting a precise type.
 *         validator: (v, opts) => GeoLeaf.Validators.validateCoordinates(Number(v), 0, opts),
 *         label: "latitude",
 *     },
 *     {
 *         value: "https://example.com",
 *         validator: GeoLeaf.Validators.validateUrl,
 *         label: "url",
 *     },
 *     {
 *         value: "user@example.com",
 *         validator: GeoLeaf.Validators.validateEmail,
 *         label: "email",
 *     },
 * ]);
 * // Returns: { valid: true, errors: [] }
 * // Si erreurs : { valid: false, errors: ['latitude: ...', 'url: ...'] }
 * ```
 */
function validateBatch(validations: ValidateBatchItem[]): ValidationResult {
    const errors: string[] = [];

    for (const item of validations) {
        const { value, validator, options = {}, label = "value" } = item;

        if (typeof validator !== "function") {
            errors.push(`Invalid validator for ${label}`);
            continue;
        }

        const result = validator(value, { ...options, throwOnError: false });
        if (!result.valid) {
            errors.push(`${label}: ${result.error ?? "validation failed"}`);
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * The `GeoLeaf.Validators` façade — the generic value validators.
 *
 * Every member shares one convention: it **reports** by default (`{ valid, error }`) and only
 * throws when `throwOnError` is set. Style validation lives elsewhere, under
 * `StyleValidator`, and follows an accumulator convention instead.
 */
const Validators = {
    validateCoordinates,
    validateUrl,
    validateEmail,
    validatePhone,
    validateZoom,
    validateRequiredFields,
    validateGeoJSON,
    validateColor,
    validateBatch,
};

export {
    Validators,
    validateCoordinates,
    validateUrl,
    validateEmail,
    validatePhone,
    validateZoom,
    validateRequiredFields,
    validateGeoJSON,
    validateColor,
    validateBatch,
};
