/*!
 * GeoLeaf Core – Config / Module config (Plugin Contract v1)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { isUnsafeKey } from "../../../utils/general/object-path-guard.js";

/** Minimal reader contract — satisfied by the Config ConfigStore. */
interface ConfigReader {
    get(path: string, defaultValue?: unknown): unknown;
}

/**
 * Reads a module configuration value from the `modules.<moduleId>` block.
 *
 * This is the canonical read path of the Plugin Contract v1 (INV-CONFIG):
 * every plugin declares its config under `modules.<id>` in the profile and
 * reads it through this accessor (exposed publicly as
 * `Config.getModuleConfig`). The deprecated legacy root-key fallback was
 * removed in S14 — the contract is frozen, `modules.<id>` is the only form.
 *
 * @param reader - Config storage exposing `get(path, defaultValue)`.
 * @param moduleId - Plugin module id (e.g. `"editor"`, `"connector"`).
 * @param key - Optional dot-notation key inside the module block; omit to
 *   read the whole block.
 * @param defaultValue - Returned when the block (or key) does not resolve.
 */
export function resolveModuleConfig<T = unknown>(
    reader: ConfigReader,
    moduleId: string,
    key?: string,
    defaultValue?: T
): T {
    const block = reader.get(`modules.${moduleId}`);
    if (block !== undefined) {
        if (!key) return block as T;
        const value = reader.get(`modules.${moduleId}.${key}`);
        return (value === undefined ? defaultValue : value) as T;
    }
    return defaultValue as T;
}

/** Returns target.modules, creating it when absent or malformed. */
function _modulesBag(target: Record<string, unknown>): Record<string, unknown> {
    if (!target.modules || typeof target.modules !== "object" || Array.isArray(target.modules)) {
        target.modules = {};
    }
    return target.modules as Record<string, unknown>;
}

/**
 * Merges an incoming `modules` bag into `target.modules` entry by entry
 * (incoming entries override existing ones for the same module id, by
 * reference). A wholesale `target.modules = incoming` assignment would drop
 * bag entries owned by other plugins and declared elsewhere (e.g. in the
 * boot config when the incoming bag comes from a profile).
 */
export function mergeModulesBag(target: Record<string, unknown>, incoming: unknown): void {
    if (!target || typeof target !== "object" || Array.isArray(target)) return;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return;
    const bag = _modulesBag(target);
    for (const [moduleId, value] of Object.entries(incoming as Record<string, unknown>)) {
        // @security A profile is untrusted JSON, and `JSON.parse` yields `__proto__`
        // as an OWN property — so `Object.entries` lists it here and the assignment
        // below would hit the inherited setter and re-parent the bag. No module id is
        // ever one of the blocked keys, so refusing them costs nothing legitimate.
        // Skip the entry rather than abort: a profile mixing a hostile id with real
        // ones still has to configure the real ones.
        if (isUnsafeKey(moduleId)) continue;
        bag[moduleId] = value;
    }
}
