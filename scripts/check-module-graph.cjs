#!/usr/bin/env node
/**
 * check-module-graph.cjs — MG-00…02: "no importer" and "imported for its side
 * effect" are two things, and nothing told them apart.
 *
 * 🛑 **Why the obvious route does not work.** Forbidding an importer-less module
 * would redden on **side-effect** modules, whose job is to have no named one. An
 * oracle separating the two was needed — that is what `lib/module-graph.cjs`
 * does, and it is the `@sideEffectGraft` mark (set with `GRAFT`) that makes the
 * second category explainable.
 *
 * ## 🛑 FOUR BLINDNESSES, all found by a known answer, none by re-reading
 *
 * The instrument was wrong four times before being right, and **each version
 * rendered a plausible figure**:
 *
 * | # | What was missing                       | What it rendered                                   |
 * | - | -------------------------------------- | -------------------------------------------------- |
 * | 1 | `p.absDir` instead of `p.dir`          | **914 orphans of 929** — the paths did not pair up |
 * | 2 | the `.d.ts` as importers               | `top-level-api.contract.ts` declared orphan        |
 * | 3 | `import("…")` in TYPE position         | same — a contract is consumed as a type            |
 * | 4 | the `.js` test suites (478!)           | `style-resolver.ts` declared orphan                |
 *
 * ⚠️ Only the first was absurd. **The other three rendered credible lists** —
 * and each wrongly accused a file whose header said the opposite. That is why
 * `MG-00` exists: an exploding orphan rate is not debated, it **refuses to
 * conclude**.
 *
 * ## MG-00 — refusal to conclude if the graph no longer resolves
 *
 * An orphan is rare by construction: nearly every module has a reader. Beyond a
 * threshold, the most probable explanation is not that the repo collapsed, it is
 * that **resolution is broken** — exactly case 1 above.
 *
 * ## MG-01 / MG-02 — two DECREASING ratchets
 *
 * Born non-empty, which the standing decision allows for a decreasing guard
 * whose first survey is recorded. Reddening on the landing's 6 + 15 would get it
 * disarmed within the week.
 *
 * ⚠️ **The PROD / TESTS distinction decides the verdict**, and it is not
 * cosmetic: letting the `.js` suites into the corpus takes side-effect modules
 * from 21 to 4, because a test imports them BY NAME to prove them. Production
 * decides a module's nature; tests decide only its orphanhood.
 *
 * Usage :
 *   node scripts/check-module-graph.cjs
 *   node scripts/check-module-graph.cjs --update-baseline   # ONLY to DESCEND
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const lib = require("./lib/module-graph.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts/.baselines/module-graph.json");
const UPDATE = process.argv.includes("--update-baseline");
const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };

/** Beyond this, refuse to conclude: resolution is broken, not the repo. */
const TAUX_ORPHELINS_MAX = 0.05;
const PLANCHER_SOURCES = 500;

const echecs = [];
const r = lib.scan();
const nonMarques = r.effetDeBord
    .filter((e) => !e.marque)
    .map((e) => e.fichier)
    .sort();

console.log(`${C.d}── MODULE-GRAPH — qui référence quoi, et comment ──${C.x}`);
console.log(
    `  ${r.sources} source(s) · ${r.importeurs} importeur(s) · ${r.entrees} point(s) d'entrée\n` +
        `  ${r.orphelins.length} orphelin(s) · ${r.effetDeBord.length} module(s) d'effet de bord ` +
        `(${r.effetDeBord.length - nonMarques.length} marqué(s), ${nonMarques.length} non marqué(s))`
);

// ─── MG-00 ────────────────────────────────────────────────────────────────────
if (r.sources < PLANCHER_SOURCES) {
    echecs.push(
        `[MG-00] ${r.sources} sources, plancher ${PLANCHER_SOURCES} — le corpus ne se dérive plus.`
    );
}
const taux = r.sources > 0 ? r.orphelins.length / r.sources : 1;
if (taux > TAUX_ORPHELINS_MAX) {
    echecs.push(
        `[MG-00] REFUS DE CONCLURE — ${r.orphelins.length} orphelins sur ${r.sources} sources ` +
            `(${(taux * 100).toFixed(1)} %, plafond ${TAUX_ORPHELINS_MAX * 100} %).\n` +
            `      Un orphelin est rare par construction. À ce taux, l'explication la plus probable\n` +
            `      n'est pas que le dépôt s'est effondré : c'est que la RÉSOLUTION est cassée.`
    );
}

// ─── MG-01 / MG-02 ────────────────────────────────────────────────────────────
if (UPDATE) {
    const actuel = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
    if (
        actuel &&
        (r.orphelins.length > actuel.orphelins.length ||
            nonMarques.length > actuel.effetDeBordNonMarques.length)
    ) {
        console.error(
            `${C.r}✗${C.x} refus de MONTER une baseline (${actuel.orphelins.length}→${r.orphelins.length} orphelins, ` +
                `${actuel.effetDeBordNonMarques.length}→${nonMarques.length} non marqués). Interdit I3.`
        );
        process.exit(1);
    }
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "MG-01 : modules qu'AUCUNE arête n'atteint (imports nommés, nus, ré-exports, `import()` de type ou dynamique, depuis les sources, les tests .ts ET .js, et les .d.ts). Les 6 de la pose sont tous structurels — 2 points d'entrée que la détection ne déclare pas, et 4 fichiers de mise en place chargés par la config vitest. MG-02 : modules dont la PRODUCTION ne les atteint que par un import NU, sans porter `@sideEffectGraft`. Les 15 de la pose sont de vrais modules d'effet de bord d'une forme que `GRAFT` ne couvre pas — il ne voit que la greffe sur un import, ceux-ci écrivent sur `globalThis`. Les deux listes ne peuvent que RÉTRÉCIR.",
                _generated: "node scripts/check-module-graph.cjs --update-baseline",
                orphelins: r.orphelins,
                effetDeBordNonMarques: nonMarques,
            },
            null,
            4
        ) + "\n"
    );
    console.log(
        `${C.g}✓${C.x} baseline écrite — ${r.orphelins.length} orphelin(s), ${nonMarques.length} non marqué(s).`
    );
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error(`${C.r}✗${C.x} [MG-01] baseline absente — poser avec --update-baseline.`);
    process.exit(1);
}
const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const orphNeufs = r.orphelins.filter((o) => !base.orphelins.includes(o));
const sebNeufs = nonMarques.filter((o) => !base.effetDeBordNonMarques.includes(o));

if (orphNeufs.length > 0) {
    echecs.push(
        `[MG-01] ${orphNeufs.length} module(s) que PLUS RIEN n'atteint :\n` +
            orphNeufs.map((o) => `      + ${o}`).join("\n") +
            `\n\n      Aucune arête entrante — ni import nommé, ni import nu, ni ré-export, ni type.\n` +
            `      Soit il est mort, soit son ancrage a disparu : les deux se corrigent, pas se gèlent.`
    );
}
if (sebNeufs.length > 0) {
    echecs.push(
        `[MG-02] ${sebNeufs.length} module(s) d'effet de bord SANS marque :\n` +
            sebNeufs.map((o) => `      + ${o}`).join("\n") +
            `\n\n      La production ne les atteint que par un import NU — ils sont chargés POUR LEUR\n` +
            `      EFFET. Sans \`@sideEffectGraft <ancre>\`, rien ne distingue ce cas de « personne ne\n` +
            `      l'importe », et retirer l'ancrage les sort du graphe en silence.`
    );
}
const partis = [
    ...base.orphelins.filter((o) => !r.orphelins.includes(o)),
    ...base.effetDeBordNonMarques.filter((o) => !nonMarques.includes(o)),
];
if (partis.length > 0) {
    console.log(
        `  ${C.g}${partis.length} entrée(s) de baseline ne se retrouvent plus${C.x} — resserrer :`
    );
    for (const p of partis) console.log(`      − ${p}`);
}

if (echecs.length > 0) {
    console.error("");
    for (const e of echecs) console.error(`${C.r}✗${C.x} ${e}`);
    process.exit(1);
}
console.log(
    `${C.g}✓ MODULE-GRAPH${C.x} — aucun orphelin ni module d'effet de bord NOUVEAU ` +
        `(${base.orphelins.length} + ${base.effetDeBordNonMarques.length} gelés).`
);
