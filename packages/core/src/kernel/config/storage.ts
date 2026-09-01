/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { isUnsafeKey } from "../../utils/general/object-path-guard.js";
import type { GeoLeafConfig } from "./geoleaf-config/config-types.js";

/**
 * Returns true (and logs) when `key` would pollute a prototype if assigned.
 *
 * @security Thin logging wrapper over the canonical blocklist
 * ({@link module:utils/general/object-path-guard}). Every writer in this module
 * applies it: `set()`, `deepMerge()` and `setValueByPath()`.
 *
 * The warning lives here rather than in the shared guard on purpose. This module's
 * input is a profile — untrusted, authored outside the repo — so a blocked key is a
 * signal worth surfacing. The other sinks receive code-originated keys, where the same
 * warning would be noise, and `Log` in the shared guard would give it a dependency
 * (see that module's header on why it must stay import-free). Four tests assert this
 * exact message; keep the string in sync with them if it ever changes.
 */
function _isUnsafeKey(key: string): boolean {
    if (isUnsafeKey(key)) {
        Log.warn("[GeoLeaf.Config.Storage] Prototype pollution attempt blocked", { key });
        return true;
    }
    return false;
}

/**
 * Module Config.Storage — the in-memory store of the consolidated configuration.
 *
 * Responsibilities:
 * - Holds and exposes the merged configuration object
 * - get/set API over dotted paths (`"a.b.c"`)
 * - Deep merge
 * - Path-walking helpers usable on arbitrary objects, not just the store
 */
const StorageModule: {
    _config: GeoLeafConfig | null;
    init(config: GeoLeafConfig): void;
    getAll(): GeoLeafConfig;
    get(path: string, defaultValue?: unknown): unknown;
    set(path: string, value: unknown): void;
    merge(config: Record<string, unknown> | null): void;
    getSection(sectionName: string, defaultValue?: unknown): unknown;
    deepMerge(
        target: Record<string, unknown> | null,
        source: Record<string, unknown> | null
    ): Record<string, unknown>;
    getValueByPath(source: Record<string, unknown>, path: string): unknown;
    setValueByPath(target: Record<string, unknown>, path: string, value: unknown): void;
} = {
    _config: null,

    /**
     * Installs the consolidated configuration object as the live store.
     * @param config - The merged configuration. Held by reference, not copied.
     */
    init(config: GeoLeafConfig): void {
        this._config = config;
    },

    /**
     * Returns the whole configuration.
     * @returns The live object (never null — an empty object before `init`). Mutating it
     * bypasses the prototype-pollution guards; prefer `set()`.
     */
    getAll(): GeoLeafConfig {
        return this._config || {};
    },

    /**
     * Reads a value through a dotted path.
     * @param path - Dotted path, e.g. `"ui.theme"` or `"modules.storage.cache.enabled"`.
     * @param defaultValue - Returned when the path is absent or the store is uninitialised.
     * @returns The value at `path`, or `defaultValue`.
     */
    get(path: string, defaultValue?: unknown): unknown {
        if (!this._config || !path || typeof path !== "string") {
            return defaultValue;
        }
        const result = this.getValueByPath(this._config as Record<string, unknown>, path);
        return result === undefined ? defaultValue : result;
    },

    /**
     * Deep-merges a partial configuration into the store.
     * @param config - Partial configuration. Non-objects and arrays are rejected with a warning.
     * @security Prototype-polluting keys are dropped — see `deepMerge`.
     */
    merge(config: Record<string, unknown> | null): void {
        if (!this._config) {
            Log.warn("[GeoLeaf.Config.Storage] Configuration non initialisée.");
            return;
        }
        if (!config || typeof config !== "object" || Array.isArray(config)) {
            Log.warn("[GeoLeaf.Config.Storage] merge() requiert un objet valide.");
            return;
        }
        this._config = this.deepMerge(
            this._config as Record<string, unknown>,
            config
        ) as GeoLeafConfig;
    },

    /**
     * Writes a value through a dotted path, creating intermediate objects as needed.
     * @param path - Dotted path, e.g. `"ui.theme"`.
     * @param value - Value to assign.
     * @security Refused (no-op + warning) when any path segment names a prototype key.
     */
    set(path: string, value: unknown): void {
        if (!this._config) {
            Log.warn("[GeoLeaf.Config.Storage] Configuration non initialisée.");
            return;
        }
        if (!path || typeof path !== "string") {
            Log.warn("[GeoLeaf.Config.Storage] set() requiert un chemin string non vide.");
            return;
        }
        const segments = path.split(".");
        let current: Record<string, unknown> = this._config as Record<string, unknown>;
        for (const [i, key] of segments.entries()) {
            if (_isUnsafeKey(key)) return;
            if (i === segments.length - 1) {
                current[key] = value;
            } else {
                if (
                    !Object.prototype.hasOwnProperty.call(current, key) ||
                    typeof current[key] !== "object" ||
                    current[key] === null
                ) {
                    current[key] = {};
                }
                current = current[key] as Record<string, unknown>;
            }
        }
    },

    /**
     * Reads a top-level section.
     * @param sectionName - Section key, e.g. `"map"` or `"ui"`.
     * @param defaultValue - Returned when the section is absent.
     */
    getSection(sectionName: string, defaultValue?: unknown): unknown {
        if (!sectionName) return defaultValue;
        const value = this.get(sectionName);
        return value === undefined ? defaultValue : value;
    },

    /**
     * Recursively merges `source` into a shallow copy of `target`.
     * Plain objects are merged; arrays and scalars are replaced, never concatenated.
     * @param target - Base object. Not mutated.
     * @param source - Overriding object.
     * @returns A new object; `target` is left untouched.
     * @security Prototype-polluting keys in `source` are skipped with a warning.
     */
    deepMerge(
        target: Record<string, unknown> | null,
        source: Record<string, unknown> | null
    ): Record<string, unknown> {
        const output = Object.assign({}, target || {});
        if (!source || typeof source !== "object") return output;
        Object.keys(source).forEach((key) => {
            if (_isUnsafeKey(key)) return;
            const srcVal = source[key];
            const tgtVal = output[key];
            if (
                srcVal &&
                typeof srcVal === "object" &&
                !Array.isArray(srcVal) &&
                tgtVal &&
                typeof tgtVal === "object" &&
                !Array.isArray(tgtVal)
            ) {
                output[key] = this.deepMerge(
                    tgtVal as Record<string, unknown>,
                    srcVal as Record<string, unknown>
                );
            } else {
                output[key] = srcVal;
            }
        });
        return output;
    },

    /**
     * Reads a dotted path out of an arbitrary object (not the store).
     * @param source - Object to walk.
     * @param path - Dotted path.
     * @returns The value, or `undefined` if any segment is missing.
     */
    getValueByPath(source: Record<string, unknown>, path: string): unknown {
        if (!source || !path) return undefined;
        const parts = path.split(".");
        let current: unknown = source;
        for (const part of parts) {
            if (current == null) return undefined;
            current = (current as Record<string, unknown>)[part];
        }
        return current;
    },

    /**
     * Writes a dotted path into an arbitrary object (not the store), creating intermediates.
     * @param target - Object to mutate.
     * @param path - Dotted path. In production this comes from a profile's `mapping.json` keys.
     * @param value - Value to assign.
     * @security Refused (no-op + warning) when any segment — the last included — names a
     * prototype key. See `_DANGEROUS_KEYS`.
     */
    setValueByPath(target: Record<string, unknown>, path: string, value: unknown): void {
        if (!target || !path) return;
        const parts = path.split(".");
        // Guard EVERY segment, the last one included: a single-segment path ("__proto__")
        // skips the descent loop below and lands straight on the final write. `some()`
        // short-circuits, so a hostile mapping logs once per POI, not once per segment.
        if (parts.some(_isUnsafeKey)) return;
        // `pop()` hands back the final segment as a value, so the descent walks what remains
        // and the last write needs no indexed read (qualite Q5).
        const last = parts.pop();
        if (last === undefined) return;
        let current: Record<string, unknown> = target;
        for (const key of parts) {
            if (!Object.prototype.hasOwnProperty.call(current, key) || current[key] == null) {
                current[key] = {};
            }
            current = current[key] as Record<string, unknown>;
        }
        current[last] = value;
    },
};

// Named `ConfigStore`, not `StorageHelper`: this is the in-memory store of the consolidated
// configuration, unrelated to `capabilities/offline/db/storage-helper.ts` (a localStorage
// wrapper) which owned the same concept name. That one exports `StorageHelperModule` and its
// consumers alias it back, so the clash was conceptual rather than a module-resolution
// conflict — but two unrelated "storage helpers" in one codebase is one too many.
// The runtime module identity is unchanged: log prefix stays `[GeoLeaf.Config.Storage]`.
const ConfigStore = StorageModule;
export { ConfigStore };
