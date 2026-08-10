#!/usr/bin/env node
/**
 * verify-coverage-attribution.cjs — la gate qui vérifie l'APPAREIL DE MESURE (S1.7).
 *
 * ## Le défaut qu'aucun test ne peut attraper
 *
 * Toutes les autres gates de ce dépôt vérifient le code. Celle-ci vérifie l'instrument qui
 * mesure le code. C'est le seul défaut qu'une suite verte ne peut pas révéler : un rapport
 * de couverture faux est **bien formé**, ses pourcentages sont **plausibles**, et rien ne
 * rougit. C'est exactement ainsi que le défaut de la roadmap COUVERTURE a vécu un mois.
 *
 * Le protocole est celui qui l'a révélé : un module témoin à **4 fonctions**, un test qui
 * n'en appelle **qu'une**, et l'assertion que le `lcov` crédite **celle-là et pas les trois
 * autres**. Une question dont on connaît déjà la réponse — un **oracle externe** — posée à
 * l'instrument. C'est ce qui rend le contrôle concluant avec un SEUL provider : on ne demande
 * pas à istanbul de se vérifier lui-même, on le confronte à une vérité qu'on tient d'avance.
 *
 * ## Pourquoi une gate et pas une contre-épreuve ponctuelle
 *
 * L'histoire du dépôt tranche : une vérification non câblée n'a pas lieu. Le gate de
 * couverture lui-même était absent de `ci:local` jusqu'au 19/07 et **il est resté ROUGE sur
 * `main`** sans que rien ne le signale (ARCHI B.14). Une contre-épreuve « à faire de temps
 * en temps » subirait le même sort.
 *
 * ## Un seul provider : istanbul
 *
 * Le dépôt mesure sa couverture avec **istanbul, partout, et rien d'autre**. La classe de
 * défauts qui avait motivé cette gate — un module chargé par `require()` que l'instrumentation
 * ne voit pas sous `--import tsx` — a été éliminée aux sprints 2 à 5 et est désormais gardée à
 * la source par `verify-test-load-mode.cjs` (baseline qui ne peut que descendre). Ici, on
 * vérifie l'attribution : `charlie` appelée une fois doit être créditée `FNDA:1`, les trois
 * autres `FNDA:0`. La sonde ne certifie que le **témoin** — un fichier, un worker, sur la
 * branche `import` — pas l'agrégat en suite complète.
 *
 * Usage :
 *   node scripts/verify-coverage-attribution.cjs           # gate
 *   node scripts/verify-coverage-attribution.cjs --verbose # affiche le lcov produit
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT, ".tmp-coverage-probe");
const VERBOSE = process.argv.includes("--verbose");

// Le répertoire de travail ne doit pas survivre au processus, et un `finally` ne suffit
// pas : chaque garde ci-dessous sort par `process.exit()`, qui saute les `finally`.
process.on("exit", () => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

/** La fonction que le test appelle — les trois autres ne doivent JAMAIS être créditées. */
const CALLED = "charlie";
const NEVER_CALLED = ["alpha", "bravo", "delta"];

/**
 * Écrit le témoin, son test et la config de couverture.
 *
 * Les 4 fonctions ont des corps distincts sur des lignes distinctes : une attribution
 * décalée devient visible sur les `DA:` autant que sur les `FNDA:`.
 */
function plantWitness() {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    fs.writeFileSync(
        path.join(TMP_DIR, "witness.ts"),
        [
            "export function alpha(n: number): number {",
            "    return n + 1;",
            "}",
            "",
            "export function bravo(n: number): number {",
            "    return n + 2;",
            "}",
            "",
            "export function charlie(n: number): number {",
            "    return n + 3;",
            "}",
            "",
            "export function delta(n: number): number {",
            "    return n + 4;",
            "}",
            "",
        ].join("\n")
    );

    // Charge par `import` — la branche que l'instrument mesure juste.
    fs.writeFileSync(
        path.join(TMP_DIR, "witness.test.ts"),
        [
            'import { describe, it, expect } from "vitest";',
            'import { charlie } from "./witness";',
            "",
            'describe("témoin d\'étalonnage", () => {',
            '    it("n\'appelle QUE charlie", () => {',
            "        expect(charlie(1)).toBe(4);",
            "    });",
            "});",
            "",
        ].join("\n")
    );

    fs.writeFileSync(
        path.join(TMP_DIR, "vitest.config.ts"),
        [
            'import { defineConfig } from "vitest/config";',
            "",
            "export default defineConfig({",
            `    root: ${JSON.stringify(TMP_DIR)},`,
            "    test: {",
            '        include: ["witness.test.ts"],',
            "        coverage: {",
            '            provider: "istanbul",',
            '            include: ["witness.ts"],',
            "            all: false,",
            '            reporter: ["lcovonly"],',
            '            reportsDirectory: "./cov",',
            "        },",
            "    },",
            "});",
            "",
        ].join("\n")
    );
}

/**
 * Lance vitest avec couverture (istanbul) et rend les compteurs `FNDA` du témoin.
 *
 * @returns {Record<string, number>} nom de fonction → nombre d'appels crédités.
 */
function measure() {
    const res = spawnSync(
        "npx",
        ["vitest", "run", "--config", path.join(TMP_DIR, "vitest.config.ts"), "--coverage"],
        { cwd: ROOT, encoding: "utf8", env: { ...process.env, CI: "true" } }
    );

    const lcovPath = path.join(TMP_DIR, "cov", "lcov.info");
    if (!fs.existsSync(lcovPath)) {
        console.error("✘ verify-coverage-attribution: aucun lcov produit.");
        console.error((res.stdout || "") + (res.stderr || ""));
        process.exit(1);
    }

    const lcov = fs.readFileSync(lcovPath, "utf8");
    if (VERBOSE) console.log(`\n─── lcov ───\n${lcov}`);

    /** @type {Record<string, number>} */
    const fnda = {};
    for (const line of lcov.split("\n")) {
        const f = line.match(/^FNDA:(\d+),(.+)$/);
        if (f) fnda[f[2].trim()] = Number(f[1]);
    }
    return fnda;
}

/**
 * Vérifie qu'un relevé crédite la bonne fonction et elle seule.
 *
 * @param {Record<string, number>} fnda
 * @returns {string[]} Anomalies, vide si conforme.
 */
function checkAttribution(fnda) {
    const bad = [];

    if (Object.keys(fnda).length === 0) {
        bad.push("aucune fonction relevée — l'instrument n'a rien mesuré");
        return bad;
    }
    if (fnda[CALLED] !== 1) {
        bad.push(
            `\`${CALLED}\` est la SEULE fonction appelée, attendu FNDA:1, ` +
                `relevé FNDA:${fnda[CALLED] ?? "absent"}`
        );
    }
    for (const fn of NEVER_CALLED) {
        if (fnda[fn] !== 0) {
            bad.push(
                `\`${fn}\` n'est JAMAIS appelée, attendu FNDA:0, relevé FNDA:${fnda[fn] ?? "absent"}`
            );
        }
    }
    return bad;
}

// ── Exécution ────────────────────────────────────────────────────────────────
plantWitness();

const problems = checkAttribution(measure());

if (problems.length > 0) {
    console.error("✘ verify-coverage-attribution: l'appareil de mesure ne dit pas vrai.\n");
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
        "\n  Un rapport de couverture faux est bien formé et plausible : aucun test ne\n" +
            "  peut l'attraper. Voir _docs_projet/archives/roadmap_couverture-tests.md"
    );
    process.exit(1);
}

console.log(
    "✔ verify-coverage-attribution: l'attribution est juste sur la branche `import` — " +
        `\`${CALLED}\` créditée FNDA:1, les 3 autres FNDA:0.`
);
