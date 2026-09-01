/**
 * @file overrides-reference-direct.guard.test.ts
 * @description Guard test — no root `package.json` `override` COPIES a direct
 * dependency, and no `$name` reference points to an absent direct.
 *
 * Why this guard exists — a trap paid on 24/08/2026, invisible while it holds
 * ------------------------------------------------------------------------------------
 * The `Dependabot Updates` job meant to rebase the dependency-bump PR died on
 * `npm error code EOVERRIDE — Override for @emnapi/core@1.11.3 conflicts
 * with direct dependency`. Five packages were declared TWICE — as a direct
 * dependency AND in `overrides`, with the same copied value: the three
 * `@emnapi/*`, the two `@csstools/*`.
 *
 * npm accepts an override that EXACTLY coincides with the direct. As soon as
 * a bump touches one without the other, they diverge and `npm install`
 * refuses — so the bump can NEVER land, and those packages are frozen with
 * nothing saying so. The trap is structural and invisible: while the two
 * copies are identical, everything is green. It only triggers at bump time,
 * and then it triggers every time.
 *
 * The remedy is npm's reference syntax — `"@emnapi/core": "$@emnapi/core"` —
 * which makes the override POINT at the direct instead of copying its value.
 * One source, no divergence possible.
 *
 * ## 🛑 The remedy creates its own trap, and this guard holds BOTH directions
 *
 * Measured the same day, on the same machine: removing the direct while
 * leaving the reference yields `npm error Unable to resolve reference
 * $@emnapi/core` — `npm install` dies too. The two breaking mutations:
 *
 *   ① an override copying a direct as a literal  → EOVERRIDE at the next bump;
 *   ② a `$name` reference whose direct vanished  → Unable to resolve reference.
 *
 * Direction ② was born from direction ①'s fix: precisely why the fix without
 * a guard would have moved the trap instead of closing it.
 *
 * ## Perimeter: the ROOT alone, and the flat forms
 *
 * npm only honours `overrides` in the installation's root `package.json` —
 * workspace ones are ignored, hence cannot produce these errors. Judged are
 * the flat values (`"name": "spec"`) and an object override's `"."` key,
 * which targets the package itself; a rule nested under another package does
 * not bear on the root's direct edge and does not enter the conflict.
 *
 * ## The witness does not depend on the repo's state
 *
 * Asserting "at least one override covers a direct" would fossilise the
 * current state: legitimately removing those five packages would turn the
 * guard red on a cleanup. The witness therefore makes the DETECTOR bite on
 * synthetic manifests — one defect of each direction, one accepted form of
 * each — at every run. Same pattern as `patternWitnesses()` in
 * `lib/registry-crossrefs.cjs`: the guard is seen red by construction, not
 * believed on its word.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const ROOT_MANIFEST = path.join(REPO_ROOT, "package.json");

/** The slice of a `package.json` this guard reads. */
interface Manifest {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    overrides?: Record<string, string | Record<string, string>>;
}

/** A found gap, with the gesture that fixes it. */
interface Finding {
    key: string;
    defect: string;
    gesture: string;
}

/**
 * The root's direct dependencies — the only ones an override can contradict.
 *
 * `peerDependencies` is deliberately out of play: a monorepo's root declares
 * none, and npm does not count them in the EOVERRIDE conflict.
 */
function directDeps(m: Manifest): Record<string, string> {
    return { ...m.dependencies, ...m.devDependencies, ...m.optionalDependencies };
}

/**
 * The flat spec an override applies to the `key` package itself, or
 * `undefined` if the rule is purely nested (it then does not target the
 * root's direct edge).
 */
function flatSpec(value: string | Record<string, string>): string | undefined {
    if (typeof value === "string") return value;
    return typeof value["."] === "string" ? value["."] : undefined;
}

/**
 * A manifest's gaps, in both measured directions.
 *
 * @param m The judged manifest — the real one, or a witness fixture.
 * @returns One gap per faulty override; empty when the property holds.
 */
function scanOverrides(m: Manifest): Finding[] {
    const direct = directDeps(m);
    const out: Finding[] = [];
    for (const [key, value] of Object.entries(m.overrides ?? {})) {
        const spec = flatSpec(value);
        if (spec === undefined) continue;
        const isRef = spec.startsWith("$");
        if (key in direct && !isRef) {
            // Direction ① — the literal copy. Identical today or not: the
            // DUPLICATION is the defect, the divergence only its due date.
            out.push({
                key,
                defect: `recopie la directe (override "${spec}", direct "${direct[key]}")`,
                gesture: `écrire "$${key}" — pointer la directe, pas la recopier`,
            });
        } else if (isRef) {
            const ref = spec.slice(1);
            if (!(ref in direct)) {
                // Direction ② — the orphan reference, created by ①'s fix.
                out.push({
                    key,
                    defect: `référence "$${ref}" sans dépendance directe de ce nom`,
                    gesture:
                        `redéclarer "${ref}" en directe, ou donner à l'override une spec ` +
                        `littérale maintenant qu'il est la seule source`,
                });
            }
        }
    }
    return out;
}

/** A gap's rendering in the failure message. */
function fmt(f: Finding): string {
    return `${f.key} — ${f.defect}\n      geste : ${f.gesture}`;
}

describe("OVERRIDES — un override ne recopie jamais une directe, une référence résout toujours", () => {
    it("🛑 le détecteur MORD — vu rouge sur les deux sens, à chaque run", () => {
        // Direction ①: the exact form paid on 24/08/2026 (identical values,
        // hence green for npm today — precisely the one the detector must refuse).
        const literal: Manifest = {
            devDependencies: { "@emnapi/core": "^1.11.2" },
            overrides: { "@emnapi/core": "^1.11.2" },
        };
        expect(
            scanOverrides(literal).map((f) => f.key),
            "le détecteur ne voit plus la recopie littérale — le sens ① est désarmé"
        ).toEqual(["@emnapi/core"]);

        // Direction ②: the reference whose direct vanished.
        const orphan: Manifest = {
            devDependencies: {},
            overrides: { "@emnapi/core": "$@emnapi/core" },
        };
        expect(
            scanOverrides(orphan).map((f) => f.key),
            "le détecteur ne voit plus la référence orpheline — le sens ② est désarmé"
        ).toEqual(["@emnapi/core"]);

        // The two SOUND forms: the paired reference, and the override of a
        // package that is NOT a direct (an override's normal use case — a pinned transitive).
        const sound: Manifest = {
            devDependencies: { "@emnapi/core": "^1.11.2" },
            overrides: { "@emnapi/core": "$@emnapi/core", tar: "^7.5.9" },
        };
        expect(
            scanOverrides(sound),
            "le détecteur accuse une forme saine — il rougirait en permanence, donc serait désarmé"
        ).toEqual([]);

        // The purely nested rule is out of perimeter, and must stay so: it
        // does not bear on the root's direct edge.
        const nested: Manifest = {
            devDependencies: { foo: "^1.0.0" },
            overrides: { bar: { foo: "^9.9.9" } },
        };
        expect(scanOverrides(nested)).toEqual([]);
    });

    it("lit un corpus non vide — anti-garde-vide", () => {
        const m = JSON.parse(fs.readFileSync(ROOT_MANIFEST, "utf8")) as Manifest;
        expect(
            Object.keys(directDeps(m)).length,
            `aucune dépendance directe lue dans ${path.relative(REPO_ROOT, ROOT_MANIFEST)} — ` +
                `le garde ne compare plus rien. Re-pointer la lecture, ne pas la neutraliser.`
        ).toBeGreaterThan(0);
    });

    it("le package.json RACINE tient la propriété, dans les deux sens", () => {
        const m = JSON.parse(fs.readFileSync(ROOT_MANIFEST, "utf8")) as Manifest;
        const findings = scanOverrides(m);
        expect(
            findings,
            `override(s) en défaut dans package.json :\n  ${findings.map(fmt).join("\n  ")}\n` +
                `  Les deux sens cassent \`npm install\` — l'un à la prochaine montée ` +
                `(EOVERRIDE), l'autre immédiatement (Unable to resolve reference). Mesurés ` +
                `tous deux le 24/08/2026.`
        ).toEqual([]);
    });
});
