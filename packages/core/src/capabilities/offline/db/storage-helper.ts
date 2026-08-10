/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage Helper
 *
 * Provides validated and secure storage operations for localStorage and IndexedDB.
 * Prevents data corruption, injection attacks, and application crashes.
 *
 * Features:
 * - Validated localStorage operations
 * - Secure JSON parsing with fallback
 * - Unified IndexedDB operations with timeout
 * - Transaction validation with schemas
 *
 * @version 3.0.0
 */
"use strict";

import { Log } from "../../../utils/log/index.js";

interface ValidatorLike {
    validate?(value: unknown): boolean;
    sanitize?(value: unknown): unknown;
}

interface SchemaRules {
    type?: string;
    required?: boolean;
    min?: number;
    max?: number;
    validate?: (value: unknown) => boolean;
}

/**
 * Storage Helper Module
 * Provides secure and validated storage operations
 */
const StorageHelper = {
    /**
     * Set item in localStorage with validation
     *
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     * @param {Object} [validator] - Optional validator with validate() and sanitize() methods
     * @returns {boolean} Success status
     *
     * @example
     * // Avec validateur — un objet `{ validate?, sanitize? }`, fourni par l'appelant.
     * // ⚠️ Il n'existe PAS de validateur pré-fabriqué sur `GeoLeaf.Validators` pour ce
     * // rôle : cet exemple citait `GeoLeaf.Validators.Theme`, qui n'a jamais existé
     * // (corrigé le 27/07/2026, défaut trouvé par `typecheck-docs-examples`).
     * const themeValidator = {
     *     validate: (v: unknown) => v === "light" || v === "dark",
     *     sanitize: () => "light",
     * };
     * StorageHelper.setItem("theme", "dark", themeValidator);
     *
     * // Sans validateur
     * StorageHelper.setItem("config", JSON.stringify({ zoom: 12 }));
     */
    setItem(key: string, value: unknown, validator?: ValidatorLike): boolean {
        if (!key || typeof key !== "string") {
            Log.error("[StorageHelper] Invalid key provided:", key);
            return false;
        }

        try {
            // Validate if validator provided
            if (validator && typeof validator.validate === "function") {
                if (!validator.validate(value)) {
                    Log.warn("[StorageHelper] Validation failed for key:", key, "value:", value);

                    // Try to sanitize — then CHECK that it worked.
                    //
                    // The sanitized value used to be written straight out (B.7-D1). A
                    // `sanitize` returning something the same validator still rejects
                    // therefore reached storage, and the call reported success: the
                    // validator became advisory the moment a sanitizer existed, which is
                    // the opposite of what a sanitize/validate pair is for. Revalidating
                    // once is enough — a sanitizer that cannot produce a valid value on the
                    // first pass will not produce one on the second, and looping would hand
                    // an unbounded retry to caller-supplied code.
                    if (typeof validator.sanitize !== "function") {
                        return false;
                    }
                    value = validator.sanitize(value);
                    if (!validator.validate(value)) {
                        Log.error(
                            "[StorageHelper] Sanitized value is still invalid, refusing to store key:",
                            key
                        );
                        return false;
                    }
                    Log.info("[StorageHelper] Value sanitized for key:", key);
                }
            }

            // Check localStorage availability
            if (!globalThis.localStorage) {
                Log.warn("[StorageHelper] localStorage not available");
                return false;
            }

            // Store value (localStorage accepts string)
            globalThis.localStorage.setItem(key, typeof value === "string" ? value : String(value));

            Log.debug("[StorageHelper] setItem success:", key);
            return true;
        } catch (error) {
            Log.error("[StorageHelper] setItem error:", (error as Error).message);
            return false;
        }
    },

    /**
     * Get item from localStorage with validation and fallback
     *
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if key not found or invalid
     * @param {Object} [validator] - Optional validator with validate() method
     * @returns {*} Retrieved value or defaultValue
     *
     * @example
     * // Avec validateur et valeur par défaut — même contrat `{ validate?, sanitize? }`.
     * const themeValidator = { validate: (v: unknown) => v === "light" || v === "dark" };
     * const theme = StorageHelper.getItem("theme", "dark", themeValidator);
     *
     * // Lecture simple
     * const config = StorageHelper.getItem("config", null);
     */
    getItem(key: string, defaultValue: unknown, validator?: ValidatorLike): unknown {
        if (!key || typeof key !== "string") {
            Log.error("[StorageHelper] Invalid key provided:", key);
            return defaultValue;
        }

        try {
            // Check localStorage availability
            if (!globalThis.localStorage) {
                Log.warn("[StorageHelper] localStorage not available, returning default");
                return defaultValue;
            }

            const value = globalThis.localStorage.getItem(key);

            // Return default if null
            if (value === null) {
                Log.debug("[StorageHelper] Key not found:", key, "returning default");
                return defaultValue;
            }

            // Validate if validator provided
            if (validator && typeof validator.validate === "function") {
                if (!validator.validate(value)) {
                    Log.warn(
                        "[StorageHelper] Validation failed for key:",
                        key,
                        "returning default"
                    );
                    return defaultValue;
                }
            }

            Log.debug("[StorageHelper] getItem success:", key);
            return value;
        } catch (error) {
            Log.error("[StorageHelper] getItem error:", (error as Error).message);
            return defaultValue;
        }
    },

    /**
     * Remove item from localStorage
     *
     * @param {string} key - Storage key
     * @returns {boolean} Success status
     */
    removeItem(key: string): boolean {
        if (!key || typeof key !== "string") {
            Log.error("[StorageHelper] Invalid key provided:", key);
            return false;
        }

        try {
            if (!globalThis.localStorage) {
                return false;
            }

            globalThis.localStorage.removeItem(key);
            Log.debug("[StorageHelper] removeItem success:", key);
            return true;
        } catch (error) {
            Log.error("[StorageHelper] removeItem error:", (error as Error).message);
            return false;
        }
    },

    /**
     * Parse JSON safely with fallback
     *
     * @param {string} json - JSON string to parse
     * @param {*} defaultValue - Default value if parsing fails
     * @returns {*} Parsed object or defaultValue
     *
     * @example
     * const config = StorageHelper.parseJSON(stored, { theme: 'dark' });
     */
    parseJSON(json: string | null | undefined, defaultValue: unknown): unknown {
        if (json === null || json === undefined) {
            return defaultValue;
        }

        if (typeof json !== "string") {
            Log.warn("[StorageHelper] parseJSON: input not a string, returning default");
            return defaultValue;
        }

        try {
            const parsed = JSON.parse(json) as unknown;
            Log.debug("[StorageHelper] parseJSON success");
            return parsed;
        } catch (error) {
            Log.error(
                "[StorageHelper] parseJSON error:",
                (error as Error).message,
                "returning default"
            );
            return defaultValue;
        }
    },

    /**
     * Stringify JSON safely
     *
     * @param {*} data - Data to stringify
     * @param {string} [defaultValue='null'] - Default value if stringifying fails
     * @returns {string} JSON string or defaultValue
     *
     * @example
     * const json = StorageHelper.stringifyJSON({ theme: 'dark' });
     */
    stringifyJSON(data: unknown, defaultValue = "null"): string {
        try {
            const result = JSON.stringify(data);
            // `JSON.stringify` returns `undefined` — it does NOT throw — for values JSON
            // cannot represent (`undefined`, a bare function, a symbol). The catch below
            // therefore never runs for them, and the declared `: string` return type was
            // violated in silence: a caller doing `.length` on the result got a TypeError
            // far from here. Fall back like any other failure (B.7-D3).
            if (typeof result !== "string") {
                Log.warn("[StorageHelper] stringifyJSON: value is not JSON-representable");
                return defaultValue;
            }
            Log.debug("[StorageHelper] stringifyJSON success");
            return result;
        } catch (error) {
            Log.error("[StorageHelper] stringifyJSON error:", (error as Error).message);
            return defaultValue;
        }
    },

    /**
     * Open IndexedDB database with timeout and unified error handling
     *
     * @param {string} name - Database name
     * @param {number} version - Database version
     * @param {Function} [upgradeCallback] - Upgrade callback for onupgradeneeded
     * @param {number} [timeout=5000] - Timeout in milliseconds
     * @returns {Promise<IDBDatabase>}
     *
     * @example
     * const db = await StorageHelper.openDatabase('geoleaf-db', 2, (event) => {
     *     const db = event.target.result;
     *     if (!db.objectStoreNames.contains('layers')) {
     *         db.createObjectStore('layers', { keyPath: 'id' });
     *     }
     * });
     */
    openDatabase(
        name: string,
        version: number,
        upgradeCallback?: (event: IDBVersionChangeEvent) => void,
        timeout = 5000
    ): Promise<IDBDatabase> {
        if (!name || typeof name !== "string") {
            return Promise.reject(new Error("[StorageHelper] Invalid database name"));
        }

        if (!version || typeof version !== "number") {
            return Promise.reject(new Error("[StorageHelper] Invalid database version"));
        }

        // Check IndexedDB support
        if (!globalThis.indexedDB) {
            const error = new Error("[StorageHelper] IndexedDB not supported in this browser");
            Log.error(error.message);
            return Promise.reject(error);
        }

        return new Promise((resolve, reject) => {
            // Setup timeout
            const timeoutId = setTimeout(() => {
                const error = new Error(
                    `[StorageHelper] IndexedDB open timeout after ${timeout}ms`
                );
                Log.error(error.message);
                reject(error);
            }, timeout);

            Log.info(`[StorageHelper] Opening database: ${name} v${version}`);

            try {
                const request = globalThis.indexedDB.open(name, version);

                request.onerror = () => {
                    clearTimeout(timeoutId);
                    const err = new Error(
                        `[StorageHelper] Failed to open database: ${request.error?.message || "Unknown error"}`
                    );
                    Log.error(err.message);
                    reject(err);
                };

                request.onsuccess = () => {
                    clearTimeout(timeoutId);
                    const db = request.result;

                    // Validate database instance
                    if (!db || !(db instanceof IDBDatabase)) {
                        const error = new Error(
                            "[StorageHelper] Invalid database instance returned"
                        );
                        Log.error(error.message);
                        reject(error);
                        return;
                    }

                    Log.info(`[StorageHelper] Database opened successfully: ${name} v${version}`);
                    resolve(db);
                };

                request.onupgradeneeded = (event) => {
                    Log.info(
                        `[StorageHelper] Upgrading database: ${name} v${event.oldVersion} → v${event.newVersion}`
                    );

                    if (upgradeCallback && typeof upgradeCallback === "function") {
                        try {
                            upgradeCallback(event);
                        } catch (error) {
                            Log.error(
                                "[StorageHelper] Upgrade callback error:",
                                (error as Error).message
                            );
                            // Don't reject here, let the transaction handle it
                        }
                    }
                };

                // A blocked open is REJECTED, not merely logged.
                //
                // It fires when another live connection holds the database at an older
                // version and refuses to yield. Logging alone let the request hang until the
                // 15 s timeout above, and the caller's catch then installed the `_isStub`
                // fallback — turning a RECOVERABLE condition ("close the other tab") into a
                // silent, durable "no storage on this device", 15 s after the fact.
                //
                // The error carries a stable `name` so a caller can tell it apart from a
                // genuine failure and surface an actionable message. Rejecting here does not
                // cancel the underlying request; if the blocker goes away the browser still
                // fires `onsuccess`, which settles nothing (a promise settles once).
                request.onblocked = () => {
                    clearTimeout(timeoutId);
                    const err = new Error(
                        `[StorageHelper] Database open BLOCKED: another connection holds ` +
                            `"${name}" at an older version. Close the other tabs of this app.`
                    );
                    err.name = "GeoLeafDbBlockedError";
                    Log.error(err.message);
                    reject(err);
                };
            } catch (error) {
                clearTimeout(timeoutId);
                Log.error("[StorageHelper] Exception opening database:", (error as Error).message);
                reject(error);
            }
        });
    },

    /**
     * Validate data against schema before storing
     *
     * @param {Object} data - Data to validate
     * @param {Object} schema - Schema definition with field rules
     * @returns {boolean} True if valid
     * @throws {Error} Validation error with details
     *
     * @example
     * const schema = {
     *     id: { type: 'string', required: true },
     *     data: { type: 'object', required: true }
     * };
     * StorageHelper.validateBeforeStore(layer, schema);
     */
    validateBeforeStore(
        data: Record<string, unknown>,
        schema: Record<string, SchemaRules>
    ): boolean {
        if (!data || typeof data !== "object") {
            throw new Error("[StorageHelper] Data must be an object");
        }

        if (!schema || typeof schema !== "object") {
            throw new Error("[StorageHelper] Schema must be an object");
        }

        const errors: string[] = [];

        // Validate each field in schema. The per-field logic is extracted to
        // `_validateField` to keep this method's cyclomatic complexity ≤ 20 (core budget).
        for (const [key, rules] of Object.entries(schema) as [string, SchemaRules][]) {
            this._validateField(key, rules, data, errors);
        }

        if (errors.length > 0) {
            const errorMsg = `[StorageHelper] Validation failed: ${errors.join(", ")}`;
            Log.error(errorMsg);
            throw new Error(errorMsg);
        }

        Log.debug("[StorageHelper] Validation passed");
        return true;
    },

    /**
     * Validates a single schema field against `data`, pushing any failure messages onto
     * `errors`. Extracted from {@link validateBeforeStore} to keep that method within the
     * core cyclomatic-complexity budget (≤ 20). Behaviour is identical (a `continue` in the
     * former loop maps to an early `return` here).
     */
    _validateField(
        key: string,
        rules: SchemaRules,
        data: Record<string, unknown>,
        errors: string[]
    ): void {
        // Check required fields
        if (rules.required && !(key in data)) {
            errors.push(`Missing required field: ${key}`);
            return;
        }

        // Skip validation if field is not required and not present
        if (!rules.required && !(key in data)) {
            return;
        }

        const value = data[key];

        // Check type
        if (rules.type) {
            const actualType = Array.isArray(value) ? "array" : typeof value;

            if (actualType !== rules.type) {
                errors.push(`Invalid type for ${key}: expected ${rules.type}, got ${actualType}`);
            }
        }

        // Check min/max for numbers
        // Bounds apply to any numeric value, not only to fields that also declare
        // `type: "number"`. The check used to be gated on the declared type, so a schema
        // written `{ min: 5 }` enforced NOTHING and said nothing — the author got silence
        // instead of either a check or an error (B.7-D4). A non-numeric value under a
        // `min`/`max` rule is left to the type check above, which is where it belongs.
        if (typeof value === "number") {
            if (rules.min !== undefined && value < rules.min) {
                errors.push(`${key} must be >= ${rules.min}, got ${value}`);
            }
            if (rules.max !== undefined && value > rules.max) {
                errors.push(`${key} must be <= ${rules.max}, got ${value}`);
            }
        }

        // Check custom validator
        if (rules.validate && typeof rules.validate === "function") {
            try {
                if (!rules.validate(value)) {
                    errors.push(`Custom validation failed for ${key}`);
                }
            } catch (err) {
                errors.push(`Custom validation error for ${key}: ${(err as Error).message}`);
            }
        }
    },
};

/**
 * Public name of the {@link StorageHelper} module: validated localStorage access
 * (`setItem` / `getItem` / `removeItem`), safe JSON round-tripping, IndexedDB opening
 * with a timeout, and schema validation before storing.
 *
 * Exported under an alias so the module keeps one public name across the engine; the
 * TSDoc lives here too, since a consumer hovering the import sees the alias, not the
 * object it points at.
 */
const StorageHelperModule = StorageHelper;

export { StorageHelperModule };
