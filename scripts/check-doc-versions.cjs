#!/usr/bin/env node
/**
 * @fileoverview DOC-VERSIONS — a workshop document's frontmatter `version:` must
 * EQUAL the highest version its revision table cites.
 *
 * ## The defect this closes, and why it reproduces on its own
 *
 * A roadmap's closure protocol asks TWO gestures: bump `version:` in the
 * frontmatter, and add a line to `## Historique des révisions`. **Nothing linked
 * the two.** Doing the first without the second produces a document announcing
 * v1.8.0 whose history stops at v1.7.0 — a reader looking for "what changed in
 * 1.8.0" finds nothing, and concludes either the version is wrong or the change
 * undocumented. Both conclusions are bad, and neither verifiable.
 *
 * 🛑 **This gate's deposit was manufactured by the chain writing it.** Measured on
 * 2026-08-17: 27 tracked documents carry a `version:`, and the **2** gaps both
 * come from documents of the same night, bumped without a revision line. ⚠️ **On
 * `main`, the gap is 0**: neither commit is there. Never write "the repo carries
 * 2 defects" without saying "on this branch". The motive's self-demonstration: a
 * two-gesture protocol with only one guarded loses the second, including among
 * those who wrote it.
 *
 * ## The four oracle decisions, each with the witness imposing it
 *
 * ① **`max()` of the cells, NEVER "the first" nor "the last".** The corpus
 *    carries **three** ordering conventions, not two: reverse-chronological,
 *    chronological, and **non-monotonic**. Any positional heuristic renders a
 *    false verdict on the third; `max()` survives it and demands no convention.
 *
 *    🛑 **BOTH non-monotonic witnesses left the corpus on 2026-08-26, and their
 *    sequences are recorded here BECAUSE they left.** They were
 *    `CDC_api-requise_geoleaf-js.md` (v1.0.0, v1.3.0, v1.2.3, v1.2.2 — first
 *    1.0.0, last 1.1.0, **max 1.3.0**) and a settlement roadmap (v1.0.3,
 *    v1.0.2, **v1.0.5**, v1.0.4, v1.0.1, v1.0.0 — first 1.0.3, last 1.0.0,
 *    **max 1.0.5**). Without this note `max()` has **no living counter-example
 *    left**, and a later "simplification" to a positional read would turn
 *    green on the whole corpus while being wrong by construction. Recover
 *    either file with
 *    `git log --diff-filter=D --format=%H -1 -- <path>` then `git show <sha>^:<path>`.
 *
 * ② **The `v` prefix is MANDATORY in the cell.** It is what separates a REVISION
 *    line from a DATA line. Measured witness: one document of the corpus carries
 *    a **Node** version table (`| 22.22.1 |`, `| 22.20.0 |`) that a lax oracle
 *    reads as revisions, derives max = 22.22.1 from, and wrongly reddens on.
 *
 * ③ **The corpus comes from `git ls-files`, not a disk walk.** An untracked file
 *    does not ship in the public clone and is judged by no CI: judging it here
 *    would make the workshop diverge from the public with nobody able to see.
 *    Measured: the disk's only "table-less" `.md` is git-ignored.
 *
 * ④ **A document WITHOUT a revision table is not a subject.** Expressly forbidden
 *    — "on pain of imposing a table where nobody wants one". Measured: on the
 *    tracked corpus, **zero** files carry `version:` without a table, so this
 *    clause currently exempts nobody; it exists so the gate does not become a
 *    disguised mandate.
 *
 * ## What this gate does NOT guard
 *
 * It compares two NUMBERS. It says nothing of the revision line's VERACITY: a
 * line "v1.8.0 — fixed the thing" matching no real change satisfies it fully.
 * _Generated ≠ true; generated = structurally true._
 *
 * Usage :
 *   node scripts/check-doc-versions.cjs            # gate (exit 1 on gap)
 *   node scripts/check-doc-versions.cjs --list     # prints the corpus and exits 0
 */

"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const docsPaths = require("./lib/docs-paths.cjs");

const CODE = "DOC-VERSIONS";

/**
 * ⚠️ EXPLICIT, MOTIVATED skip on a clone without the internal root. Without this
 * block, the gate would sweep 0 files and go GREEN having read nothing — the
 * false-green this repo names its costliest class.
 */
if (!docsPaths.internalRootExists()) {
    console.log(
        `⏭️  [${CODE}] SAUTÉ — la racine INTERNE est absente : ${docsPaths.rel(docsPaths.INTERNAL_ROOT)}`
    );
    console.log(
        "    Ce n'est PAS un vert : aucun document d'atelier n'a été lu, donc aucun `version:`\n" +
            "    n'a été confronté à son tableau de révisions. Sur le dépôt public c'est le\n" +
            "    comportement attendu — `_docs_projet/` y est retiré par décision. Ailleurs,\n" +
            "    c'est un défaut : poser GEOLEAF_INTERNAL_DOCS_ROOT."
    );
    process.exit(0);
}

const INTERNAL_REL = path
    .relative(docsPaths.REPO_ROOT, docsPaths.INTERNAL_ROOT)
    .split(path.sep)
    .join("/");

/**
 * Corpus = the GIT-TRACKED `.md` under the internal root (decision ③).
 *
 * ⚠️ `git ls-files` THROWS if the root falls outside the repo ("is outside
 * repository"), which happens as soon as `GEOLEAF_INTERNAL_DOCS_ROOT` is diverted
 * to an absolute path. Without this `try`, the gate rendered a stack trace
 * instead of a verdict. It did exit 1 — so never a false green — but **a crash is
 * not a diagnosis**: the operator must read what is wrong, not deduce. Measured
 * while proving the anti-empty-corpus assertion.
 */
function trackedMarkdown() {
    try {
        const out = execSync(`git ls-files -- '${INTERNAL_REL}/**/*.md' '${INTERNAL_REL}/*.md'`, {
            cwd: docsPaths.REPO_ROOT,
            encoding: "utf8",
            maxBuffer: 1 << 26,
            stdio: ["ignore", "pipe", "pipe"],
        });
        return out
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
    } catch (err) {
        console.error(
            `\n❌ [${CODE}/DV-00] REFUS DE CONCLURE — le corpus n'a pas pu être listé.\n` +
                `   racine interne : ${docsPaths.rel(docsPaths.INTERNAL_ROOT)}\n` +
                `   ${String(err.message).split("\n")[0]}\n` +
                `   La racine doit être un chemin SUIVI PAR GIT à l'intérieur du dépôt. Une gate\n` +
                `   qui ne sait pas ce qu'elle lit ne rend pas de verdict.`
        );
        process.exit(1);
    }
    return [];
}

/** `1.8.0` → [1,8,0]; numeric comparison per component, never lexical. */
function cmp(a, b) {
    const A = a.split(".").map(Number);
    const B = b.split(".").map(Number);
    for (let i = 0; i < 3; i += 1) if (A[i] !== B[i]) return A[i] - B[i];
    return 0;
}

/** Frontmatter version, `v` tolerated in writing (`version: v1.2.0` like `version: 1.2.0`). */
function frontmatterVersion(src) {
    const m = src.match(/^version:\s*v?(\d+\.\d+\.\d+)\s*$/m);
    return m ? m[1] : null;
}

/**
 * Versions cited in the FIRST CELL of a table row, `v` MANDATORY (decision ②).
 * The `^\|` anchor avoids grabbing a `| v1.0.0 |` that is something else's 2nd column.
 */
function revisionVersions(src) {
    return [...src.matchAll(/^\|\s*v(\d+\.\d+\.\d+)\s*\|/gm)].map((m) => m[1]);
}

const files = trackedMarkdown();
const subjects = [];
const problems = [];

for (const rel of files) {
    const src = fs.readFileSync(path.join(docsPaths.REPO_ROOT, rel), "utf8");
    const fm = frontmatterVersion(src);
    if (!fm) continue; // no `version:` → not a subject
    const cells = revisionVersions(src);
    if (cells.length === 0) continue; // decision ④ — no table, no mandate
    subjects.push({ rel, fm, cells });
    const max = cells.reduce((m, c) => (cmp(c, m) > 0 ? c : m), cells[0]);
    if (cmp(fm, max) !== 0)
        problems.push({ rel, fm, max, sens: cmp(fm, max) > 0 ? "fm > max" : "fm < max" });
}

if (process.argv.includes("--list")) {
    for (const s of subjects)
        console.log(
            `${s.fm.padEnd(8)} ${s.cells.length.toString().padStart(3)} ligne(s)  ${s.rel}`
        );
    console.log(`\n${subjects.length} sujet(s) sur ${files.length} document(s) suivi(s).`);
    process.exit(0);
}

// 🛑 Anti-empty-corpus assertion. A gate that reads nothing goes green having
// guarded nothing — precisely how a directory rename or a broken glob goes unseen.
//
// RE-DERIVED on 2026-08-26, because the premise it rested on is gone. It read
// `subjects.length < 10`, motivated by "the expected corpus is about twenty". That
// conflated TWO different failures behind one number, and archiving proved it: a batch
// of finished working documents left the corpus that day, taking sixteen subjects with
// them LEGITIMATELY, and the count fell to single digits. The gate refused to conclude
// on a perfectly healthy repo — and a gate that is red for being right gets disarmed.
//
// The two failures are now separated, each watched by the number that actually moves
// when it happens:
//   · a broken glob or a moved root collapses the SWEEP itself → `files.length`;
//   · a broken frontmatter/table reader leaves the sweep intact and yields no subject
//     at all → `subjects.length === 0`.
// Archiving moves neither past its floor; it only lowers `subjects.length` gradually,
// which is the one thing that is NOT a defect.
if (files.length < 10) {
    console.error(
        `\n❌ [${CODE}/DV-00] REFUS DE CONCLURE — ${files.length} document(s) suivi(s) balayé(s).\n` +
            `   Ce n'est pas un corpus, c'est un balayage qui n'a rien trouvé : glob cassé ou\n` +
            `   racine déplacée. La gate ne rend pas un vert qu'elle n'a pas mérité.`
    );
    process.exit(1);
}
if (subjects.length === 0) {
    console.error(
        `\n❌ [${CODE}/DV-00] REFUS DE CONCLURE — ${files.length} document(s) balayé(s) et ` +
            `AUCUN sujet.\n` +
            `   Le balayage fonctionne, donc c'est le lecteur d'en-tête ou de tableau qui a\n` +
            `   cessé de mordre. Un corpus légitimement vide de sujets n'existe pas ici : les\n` +
            `   deux registres permanents en portent toujours un.`
    );
    process.exit(1);
}

console.log(`── ${CODE} ──`);
console.log(
    `  ${subjects.length} document(s) portant \`version:\` + tableau, sur ${files.length} suivi(s)`
);

if (problems.length > 0) {
    console.error(
        `\n❌ [${CODE}/DV-01] ${problems.length} document(s) dont le \`version:\` ne correspond à aucune ligne de révision :\n`
    );
    for (const p of problems) {
        console.error(`   • ${p.rel}`);
        console.error(
            `     frontmatter \`version: v${p.fm}\`  ·  plus haute ligne de révision \`v${p.max}\`  (${p.sens})`
        );
    }
    console.error(
        `\n   Les deux gestes de la clôture sont indissociables : bumper \`version:\` ET poser la\n` +
            `   ligne de révision correspondante, DANS LE MÊME COMMIT. Un document qui s'annonce\n` +
            `   en une version dont l'historique ne parle pas est illisible pour qui cherche ce\n` +
            `   qui a changé.\n`
    );
    process.exit(1);
}

console.log(`✓ ${CODE} — chaque \`version:\` est égal à la plus haute ligne de son historique.`);
