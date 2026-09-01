/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Canonical prototype-pollution blocklist for dynamic-key writes.
 *
 * @security This is the SINGLE SOURCE for "which keys must never be a write target".
 * The same three-key list long lived in four divergent copies — the config
 * store, `object-utils`, `general-utils` and the MapLibre style converter — as an
 * Array, a second Array declared *inside* a recursive function body, a third Array,
 * and a Set. Three of the four blocked silently. Divergence is the one thing a
 * blocklist cannot afford: a measured hole was a single sink an earlier sweep had
 * simply not reached, and a fifth copy is how that happens again.
 *
 * Deliberately DEPENDENCY-FREE, and that is not incidental. Having zero imports is
 * what lets every layer — `kernel/config`, `utils`, `adapters`, `capabilities` —
 * import it without creating an architectural edge or risking a cycle, which is
 * precisely the objection that had kept `object-utils.ts` on a local copy ("importing
 * the config guard would create a utils -> built-in/config edge"). Do not add imports
 * here, not even `Log`: logging is the caller's policy, and only the config store has
 * a reason to warn (its input is an untrusted profile). Adding `Log` would re-couple
 * this module to the log barrel and hand the next reader a reason to copy it again.
 *
 * @see docs/security/SECURITY_CONTRACT.md §1.3 for the sink inventory.
 */

/**
 * Keys that must never be used as a dynamic write target.
 *
 * `__proto__` is the live vector: `obj[k] = v` with `k === "__proto__"` invokes the
 * inherited accessor and re-parents `obj`. `JSON.parse` is what puts it in reach —
 * it yields `__proto__` as an OWN, enumerable property, so `Object.keys` and
 * `Object.entries` list it, unlike an object literal (where `{ __proto__: x }` sets
 * the prototype at parse time and is never enumerated). Any fixture or guard reasoning
 * about this must go through `JSON.parse` to be meaningful.
 *
 * `constructor` and `prototype` are the chain hops (`constructor.prototype.x`). They
 * cannot re-parent on their own, but assigning them shadows a property that callers
 * legitimately read — `bag.constructor` no longer being `Object` is enough to break
 * downstream duck-typing.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Returns true when `key` would touch a prototype if used as a write target.
 *
 * @param key - The candidate property name.
 * @returns `true` when the key must be refused.
 *
 * @example
 * ```ts
 * for (const [k, v] of Object.entries(untrusted)) {
 *     if (isUnsafeKey(k)) continue;
 *     bag[k] = v;
 * }
 * ```
 */
export function isUnsafeKey(key: string): boolean {
    return UNSAFE_KEYS.has(key);
}

/**
 * Returns true when ANY segment of a dotted path is unsafe — the last one INCLUDED.
 *
 * @param segments - The path already split on `"."`.
 * @returns `true` when the whole write must be refused.
 *
 * @remarks
 * The "last one included" is the whole point and was the measured bug: a
 * single-segment path (`"__proto__"`) skips the descent loop entirely and lands
 * straight on the final assignment, so a guard that only covers the loop leaves the
 * shortest possible attack open. Callers must refuse the entire write rather than
 * skip a segment — a partially-applied path writes to somewhere nobody asked for.
 */
export function hasUnsafeSegment(segments: readonly string[]): boolean {
    for (const segment of segments) {
        if (UNSAFE_KEYS.has(segment)) return true;
    }
    return false;
}

/**
 * Frozen view of the blocklist, for tests and gates that assert its contents.
 *
 * @remarks
 * Exported so the guard test can pin the list: an entry silently disappearing here
 * would weaken every sink at once, which is the flip side of having a single source.
 */
export const UNSAFE_KEY_LIST: readonly string[] = Object.freeze([...UNSAFE_KEYS]);
