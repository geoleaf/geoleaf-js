/**
 * Deterministic shuffle shared by `__tests__/presets/`'s permutation harnesses.
 *
 * Extracted from `manifest-shuffle.test.ts` on 08/08/2026, when
 * `shared-lifecycle-order.test.ts` needed it in turn. Not comfort
 * factoring: **two copies of a congruential generator are two seed
 * sequences that will diverge**, and the day one of the two guards turns
 * red, the printed seed would not replay the other. The file that carried
 * it already said so of `Math.random()` — the same reason holds against
 * duplication.
 *
 * This `_helpers/` directory is not collected by Vitest:
 * `packages/core/vitest.config.ts` globs `**\/__tests__\/**\/*.test.{js,ts}`,
 * and this file does not carry the suffix.
 */
"use strict";

/**
 * Deterministic permutation by linear congruential generator.
 *
 * `Math.random()` would make the failing run uninspectable: an integer seed
 * makes the failure replayable identically.
 *
 * @param items - List to permute. **Never mutated** — the copy is returned.
 * @param seed - Integer seed; the same seed always returns the same permutation.
 * @returns A new list carrying the same elements, in an order derived from `seed`.
 *
 * @example
 * ```ts
 * const a = shuffled([1, 2, 3, 4], 7);
 * const b = shuffled([1, 2, 3, 4], 7);
 * // a and b are identical — that is the whole point.
 * ```
 */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
    const out = [...items];
    let s = seed;
    const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff);
    for (let i = out.length - 1; i > 0; i--) {
        const j = next() % (i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
}
