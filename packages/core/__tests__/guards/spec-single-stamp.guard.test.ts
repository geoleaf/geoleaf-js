/**
 * @file spec-single-stamp.guard.test.ts
 * @description Guard — a spec sheet states the commit it was verified against ONCE, in its
 * frontmatter. A second copy of that fact in the prose is refused.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * 🛑 **Two surfaces for one fact, one of them ungated, always disagree in the same
 * direction: the ungated one lies.** Sheets carried `verifie_contre:` in their frontmatter —
 * which `check-specs-verified-against.cjs` reads and holds fresh — and a second, hand-written
 * `**Vérifié contre :** <sha>` in their opening prose, which nothing read. Re-stamping updates
 * the first; the second is forgotten.
 *
 * ⚠️ **Measured before being asserted.** One sheet had already caught its own copy drifting by
 * three commits and removed it, leaving the lesson written. A sweep on 06/09/2026 found the
 * pattern in 33 sheets, **10 of them already divergent** — and in all ten the prose LAGGED,
 * never the reverse. The ungated surface does not drift randomly; it decays backwards, because
 * it is the one nobody remembers to touch.
 *
 * ⚠️ **And the trap is armed by the very act of maintaining the sheet.** Seven of those ten
 * divergences were created in a single session, by correctly re-stamping the frontmatter of
 * seven sheets whose prose was left alone. Nothing warned; the sheets stayed green.
 *
 * What it locks
 * ------------------------------------------------------------------------------------
 * No commit hash may appear behind `**Vérifié contre :**` anywhere under `docs/specs/`. The
 * sheets point at the frontmatter instead. The stake is not cosmetic: these sheets ship to the
 * published mirror and into immutable npm tarballs, so a wrong statement there is permanent.
 */

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "node:fs";

const ROOT = resolve(__dirname, "../../../..");
const SPECS = resolve(ROOT, "docs/specs");

/** `**Vérifié contre :**` followed by a hash — the second surface, in any of its forms. */
const SECOND_STAMP = /\*\*Vérifié contre :\*\*\s*`[0-9a-f]{6,}`/;

/** Every sheet under `docs/specs/`. */
function sheets(): string[] {
    return globSync("**/*.md", { cwd: SPECS }).map((rel) => resolve(SPECS, rel));
}

describe("une fiche déclare son commit de vérification UNE fois", () => {
    const files = sheets();

    test("🛑 le corpus n'est pas vide — sinon ce fichier ne garde rien", () => {
        // A derived list that silently matches nothing is the failure mode this repository
        // names most often: a gate exiting green having scanned nothing.
        expect(files.length).toBeGreaterThan(0);
    });

    test("aucune fiche ne porte une SECONDE empreinte en prose", () => {
        const carriers = files
            .filter((abs) => SECOND_STAMP.test(readFileSync(abs, "utf8")))
            .map((abs) => relative(ROOT, abs));
        // Named, so the red says what to open — and the fix is always the same: point at the
        // frontmatter, which is the surface a gate actually reads.
        expect(carriers).toEqual([]);
    });
});
