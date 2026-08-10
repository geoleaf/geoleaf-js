/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Runtime type guards for narrowing untyped feature / properties data.
 *
 * GeoJSON `properties` arrive as an opaque `Record<string, unknown>`; these guards
 * turn `unknown` into a concrete value (or `null`) at the call site, replacing the
 * `as any` casts spread across loaders, popups and renderers
 * (roadmap_typage-strict.md, S1 — adopted progressively from S3 onward).
 */

/** Narrows `unknown` to a plain object (non-null, non-array), else `null`. */
export function asObject(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** Narrows `unknown` to an array, else `null`. */
export function asArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
}
