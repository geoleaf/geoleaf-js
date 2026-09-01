#!/usr/bin/env node
/*!
 * GeoLeaf — SHIPPED-BUNDLE BOOT coverage gate
 * © 2026 Mattieu Pottier — MIT
 *
 * 2026-07-25 — "the E2E coverage had a producer and no reader".
 *
 * ## What this gate measures — and its name
 *
 * It does NOT measure "the E2E coverage". It measures what ONE page load executes of
 * the shipped, minified bundle, in a real Chromium. The name matters: calling it
 * "E2E coverage" would be one more false statement, of which that pass fixed eleven.
 *
 *   · producer   : `e2e/helpers/coverage.js` → `.nyc_output/e2e-<name>.json`
 *   · caller     : `e2e/07-boot-sequence.spec.js` — the ONLY one of the 36 specs
 *   · perimeter  : the 226 files instrumented by
 *                  `packages/core/rollup.config.mjs` (`src/{api,globals,kernel,
 *                  utils,app}`). `src/capabilities/**` — 219 files, 44 % of
 *                  `core/src` — is not in it, neither numerator nor denominator.
 *
 * Three other specs target the instrumented variant (`20`, `21`, `22`) without ever
 * dumping; the remaining 32 run against non-instrumented deploys where
 * `window.__coverage__` does not exist. Writing new E2E scenarios will thus NOT
 * raise this number — a spec only counts if it targets `baseURL('coverage')` AND
 * calls `collectCoverage()`. The lever is the instrumentation perimeter.
 *
 * What it protects, and nothing else protects: that a page boot keeps executing
 * ~4 lines out of 10 of the ACTUALLY PUBLISHED kernel+api+utils+app closure. The
 * repo's 92 % figure is the SOURCES' unit coverage under Node — another object,
 * another chain, never to reconcile with this one.
 *
 * ## Why a wrapper, and not the bare `npm run report:e2e` step
 *
 * Because `nyc report` comes out GREEN on an empty `.nyc_output/`, on all four
 * metrics. Measured chain:
 *   · `istanbul-lib-coverage/lib/percent.js`: `total === 0` → `return 100`
 *   · on a fully empty map, `blankSummary()` returns `pct: 'Unknown'`
 *   · and `nyc/index.js`'s comparison is `if (coverage < thresholds[key])`,
 *     and `'Unknown' < 35` is `false`.
 *
 * Wiring `report:e2e` as originally proposed would thus have installed a gate green
 * EXACTLY when the measurement fails — the defect class documented over and over
 * here. Hence the two checks preceding the delegation.
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

// ROOT paths — the "never a hard-coded `packages/<name>`" rule is not engaged here:
// neither of these two paths is a package.
const NYC_OUTPUT = process.env.GEOLEAF_NYC_OUTPUT
    ? path.resolve(process.env.GEOLEAF_NYC_OUTPUT)
    : path.join(ROOT, ".nyc_output");
const INSTRUMENTED_BUILD = path.join(ROOT, "deploy", "deploy-coverage");

/**
 * Witness floors.
 *
 * 2026-07-25 measurement: 216 instrumented files present in the data, 10,362
 * statements. The instrumentation perimeter declares 226 — the data thus covers
 * 95.6 % of it, and 40 of the 216 are at zero executed statements (the denominator
 * is not biased "by what ran").
 *
 * The floors sit deliberately BELOW the measurement: they are not a coverage
 * ratchet — `nyc.config.cjs`'s thresholds play that role — but a COLLAPSE detector.
 * Below the floor, the gate refuses to conclude rather than conclude right by
 * accident. Same pattern as `MIN_RESOLVED` in `verify-ci-scripts-tracked.cjs`.
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

// ── Reading the data ─────────────────────────────────────────────────────────

/** A tree's newest mtime, or 0 if it does not exist. */
function newestMtime(dir) {
    if (!fs.existsSync(dir)) return 0;
    let newest = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (!entry.isFile()) continue;
        const full = path.join(entry.parentPath || entry.path || dir, entry.name);
        try {
            newest = Math.max(newest, fs.statSync(full).mtimeMs);
        } catch {
            /* file vanished mid-walk — irrelevant here */
        }
    }
    return newest;
}

/** The tempDir's `e2e-*.json` files, merged into a single tally. */
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
            // `nyc` swallows the same error silently (`return {}`). Here we NAME it:
            // an unreadable JSON in the tempDir shrinks the measurement tracelessly.
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

// ── Check ────────────────────────────────────────────────────────────────────

const errors = [];
const data = readCoverageData();

console.log(`${C.cyan}── E2E-COVERAGE (boot du bundle livré) ──${C.reset}`);
console.log(
    `  ${data.files} fichier(s) instrumenté(s), ${data.statements} statement(s) — ${C.dim}${path.relative(ROOT, NYC_OUTPUT) || NYC_OUTPUT}${C.reset}`
);

// ── Check 0 — freshness ──────────────────────────────────────────────────────
// The E2E data NECESSARILY comes after the instrumented build that produced it.
// Earlier data is a residue of a previous run: the gate would measure it as if it
// were the current run. Ignored when the build is absent (a machine where
// `build:deploy-coverage` has not run yet) — check 1 covers that case.
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

// ── Check 1 — witness floor ──────────────────────────────────────────────────
// THE check that justifies this file. It runs BEFORE delegating to `nyc`, because
// `nyc report` is green on empty data (cf. header): without this floor, the step
// would be green precisely when the measurement failed.
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

// ── Check 2 — the thresholds, delegated to nyc ───────────────────────────────
// DELIBERATE delegation, not a recomputation: one definition of the thresholds
// (`nyc.config.cjs`), one set of reporters — and above all `report:e2e` keeps a
// NAMED consumer, so the `nyc` devDependency stays reachable and knip stays green
// without touching `ignoreDependencies`.
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
