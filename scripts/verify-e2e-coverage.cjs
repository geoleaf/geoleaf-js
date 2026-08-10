#!/usr/bin/env node
/*!
 * GeoLeaf — Gate de couverture du BOOT DU BUNDLE LIVRÉ
 * © 2026 Mattieu Pottier — MIT
 *
 * T6.1 (25/07/2026) — « la couverture E2E avait un producteur et aucun lecteur ».
 *
 * ## Ce que cette gate mesure — et son nom
 *
 * Elle NE mesure PAS « la couverture E2E ». Elle mesure ce qu'UN chargement de page
 * exécute du bundle livré minifié, dans un vrai Chromium. Le nom compte : appeler ça
 * « couverture E2E » serait une déclaration fausse de plus, et ce sprint en corrige
 * onze.
 *
 *   · producteur   : `e2e/helpers/coverage.js:7` → `.nyc_output/e2e-<name>.json`
 *   · appelant     : `e2e/07-boot-sequence.spec.js` — LE SEUL des 36 specs
 *   · périmètre    : les 226 fichiers instrumentés par
 *                    `packages/core/rollup.config.mjs:166` (`src/{api,globals,kernel,
 *                    utils,app}`). `src/capabilities/**` — 219 fichiers, 44 % de
 *                    `core/src` — n'y est pas, ni au numérateur ni au dénominateur.
 *
 * Trois autres specs visent la variante instrumentée (`20`, `21`, `22`) sans jamais
 * dumper ; les 32 restants tournent contre des deploys non instrumentés où
 * `window.__coverage__` n'existe pas. Écrire de nouveaux scénarios E2E n'augmentera
 * donc PAS ce chiffre — un spec ne compte que s'il vise `baseURL('coverage')` ET
 * appelle `collectCoverage()`. Le levier est le périmètre d'instrumentation.
 *
 * Ce qu'elle protège, et que rien d'autre ne protège : qu'un boot de page continue
 * d'exécuter ~4 lignes sur 10 de la clôture kernel+api+utils+app RÉELLEMENT PUBLIÉE.
 * Les 92 % de CLAUDE.md sont la couverture unitaire des SOURCES sous Node — un autre
 * objet, une autre chaîne, jamais à réconcilier avec celui-ci.
 *
 * ## Pourquoi un wrapper, et pas l'étape `npm run report:e2e` nue
 *
 * Parce que `nyc report` sort VERT sur un `.nyc_output/` vide, sur les quatre
 * métriques. Chaîne mesurée :
 *   · `istanbul-lib-coverage/lib/percent.js` : `total === 0` → `return 100`
 *   · sur une carte entièrement vide, `blankSummary()` renvoie `pct: 'Unknown'`
 *   · et la comparaison de `nyc/index.js` est `if (coverage < thresholds[key])`,
 *     or `'Unknown' < 35` vaut `false`.
 *
 * Câbler `report:e2e` tel que l'énoncé du sprint le proposait aurait donc installé une
 * gate verte EXACTEMENT quand la mesure échoue — la classe de défaut que T3, T4 et T6
 * documentent chacun à leur tour. D'où les deux checks qui précèdent la délégation.
 *
 * Usage :
 *   node scripts/verify-e2e-coverage.cjs
 *   GEOLEAF_NYC_OUTPUT=/tmp/vide node scripts/verify-e2e-coverage.cjs   # preuve par mutation
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

// Chemins de la RACINE — la règle « jamais de `packages/<nom>` en dur » n'est pas
// engagée ici : aucun de ces deux chemins n'est un paquet.
const NYC_OUTPUT = process.env.GEOLEAF_NYC_OUTPUT
    ? path.resolve(process.env.GEOLEAF_NYC_OUTPUT)
    : path.join(ROOT, ".nyc_output");
const INSTRUMENTED_BUILD = path.join(ROOT, "deploy", "deploy-coverage");

/**
 * Planchers de témoin.
 *
 * Mesure du 25/07/2026 : 216 fichiers instrumentés présents dans la donnée, 10 362
 * statements. Le périmètre d'instrumentation en déclare 226 — la donnée en couvre donc
 * 95,6 %, et 40 des 216 sont à zéro statement exécuté (le dénominateur n'est pas biaisé
 * « par ce qui a tourné »).
 *
 * Les planchers sont délibérément SOUS la mesure : ils ne sont pas un cliquet de
 * couverture — les seuils de `nyc.config.cjs` jouent ce rôle — mais un détecteur
 * d'EFFONDREMENT. Sous le plancher, la gate refuse de conclure plutôt que de conclure
 * juste par accident. Même patron que `MIN_RESOLVED` dans `verify-ci-scripts-tracked.cjs`.
 */
const MIN_INSTRUMENTED_FILES = 180;
const MIN_STATEMENTS = 8000;

const C = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

// ── Lecture de la donnée ─────────────────────────────────────────────────────

/** Le mtime le plus récent d'une arborescence, ou 0 si elle n'existe pas. */
function newestMtime(dir) {
    if (!fs.existsSync(dir)) return 0;
    let newest = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (!entry.isFile()) continue;
        const full = path.join(entry.parentPath || entry.path || dir, entry.name);
        try {
            newest = Math.max(newest, fs.statSync(full).mtimeMs);
        } catch {
            /* fichier disparu en cours de parcours — sans importance ici */
        }
    }
    return newest;
}

/** Les fichiers `e2e-*.json` du tempDir, fusionnés en un seul décompte. */
function readCoverageData() {
    if (!fs.existsSync(NYC_OUTPUT)) return { files: 0, statements: 0, present: false };

    let files = 0;
    let statements = 0;
    for (const name of fs.readdirSync(NYC_OUTPUT)) {
        if (!name.endsWith(".json")) continue;
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(path.join(NYC_OUTPUT, name), "utf8"));
        } catch {
            // `nyc` avale la même erreur en silence (`return {}`). Ici on la NOMME :
            // un JSON illisible dans le tempDir fait rétrécir la mesure sans trace.
            continue;
        }
        for (const entry of Object.values(parsed)) {
            if (!entry || typeof entry !== "object" || !entry.s) continue;
            files += 1;
            statements += Object.keys(entry.s).length;
        }
    }
    return { files, statements, present: true };
}

// ── Contrôle ─────────────────────────────────────────────────────────────────

const errors = [];
const data = readCoverageData();

console.log(`${C.cyan}── E2E-COVERAGE (boot du bundle livré) ──${C.reset}`);
console.log(
    `  ${data.files} fichier(s) instrumenté(s), ${data.statements} statement(s) — ${C.dim}${path.relative(ROOT, NYC_OUTPUT) || NYC_OUTPUT}${C.reset}`
);

// ── Check 0 — fraîcheur ──────────────────────────────────────────────────────
// La donnée E2E vient NÉCESSAIREMENT après le build instrumenté qui l'a produite.
// Une donnée antérieure est un résidu d'un run précédent : la gate le mesurerait
// comme si c'était le run courant. Ignoré quand le build est absent (poste où l'on
// n'a pas encore lancé `build:deploy-coverage`) — le check 1 couvre ce cas.
const buildMtime = newestMtime(INSTRUMENTED_BUILD);
const dataMtime = newestMtime(NYC_OUTPUT);
if (buildMtime > 0 && dataMtime > 0 && dataMtime < buildMtime) {
    errors.push(
        `donnée PÉRIMÉE — .nyc_output/ est antérieur au build instrumenté.\n` +
            `    donnée : ${new Date(dataMtime).toISOString()}\n` +
            `    build  : ${new Date(buildMtime).toISOString()} (deploy/deploy-coverage)\n` +
            `    C'est le résidu d'un run précédent. Relancer l'E2E avant de conclure.`
    );
}

// ── Check 1 — plancher de témoin ─────────────────────────────────────────────
// LE check qui justifie ce fichier. Il passe AVANT la délégation à `nyc`, parce que
// `nyc report` est vert sur une donnée vide (cf. en-tête) : sans ce plancher, l'étape
// serait verte précisément quand la mesure a échoué.
if (!data.present) {
    errors.push(
        `.nyc_output/ ABSENT — aucune donnée de couverture à évaluer.\n` +
            `    Produite par un run E2E sur deploy-coverage (\`node scripts/ci-local.cjs --e2e\`).`
    );
} else if (data.files < MIN_INSTRUMENTED_FILES || data.statements < MIN_STATEMENTS) {
    errors.push(
        `témoin en échec — ${data.files} fichiers / ${data.statements} statements ` +
            `(planchers ${MIN_INSTRUMENTED_FILES} / ${MIN_STATEMENTS}).\n` +
            `    La gate REFUSE DE CONCLURE : sur une donnée effondrée, \`nyc report\` sort\n` +
            `    VERT ('Unknown' < seuil vaut false), ce qui serait indiscernable d'un succès.\n` +
            `    Causes usuelles : bundle non instrumenté servi sur 8769, ou run E2E interrompu.`
    );
}

if (errors.length) {
    console.error(`\n${C.red}✗ E2E-COVERAGE — ${errors.length} problème(s)${C.reset}\n`);
    for (const e of errors) console.error(`  ${C.red}•${C.reset} ${e}\n`);
    process.exit(1);
}

// ── Check 2 — les seuils, délégués à nyc ─────────────────────────────────────
// Délégation DÉLIBÉRÉE, et non un recalcul : une seule définition des seuils
// (`nyc.config.cjs`), un seul jeu de reporters — et surtout `report:e2e` garde un
// consommateur NOMMÉ, donc la devDependency `nyc` reste atteignable et knip reste vert
// sans qu'on touche à `ignoreDependencies`.
console.log(`  ${C.dim}seuils délégués à \`npm run report:e2e\` (nyc.config.cjs)${C.reset}\n`);
const res = spawnSync("npm", ["run", "report:e2e"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
});

if (res.status !== 0) {
    console.error(`\n${C.red}✗ E2E-COVERAGE — seuils non atteints (voir ci-dessus).${C.reset}`);
    process.exit(res.status || 1);
}

console.log(
    `\n${C.green}✓${C.reset}  Couverture du boot dans les seuils — ${data.files} fichiers instrumentés mesurés.`
);
process.exit(0);
