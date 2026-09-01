/**
 * Guard GEN — the two example entries are GENERATED, and the disk proves it.
 *
 * ## What the guard replaces, and why it is not a CI step
 *
 * The plan asked for a `git diff --exit-code examples/` step. It is carried
 * here, as a test, for a simple reason: a CI step must enrol in
 * `scripts/ci-local.cjs` **and** in `.github/workflows/ci.yml`, while this
 * test is picked up by the existing suite and adds **no enrolment** — hence
 * nothing to keep in sync.
 *
 * 🛑 **This header gave another, technical motive, and it was FALSE** (fixed
 * on 08/08/2026). It claimed "**PARITY-11 compares the command lists on both
 * sides** — forgetting either enrolment turns `ci:local` red". **The gate is
 * DIRECTIONAL**: `ci.yml ⊆ ci:local`. It iterates `ci.yml`'s leaves and has
 * no reverse loop; PARITY-11 itself only targets the leaves enrolled in
 * `DEFERRED_TO_E2E`. Measured: a step added to `ci-local.cjs` with no remote
 * equivalent comes out **green and silent**. Forgetting `ci.yml` would thus
 * have turned nothing red at all — WORSE than what the sentence described,
 * and changing nothing to the choice made here.
 *
 * ⚠️ What is lost, written so it is not forgotten: `git diff` would see an
 * **uncommitted** manual edit, this test does not. The targeted defect is
 * drift over TIME, not the index's state — but the nuance is real.
 *
 * ## The GEN rules
 *
 * ⚠️ This title wrote "the THREE rules" until 08/08/2026 — there were four
 * (GEN-04 entered later), not counting the four DEPs set in the same file.
 * The number is removed rather than corrected: the same gesture the repo's
 * doctrine applies everywhere else here, and the only form that does not
 * expire at the next rule.
 *
 *   GEN-01  **Each entry is identical to what the generator produces** from
 *           its own marker's `caps=`. The non-drift proper.
 *   GEN-02  **`minimal`'s "Left out" list is exactly `caps=`'s complement.**
 *           The same defect class as before — a prose list next to a code
 *           list —, and the only place in the batch where it deliberately
 *           survives (it carries reasoning the generator cannot write). Kept
 *           rather than removed.
 *   GEN-03  **The corpus is not empty** — two entries expected, not zero.
 *   GEN-04  **The generator sees ALL of `FULL.capabilities`, in the same
 *           order.** It puts the array's TWO extractors face to face: the one
 *           that PARSES it (`gen-entry.cjs`) and the one that IMPORTS it
 *           (here, like `manifest-full-completeness`). Their disagreement
 *           was real — 16 against 21 — and no rule saw it.
 *
 * ## Proof by mutation — seen on 08/08/2026, REDS **and** GREENS
 *
 * A guard never seen red guards nothing; a guard not seen STAYING green may
 * only be right by luck. The eight mutations, and what they yielded:
 *
 *   M-B1  restoring the 07/08 algorithm (bound on RAW text)  → 🔴 GEN-04,
 *         **naming the five**: `language-switcher, profile-switcher,
 *         theme-palette, theme-selector, vector-tiles`. The exact
 *         regression, reproduced and named.
 *   M-B2  `.reverse()` at `manifestOrder()`'s end             → 🔴 GEN-04 (ORDER half)
 *   M-B3  a comment carrying `["x"],` inside the array        → 🟢 **stays green**
 *   M-B4a a FULL-LINE comment citing `FILTER_INSTALLER`       → 🟢 **stays green**
 *   M-B4b the same at END OF LINE                             → 🟢 **stays green**
 *   M-B5  `capabilityDirs()` returns `[]`                     → 🔴 anti-empty-gate
 *   M-B6  removing `dependencies: ["pwa"]` from disk          → 🔴 DEP-01 + DEP-03
 *   M-B7  `checkDeps` returns `[]`                            → 🔴 DEP-01
 *   M-B8  removing `buildRegion`'s deps check                 → 🔴 DEP-04
 *
 * ⚠️ **M-B3/B4a/B4b matter as much as the reds**: they tell "the bound is
 * correctly computed" from "the bound lands right that day". M-B4b moreover
 * settled a writing choice — the merely line-ANCHORED regex, considered
 * first, let it through and counted 22 installers instead of 21.
 *
 * ## What the guard does NOT require, and that is a decision
 *
 * That both entries embark the **same** list. The preflight dated the two
 * instructions: "keep this list in lock-step" dates from **14/07/2026**, the
 * deliberate exclusion of `cluster`/`toast-renderer`/`geolocation` in
 * `minimal` from **15/07/2026**. The 6-versus-9 divergence is thus not the
 * described drift — it is a choice documented on both sides, and the
 * equality instruction was the stale one. It was removed.
 *
 * @see scripts/gen-entry.cjs — the generator, reused as-is rather than reimplemented
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");

const gen = createRequire(import.meta.url)(path.join(REPO, "scripts/gen-entry.cjs"));

// The THIRD extractor — the one GEN-05 confronts. Loaded here rather than in
// the test so its absence breaks at load, not at the assertion.
const bundleCheck = createRequire(import.meta.url)(
    path.join(REPO, "scripts/check-example-bundle.cjs")
);

// The OTHER authority on `FULL.capabilities` — imported, where the script
// PARSES it. GEN-04's whole point: putting the two extractors face to face
// rather than believing one.
const { FULL } = await import("../../src/presets/manifest.full.ts");

const ENTRIES = [
    "packages/core/examples/minimal/entry.ts",
    "packages/core/examples/slim/entry.ts",
    "packages/core/examples/consumer/entry.ts",
];

/**
 * The entries carrying a "Left out" block in their header.
 *
 * ⚠️ Not all do: `consumer/entry.ts` declares none. GEN-02 thus only targeted
 * `ENTRIES[0]`, which made it mute as soon as a second entry carried one —
 * it would have let a false "Left out" on `slim` through without a word.
 */
const ENTRIES_WITH_LEFT_OUT = [
    "packages/core/examples/minimal/entry.ts",
    "packages/core/examples/slim/entry.ts",
];

describe("GEN — les entrées d'exemple sont générées, pas écrites à la main", () => {
    it("GEN-03 — le corpus n'est pas vide et les fichiers existent", () => {
        expect(ENTRIES.length).toBeGreaterThan(0);
        for (const rel of ENTRIES) {
            expect(fs.existsSync(path.join(REPO, rel)), `${rel} est introuvable`).toBe(true);
        }
    });

    it.each(ENTRIES)("GEN-01 — %s est identique à sa régénération", (rel) => {
        const abs = path.join(REPO, rel);
        const spec = gen.readSpec(abs);
        const expected = gen.spliceRegion(spec.src, spec.line, gen.buildRegion(spec));

        expect(
            expected === spec.src,
            `${rel} a DÉRIVÉ de ce que scripts/gen-entry.cjs produit depuis son propre \`caps=\`.\n` +
                `Régénérer : node scripts/gen-entry.cjs --file=${rel}`
        ).toBe(true);
    });

    it.each(ENTRIES_WITH_LEFT_OUT)(
        "GEN-02 — la liste « Left out » de %s est le complément exact de caps=",
        (rel) => {
            const abs = path.join(REPO, rel);
            const { caps, src } = gen.readSpec(abs);

            const m = src.match(/\*\*Left out:\*\*([\s\S]*?)\. Not one line/);
            expect(
                m,
                `Le bloc « **Left out:** … . Not one line » a disparu de l'en-tête de ${rel}`
            ).not.toBeNull();
            const declared = [...m[1].matchAll(/`([\w-]+)`/g)].map((x) => x[1]).sort();

            const expected = gen
                .capabilityDirs()
                .filter((c) => !caps.includes(c))
                .sort();

            expect(declared).toEqual(expected);
        }
    );

    it("GEN-04 — le générateur voit TOUT FULL.capabilities, et dans le même ordre", () => {
        const dirs = gen.capabilityDirs();

        // Anti-empty-gate, before all else: both sides must see a non-empty
        // corpus, and the SAME. That size equality is what turned red before
        // 08/08 (16 ≠ 21).
        expect(dirs.length).toBeGreaterThan(10);
        expect(FULL.capabilities.length).toBe(dirs.length);

        // ⚠️ `mode: "relative"` is MANDATORY and not a convenience: in npm
        // mode the generator fails on `pwa`, which has no `./facades/pwa.js`
        // declared in the `exports` map (known hole, filed). Do not "fix" this mode.
        const region = gen.buildRegion({ caps: dirs, mode: "relative", id: "gen04" });

        // SCRIPT side: the ids the region imports, in emission order — which
        // is exactly the one `manifestOrder()` returned.
        const seen = [
            ...region.matchAll(
                /^import \{ \w+ \} from "[^"]*capabilities\/([\w-]+)\/install\.js";$/gm
            ),
        ].map((m) => m[1]);

        // IMPORT side: the repo's only other authority on this array.
        const truth = FULL.capabilities.map((i) => i.declaration.id);

        expect(
            seen,
            `Les deux extracteurs de \`FULL.capabilities\` sont en désaccord.\n` +
                `  script (parse) : ${seen.length} → ${seen.join(", ")}\n` +
                `  import (vérité): ${truth.length} → ${truth.join(", ")}\n` +
                `C'est le défaut du 08/08 : la borne du tableau se prenait sur le texte BRUT, et ` +
                `un \`],\` dans un commentaire la faisait tomber à 16 sur 21.`
        ).toEqual(truth);
    });

    it("GEN-05 — le TROISIÈME extracteur de FULL.capabilities est recoupé, lui aussi", () => {
        // 🛑 This repo has THREE independent readers of `FULL.capabilities`,
        // and until now only TWO watched each other (GEN-04 above). The third
        // lives in the example bundle checker: it collects the
        // `capabilities/<id>/install.js` by regex over the manifest's source,
        // and it now serves TWO scripts, which import it from one another. A
        // shared extractor that errs thus errs twice, and nobody contradicted it.
        //
        // ⚠️ The failure mode is the SAME as 08/08's, instrument aside: a
        // regex over source text yields a plausible result when it misses
        // something — never an error. It can only be caught out by another
        // authority, and the only other authority is the import.
        const { capabilitiesImportedBy, MANIFEST_SRC } = bundleCheck;

        const scanned = [...capabilitiesImportedBy(MANIFEST_SRC)].sort();
        const truth = FULL.capabilities.map((i) => i.declaration.id).sort();

        // Anti-empty-gate: a regex that no longer matches yields `[]` without
        // complaint, and the comparison below would pass if both sides were empty.
        expect(scanned.length).toBeGreaterThan(10);

        expect(
            scanned,
            `Le troisième extracteur de \`FULL.capabilities\` est en désaccord avec l'import.\n` +
                `  regex sur la source : ${scanned.length} → ${scanned.join(", ")}\n` +
                `  import (vérité)     : ${truth.length} → ${truth.join(", ")}\n` +
                `Il est partagé par deux scripts de vérification de bundle : s'il rate une ` +
                `capacité, les deux la ratent, et leur accord ne prouve rien.`
        ).toEqual(truth);
    });
});

/**
 * Guard DEP — the declared dependency graph is TRAVERSED, not only declared.
 *
 * ⚠️ `ICapabilityDeclaration.dependencies` is read **nowhere at runtime** —
 * the capability registry does not touch it. Its only use is at build, in
 * `gen-entry.cjs`. Yet until 08/08/2026 that check lived only in the
 * script's `main()`: the guard above calls `buildRegion`, so the repo's only
 * real edge was traversed by **no automatic execution**. The check moved to
 * the emission point; these rules pin it there.
 *
 * The subjects are **derived from disk**, never written: the day
 * `offline → pwa` stops being the only edge, these rules exercise the one
 * that replaced it instead of turning red on a name.
 */
describe("DEP — le graphe de dépendances des capacités est traversé", () => {
    /** The first capability on disk declaring a dependency, and its expected edges. */
    function anyEdge() {
        const cap = gen.capabilityDirs().find((c) => gen.declaredDeps(c).length > 0);
        return cap ? { cap, edges: gen.declaredDeps(cap).map((d) => `${cap} → ${d}`) } : null;
    }

    it("DEP-03 — le sujet existe encore : au moins une arête déclarée dans le dépôt", () => {
        // Anti-empty-gate. Without it, DEP-01/02/04 would pass on the empty
        // set the day no capability declares `dependencies` any more — a
        // green guard guarding nothing.
        expect(
            anyEdge(),
            "aucune capacité ne déclare de `dependencies` — les règles DEP n'ont plus de sujet, " +
                "il faut décider si elles gardent encore quelque chose plutôt que de les laisser vertes"
        ).not.toBeNull();
    });

    it("DEP-01 — une dépendance non embarquée est trouvée ET nommée", () => {
        const { cap, edges } = anyEdge();
        expect(gen.checkDeps([cap])).toEqual(edges);
    });

    it("DEP-02 — le graphe complet ne signale rien", () => {
        const { cap } = anyEdge();
        expect(gen.checkDeps([cap, ...gen.declaredDeps(cap)])).toEqual([]);
    });

    it("DEP-04 — buildRegion REFUSE d'émettre une entrée au graphe incomplet", () => {
        const { cap, edges } = anyEdge();
        expect(() => gen.buildRegion({ caps: [cap], mode: "relative", id: "dep04" })).toThrow(
            edges[0]
        );
    });
});
