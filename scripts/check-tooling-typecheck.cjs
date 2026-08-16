#!/usr/bin/env node
/*!
 * GeoLeaf — gate d'outillage
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file check-tooling-typecheck.cjs
 * @description TOOLING-TS — cliquet décroissant sur le typage de `scripts/`, `e2e/` et les
 * configs racine. B-93.
 *
 * ## 🛑 POURQUOI UN CLIQUET ET NON UN VERT
 *
 * Ces trois corpus n'étaient couverts par **aucun** tsconfig — ni éditeur, ni compilateur.
 * `tsconfig.tooling.json` les couvre désormais avec `checkJs: true`, et le premier run rend
 * **301 erreurs**. Exiger zéro tout de suite reviendrait à ne pas poser la couverture du tout ;
 * accepter un tsconfig sans `checkJs` reviendrait à poser un périmètre **décoratif**, c'est-à-dire
 * le défaut exact que la roadmap R1 supprime.
 *
 * Le cliquet est la troisième voie, et c'est l'idiome de ce dépôt : la dette est **chiffrée**,
 * elle ne peut que **rétrécir**, et toute régression rougit le jour même.
 *
 * ## ⚠️ CE QUE CETTE GATE NE DIT PAS
 *
 * Un compte qui ne monte pas ne prouve pas qu'aucune erreur n'est apparue : une corrigée et une
 * introduite se compensent. Le cliquet garde une **enveloppe**, pas une liste. C'est un choix —
 * une liste d'erreurs `tsc` s'ancre sur des numéros de ligne, et ceux-là dérivent au premier
 * reformatage, ce qui produirait des rouges qui ne désignent rien.
 *
 * Usage :
 *   node scripts/check-tooling-typecheck.cjs
 *   node scripts/check-tooling-typecheck.cjs --update-baseline
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts/.baselines/tooling-typecheck.json");
const PROJECT = "tsconfig.tooling.json";
const UPDATE = process.argv.includes("--update-baseline");

const res = spawnSync("npx", ["tsc", "-p", PROJECT], { cwd: ROOT, encoding: "utf8" });
const out = `${res.stdout || ""}${res.stderr || ""}`;
const lines = out.split("\n").filter((l) => /error TS\d+/.test(l));

// 🛑 PLANCHER ANTI-GATE-VIDE. `tsc` qui ne rend RIEN peut vouloir dire « zéro erreur » ou
// « le projet n'a compilé aucun fichier » — un `include` qui ne matche plus produit les deux
// fois un silence. On distingue les deux en comptant les fichiers réellement vus.
const listed = spawnSync("npx", ["tsc", "-p", PROJECT, "--listFiles"], {
    cwd: ROOT,
    encoding: "utf8",
});
const ours = (listed.stdout || "")
    .split("\n")
    .filter((f) => f.startsWith(ROOT) && !f.includes("node_modules")).length;

if (ours === 0) {
    console.error(
        `ERROR [TOOLING-TS]: 0 fichier du dépôt compilé par ${PROJECT}.\n` +
            "   L'`include` ne matche plus rien — l'instrument est cassé, pas le code.\n" +
            "   La gate refuse de conclure."
    );
    process.exit(2);
}

const count = lines.length;

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "B-93 — nombre d'erreurs `tsc --checkJs` sur scripts/, e2e/ et les configs " +
                    "racine. Ce nombre ne peut que DÉCROÎTRE (TOOLING-TS). Ne jamais le remonter " +
                    "à la main : corrigez, ou expliquez pourquoi la hausse est légitime dans le " +
                    "commit qui la porte.",
                _generated: "node scripts/check-tooling-typecheck.cjs --update-baseline",
                maxErrors: count,
                filesCompiled: ours,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [TOOLING-TS] baseline écrite — ${count} erreur(s), ${ours} fichier(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error("ERROR [TOOLING-TS]: baseline absente.");
    console.error("Lancer : node scripts/check-tooling-typecheck.cjs --update-baseline");
    process.exit(2);
}

const { maxErrors } = JSON.parse(fs.readFileSync(BASELINE, "utf8"));

if (count > maxErrors) {
    console.error(
        `\n❌ [TOOLING-TS] ${count} erreur(s) de typage pour un plafond de ${maxErrors}.\n\n` +
            lines.slice(0, 15).join("\n") +
            (lines.length > 15 ? `\n   … ${lines.length - 15} de plus` : "") +
            `\n\n   Le cliquet ne remonte pas. Corrigez, ou — si la hausse est délibérée —\n` +
            `   motivez-la dans le commit et régénérez avec --update-baseline.\n`
    );
    process.exit(1);
}

if (count < maxErrors) {
    console.log(
        `✅ [TOOLING-TS] ${count} erreur(s) — le cliquet DESCEND (plafond ${maxErrors}).\n` +
            `   Resserrez-le : node scripts/check-tooling-typecheck.cjs --update-baseline`
    );
    process.exit(0);
}

console.log(
    `✅ [TOOLING-TS] ${count} erreur(s), plafond tenu — ${ours} fichier(s) compilés ` +
        `(scripts/, e2e/, configs racine).`
);
process.exit(0);
