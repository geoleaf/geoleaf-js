#!/usr/bin/env node
/**
 * ATELIER-CHECK — the gates whose SUBJECT does not exist on the public clone.
 *
 * Usage:
 *   node scripts/atelier-check.cjs            # runs them, names a skip in the summary
 *   node scripts/atelier-check.cjs --strict   # refuses to run when they could only skip
 *   node scripts/atelier-check.cjs --list     # prints the subset and exits
 *
 * Exit code: 0 if every selected gate passed, 1 otherwise, 2 on a tooling refusal.
 *
 * ## Why this exists apart from `ci:local`
 *
 * Five gates judge the WORKSHOP ROOT — the internal tree `scripts/lib/public-partition.cjs`
 * keeps out of the public repo by decision. On the public clone each one exits 0 with a
 * named skip. So `ci:local` paid for five gates on every single run that could only ever
 * bite in one place, and the apparatus grew from 14 gates to 111 in sixty days with no
 * doctrine of exit. Moving them here is not a demotion: it is where they can be run
 * deliberately, and measured.
 *
 * ## What moving them COSTS, said plainly
 *
 * A green `ci:local` no longer covers these five. The push protocol therefore asks for
 * two greens instead of one (CLAUDE.md, §Protocole de push). That is a real weakening of
 * a single-command criterion, accepted knowingly: a one-command protocol that silently
 * stopped covering five gates would be worse than a two-command one that says what each
 * covers.
 *
 * ⚠️ What did NOT move, and why — the distinction is easy to get wrong:
 *
 *   • `CONSUMER-CONTRACT` reads a manifest outside the repo, not inside the workshop.
 *     It also carries `release: true` and appears in `release-check.cjs`'s
 *     `REQUIRED_MARKS`: exiling it would make the publication gate exit 2.
 *   • `WREF` and `WPATH` exist BECAUSE of the workshop, but they judge the PUBLIC
 *     corpus — they catch public prose pointing into the workshop. Taking them off the
 *     push path would remove exactly what they guard.
 *
 * ## The subset is DERIVED, never listed here
 *
 * `ci-local.cjs` keeps ONE declared table; the flag `workshop: true` sits on the step,
 * and `WORKSHOP_STEPS` is derived from it. A list of commands written in this file
 * would be a second copy of the gate list, and two copies diverge. Same reasoning, same
 * shape, and for the same measured reason as `release-check.cjs`.
 *
 * 🛑 THE FAILURE MODE THE FLAG CANNOT COVER. Renaming or deleting a step takes its
 * `workshop: true` with it: the subset shrinks, the run stays green, and 5/5 becomes
 * 4/4 — a shape no reader distinguishes from a normal run. Hence {@link REQUIRED_MARKS}
 * and {@link FLOOR}, both re-derived from the SELECTION at every run. The marks are
 * keyed on the COMMAND rather than the step name, because the command is what runs.
 *
 * ⚠️ `PARTITION-01` (`lib/ci-parity.cjs`) closes the other half: it re-derives which
 * scripts condition themselves on the workshop root, and reddens if the flag stopped
 * describing them — in EITHER direction. The dangerous direction is a product gate
 * flagged `workshop`, because it then leaves the push path with nothing saying so.
 */

"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const NPM_SHELL = process.platform === "win32";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const LIST_ONLY = args.includes("--list");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    c: "\x1b[36m",
    d: "\x1b[2m",
    x: "\x1b[0m",
};

/**
 * Load-bearing commands that must survive the selection.
 *
 * All five, because the set is small enough that losing any one of them is losing a
 * fifth of the workshop's coverage — there is no "minor" entry to leave out.
 *
 * ⚠️ Adding an entry is cheap; removing one is a decision, and its motive is written
 * here rather than in a commit message.
 */
const REQUIRED_MARKS = [
    "check:tsdoc-paths",
    "check:vision-paths",
    "check-doc-versions.cjs",
    "check-roadmap-closures.cjs",
    "verify:config-consumers",
    "check-doc-ceilings.cjs",
];

/**
 * Witness floor on the selection's size.
 *
 * 🛑 Not the same guard as {@link REQUIRED_MARKS}, and not redundant with it: the marks
 * catch a NAMED gate disappearing, this catches the selection collapsing wholesale — a
 * bad `filter`, or an export handed back empty through a require cycle. `ci-local.cjs`
 * has already had that exact cycle serve empty tables (see its export comment,
 * 30/07/2026), and it is checked FIRST, before the marks, because an empty selection
 * would otherwise be reported as five missing marks rather than as one broken import.
 */
const FLOOR = 5;

function select() {
    const { WORKSHOP_STEPS } = require("./ci-local.cjs");
    if (!Array.isArray(WORKSHOP_STEPS) || WORKSHOP_STEPS.length === 0) {
        console.error(
            `${C.r}✗ REFUS — \`ci-local.cjs\` n'a rendu aucune étape d'atelier.${C.x}\n` +
                `  Un sous-ensemble dérivé d'une table vide sort vert en ne jouant rien.`
        );
        process.exit(2);
    }
    if (WORKSHOP_STEPS.length < FLOOR) {
        console.error(
            `${C.r}✗ REFUS — ${WORKSHOP_STEPS.length} étape(s) sélectionnée(s), plancher ${FLOOR}.${C.x}\n` +
                `  Une sélection qui rétrécit sort VERTE en couvrant moins : c'est le mode\n` +
                `  d'échec que le drapeau seul ne peut pas voir. Corriger, ou baisser le\n` +
                `  plancher avec son motif écrit.`
        );
        process.exit(2);
    }
    const commands = WORKSHOP_STEPS.map((s) => s.run.join(" "));
    const missing = REQUIRED_MARKS.filter((m) => !commands.some((c) => c.includes(m)));
    if (missing.length > 0) {
        console.error(
            `${C.r}✗ REFUS — ${missing.length} commande(s) porteuse(s) absente(s) de la sélection :${C.x}\n` +
                missing.map((m) => `     • ${m}`).join("\n") +
                `\n\n  Une gate renommée emporte son drapeau \`workshop: true\`, et le run reste\n` +
                `  vert en couvrant moins. Si le retrait est voulu, retirer aussi la marque —\n` +
                `  c'est le geste qui rend la décision visible.`
        );
        process.exit(2);
    }
    return WORKSHOP_STEPS;
}

/**
 * Whether this clone can feed the workshop gates at all.
 *
 * DERIVED from the same predicate the gates themselves use, never parsed from their
 * output: reading a gate's stdout for the word "skip" would be an oracle on prose.
 *
 * @returns {boolean} True when the workshop root is present.
 */
function workshopPresent() {
    return require("./lib/docs-paths.cjs").internalRootExists();
}

function runStep(step, index, total) {
    console.log(`\n${C.c}── [${index + 1}/${total}] ${step.name} ──${C.x}`);
    console.log(`   $ ${step.run.join(" ")}`);
    const start = process.hrtime.bigint();
    const res = spawnSync(step.run[0], step.run.slice(1), {
        cwd: ROOT,
        stdio: "inherit",
        shell: NPM_SHELL,
    });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { name: step.name, ok: res.status === 0, ms, code: res.status };
}

function main() {
    const steps = select();

    if (LIST_ONLY) {
        console.log(`${steps.length} gate(s) d'atelier :`);
        for (const s of steps) console.log(`  • ${s.name}\n      $ ${s.run.join(" ")}`);
        return;
    }

    const present = workshopPresent();

    // 🛑 Before the first step, never after — same placement and same motive as
    // `release-check.cjs --strict`: a strict run that discovered at the summary that
    // it had read nothing would already have paid for every gate.
    if (STRICT && !present) {
        console.error(
            `${C.r}✗ REFUS DE LANCER (--strict)${C.x} — la racine d'atelier est absente.\n\n` +
                `  Les ${steps.length} gates de ce runner SAUTERAIENT toutes en sortant 0, et le run\n` +
                `  rendrait un vert qui n'a rien lu.\n\n` +
                `  Sur le clone public, c'est le comportement attendu — n'y lancez pas ce\n` +
                `  runner. Ailleurs, c'est un défaut de poste : poser GEOLEAF_INTERNAL_DOCS_ROOT.`
        );
        process.exit(2);
    }

    console.log(
        `${C.c}ATELIER-CHECK${C.x} — ${steps.length} gate(s) dont le sujet vit dans l'atelier` +
            `${STRICT ? " · mode strict" : ""}`
    );

    const results = [];
    for (const [i, step] of steps.entries()) results.push(runStep(step, i, steps.length));

    // Same ledger as `ci:local`, keyed on the gate name: `ci:local --report` therefore
    // covers both runners without either knowing about the other.
    const ledger = require("./lib/gate-ledger.cjs").record({
        startedAt: new Date().toISOString(),
        sha: null,
        flags: ["atelier"],
        results,
    });
    if (!ledger.ok) console.log(`  ${C.y}⚠ registre de coût non écrit (${ledger.error})${C.x}`);

    console.log(`\n${C.c}══ Résumé ══${C.x}`);
    for (const r of results) {
        const mark = r.ok ? `${C.g}✓${C.x}` : `${C.r}✗${C.x}`;
        console.log(`  ${mark} ${r.name} ${C.d}(${(r.ms / 1000).toFixed(1)} s)${C.x}`);
    }

    // ⚠️ Printed on GREEN as well as on red, and that is the point: a skip named only
    // when something else fails is a skip nobody ever reads.
    if (!present) {
        console.log(`\n${C.y}⚠ Ce que ce run N'A PAS vérifié :${C.x}`);
        console.log(`  • les ${steps.length} gates ont sauté — la racine d'atelier est absente.`);
        console.log(
            `    ${C.d}Ce n'est pas un vert de l'atelier. \`--strict\` refuse de tourner dans cet état.${C.x}`
        );
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.log(
            `\n${C.r}✗ ${failed.length}/${results.length} gate(s) en échec :${C.x} ` +
                failed.map((r) => r.name).join(", ")
        );
        process.exit(1);
    }

    console.log(`\n${C.g}✓ ${results.length}/${results.length} — l'atelier est propre.${C.x}`);
}

module.exports = { REQUIRED_MARKS, FLOOR };

if (require.main === module) {
    main();
}
