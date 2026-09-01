/**
 * hygiene-patterns.cjs — the path shapes `verify-repo-hygiene.cjs` refuses.
 *
 * One definition, two readers: the gate (checks 1, 2 and 3) and
 * `probe-gate-visibility.cjs`, which evaluates them on known-answer witnesses. Same
 * pattern as `lib/generated-artifacts.cjs`, and for the same reason:
 * `verify-repo-hygiene.cjs` executes at import — a third-party reader cannot `require()`
 * it to query its tables.
 *
 * ⚠️ The probe CANNOT prove these patterns by planting a fixture: their corpus is
 * `getTrackedFiles()`, and the probe deliberately plants without indexing (which is what
 * makes it harmless). With no third-party reader, a pattern widened here would be covered
 * by check 1b's `.cjs` fixture and its widening would stay UNPROVEN — exactly the hole
 * that had to be patched after the fact for the `.mjs` half.
 *
 * ⚠️ Patterns are tested against a full relative PATH (`scripts/foo.cjs`), never a
 * basename. Hence the `\b` anchor on each: without it, `fix[-_]` takes
 * `prefix-loader.js`, `hotfix-runner.js` and `postfix-util.js`.
 */

"use strict";

/**
 * Throwaways: single-use scripts that never should have entered the index.
 *
 * The signal is carried by the PREFIX, never by the extension. Widening to `.js` in
 * general would take hundreds of legitimate files; it is `fix`/`tmp`/`scratch` that says
 * "written for one use".
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

/** Tool outputs that have no business in the index. */
const ARTIFACT_PATTERNS = [
    { re: /coverage[-_]output\.txt$/i, label: "coverage output log" },
    { re: /_cov_run\.txt$/i, label: "vitest coverage run log" },
    // The single directory for run reports (playwright results + report, root vitest
    // coverage, coverage-e2e). Anchored: it lives at exactly one place.
    { re: /^artifacts\//i, label: "répertoire d'artefacts de run" },
    // Kept even though these directories moved under `artifacts/`: they guard against a
    // RE-CREATION at the root by a misconfigured tool.
    { re: /^coverage-e2e\//i, label: "e2e coverage HTML dir (ancien emplacement)" },
    { re: /^playwright-report\//i, label: "playwright HTML report (ancien emplacement)" },
    { re: /^test-results\//i, label: "playwright results dir (ancien emplacement)" },
    { re: /^\.nyc_output\//i, label: "nyc output dir" },
];

/** Python bytecode — the repo has no `.py`; the rule guards that none enters. */
const BYTECODE_PATTERNS = [
    { re: /__pycache__\//i, label: "Python bytecode (__pycache__)" },
    { re: /\.pyc$/i, label: "Python .pyc file" },
    { re: /\.pyo$/i, label: "Python .pyo file" },
];

/**
 * Known-answer witnesses, read by `probe-gate-visibility.cjs`.
 *
 * Each line is a design choice that cost a measurement. The last four are the `\b`
 * anchor's reason to exist: these are ORDINARY names, and the originally proposed pattern
 * (unanchored) took all three.
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
 * ARTIFACT-pattern witnesses, read by `probe-gate-visibility.cjs`.
 *
 * Same requirement as `THROWAWAY_WITNESSES`: a pattern added without a witness is
 * UNPROVEN. That is the exact hole that had to be re-plugged after the fact for the
 * `.mjs` half.
 *
 * The last two are the `^` anchor's reason to exist: `artifacts` and `test-results` are
 * ORDINARY directory names, perfectly legitimate inside a package or a source tree.
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
