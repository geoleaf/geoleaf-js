/**
 * Mélange déterministe partagé par les harnais de permutation de `__tests__/presets/`.
 *
 * Extrait de `manifest-shuffle.test.ts` le 08/08/2026, quand `shared-lifecycle-order.test.ts`
 * en a eu besoin à son tour. Ce n'est pas de la factorisation de confort : **deux copies d'un
 * générateur congruentiel sont deux suites de graines qui divergeront**, et le jour où l'une des
 * deux gardes rougit, la graine imprimée ne rejouerait pas l'autre. Le fichier qui le portait le
 * disait déjà de `Math.random()` — la même raison vaut contre la duplication.
 *
 * Ce répertoire `_helpers/` n'est pas ramassé par Vitest : `packages/core/vitest.config.ts`
 * globe `**\/__tests__\/**\/*.test.{js,ts}`, et ce fichier ne porte pas le suffixe.
 */
"use strict";

/**
 * Permutation déterministe par générateur congruentiel linéaire.
 *
 * `Math.random()` rendrait ininspectable le run qui rougit : une graine entière rend l'échec
 * rejouable à l'identique.
 *
 * @param items - Liste à permuter. **Jamais mutée** — la copie est rendue.
 * @param seed - Graine entière ; la même graine rend toujours la même permutation.
 * @returns Une nouvelle liste portant les mêmes éléments, dans un ordre dérivé de `seed`.
 *
 * @example
 * ```ts
 * const a = shuffled([1, 2, 3, 4], 7);
 * const b = shuffled([1, 2, 3, 4], 7);
 * // a et b sont identiques — c'est tout l'intérêt.
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
