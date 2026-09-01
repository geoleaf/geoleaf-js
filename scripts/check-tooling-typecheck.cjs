#!/usr/bin/env node
/*!
 * GeoLeaf — gate d'outillage
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file check-tooling-typecheck.cjs
 * @description TOOLING-TS — decreasing ratchet on the typing of `scripts/`,
 * `e2e/` and the root configs.
 *
 * ## 🛑 WHY A RATCHET AND NOT A GREEN
 *
 * These three corpora were covered by **no** tsconfig — neither editor nor
 * compiler. `tsconfig.tooling.json` now covers them with `checkJs: true`, and
 * the first run renders **301 errors**. Requiring zero right away would amount
 * to not laying the coverage at all; accepting a tsconfig without `checkJs`
 * would amount to laying a **decorative** perimeter — the exact defect being
 * removed.
 *
 * The ratchet is the third way, and it is this repo's idiom: the debt is
 * **numbered**, it can only **shrink**, and any regression reddens the same day.
 *
 * ## ⚠️ WHAT THIS GATE DOES NOT SAY
 *
 * A count that does not rise does not prove no error appeared: one fixed and one
 * introduced cancel out. The ratchet guards an **envelope**, not a list. A
 * choice — a `tsc` error list anchors on line numbers, and those drift at the
 * first reformat, producing reds that designate nothing.
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

// 🛑 ANTI-EMPTY-GATE FLOOR. A `tsc` that renders NOTHING can mean "zero errors"
// or "the project compiled no file" — an `include` that no longer matches
// produces silence both times. The two are told apart by counting the files
// actually seen.
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
                    "Nombre d'erreurs `tsc --checkJs` sur scripts/, e2e/ et les configs " +
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
