/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Typed error classes for GeoLeaf.
 * Each error type includes context information and can be caught specifically.
 */

import { Log } from "../log/index.js";

// ── Types ──

interface ErrorContext {
    [key: string]: unknown;
}

interface ErrorToJSON {
    name: string;
    message: string;
    context: ErrorContext;
    timestamp: string;
    stack?: string;
}

type ErrorClassConstructor = new (message: string, context?: ErrorContext) => GeoLeafError;

// ── Base class ──

/**
 * Base class for every GeoLeaf error — a native `Error` carrying structured context.
 *
 * Beyond `message`, an instance holds a free-form `context` bag and an ISO-8601 `timestamp`
 * set at construction, so a caught error can be logged or serialised without the catch site
 * having to reconstruct where it came from. `name` is taken from the concrete constructor,
 * which is what makes the subclasses distinguishable after a `JSON.stringify`.
 *
 * ⚠️ `code` is declared here but **only set by the subclasses** — an instance of this base
 * class has `code === undefined`. Use {@link getErrorCode}, which falls back to
 * `"UNKNOWN_ERROR"`, rather than reading the field directly.
 *
 * @example
 * ```js
 * const error = new GeoLeaf.Errors.GeoLeafError("Erreur générique", {
 *     module: "Core",
 *     operation: "init",
 * });
 *
 * console.log(error.name); // 'GeoLeafError'
 * console.log(error.message); // 'Erreur générique'
 * console.log(error.context); // { module: 'Core', operation: 'init' }
 * console.log(error.timestamp); // '2026-03-15T10:30:00.000Z'
 * console.log(error.code); // undefined (base class)
 * ```
 */
export class GeoLeafError extends Error {
    context: ErrorContext;
    timestamp: string;
    declare code?: string;

    constructor(message: string, context: ErrorContext = {}) {
        super(message);
        this.name = this.constructor.name;
        this.context = context;
        this.timestamp = new Date().toISOString();
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    toJSON(): ErrorToJSON {
        return {
            name: this.name,
            message: this.message,
            context: this.context,
            timestamp: this.timestamp,
            ...(this.stack !== undefined && { stack: this.stack }),
        };
    }

    override toString(): string {
        const contextStr =
            Object.keys(this.context).length > 0
                ? ` [Context: ${JSON.stringify(this.context)}]`
                : "";
        return `${this.name}: ${this.message}${contextStr}`;
    }
}

// ── Specific error types ──

/**
 * Data failed validation — invalid coordinates, a missing parameter, a malformed shape.
 *
 * Code: `VALIDATION_ERROR`.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.ValidationError("Latitude must be between -90 and 90", {
 *     lat: 95,
 *     lng: -73,
 *     expected: "Range: -90 to 90",
 * });
 *
 * // Catch spécifique
 * try {
 *     GeoLeaf.Core.init({
 *         // options
 *     });
 * } catch (error) {
 *     if (error instanceof GeoLeaf.Errors.ValidationError) {
 *         console.error("Erreur de validation:", error.context);
 *     }
 * }
 * ```
 */
export class ValidationError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "VALIDATION_ERROR";
    }
}

/**
 * A security rule was violated — XSS-shaped content, a disallowed URL protocol, a non-image
 * data URL.
 *
 * Code: `SECURITY_ERROR`. Worth catching separately from {@link ValidationError}: this one
 * marks input that was actively rejected, not merely malformed, and is usually worth logging.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.SecurityError("Protocol not allowed: javascript:", {
 *     url: "javascript:alert(1)",
 *     allowedProtocols: ["http:", "https:", "data:"],
 * });
 *
 * try {
 *     GeoLeaf.Validators.validateUrl(userUrl, { throwOnError: true });
 * } catch (error) {
 *     if (error instanceof GeoLeaf.Errors.SecurityError) {
 *         console.error("Tentative de sécurité détectée");
 *         // Logger pour analyse
 *     }
 * }
 * ```
 */
export class SecurityError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "SECURITY_ERROR";
    }
}

/**
 * The configuration or profile is unusable — invalid JSON, a missing field, a malformed
 * profile structure.
 *
 * Code: `CONFIG_ERROR`.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.ConfigError("Invalid profile structure: missing layers", {
 *     profileId: "tourism",
 *     expected: "Array",
 *     received: "undefined",
 * });
 *
 * try {
 *     await GeoLeaf.Config.init({ url: "../data/geoleaf.config.json" });
 * } catch (error) {
 *     if (error instanceof GeoLeaf.Errors.ConfigError) {
 *         console.error("Configuration incorrecte:", error.message);
 *     }
 * }
 * ```
 */
export class ConfigError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "CONFIG_ERROR";
    }
}

/**
 * A network call failed — a rejected `fetch`, a timeout, an HTTP 4xx/5xx.
 *
 * Code: `NETWORK_ERROR`. This is the type worth retrying; see
 * {@link "utils/general/helpers-namespace"} for a backoff helper.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.NetworkError("Failed to load POI data", {
 *     url: "/api/poi",
 *     status: 404,
 *     statusText: "Not Found",
 * });
 * ```
 */
export class NetworkError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "NETWORK_ERROR";
    }
}

/**
 * Boot failed — the map could not be created, the target element is missing, a dependency
 * did not load.
 *
 * Code: `INITIALIZATION_ERROR`. Almost always fatal for the map instance: there is nothing
 * to degrade to.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.InitializationError("Failed to create map: target element not found", {
 *     target: "map-container",
 *     domReady: document.readyState,
 * });
 * ```
 */
export class InitializationError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "INITIALIZATION_ERROR";
    }
}

/**
 * A MapLibre-side operation failed — a layer is missing, a camera move is impossible.
 *
 * Code: `MAP_ERROR`.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.MapError("Cannot fit bounds: no features loaded", {
 *     operation: "fitBounds",
 *     featureCount: 0,
 * });
 * ```
 */
export class MapError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "MAP_ERROR";
    }
}

/**
 * Generic data failure — a malformed payload or a parse that did not complete.
 *
 * Code: `DATA_ERROR`. The catch-all of the data family: prefer {@link POIError} or
 * {@link RouteError} when the subject is known.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.DataError("Invalid data structure", {
 *     source: "api/response",
 *     expected: "array",
 *     received: typeof data,
 * });
 * ```
 */
export class DataError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "DATA_ERROR";
    }
}

/**
 * A point of interest could not be handled — malformed entry, failed load, invalid marker.
 *
 * Code: `POI_ERROR`.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.POIError("Invalid POI: missing latlng", {
 *     poiId: "poi-123",
 *     provided: { id: "poi-123", label: "Test" },
 *     expected: "latlng: [lat, lng]",
 * });
 * ```
 */
export class POIError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "POI_ERROR";
    }
}

/**
 * A route could not be processed — malformed GPX, a parse failure, an empty track.
 *
 * Code: `ROUTE_ERROR`.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.RouteError("Failed to parse GPX: invalid XML", {
 *     url: "route.gpx",
 *     parseError: "Unexpected end of input",
 * });
 * ```
 */
export class RouteError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "ROUTE_ERROR";
    }
}

/**
 * A user-interface operation failed — an uninitialised component, a failed render, a missing
 * container.
 *
 * Code: `UI_ERROR`. Usually recoverable: the map keeps working without the panel.
 *
 * @example
 * ```js
 * throw new GeoLeaf.Errors.UIError("Panel render failed: container not found", {
 *     panelId: "sidepanel",
 *     operation: "render",
 * });
 * ```
 */
export class UIError extends GeoLeafError {
    declare code: string;
    constructor(message: string, context: ErrorContext = {}) {
        super(message, context);
        this.code = "UI_ERROR";
    }
}

// ── Error codes enum ──

/**
 * The machine-readable code carried by each error subclass, frozen.
 *
 * Keys are the short family names; values are the strings that land on `error.code`. Compare
 * against these rather than against literals, so a rename stays a compile-time concern.
 *
 * @example
 * ```js
 * GeoLeaf.Errors.ErrorCodes.VALIDATION; // 'VALIDATION_ERROR'
 * GeoLeaf.Errors.ErrorCodes.SECURITY; // 'SECURITY_ERROR'
 * GeoLeaf.Errors.ErrorCodes.CONFIG; // 'CONFIG_ERROR'
 * GeoLeaf.Errors.ErrorCodes.NETWORK; // 'NETWORK_ERROR'
 * GeoLeaf.Errors.ErrorCodes.INITIALIZATION; // 'INITIALIZATION_ERROR'
 * GeoLeaf.Errors.ErrorCodes.MAP; // 'MAP_ERROR'
 * GeoLeaf.Errors.ErrorCodes.DATA; // 'DATA_ERROR'
 * GeoLeaf.Errors.ErrorCodes.POI; // 'POI_ERROR'
 * GeoLeaf.Errors.ErrorCodes.ROUTE; // 'ROUTE_ERROR'
 * GeoLeaf.Errors.ErrorCodes.UI; // 'UI_ERROR'
 * ```
 */
export const ErrorCodes = Object.freeze({
    VALIDATION: "VALIDATION_ERROR",
    SECURITY: "SECURITY_ERROR",
    CONFIG: "CONFIG_ERROR",
    NETWORK: "NETWORK_ERROR",
    INITIALIZATION: "INITIALIZATION_ERROR",
    MAP: "MAP_ERROR",
    DATA: "DATA_ERROR",
    POI: "POI_ERROR",
    ROUTE: "ROUTE_ERROR",
    UI: "UI_ERROR",
});

// ── Utility functions ──

/**
 * Coerces any caught value into a {@link GeoLeafError}.
 *
 * A `catch` binding is `unknown` — it may be an `Error`, a string, a plain object from a
 * rejected fetch, or anything a third party threw. This flattens all of it to one shape so a
 * handler can rely on `.context` and `.toString()`.
 *
 * ⚠️ An existing `Error` is **passed through and cast**, not rebuilt: the result keeps the
 * original prototype, so a `TypeError` stays a `TypeError` and gains no `context`. Only
 * non-`Error` values are wrapped, with the original preserved under `context.originalError`.
 *
 * @param error - The caught value, of any shape.
 * @param defaultMessage - Message used when nothing usable can be extracted.
 *   Defaults to `"An unknown error occurred"`.
 * @returns The value as a `GeoLeafError`.
 *
 * @example
 * ```js
 * try {
 *     // code risqué
 * } catch (rawError) {
 *     const err = GeoLeaf.Errors.normalizeError(rawError, "Unexpected error");
 *     GeoLeaf.Log.error(err.toString());
 * }
 * ```
 */
export function normalizeError(
    error: unknown,
    defaultMessage: string = "An unknown error occurred"
): GeoLeafError {
    if (error instanceof Error) return error as GeoLeafError;
    if (typeof error === "string") return new GeoLeafError(error);
    if (error && typeof error === "object") {
        const obj = error as { message?: string; error?: string };
        const message = obj.message || obj.error || defaultMessage;
        return new GeoLeafError(message, { originalError: error });
    }
    return new GeoLeafError(defaultMessage, { originalError: error });
}

/**
 * Tests whether a value is an instance of a given error class.
 *
 * A thin wrapper over `instanceof`, useful where the class is held in a variable. Note that
 * subclasses match their ancestors: every GeoLeaf error satisfies a test against
 * {@link GeoLeafError}, so order the checks from specific to general.
 *
 * @param error - The value to test.
 * @param ErrorClass - The constructor to test against.
 * @returns `true` if `error` is an instance of `ErrorClass`.
 *
 * @example
 * ```js
 * const isConfig = GeoLeaf.Errors.isErrorType(error, GeoLeaf.Errors.ConfigError);
 * ```
 */
export function isErrorType(error: unknown, ErrorClass: typeof GeoLeafError): boolean {
    return error instanceof ErrorClass;
}

/**
 * Reads the machine code off any value, without assuming it is an error.
 *
 * Any object carrying a `code` property yields it — including native `DOMException` and
 * Node-style errors, which is deliberate. Anything else yields `"UNKNOWN_ERROR"`, so the
 * result is always a usable string.
 *
 * @param error - The value to inspect.
 * @returns The `code` property, or `"UNKNOWN_ERROR"`.
 *
 * @example
 * ```js
 * const code = GeoLeaf.Errors.getErrorCode(error);
 * // 'VALIDATION_ERROR' | 'CONFIG_ERROR' | ... | 'UNKNOWN_ERROR'
 * ```
 */
export function getErrorCode(error: unknown): string {
    if (error && typeof error === "object" && "code" in error)
        return (error as { code: string }).code;
    return "UNKNOWN_ERROR";
}

/**
 * Builds a typed error whose stack starts at the caller, not inside this helper.
 *
 * The only reason to prefer this over `new ValidationError(...)`: `captureStackTrace` elides
 * this frame, so the top of the stack is the code that decided to fail. Without it, every
 * error built through a factory points at the factory.
 *
 * @param ErrorClass - Constructor to instantiate.
 * @param message - Error message.
 * @param context - Structured context attached to the instance. Defaults to `{}`.
 * @returns The constructed error, not thrown.
 *
 * @example
 * ```js
 * const err = GeoLeaf.Errors.createError(GeoLeaf.Errors.ValidationError, "Invalid zoom level", {
 *     zoom: 25,
 *     max: 20,
 * });
 * ```
 */
export function createError(
    ErrorClass: ErrorClassConstructor,
    message: string,
    context: ErrorContext = {}
): GeoLeafError {
    const err = new ErrorClass(message, context);
    if (Error.captureStackTrace) {
        Error.captureStackTrace(err, createError);
    }
    return err;
}

/**
 * String-key → class registry backing `createErrorByType()`.
 *
 * ⚠️ **This is the only consumer of several classes above** — and it is invisible to any
 * search by token, which is exactly why a dead-code sweep reported 7 of them as unused
 * (S5 backlog B.3). Deleting `NetworkError` does not break a single import; it breaks
 * `createErrorByType("network")` at runtime, silently. The classes are also public API
 * (`GeoLeaf.Errors.*`, documented in `docs/errors/GeoLeaf_Errors_README.md`, mounted on the
 * global by `globals.core.ts` and re-exported by `kernel-exports.ts`). Do not purge.
 * ⚠️ This justification used to cite the root `index.d.ts` as well; it was removed at ARCHI
 * S6 (never published, drifted from the code). The two anchors above are the live ones —
 * they are what actually puts these classes in front of an integrator.
 */
const errorMap: Record<string, ErrorClassConstructor> = {
    validation: ValidationError,
    security: SecurityError,
    config: ConfigError,
    network: NetworkError,
    initialization: InitializationError,
    map: MapError,
    data: DataError,
    poi: POIError,
    route: RouteError,
    ui: UIError,
};

/**
 * Builds a typed error from a string family name.
 *
 * For call sites where the family is data — a server field, a config value — rather than a
 * symbol. Accepted types: `"validation"`, `"security"`, `"config"`, `"network"`,
 * `"initialization"`, `"map"`, `"data"`, `"poi"`, `"route"`, `"ui"`; matching is
 * case-insensitive.
 *
 * ⚠️ **An unknown type is not an error**: it silently yields a base {@link GeoLeafError},
 * which has no `code`. A typo in the family name therefore degrades the error rather than
 * announcing itself.
 *
 * @param type - Family name; unknown values fall back to the base class.
 * @param message - Error message.
 * @param context - Structured context attached to the instance. Defaults to `{}`.
 * @returns The constructed error, not thrown.
 *
 * @example
 * ```js
 * const err = GeoLeaf.Errors.createErrorByType("validation", "Invalid value", { value: 42 });
 * // Retourne une instance de ValidationError
 * ```
 */
export function createErrorByType(
    type: string,
    message: string,
    context: ErrorContext = {}
): GeoLeafError {
    const ErrorClass = errorMap[type.toLowerCase()] || GeoLeafError;
    return createError(ErrorClass, message, context);
}

const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Escapes an error message for HTML display and caps its length.
 *
 * Escapes `& < > " '`, then truncates to `maxLength` and appends an ellipsis. Intended for
 * messages that may embed user input and are about to reach the DOM — a server error echoing
 * a submitted value is the usual case.
 *
 * ⚠️ This escapes **text**, it is not a sanitiser for markup: it is safe for text content and
 * attribute values, not for injecting HTML. For anything richer, go through
 * `security/dom-security`. ⚠️ Truncation happens **after** escaping, so an entity can be cut
 * mid-sequence; the result is safe but may end on a stray fragment.
 *
 * @param message - Value to render; non-strings are stringified, null-ish yields
 *   `"Unknown error"`.
 * @param maxLength - Maximum length before truncation. Defaults to `500`.
 * @returns An escaped, length-capped string.
 *
 * @example
 * ```js
 * const safe = GeoLeaf.Errors.sanitizeErrorMessage(userInput, 500);
 * ```
 */
export function sanitizeErrorMessage(
    message: unknown,
    maxLength: number = MAX_ERROR_MESSAGE_LENGTH
): string {
    if (message == null) return "Unknown error";
    let str = typeof message === "string" ? message : String(message);
    str = str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    if (str.length > maxLength) {
        str = str.slice(0, maxLength) + "...";
    }
    return str;
}

/**
 * Invokes a user-supplied error handler without letting it throw.
 *
 * A handler that fails while reporting a failure would replace the original error with its
 * own — the classic way to lose the interesting one. Here both are logged and neither
 * escapes. A missing or non-function handler is a no-op, so callers need no guard.
 *
 * @param handler - Optional callback; anything that is not a function is ignored.
 * @param error - The error to hand to it.
 *
 * @example
 * ```js
 * GeoLeaf.Errors.safeErrorHandler(onError, caughtError);
 * ```
 */
export function safeErrorHandler(
    handler: ((err: unknown) => void) | undefined,
    error: unknown
): void {
    if (typeof handler !== "function") return;
    try {
        handler(error);
    } catch (handlerError: unknown) {
        (Log as { error: (...args: unknown[]) => void }).error(
            "[GeoLeaf.Errors] Error in error handler:",
            handlerError
        );
        (Log as { error: (...args: unknown[]) => void }).error(
            "[GeoLeaf.Errors] Original error:",
            error
        );
    }
}

// ── Aggregate export (facade) ──

/**
 * The `GeoLeaf.Errors` façade — every error class, the code table and the helpers.
 *
 * Mounted on the global namespace by `globals.core.ts` and re-exported by
 * `kernel-exports.ts`. Its members are the same objects exported individually from this
 * module; the façade exists so integrators can reach them without a deep import.
 */
export const Errors = {
    GeoLeafError,
    ValidationError,
    SecurityError,
    ConfigError,
    NetworkError,
    InitializationError,
    MapError,
    DataError,
    POIError,
    RouteError,
    UIError,
    normalizeError,
    isErrorType,
    getErrorCode,
    createError,
    createErrorByType,
    sanitizeErrorMessage,
    safeErrorHandler,
    ErrorCodes,
};
