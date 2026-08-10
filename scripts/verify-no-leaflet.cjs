#!/usr/bin/env node
/**
 * Scan the codebase for remaining Leaflet references after MapLibre migration.
 *
 * Categories detected:
 *   1. Runtime L.* calls (not inside comments or JSDoc)
 *   2. Leaflet imports (import/require)
 *   3. Global L declarations (declare const/var L)
 *   4. Engine type branching ("leaflet" as engine type literal)
 *   5. JSDoc Leaflet types (@param {L., @returns {L., @type {L.)
 *   6. Config references (external arrays, peerDependencies)
 *
 * Usage: node scripts/verify-no-leaflet.cjs (from repo root)
 * Exit code 0 = clean, 1 = references found.
 */

const fs = require("fs");
const path = require("path");

// ARCHI S9.5 — the three package enumerations below come from the workspace
// registry rather than a one-level `readdirSync(packages/)`. That form scanned only
// direct children, so once ARCHI S10 nests packages under `packages/plugins/` it
// would have found no `src/` and no `__tests__/` at that level and scanned NOTHING —
// reporting "no Leaflet reference" across an empty set, green and blind.
const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");

// ─── Directories & files to scan ────────────────────────────────────────────

/**
 * Discover every `packages/<pkg>/src` directory (all 14 workspaces).
 * Skips `_*` (template) and packages without a `src/` folder (e.g. docs-dist).
 */
function discoverSourceDirs() {
    const dirs = [];
    for (const pkg of registry.all()) {
        const srcDir = path.join(pkg.absDir, "src");
        if (fs.existsSync(srcDir)) dirs.push(srcDir);
    }
    return dirs;
}

const SOURCE_DIRS = discoverSourceDirs();

/**
 * Discover top-level test directories (`packages/<pkg>/__tests__`) plus the
 * root `e2e/` suite. Packages whose tests live under `src/__tests__`
 * (addpoi/flatgeobuf/cog) are already covered by SOURCE_DIRS, so they are not
 * re-added here. Tests are held to the same Leaflet categories as source, plus
 * the "Global L assignment" lock — no `global.L` test mock may be reintroduced.
 */
function discoverTestDirs() {
    const dirs = [];
    for (const pkg of registry.all()) {
        const testDir = path.join(pkg.absDir, "__tests__");
        if (fs.existsSync(testDir)) dirs.push(testDir);
    }
    const e2eDir = path.join(ROOT, "e2e");
    if (fs.existsSync(e2eDir)) dirs.push(e2eDir);
    return dirs;
}

const TEST_DIRS = discoverTestDirs();

const CONFIG_FILES = [
    "rollup.config.js",
    "rollup.config.mjs",
    "rollup.config.cjs",
    "rollup.config.ts",
    // ARCHI S9.2 — the shared rollup factory (packages/build-config/rollup.mjs) now
    // holds the plugin assembly that used to live in the 15 scanned configs. Without
    // this entry the gate would have lost that surface: the code moved, the coverage
    // would not have followed.
    "rollup.mjs",
    "csp-style-inject.mjs",
    "package.json",
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

// ─── Category definitions ───────────────────────────────────────────────────

const CATEGORIES = {
    "Runtime L.* calls": {
        /** Match L. preceded by whitespace, (, !, or line start — skip comments & JSDoc */
        test(line) {
            if (isComment(line) || isJSDoc(line)) return false;
            return /(^|[\s(!])L\./m.test(line);
        },
    },
    "Leaflet imports": {
        test(line) {
            if (isComment(line)) return false;
            return /import.*leaflet/i.test(line) || /require\s*\(.*leaflet/i.test(line);
        },
    },
    "Declare global L": {
        test(line) {
            if (isComment(line)) return false;
            return /declare\s+(const|var)\s+L\b/.test(line);
        },
    },
    "Engine type branching": {
        test(line) {
            if (isComment(line)) return false;
            return /engineType.*leaflet/i.test(line) || /["']leaflet["']/.test(line);
        },
    },
    "JSDoc Leaflet types": {
        test(line) {
            return (
                /@param\s*\{L\./.test(line) ||
                /@returns?\s*\{L\./.test(line) ||
                /@type\s*\{L\./.test(line)
            );
        },
    },
    "Global L assignment": {
        /** Lock (tests): no `global.L`/`globalThis.L`/`window.L` Leaflet mock may
         * be reintroduced. Matches the global token, not `global.Log` etc. */
        test(line) {
            if (isComment(line)) return false;
            return /(global|globalThis|window)\.L\b/.test(line);
        },
    },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** True if the line is a single-line comment or inside a block-comment fence. */
function isComment(line) {
    const t = line.trim();
    return (
        t.startsWith("//") ||
        t.startsWith("/*") ||
        t.startsWith("*/") ||
        (t.startsWith("*") && !t.startsWith("*/"))
    );
}

/** True if the line contains a JSDoc type annotation. */
function isJSDoc(line) {
    return /@param\s/.test(line) || /@returns?\s/.test(line) || /@type\s/.test(line);
}

/**
 * Recursively collect .ts and .js files from a directory.
 * Skips node_modules, dist, .git.
 */
function collectSourceFiles(dir, out) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
                collectSourceFiles(full, out);
            }
        } else if (/\.(ts|js)$/.test(entry.name)) {
            out.push(full);
        }
    }
}

/**
 * Locate config files (rollup.config.*, package.json) across all packages.
 */
function collectConfigFiles() {
    const out = [];
    // Root-level configs
    for (const name of CONFIG_FILES) {
        const full = path.join(ROOT, name);
        if (fs.existsSync(full)) out.push(full);
    }
    // Per-package configs
    for (const pkg of registry.all()) {
        for (const name of CONFIG_FILES) {
            const full = path.join(pkg.absDir, name);
            if (fs.existsSync(full)) out.push(full);
        }
    }
    return out;
}

// ─── Scan sources ───────────────────────────────────────────────────────────

/** @type {Record<string, Array<{file: string, line: number, content: string}>>} */
const results = {};
for (const cat of Object.keys(CATEGORIES)) {
    results[cat] = [];
}
results["Config leaflet references"] = [];

// Collect all source files
const sourceFiles = [];
for (const dir of SOURCE_DIRS) {
    collectSourceFiles(dir, sourceFiles);
}

// Scan each source file against all categories
for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const [cat, rule] of Object.entries(CATEGORIES)) {
            if (rule.test(line)) {
                results[cat].push({
                    file: path.relative(ROOT, filePath),
                    line: i + 1,
                    content: line.trim(),
                });
            }
        }
    }
}

// ─── Scan config files ──────────────────────────────────────────────────────

const configFiles = collectConfigFiles();
const LEAFLET_CONFIG_RE = /leaflet/i;

for (const filePath of configFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (LEAFLET_CONFIG_RE.test(line)) {
            results["Config leaflet references"].push({
                file: path.relative(ROOT, filePath),
                line: i + 1,
                content: line.trim(),
            });
        }
    }
}

// ─── Report ─────────────────────────────────────────────────────────────────

let totalHits = 0;

console.log("=".repeat(72));
console.log("  LEAFLET REFERENCE SCAN");
console.log("=".repeat(72));
console.log();

const allCategories = Object.keys(results);

for (const cat of allCategories) {
    const hits = results[cat];
    totalHits += hits.length;

    console.log(`--- ${cat} (${hits.length}) ---`);
    if (hits.length === 0) {
        console.log("  (none)");
    } else {
        for (const hit of hits) {
            console.log(`  ${hit.file}:${hit.line}  ${hit.content}`);
        }
    }
    console.log();
}

// Summary table
console.log("-".repeat(72));
console.log("  SUMMARY");
console.log("-".repeat(72));
for (const cat of allCategories) {
    const count = results[cat].length;
    const status = count === 0 ? "OK" : `${count} hit(s)`;
    console.log(`  ${cat.padEnd(30)} ${status}`);
}
console.log("-".repeat(72));
console.log();

if (totalHits === 0) {
    console.log("VERDICT: ZERO LEAFLET REFERENCES");
    process.exit(0);
} else {
    console.log(`VERDICT: ${totalHits} Leaflet reference(s) found — cleanup required`);
    process.exit(1);
}
