#!/usr/bin/env node
/*!
 * GeoLeaf — gate d'arborescence
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file check-tree-qualification.cjs
 * @description TREE-QUAL — cliquet décroissant sur les artefacts NON JUGÉS. B-36.
 *
 * ## 🛑 POURQUOI UN CLIQUET, ET POURQUOI PAS UN TROISIÈME BALAYAGE
 *
 * Le T5 a qualifié **1112 artefacts sur 1112 — 100 %**, et la dette s'est reformée **deux fois**
 * depuis : 96,3 % au 26/07, puis 88,3 % au 16/08. Ce n'est pas un échec d'exécution, c'est la
 * démonstration qu'un balayage ne tient pas : **rien n'exige qu'un artefact neuf naisse jugé**,
 * donc chaque capacité ajoutée rouvre l'écart. Un troisième balayage produirait un troisième
 * 100 % suivi d'une troisième érosion.
 *
 * 📌 C'est le constat que le Sprint 1 de cette roadmap a fait sur la `BASELINE` de PCB-01, mot
 * pour mot : **une parade appliquée à la main sur chaque membre n'est pas une parade, c'est une
 * liste — et une liste oublie.** Le cliquet la remplace par une structure : le compte gèle, il
 * ne peut que descendre, et un artefact neuf non jugé rougit le jour où il arrive.
 *
 * ## ⚠️ POURQUOI CETTE GATE LIT LA SORTIE DU GÉNÉRATEUR AU LIEU DE RECOMPTER
 *
 * « Qualifié » a **une** définition, et elle vit dans `generate-docs-tree.cjs` : un artefact dont
 * le verdict d'existence n'est pas `?`. La recompter ici créerait une seconde définition — et une
 * gate qui diverge de son générateur est exactement le défaut que `source-inventory.cjs` a été
 * extrait pour empêcher (« quand un générateur et sa gate portent chacun leur copie de la règle,
 * la gate sort verte sur un fichier que le générateur déclare manquant »).
 *
 * Le prix est une dépendance au FORMAT de la ligne imprimée. Il est payé explicitement : si la
 * ligne n'est pas trouvée, la gate **refuse de conclure** au lieu de supposer zéro.
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

// 🛑 PLANCHER ANTI-GATE-VIDE. Une sortie sans ce motif signifie que le générateur a changé de
// format, échoué, ou n'a rien scanné — trois causes qu'un `0` unique confondrait.
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
                    "B-36 — nombre d'artefacts SANS verdict d'existence. Ne peut que DÉCROÎTRE " +
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
