#!/usr/bin/env node
/**
 * TTC — the TypeScript test suites are actually type-checked, under a shrinking baseline.
 *
 * ## The contradiction this closes
 *
 * `JS-TEST-DEBT` refuses a NEW test written in `.js` — it imposes TypeScript. Yet every
 * package tsconfig EXCLUDES its test directory (`core`: `"__tests__"`, plugins:
 * `"src/__tests__"`), so nothing ever compiled the 260+ `.test.ts` suites the rule produced.
 * Type errors sleep there, invisible until the day some tsconfig widens — at which point they
 * all surface at once, non-actionably. Two gates of the same repo pulled in opposite
 * directions: one demanded TypeScript, nothing checked it.
 *
 * ## What it does
 *
 * For each workspace package carrying `*.test.ts` / `*.spec.ts` files, build one ts.Program
 * over those files using the PACKAGE'S OWN compilerOptions plus the overrides below, collect
 * syntactic + semantic diagnostics, and compare `file:TScode` pairs against a frozen baseline.
 *
 *   TTC-00  non-vacuity floor: fewer than 100 test .ts files found → refuse to conclude
 *           (a broken glob must not pass as "no errors").
 *   TTC-01  a `file:code` pair absent from the baseline → ERROR (a NEW dormant error).
 *   TTC-02  a baseline entry no longer observed → ERROR until the baseline is tightened
 *           (`--update-baseline`) — the ratchet only goes down.
 *
 * ## Why these compiler overrides, and not the package options alone
 *
 * The suites execute under Vitest, i.e. Vite: `moduleResolution: "bundler"` is the resolution
 * they actually run with — the packages' own `node`/`node16` settings cannot even resolve
 * vitest's type entry points (measured: TS2307 on `@vitest/utils/display`). Tests also import
 * sources with explicit `.ts` extensions, hence `allowImportingTsExtensions` (legal only with
 * `noEmit`). `skipLibCheck` keeps the verdict about OUR suites, not about dependency d.ts
 * files. The baseline keys carry no line numbers on purpose: lines drift on every edit, and a
 * ratchet keyed on them would churn without information.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { all } = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, ".baselines", "test-ts-dormant.json");
const UPDATE = process.argv.includes("--update-baseline");
const FLOOR = 100;

/** Test files of one package — worktree scan, build artefacts excluded. */
function testFilesOf(pkgAbsDir) {
    const out = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (e.name === "node_modules" || e.name === "dist" || e.name === "coverage") continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(test|spec)\.ts$/.test(e.name)) out.push(p);
        }
    };
    walk(pkgAbsDir);
    return out.sort();
}

/** The package's own options, made compilable for a Vitest corpus. */
function optionsOf(pkgAbsDir) {
    const cfgPath = path.join(pkgAbsDir, "tsconfig.json");
    let base = {};
    if (fs.existsSync(cfgPath)) {
        const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, pkgAbsDir);
        base = parsed.options;
    }
    return {
        ...base,
        noEmit: true,
        skipLibCheck: true,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
        allowImportingTsExtensions: true,
        // `types` untouched: suites import vitest explicitly (repo convention) — a suite
        // relying on injected globals surfaces as TS2304 and lands in the baseline, visibly.
    };
}

const perPkg = [];
let totalFiles = 0;
for (const pkg of all()) {
    const files = testFilesOf(pkg.absDir);
    if (files.length === 0) continue;
    totalFiles += files.length;
    perPkg.push({ name: pkg.name ?? path.basename(pkg.absDir), absDir: pkg.absDir, files });
}

console.log(
    `\x1b[2m── TTC — les suites TypeScript sont type-checkées (baseline décroissante) ──\x1b[0m`
);

if (totalFiles < FLOOR) {
    console.error(
        `❌ [TTC-00] ${totalFiles} suite(s) .ts trouvée(s) — sous le plancher de ${FLOOR}.\n` +
            `   Un corpus aussi petit signale un glob cassé, pas un dépôt sain : refus de conclure.`
    );
    process.exit(1);
}

const observed = new Map(); // "relFile:TScode" -> count
for (const { absDir, files } of perPkg) {
    const program = ts.createProgram({ rootNames: files, options: optionsOf(absDir) });
    const diags = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
    for (const d of diags) {
        if (!d.file) continue;
        const rel = path.relative(ROOT, d.file.fileName).replace(/\\/g, "/");
        // Only OUR suites decide the verdict — diagnostics reported inside imported source
        // files (the suite pulls the whole src graph) belong to the src gates, not here.
        if (!/\.(test|spec)\.ts$/.test(rel)) continue;
        const key = `${rel}:TS${d.code}`;
        observed.set(key, (observed.get(key) ?? 0) + 1);
    }
}

const observedKeys = [...observed.keys()].sort();
console.log(
    `  ${perPkg.length} paquet(s) · ${totalFiles} suite(s) .ts · ` +
        `${observedKeys.length} paire(s) fichier:code dormante(s)`
);

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            {
                _comment:
                    "TTC-01/02 — paires `fichier:TScode` d'erreurs DORMANTES dans les suites .ts, gelées à la pose (B-D1 : une gate qui naîtrait rouge sur tout le corpus serait désarmée dans la semaine). Cette liste ne peut que RÉTRÉCIR : corriger une erreur puis resserrer via --update-baseline. Les clés ne portent pas de numéro de ligne, délibérément — les lignes dérivent à chaque édition sans information.",
                _generated: "node scripts/check-test-typecheck.cjs --update-baseline",
                count: observedKeys.length,
                entries: observedKeys,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`\x1b[32m✓\x1b[0m baseline écrite — ${observedKeys.length} entrée(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
    console.error(
        `❌ [TTC] baseline absente (${path.relative(ROOT, BASELINE_PATH)}).\n` +
            `   Première pose : node scripts/check-test-typecheck.cjs --update-baseline`
    );
    process.exit(1);
}
const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).entries);

const neuf = observedKeys.filter((k) => !baseline.has(k));
const gueris = [...baseline].filter((k) => !observed.has(k)).sort();

let failed = false;
if (neuf.length) {
    failed = true;
    console.error(`❌ [TTC-01] ${neuf.length} erreur(s) de type NOUVELLE(S) dans les suites :`);
    for (const k of neuf.slice(0, 20)) console.error(`   + ${k}`);
    if (neuf.length > 20) console.error(`   … et ${neuf.length - 20} de plus`);
    console.error(
        `   Une suite neuve ou modifiée doit compiler. Corriger le type — ne pas élargir la baseline (I3).`
    );
}
if (gueris.length) {
    failed = true;
    console.error(
        `❌ [TTC-02] ${gueris.length} entrée(s) de baseline ne s'observent plus — resserrer :`
    );
    for (const k of gueris.slice(0, 10)) console.error(`   − ${k}`);
    console.error(`   \x1b[2mnode scripts/check-test-typecheck.cjs --update-baseline\x1b[0m`);
}
if (failed) process.exit(1);
console.log(
    `\x1b[32m✓ TTC\x1b[0m — aucune erreur de type nouvelle dans les suites (${baseline.size} gelée(s)).`
);
