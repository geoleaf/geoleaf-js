#!/usr/bin/env node
/**
 * verify-ci-scripts-tracked.cjs — every script `ci:local` invokes is git-tracked.
 *
 * ## The blind spot SYMMETRIC to an already-closed one
 *
 * `verify-repo-hygiene.cjs` keeps an UNDECLARED script from entering: any
 * `scripts/` `.cjs`/`.mjs` absent from `SCRIPTS_ALLOWLIST` reddens check 1. It
 * says nothing of the inverse case — a DECLARED, INVOKED but **untracked**
 * script passes both checks without a word: a file absent from the index is
 * simply ignored by the corpus, and an allowlist entry without a file is not an
 * error.
 *
 * Not a hypothesis. `check-subpath-resolve.cjs` lived exactly that state: wired
 * into `ci:local`, declared, present on the disk of the only machine that wrote
 * it, and **absent from the index**. On a fresh clone, `ci:local` failed at
 * launch — on the origin machine, it was green. The repo's worst outage profile:
 * the one that only manifests at someone else's.
 *
 * ## What the gate reads, and why not otherwise
 *
 * It **imports** `ci-local.cjs` (which exports its tables) and follows
 * invocations transitively:
 *
 *   STEPS / E2E_STEPS  ─┬─→  `node scripts/<x>`         ── directement
 *                       └─→  `npm run <x>` ─→ package.json#scripts ─→ `scripts/<y>` …
 *                                            (`npm run` chains are followed too)
 *
 * then, from each reached script, the closure of its RELATIVE
 * `require`/`import` toward `scripts/` — that is where the
 * `knip-hints-reporter.mjs` incident lived: a module created, wired and
 * documented the same day, yet in no hygiene register.
 *
 * ⚠️ It does **not analyse** `ci-local.cjs` by regex. A textual parser that
 * stops matching after a table refactor does not redden: it finds zero scripts,
 * declares them all tracked and goes green. A gate does not need to disappear
 * to be blind — an empty perimeter suffices.
 *
 * ## The known-answer witness
 *
 * A `require` cannot render an empty table in silence, but RESOLUTION can: a
 * renamed `npm run`, a restructured `package.json#scripts`, and the graph
 * shrinks without error. Hence the floor (`MIN_RESOLVED`) — same pattern as
 * `audit-report-freshness.cjs` ("≥ 400 files under core/src") and
 * `verify-coverage-attribution.cjs`. Under the floor, the gate REFUSES to
 * conclude.
 *
 * ⚠️ It proves itself from the working tree, NOT on a fresh clone: it queries
 * the INDEX (`git ls-files`), so it sees the defect before the push rather than
 * after. Precisely what makes it useful — a check requiring a fresh clone would
 * never be launched at the right moment.
 *
 * Usage : node scripts/verify-ci-scripts-tracked.cjs [--verbose]
 * Exit 0 = every invoked script is tracked, 1 otherwise.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

// Resolution of `npm run <x> -w <package>`: the registry, never a hard path.
const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const VERBOSE = process.argv.includes("--verbose");

/**
 * The witness's floor.
 *
 * 2026-07-25 measurement: 42 scripts reached from `ci:local` without `--e2e`, 45
 * with. The floor sits deliberately UNDER the measurement — it is not a coverage
 * ratchet, it detects the resolution graph's collapse. Raising it to the exact
 * measurement would redden it at the first rightly-removed gate.
 */
const MIN_RESOLVED = 30;

const C = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

// ── Resolution ───────────────────────────────────────────────────────────────

const SCRIPT_RE = /(?:^|[\s"'=])(scripts\/[\w./-]+\.(?:cjs|mjs))/g;
const NPM_RUN_RE = /npm run ([\w:.-]+)/g;
/** `-w <spec>` / `--workspace <spec>` / `--workspace=<spec>` — the script then lives in THAT package. */
const WORKSPACE_RE = /(?:-w|--workspace)[= ]([@\w./-]+)/;

/** The scripts named directly in an npm command line. */
function scriptsInCommand(cmd) {
    return [...cmd.matchAll(SCRIPT_RE)].map((m) => m[1]);
}

/**
 * A file's REAL module specifiers — by AST, never by regex on the text.
 *
 * ⚠️ This function's first version read the source by regex. Measured at
 * landing: **6 false positives out of 7 reports**, all of the same family —
 * quoted code that is not executed code:
 *
 *   • `packages.cjs` documents `require("./lib/packages.cjs")` in its own header
 *     → resolved as `scripts/lib/lib/packages.cjs`;
 *   • `check-dynamic-key-writes.cjs` carries
 *     `const GUARD_MODULE = "object-path-guard.js"` → data, not an import;
 *   • `probe-gate-visibility.cjs` embeds `await import("./eslint.config.mjs")`
 *     in a TEMPLATE LITERAL executed by a child process, with another `cwd`.
 *
 * A gate that shouts at comments gets disarmed within a week. The AST sees only
 * real import nodes; `typescript` is already 3 other gates' dependency
 * (`check-facade-purity`, `check-orphan-exports`, `check-contracts-pure`).
 */
function moduleSpecifiers(absPath, text) {
    const ts = require("typescript");
    const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const out = [];

    const visit = (node) => {
        // `import x from "…"` / `export … from "…"`
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            out.push(node.moduleSpecifier.text);
        }
        // `require("…")` et `import("…")` — un seul argument, littéral de chaîne.
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const isRequire = ts.isIdentifier(callee) && callee.text === "require";
            const isDynImport = callee.kind === ts.SyntaxKind.ImportKeyword;
            const [arg] = node.arguments;
            if ((isRequire || isDynImport) && arg && ts.isStringLiteral(arg)) out.push(arg.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

/**
 * Closure of a script's RELATIVE `require`/`import` toward `scripts/`.
 *
 * Only relative specifiers are followed: a `require("typescript")` is an npm
 * dependency, not a repo file. The extension is mandatory in this repo (explicit
 * CJS, strict ESM), so no index resolution to guess.
 */
function localRequires(relPath, seen) {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) return [];
    const out = [];
    for (const spec of moduleSpecifiers(abs, fs.readFileSync(abs, "utf8"))) {
        if (!spec.startsWith(".")) continue;
        const resolved = path.posix.join(path.posix.dirname(relPath), spec);
        if (resolved.startsWith("scripts/") && !seen.has(resolved)) out.push(resolved);
    }
    return out;
}

/** Resolves the step table into the set of repo scripts it ends up executing. */
function resolveInvokedScripts() {
    const { STEPS, E2E_STEPS } = require("./ci-local.cjs");
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const npmScripts = pkg.scripts || {};

    const found = new Set();
    const visitedNpm = new Set();
    const origin = new Map(); // script → how it was reached (for the report)
    const dangling = []; // `npm run <x>` resolving nowhere — check 2

    const note = (script, from) => {
        if (!origin.has(script)) origin.set(script, from);
        found.add(script);
    };

    /**
     * The body of an `npm run <name>`, resolved in the RIGHT package.json.
     *
     * `-w <spec>` moves resolution to the named package: `npm run test:bundle
     * -w @geoleaf/core` does NOT look in the root. Without this case, check 2
     * below would cry wolf on a perfectly valid `ci:local` step.
     */
    const bodyOf = (name, hostCmd) => {
        const ws = hostCmd && hostCmd.match(WORKSPACE_RE);
        if (!ws) return npmScripts[name];
        const entry = registry.byName(ws[1]);
        if (!entry) return undefined; // paquet inconnu — `check-versions` couvre ce cas
        const wsPkg = JSON.parse(fs.readFileSync(path.join(entry.absDir, "package.json"), "utf8"));
        return (wsPkg.scripts || {})[name];
    };

    const walkNpm = (name, from, hostCmd) => {
        const key = `${name} ${(hostCmd.match(WORKSPACE_RE) || [, ""])[1]}`;
        if (visitedNpm.has(key)) return;
        visitedNpm.add(key);
        const cmd = bodyOf(name, hostCmd);
        if (cmd === undefined) {
            // This used to be a mute `return`, under the comment "check-versions'
            // business". Verified: check-versions looks ONLY at versions and
            // inter-package dependencies, it reads no `scripts`. That delegation
            // did not exist. Measured consequence: renaming an npm script without
            // following its caller in ci-local.cjs made THIS gate go GREEN, by
            // simply resolving one script fewer (54 → 53, "53/53 tracked").
            dangling.push({ name, from });
            return;
        }
        for (const s of scriptsInCommand(cmd)) note(s, `${from} → npm run ${name}`);
        for (const m of cmd.matchAll(NPM_RUN_RE)) walkNpm(m[1], `${from} → npm run ${name}`, cmd);
    };

    for (const step of [...STEPS, ...E2E_STEPS]) {
        const cmd = step.run.join(" ");
        for (const s of scriptsInCommand(cmd)) note(s, `ci:local « ${step.name} »`);
        for (const m of cmd.matchAll(NPM_RUN_RE)) walkNpm(m[1], `ci:local « ${step.name} »`, cmd);
    }

    // Local-requires closure — breadth-first walk to saturation.
    const queue = [...found];
    while (queue.length) {
        const current = queue.shift();
        for (const dep of localRequires(current, found)) {
            note(dep, `requis par ${current}`);
            queue.push(dep);
        }
    }

    return { scripts: [...found].sort(), origin, dangling };
}

// ── Control ──────────────────────────────────────────────────────────────────

function trackedScripts() {
    const out = execSync("git ls-files scripts/", { cwd: ROOT, encoding: "utf8" });
    return new Set(out.split("\n").filter(Boolean));
}

const { scripts, origin, dangling } = resolveInvokedScripts();
const tracked = trackedScripts();

console.log(`${C.cyan}── CI-SCRIPTS-TRACKED ──${C.reset}`);
console.log(
    `  ${scripts.length} script(s) atteignable(s) depuis ci:local (directs + npm run + requires locaux)`
);

if (VERBOSE) {
    for (const s of scripts) console.log(`    ${C.dim}${s}  ←  ${origin.get(s)}${C.reset}`);
}

const errors = [];

// ── Check 1 — the witness ────────────────────────────────────────────────────
// It runs BEFORE the tracking check, deliberately: on a collapsed graph, "0
// untracked scripts" is true and means nothing. Refusing to conclude beats
// concluding right by accident.
if (scripts.length < MIN_RESOLVED) {
    errors.push(
        `témoin en échec — ${scripts.length} scripts résolus (plancher ${MIN_RESOLVED}).\n` +
            `    La table de ci-local.cjs ou les scripts npm ont changé de forme et la\n` +
            `    résolution ne suit plus. Un « 0 non tracé » depuis ce corpus serait faux.`
    );
}

// ── Check 2 — no dangling `npm run` ──────────────────────────────────────────
// An `npm run <x>` nothing defines does not redden this gate by itself: it
// simply resolves one script fewer, and the report announces "N/N tracked". The
// check-1 floor does not see it either (it detects a collapse, not a unit).
// Exactly what made an npm-script rename undetectable — the outage only
// appeared at the step's execution, hence for `--e2e` steps only when `--e2e`
// is passed.
for (const d of dangling) {
    errors.push(
        `npm run ${d.name} — AUCUNE définition (ni racine, ni workspace ciblé par -w).\n` +
            `    Origine : ${d.from}\n` +
            `    ci:local échouera à cette étape avec « Missing script ».`
    );
}

// ── Check 3 — the property ───────────────────────────────────────────────────
const untracked = scripts.filter((s) => !tracked.has(s));
for (const s of untracked) {
    const onDisk = fs.existsSync(path.join(ROOT, s));
    errors.push(
        `${s} — invoqué mais NON SUIVI par git (${onDisk ? "présent sur ce disque" : "absent du disque"}).\n` +
            `    Origine : ${origin.get(s)}\n` +
            `    ${onDisk ? "Sur un clone frais, ci:local échouerait ici." : "ci:local échoue déjà."}`
    );
}

// ── Rapport ──────────────────────────────────────────────────────────────────
if (errors.length) {
    console.error(`\n${C.red}✗ CI-SCRIPTS-TRACKED — ${errors.length} problème(s)${C.reset}\n`);
    for (const e of errors) console.error(`  ${C.red}•${C.reset} ${e}\n`);
    process.exit(1);
}

console.log(
    `${C.green}✓${C.reset}  ${scripts.length}/${scripts.length} suivis par git — ci:local démarre sur un clone frais.`
);
process.exit(0);
