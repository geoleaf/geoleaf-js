#!/usr/bin/env node
/*!
 * GeoLeaf — gate d'arborescence
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file check-tree-qualification.cjs
 * @description TREE-QUAL — decreasing ratchet on UNJUDGED artifacts.
 *
 * ## 🛑 WHY A RATCHET, AND WHY NOT A THIRD SWEEP
 *
 * A full pass qualified **1112 artifacts of 1112 — 100 %**, and the debt
 * reformed **twice** since: 96.3 % on 07-26, then 88.3 % on 08-16. Not an
 * execution failure — the demonstration that a sweep does not hold: **nothing
 * requires a new artifact to be born judged**, so each added capability reopens
 * the gap. A third sweep would produce a third 100 % followed by a third
 * erosion.
 *
 * 📌 The observation already made on PCB-01's `BASELINE`, word for word: **a
 * counter-measure applied by hand to each member is not a counter-measure, it is
 * a list — and a list forgets.** The ratchet replaces it with a structure: the
 * count freezes, it can only descend, and a new unjudged artifact reddens the
 * day it arrives.
 *
 * ## ⚠️ WHY THIS GATE READS THE GENERATOR'S OUTPUT INSTEAD OF RECOUNTING
 *
 * "Qualified" has **one** definition, and it lives in `generate-docs-tree.cjs`:
 * an artifact whose existence verdict is not `?`. Recounting it here would
 * create a second definition — and a gate diverging from its generator is
 * exactly the defect `source-inventory.cjs` was extracted to prevent ("when a
 * generator and its gate each carry their copy of the rule, the gate goes green
 * on a file the generator declares missing").
 *
 * The price is a dependency on the printed line's FORMAT. It is paid
 * explicitly: if the line is not found, the gate **refuses to conclude**
 * instead of assuming zero.
 *
 * Usage :
 *   node scripts/check-tree-qualification.cjs
 *   node scripts/check-tree-qualification.cjs --update-baseline
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts/.baselines/tree-qualification.json");
const UPDATE = process.argv.includes("--update-baseline");

const res = spawnSync("node", ["scripts/generate-docs-tree.cjs", "--check"], {
    cwd: ROOT,
    encoding: "utf8",
});
const out = `${res.stdout || ""}${res.stderr || ""}`;

// 🛑 ANTI-EMPTY-GATE FLOOR. An output without this pattern means the generator
// changed format, failed, or scanned nothing — three causes a single `0` would
// conflate.
const m = out.match(/(\d+)\/(\d+) qualifiés/);
if (!m) {
    console.error(
        "ERROR [TREE-QUAL]: la ligne « N/M qualifiés » est introuvable dans la sortie du\n" +
            "   générateur. Format changé, ou run en échec — la gate refuse de conclure.\n" +
            `   (exit ${res.status})`
    );
    process.exit(2);
}

const qualified = Number(m[1]);
const total = Number(m[2]);
const unqualified = total - qualified;

if (total === 0) {
    console.error("ERROR [TREE-QUAL]: 0 artefact dans l'arbre — instrument cassé, pas code.");
    process.exit(2);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "Nombre d'artefacts SANS verdict d'existence. Ne peut que DÉCROÎTRE " +
                    "(TREE-QUAL). Un artefact neuf naît non jugé : c'est CE compte qui l'attrape, " +
                    "et c'est pourquoi il ne se remonte pas à la main. Qualifier, puis resserrer.",
                _generated: "node scripts/check-tree-qualification.cjs --update-baseline",
                maxUnqualified: unqualified,
                measuredTotal: total,
            },
            null,
            4
        ) + "\n"
    );
    console.log(
        `✅ [TREE-QUAL] baseline écrite — ${unqualified} non jugé(s) sur ${total} artefacts.`
    );
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error("ERROR [TREE-QUAL]: baseline absente.");
    console.error("Lancer : node scripts/check-tree-qualification.cjs --update-baseline");
    process.exit(2);
}

const { maxUnqualified } = JSON.parse(fs.readFileSync(BASELINE, "utf8"));

if (unqualified > maxUnqualified) {
    console.error(
        `\n❌ [TREE-QUAL] ${unqualified} artefact(s) non jugé(s) pour un plafond de ` +
            `${maxUnqualified}.\n\n` +
            `   Un artefact est arrivé sans verdict. C'est exactement ce que ce cliquet existe\n` +
            `   pour attraper : le T5 avait atteint 100 %, et la dette s'est reformée deux fois\n` +
            `   parce que rien n'exigeait qu'un fichier neuf naisse jugé.\n\n` +
            `   Le geste : ajouter son verdict dans un shard de \`scripts/docs-tree-verdicts/\`,\n` +
            `   puis \`npm run docs:tree\`. Le plafond ne se remonte pas.\n`
    );
    process.exit(1);
}

if (unqualified < maxUnqualified) {
    console.log(
        `✅ [TREE-QUAL] ${unqualified} non jugé(s) — le cliquet DESCEND (plafond ${maxUnqualified}).\n` +
            `   Resserrez-le : node scripts/check-tree-qualification.cjs --update-baseline`
    );
    process.exit(0);
}

console.log(
    `✅ [TREE-QUAL] ${unqualified} artefact(s) non jugé(s) sur ${total}, plafond tenu ` +
        `(${qualified} qualifiés).`
);
process.exit(0);
