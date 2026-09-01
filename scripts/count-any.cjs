#!/usr/bin/env node
"use strict";

/**
 * count-any.cjs — Baseline & per-sprint tracking of EXPLICIT `any` in source.
 *
 * Counts `any` tokens in type position (best-effort: strips comments and string/
 * template literals first) across `packages/<pkg>/src`, excluding test files and
 * generated output. This is the tracking metric for the type-hardening roadmap
 *: it mirrors what `@typescript-eslint/no-explicit-any`
 * would flag closely enough to follow progress sprint by sprint.
 *
 * Usage:
 *   node scripts/count-any.cjs            # human table (all packages + core breakdown)
 *   node scripts/count-any.cjs --json     # machine-readable JSON (for baselines/diffs)
 *   node scripts/count-any.cjs --pkg core # restrict to one package
 *
 * NOTE: best-effort lexer. `any` inside `${...}` template interpolations may be
 * undercounted; comments/strings are excluded. Stable enough as a ratchet metric.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const IS_TS = /\.ts$/;
const IS_TEST = /(\.test\.ts|\.spec\.ts)$/;
const SKIP_DIR = new Set(["__tests__", "node_modules", "dist", "coverage", "e2e"]);

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const pkgFilterIdx = args.indexOf("--pkg");
const pkgFilter = pkgFilterIdx !== -1 ? args[pkgFilterIdx + 1] : null;

/** Recursively collect non-test `.ts` files under `dir`. */
function walk(dir, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (SKIP_DIR.has(e.name)) continue;
            walk(full, acc);
        } else if (IS_TS.test(e.name) && !IS_TEST.test(e.name)) {
            acc.push(full);
        }
    }
    return acc;
}

/** Strip comments and string/template literals (best-effort) to avoid false hits. */
function stripNonCode(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

function countAny(src) {
    const m = stripNonCode(src).match(/\bany\b/g);
    return m ? m.length : 0;
}

/** First path segment under `<pkg>/src` — used to group the core breakdown. */
function subdirKey(file, srcDir) {
    const rel = path.relative(srcDir, file);
    const parts = rel.split(path.sep);
    return parts.length > 1 ? parts.slice(0, 3).join("/") : "(root)";
}

const result = { packages: {}, totalSource: 0 };

// Packages come from the workspace registry, not from a one-level
// `readdirSync(packages/)`. The old form saw only direct children, so once ARCHI S10
// moves plugins under `packages/plugins/`, it would find a `plugins` directory with
// no `src/`, hit the `continue` below, and report an `any` count over ZERO plugins
// while exiting 0. The audit would have looked clean because it audited nothing.
const pkgDirs = require("./lib/packages.cjs")
    .all()
    .filter((p) => !pkgFilter || p.dirName === pkgFilter)
    .sort((a, b) => a.dirName.localeCompare(b.dirName));

for (const pkgEntry of pkgDirs) {
    const pkg = pkgEntry.dirName;
    const srcDir = path.join(pkgEntry.absDir, "src");
    // A workspace package with no src/ is a real anomaly, not something to skip in
    // silence: every package in this repo builds from src/. Say so and move on.
    if (!fs.existsSync(srcDir)) {
        console.warn(
            `⚠️  ${pkgEntry.dir} has no src/ — skipped (unexpected for a workspace package)`
        );
        continue;
    }

    const files = walk(srcDir, []);
    let pkgTotal = 0;
    const byDir = {};
    let hardenedZones = 0; // files with 0 `any` (already ratchet-ready)

    for (const f of files) {
        const n = countAny(fs.readFileSync(f, "utf8"));
        pkgTotal += n;
        if (n === 0) hardenedZones++;
        const key = subdirKey(f, srcDir);
        byDir[key] = (byDir[key] || 0) + n;
    }

    result.packages[pkg] = {
        total: pkgTotal,
        files: files.length,
        filesClean: hardenedZones,
        byDir: Object.fromEntries(Object.entries(byDir).sort((a, b) => b[1] - a[1])),
    };
    result.totalSource += pkgTotal;
}

if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log("\n=== Explicit `any` in source (excl. tests/generated) ===\n");
console.log(pad("Package", 28) + padL("any", 8) + padL("files", 8) + padL("clean", 8));
console.log("-".repeat(52));
for (const [pkg, d] of Object.entries(result.packages).sort((a, b) => b[1].total - a[1].total)) {
    console.log(pad(pkg, 28) + padL(d.total, 8) + padL(d.files, 8) + padL(d.filesClean, 8));
}
console.log("-".repeat(52));
console.log(pad("TOTAL", 28) + padL(result.totalSource, 8));

const core = result.packages.core;
if (core) {
    console.log("\n--- core breakdown by src subdir (top 20) ---\n");
    const rows = Object.entries(core.byDir).slice(0, 20);
    for (const [dir, n] of rows) {
        console.log(padL(n, 6) + "  " + dir);
    }
}
console.log("");
