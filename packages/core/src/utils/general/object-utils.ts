/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Helpers for object manipulation and nested property access.
 * @version 1.2.0
 * @since 2.1.0
 */

import { hasUnsafeSegment } from "./object-path-guard.js";

/**
 * Reads a nested value from an object through a dotted property path.
 * Handles null/undefined safely at every level.
 *
 * ⚠️ **Not interchangeable with `Utils.resolveField()`** (`general-utils.ts`), despite the
 * similar purpose. Verified divergences (KERNEL S11):
 *  - a miss returns `null` here, `""` there;
 *  - an empty `path` short-circuits to `null` here, but is *traversed* there;
 *  - `resolveField` **discards empty and whitespace-only strings**, turning `"  "` into a
 *    miss, while this function returns them verbatim;
 *  - `resolveField` is variadic (first hit across several paths wins), this one is single-path.
 *
 * Both are kept: they are published as `GeoLeaf.Utils.getNestedValue` /
 * `GeoLeaf.Utils.resolveField` and neither has an internal caller left, so unifying them
 * would change observable behaviour for integrators with no benefit to the library.
 *
 * @param obj - Source object.
 * @param path - Dotted path to the property (e.g. `'user.address.city'`).
 * @returns The value found, or `null` when the path does not resolve.
 */
export function getNestedValue<T = unknown>(
    obj: object | null | undefined,
    path: string
): T | null {
    if (!obj || typeof obj !== "object") {
        return null;
    }

    if (!path || typeof path !== "string") {
        return null;
    }

    const keys = path.split(".");
    let result: unknown = obj;

    for (const key of keys) {
        if (result == null) {
            return null;
        }
        result = (result as Record<string, unknown>)[key];
    }

    return result !== undefined ? (result as T) : null;
}

/**
 * Checks if un path de property existe dans an object.
 *
 * @param obj - Object source
 * @param path - Path to the property
 * @returns True si le path existe, false sinon
 */
export function hasNestedPath(obj: object | null | undefined, path: string): boolean {
    if (!obj || typeof obj !== "object" || !path) {
        return false;
    }

    const keys = path.split(".");
    let current: unknown = obj;

    for (const key of keys) {
        if (current == null || !Object.prototype.hasOwnProperty.call(current, key)) {
            return false;
        }
        current = (current as Record<string, unknown>)[key];
    }

    return true;
}

/**
 * Sets a value on an object through a dotted property path.
 * Creates intermediate objects as needed.
 *
 * @param obj - Target object
 * @param path - Path to the property
 * @param value - Value to assign
 * @returns The modified object
 * @security Path segments naming a prototype key are refused (no-op write).
 */
export function setNestedValue<T extends Record<string, unknown>>(
    obj: T,
    path: string,
    value: unknown
): T {
    if (!obj || typeof obj !== "object") {
        throw new Error("[ObjectUtils.setNestedValue] Invalid object");
    }

    if (!path || typeof path !== "string") {
        throw new Error("[ObjectUtils.setNestedValue] Invalid path");
    }

    const keys = path.split(".");
    // Guard every segment, the last one included — a single-segment path skips the loop.
    if (hasUnsafeSegment(keys)) return obj;

    const lastKey = keys.pop()!;
    let current: Record<string, unknown> = obj;

    for (const key of keys) {
        // Own-property check (not `key in current`): an inherited match must not be
        // followed, it would let a prototype-chain property stand in for a real
        // intermediate object and route the write onto the prototype.
        if (
            !Object.prototype.hasOwnProperty.call(current, key) ||
            typeof current[key] !== "object"
        ) {
            current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
    }

    current[lastKey] = value;

    return obj;
}
