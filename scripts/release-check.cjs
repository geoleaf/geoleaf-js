#!/usr/bin/env node
/**
 * RELEASE-CHECK — the gate sequence that stands between this repo and an IMMUTABLE
 * tarball.
 *
 * Usage:
 *   node scripts/release-check.cjs             # the subset, skips named in the summary
 *   node scripts/release-check.cjs --strict     # refuses to run when a gate could only skip
 *   node scripts/release-check.cjs --list       # prints the subset and exits
 *
 * Exit code: 0 if every selected gate passed, 1 otherwise, 2 on a tooling refusal.
 *
 * ## Why this exists apart from `ci:local`
 *
 * `ci:local` answers "is the repo sound?". This answers a narrower and harsher
 * question: "may these bytes leave, knowing they can never be taken back?". npm
 * versions are immutable — a wrong tarball is not fixed, it is superseded, and every
 * consumer who installed the wrong one keeps it until they bump.
 *
 * Until 2026-09-04 `publish.yml` crossed exactly ONE blocking gate before its first
 * tarball (`check-dist-integrity.cjs`) and verified the types AFTER publication, on
 * the monorepo rather than on what had shipped. This script is the `verify` job's
 * content, and `publish` now `needs:` it.
 *
 * ## The subset is DERIVED, never listed here
 *
 * The steps come from `ci-local.cjs`'s `STEPS`, filtered on `release: true`. A list of
 * commands written in this file would be a second copy of the gate list, and two
 * copies diverge — silently, and in the direction that matters least visibly: the
 * publication path stops covering something while still printing a green count.
 *
 * 🛑 THE FAILURE MODE THE FLAG CANNOT COVER, and the floor that answers it. Renaming
 * or deleting a step takes its `release: true` with it. Nothing would turn red: the
 * subset shrinks, the run stays green, and the count goes from 15/15 to 14/14 — a
 * shape no reader distinguishes from a normal run. Hence {@link REQUIRED_MARKS}: a
 * set of load-bearing commands re-derived from the SELECTION, each of which must still
 * be there. It is keyed on the command, not the step name, because the command is what
 * actually runs.
 *
 * ## What a green here does NOT say — and the reason `--strict` exists
 *
 * `check:consumer-contract` reads its manifests through `GEOLEAF_CONSUMERS`, which
 * points OUTSIDE the repo. Without it the gate exits 0 with its motive named — the
 * wanted behaviour on the public clone, and the unavoidable one on any GitHub runner,
 * where the downstream's manifest simply is not there.
 *
 * 🛑 So a green `verify` job does NOT mean the inverse contract was read. That matters
 * precisely here: the gate exists to say that a published core has not withdrawn a
 * member the downstream consumes, and the core is the package a publication ships
 * first. This script therefore does two things rather than pretend:
 *
 *   • it NAMES, in its summary, every gate that could only skip, so a green is never
 *     read as "everything was checked";
 *   • `--strict` REFUSES TO RUN when such a gate would skip. That is the local
 *     pre-publication protocol: `GEOLEAF_CONSUMERS=<dir> npm run release:check -- --strict`
 *     before dispatching `publish.yml`.
 *
 * ⚠️ Why `--strict` is not the default, and this is the same arbitration the repo made
 * for CC-10 and for PARITY-13: a hard red on a structural skip would be red on every
 * runner, permanently — and a permanently red gate gets disarmed, not fixed.
 */

"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// On Windows, `npm`/`npx` resolve to .cmd wrappers Node refuses to spawn without a
// shell (CVE-2024-27980). Same rule as `ci-local.cjs`, same motive.
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
 * Commands that MUST survive in the selection, whatever happens to step names.
 *
 * Each entry is a substring of a step's joined command. They are the ones whose
 * absence would make a publication unsafe without making this script red — the build
 * and the stubs decide the tarball's bytes, the four resolution gates decide whether a
 * consumer can import it at all, and PUB decides whether the registry still matches
 * this repo at an equal version.
 *
 * ⚠️ Adding an entry here is cheap; removing one is a decision. A gate leaves this
 * list only when the class it covers is closed elsewhere, and the motive is written.
 */
const REQUIRED_MARKS = [
    "turbo run build",
    "emit-css-type-stubs.cjs",
    "typecheck:consumer",
    "verify-published-types.cjs",
    "check-subpath-resolve.cjs",
    "check-shipped-specifiers.cjs",
    "check:dist-integrity",
    "check-package-files.cjs",
    "verify-published-parity.cjs",
    "check:consumer-contract",
];

/**
 * Witness floor on the selection's size.
 *
 * 🛑 Not superstition, and not the same guard as {@link REQUIRED_MARKS}: the marks
 * catch a NAMED gate disappearing, this catches the selection collapsing wholesale —
 * a bad `filter`, an export that came back empty through a require cycle, a `STEPS`
 * table read before it was populated. `ci-local.cjs` has already had that exact cycle
 * hand out empty tables (see its export comment, 30/07/2026).
 */
const FLOOR = 12;

/**
 * Gates whose subject lives outside the repo, with the variable that feeds them.
 *
 * The pair is what makes the skip DERIVABLE rather than parsed: if the variable is
 * unset, that gate read nothing, and this script says so instead of counting it.
 * Parsing a gate's stdout for the word "skip" would be an oracle on prose.
 */
const OUT_OF_REPO = [
    {
        mark: "check:consumer-contract",
        env: "GEOLEAF_CONSUMERS",
        what: "le contrat inverse — ce que l'aval consomme de nos surfaces publiques",
    },
];

/** The extra assertion this script owns, appended after the derived subset. */
const FINAL_ASSERTION = {
    name: "Stubs de type CSS — état FINAL de dist/ (CSS-STUBS --check)",
    run: ["node", "scripts/emit-css-type-stubs.cjs", "--check"],
    // 🛑 Deliberately LAST, and deliberately not the emitting form. The emission
    // happens early, right after the build; what matters at publication time is the
    // state of `dist/` at the moment the tarball is packed. Between the two, anything
    // that purges `dist/` — a `prepublishOnly`, a stray `rimraf`, a concurrent build —
    // undoes it in silence. That is not hypothetical: measured at the registry,
    // `@geoleaf/core@3.1.0` shipped 0 `*.css.d.ts` against 21 on disk.
};

function select() {
    const { STEPS } = require("./ci-local.cjs");
    if (!Array.isArray(STEPS) || STEPS.length === 0) {
        console.error(
            `${C.r}✗ REFUS — \`ci-local.cjs\` n'a rendu aucune étape.${C.x}\n` +
                `  Un sous-ensemble dérivé d'une table vide sort vert en ne jouant rien.`
        );
        process.exit(2);
    }
    const chosen = STEPS.filter((s) => s.release === true);

    if (chosen.length < FLOOR) {
        console.error(
            `${C.r}✗ REFUS — sélection de ${chosen.length} étape(s), plancher ${FLOOR}.${C.x}\n` +
                `  Le drapeau \`release: true\` a disparu de \`ci-local.cjs\`, ou le filtre ne mord\n` +
                `  plus. Ce script sortirait vert en gardant moins que ce qu'il annonce, juste\n` +
                `  avant un acte irréversible.`
        );
        process.exit(2);
    }

    const joined = chosen.map((s) => s.run.join(" "));
    const absents = REQUIRED_MARKS.filter((m) => !joined.some((c) => c.includes(m)));
    if (absents.length > 0) {
        console.error(
            `${C.r}✗ REFUS — ${absents.length} gate(s) porteuse(s) absente(s) de la sélection :${C.x}\n` +
                absents.map((m) => `     • ${m}`).join("\n") +
                `\n\n  Une étape a été renommée ou retirée de \`ci-local.cjs\` et a emporté son\n` +
                `  \`release: true\`. La sélection a rétréci SANS rougir — c'est exactement le mode\n` +
                `  d'échec que ce contrôle existe pour rendre bruyant.\n` +
                `  Remède : remettre le drapeau sur l'étape qui porte cette commande, ou retirer\n` +
                `  l'entrée de REQUIRED_MARKS en écrivant POURQUOI la classe est fermée ailleurs.`
        );
        process.exit(2);
    }

    return [...chosen, FINAL_ASSERTION];
}

/** The out-of-repo gates that this run cannot actually feed. */
function skipsOfThisRun(steps) {
    const joined = steps.map((s) => s.run.join(" "));
    return OUT_OF_REPO.filter((o) => joined.some((c) => c.includes(o.mark)) && !process.env[o.env]);
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
    const skips = skipsOfThisRun(steps);

    if (LIST_ONLY) {
        console.log(`${steps.length} étape(s) de publication :`);
        for (const s of steps) console.log(`  • ${s.name}\n      $ ${s.run.join(" ")}`);
        return;
    }

    // 🛑 The refusal comes BEFORE the first step, never after: a strict run that
    // discovered at the summary that it could not read the contract would already have
    // paid a full build for an answer it cannot give.
    if (STRICT && skips.length > 0) {
        console.error(
            `${C.r}✗ REFUS DE LANCER (--strict)${C.x} — ${skips.length} gate(s) ne pourrai(en)t que SAUTER :\n` +
                skips.map((s) => `     • ${s.what}\n       manque \`${s.env}\``).join("\n") +
                `\n\n  \`--strict\` est le mode du protocole de publication : il existe pour que\n` +
                `  « release:check vert » ne puisse pas signifier « une gate n'a rien lu ».\n\n` +
                `    export GEOLEAF_CONSUMERS=<répertoire contenant les *.consumer.json>\n\n` +
                `  ⚠️ Sans \`--strict\`, ce même run irait au bout et NOMMERAIT ces gates dans son\n` +
                `  résumé — c'est le mode des runners, où le manifeste de l'aval n'existe pas.`
        );
        process.exit(2);
    }

    console.log(
        `${C.c}RELEASE-CHECK${C.x} — ${steps.length} gate(s) devant un acte irréversible` +
            `${STRICT ? " · mode strict" : ""}`
    );

    const results = [];
    for (const [i, step] of steps.entries()) results.push(runStep(step, i, steps.length));

    console.log(`\n${C.c}══ Résumé ══${C.x}`);
    for (const r of results) {
        const mark = r.ok ? `${C.g}✓${C.x}` : `${C.r}✗${C.x}`;
        console.log(`  ${mark} ${r.name} ${C.d}(${(r.ms / 1000).toFixed(1)} s)${C.x}`);
    }

    // ⚠️ Printed on GREEN as well as on red, and that is the whole point. A skip named
    // only when something else fails is a skip nobody ever reads.
    if (skips.length > 0) {
        console.log(`\n${C.y}⚠ Ce que ce run N'A PAS vérifié :${C.x}`);
        for (const s of skips) {
            console.log(`  • ${s.what}`);
            console.log(
                `    ${C.d}\`${s.env}\` n'est pas défini — la gate a sauté en sortant 0.${C.x}`
            );
        }
        console.log(
            `  ${C.d}Le mode \`--strict\` refuse de tourner dans cet état ; c'est lui qu'il faut\n` +
                `  lancer AVANT de déclencher une publication.${C.x}`
        );
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.log(
            `\n${C.r}✗ ${failed.length}/${results.length} gate(s) en échec :${C.x} ` +
                failed.map((r) => r.name).join(", ")
        );
        console.log(`  ${C.d}Aucun tarball ne doit partir sur cet arbre.${C.x}`);
        process.exit(1);
    }

    console.log(`\n${C.g}✓ ${results.length}/${results.length} — l'arbre peut être publié.${C.x}`);
}

module.exports = { REQUIRED_MARKS, FLOOR, OUT_OF_REPO, FINAL_ASSERTION };

if (require.main === module) {
    main();
}
