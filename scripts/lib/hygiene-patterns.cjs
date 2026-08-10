/**
 * hygiene-patterns.cjs — les formes de chemin que `verify-repo-hygiene.cjs` refuse.
 *
 * Une définition, deux lecteurs : le gate (checks 1, 2 et 3) et `probe-gate-visibility.cjs`,
 * qui les évalue sur des témoins à réponse connue. Même patron que `lib/generated-artifacts.cjs`
 * posé au T4.1, et pour la même raison : `verify-repo-hygiene.cjs` s'exécute à l'import — un
 * lecteur tiers ne peut pas le `require()` pour interroger ses tables.
 *
 * ⚠️ La sonde ne peut PAS prouver ces motifs en plantant une fixture : leur corpus est
 * `getTrackedFiles()`, et la sonde plante délibérément sans indexer (c'est ce qui la rend
 * inoffensive). Sans lecteur tiers, un motif élargi ici serait couvert par la fixture `.cjs`
 * du check 1b et son élargissement resterait NON PROUVÉ — exactement le trou que T3.7 a dû
 * corriger après coup pour la moitié `.mjs`.
 *
 * ⚠️ Les motifs sont testés contre un CHEMIN relatif complet (`scripts/foo.cjs`), jamais
 * contre un basename. D'où l'ancre `\b` sur chacun : sans elle, `fix[-_]` prend
 * `prefix-loader.js`, `hotfix-runner.js` et `postfix-util.js`. Voir T5.7.
 */

"use strict";

/**
 * Jetables : scripts d'un seul usage qui n'auraient jamais dû entrer dans l'index.
 *
 * Le signal est porté par le PRÉFIXE, jamais par l'extension. Élargir aux `.js` en général
 * prendrait des centaines de fichiers légitimes ; c'est `fix`/`tmp`/`scratch` qui dit
 * « écrit pour une fois ».
 */
const THROWAWAY_PATTERNS = [
    { re: /\btmp_/i, label: "tmp_ prefix" },
    { re: /\bscratch_/i, label: "scratch_ prefix" },
    { re: /\bfix[-_][\w-]+\.(py|cjs|js)$/i, label: "fix- / fix_ one-shot script" },
    { re: /\banalyze_[\w-]+\.py$/i, label: "analyze_ one-shot script" },
    { re: /\bparse_[\w-]+\.py$/i, label: "parse_ one-shot script" },
    { re: /\bfinal_sweep\.py$/i, label: "final_sweep one-shot" },
    { re: /\bverify_\w+\.py$/i, label: "verify_ python one-shot" },
    { re: /\bcheck_\w+\.py$/i, label: "check_ python one-shot" },
    { re: /\brefactor_\w+\.py$/i, label: "refactor_ python one-shot" },
    { re: /\bserve-test\.(cjs|py)$/i, label: "serve-test one-shot" },
];

/** Sorties d'outils qui n'ont rien à faire dans l'index. */
const ARTIFACT_PATTERNS = [
    { re: /coverage[-_]output\.txt$/i, label: "coverage output log" },
    { re: /_cov_run\.txt$/i, label: "vitest coverage run log" },
    // T6.2 — le répertoire unique des rapports de run (playwright results + report,
    // coverage vitest racine, coverage-e2e). Ancré : il vit à exactement un endroit.
    { re: /^artifacts\//i, label: "répertoire d'artefacts de run" },
    // Gardés bien que ces répertoires aient déménagé sous `artifacts/` : ils gardent
    // contre une RECRÉATION à la racine par un outil mal configuré.
    { re: /^coverage-e2e\//i, label: "e2e coverage HTML dir (ancien emplacement)" },
    { re: /^playwright-report\//i, label: "playwright HTML report (ancien emplacement)" },
    { re: /^test-results\//i, label: "playwright results dir (ancien emplacement)" },
    { re: /^\.nyc_output\//i, label: "nyc output dir" },
];

/** Bytecode Python — le dépôt n'a pas de `.py`, la règle garde qu'il n'en entre pas. */
const BYTECODE_PATTERNS = [
    { re: /__pycache__\//i, label: "Python bytecode (__pycache__)" },
    { re: /\.pyc$/i, label: "Python .pyc file" },
    { re: /\.pyo$/i, label: "Python .pyo file" },
];

/**
 * Témoins à réponse connue, lus par `probe-gate-visibility.cjs`.
 *
 * Chaque ligne est un choix de conception qui a coûté une mesure. Les quatre derniers
 * sont la raison d'être de l'ancre `\b` : ce sont des noms ORDINAIRES, et le motif que
 * l'énoncé du T5.7 proposait (sans ancre) les prenait tous les trois.
 *
 * @type {{path: string, throwaway: boolean, why: string}[]}
 */
const THROWAWAY_WITNESSES = [
    {
        path: "scripts/fix-deferred-paths.js",
        throwaway: true,
        why: "tiret + .js — la forme supprimée au T3.2",
    },
    {
        path: "tools/fix_deferred_paths.cjs",
        throwaway: true,
        why: "underscore + .cjs — la forme d'origine",
    },
    { path: "fix-thing.py", throwaway: true, why: "tiret + .py" },
    {
        path: "fix.js",
        throwaway: false,
        why: "pas de séparateur : `fix` seul n'est pas un préfixe de jetable",
    },
    {
        path: "src/prefix-loader.js",
        throwaway: false,
        why: "`fix` en fin de mot — l'ancre \\b le sauve",
    },
    {
        path: "scripts/suffix_map.cjs",
        throwaway: false,
        why: "idem, et le motif d'AVANT T5.7 le prenait",
    },
    { path: "e2e/hotfix-runner.js", throwaway: false, why: "idem" },
];

/**
 * Témoins des motifs d'ARTEFACT, lus par `probe-gate-visibility.cjs` — T6.2.
 *
 * Même exigence que `THROWAWAY_WITNESSES` : un motif ajouté sans témoin est NON PROUVÉ.
 * C'est le trou exact que T5.7 a dû reboucher après coup pour la moitié `.mjs`.
 *
 * Les deux derniers sont la raison d'être de l'ancre `^` : `artifacts` et
 * `test-results` sont des noms de répertoire ORDINAIRES, parfaitement légitimes à
 * l'intérieur d'un paquet ou d'une arborescence de sources.
 *
 * @type {{path: string, artifact: boolean, why: string}[]}
 */
const ARTIFACT_WITNESSES = [
    { path: "artifacts/coverage/index.html", artifact: true, why: "rapport vitest racine (T6.2)" },
    {
        path: "artifacts/playwright/report/index.html",
        artifact: true,
        why: "rapport HTML playwright",
    },
    { path: "artifacts/coverage-e2e/lcov.info", artifact: true, why: "rapport nyc du boot" },
    { path: ".nyc_output/e2e-boot-sequence.json", artifact: true, why: "donnée brute istanbul" },
    {
        path: "coverage-e2e/index.html",
        artifact: true,
        why: "ancien emplacement — recréation à la racine",
    },
    {
        path: "packages/core/src/artifacts/registry.ts",
        artifact: false,
        why: "`artifacts` en composant INTERNE — l'ancre ^ le sauve",
    },
    {
        path: "e2e/fixtures/test-results/sample.json",
        artifact: false,
        why: "idem pour `test-results`",
    },
];

module.exports = {
    THROWAWAY_PATTERNS,
    ARTIFACT_PATTERNS,
    BYTECODE_PATTERNS,
    THROWAWAY_WITNESSES,
    ARTIFACT_WITNESSES,
};
