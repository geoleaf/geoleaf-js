#!/usr/bin/env node
/**
 * GeoLeaf Performance Benchmark — INFORMATIONAL REPORT, NOT A GATE.
 *
 * Prints the size of the built artifacts and a few source metrics. It asserts
 * nothing, writes nothing, and always exits 0. Its named consumer is a human
 * following `packages/core/docs/PERFORMANCE_METRICS.md:98`.
 *
 * Usage:
 *   node scripts/benchmark.cjs
 *
 * ## What T6.3 removed, and why (2026-07-25)
 *
 * This file used to carry four devices. All four were measured inert, three of
 * them silently:
 *
 *   1. `--ci` → `evaluateCiBudgets`. Wired TWICE (ci.yml:147, ci-local.cjs:137)
 *      and carrying exactly three assertions, all three unreachable:
 *        · `geoleaf.esm.js` regression > +5 % — the tracked baseline dated
 *          2026-02-27 (Leaflet era) recorded 1 928 560 B against ~948 B measured
 *          today, i.e. −99.95 % against a +5 % threshold;
 *        · `geoleaf-lite.esm.js` regression > +5 % — that artifact was deleted at
 *          S4 and is absent from `packages/core/dist/`, so `changes[file]` was
 *          always undefined;
 *        · `geoleaf-lite.esm.js` gzip < 150 KB — same cause, `liteGzip` was
 *          `undefined` and the block was skipped.
 *      Its only remaining failure mode was the disappearance of its own baseline
 *      file. A gate that protects nothing but its own existence.
 *   2. `--baseline` / `saveBaseline` — wrote `.benchmark-baseline.json`, the very
 *      file that made (1) absurd. Zero callers.
 *   3. `--compare` / `compareWithBaseline` — same baseline, zero callers.
 *   4. `--perf-baseline` / `generatePerfBaseline` — ⚠️ THE DANGEROUS ONE, and the
 *      one the sprint statement wanted KEPT. It did not merely fail to measure:
 *      running it would have DESTROYED a working contract. The live
 *      `perf-baseline.json` is `version 2.4.0`, `engine: "maplibre"`, with
 *      `runtime._status: "captured"`; this generator wrote `engine: "leaflet"`,
 *      an incompatible bundle shape, and NO `_status` at all. Since
 *      `e2e/helpers/perf-gate.js:42` arms the perf gate on exactly
 *      `runtime._status === 'captured'`, one run would have DISARMED that gate in
 *      silence. `perf-baseline.json` is alive, but it is maintained by
 *      `e2e/06-performance-baseline.spec.js` round-tripping it — never by this
 *      script. Zero callers.
 *
 * The real size budget lives in `scripts/check-bundle-size.cjs` (transitive
 * closure of static imports from the entry; hard fail > 300 KB gz, warn > 270),
 * which replaced this file's `--ci` step in both CI paths at the same commit.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Configuration
// T5.5 — le core par le registre, qui jette. Les 4 sites de ce fichier construisaient
// `__dirname + '../packages/core/…'` : deux niveaux de supposition (la profondeur du
// script ET l'emplacement du paquet).
const CORE_DIR = require("./lib/packages.cjs").requireByDirName("core").absDir;
const ITERATIONS = 10;

// Couleurs console
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
};

/**
 * Measures the execution time of a function
 */
function measureTime(fn, iterations = ITERATIONS) {
    const times = [];

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        fn();
        const end = performance.now();
        times.push(end - start);
    }

    return {
        min: Math.min(...times),
        max: Math.max(...times),
        avg: times.reduce((a, b) => a + b, 0) / times.length,
        median: times.sort((a, b) => a - b)[Math.floor(times.length / 2)],
    };
}

/**
 * Mesure la taille des fichiers de build
 *
 * T6.3 — `geoleaf-lite.esm.js` retiré des cibles : le build Lite a disparu au S4.
 * Le mesurer produisait une entrée toujours absente, que trois assertions de CI
 * lisaient ensuite comme un succès.
 */
function measureBuildSize() {
    // Prioritize packages/core/dist (latest build), fallback to root dist
    let distPath = path.join(CORE_DIR, "dist");
    if (!fs.existsSync(distPath)) {
        distPath = path.join(__dirname, "../dist");
    }
    if (!fs.existsSync(distPath)) {
        console.warn(
            `${colors.yellow}⚠️  dist/ folder not found. Run 'npm run build' first.${colors.reset}`
        );
        return null;
    }

    const files = {
        "geoleaf.esm.js": path.join(distPath, "geoleaf.esm.js"),
        "geoleaf-main.min.css": path.join(distPath, "geoleaf-main.min.css"),
        "geoleaf.esm.js.map": path.join(distPath, "geoleaf.esm.js.map"),
    };

    const sizes = {};
    for (const [name, filepath] of Object.entries(files)) {
        if (fs.existsSync(filepath)) {
            const stats = fs.statSync(filepath);
            const bytes = stats.size;
            sizes[name] = {
                bytes,
                kb: (bytes / 1024).toFixed(2),
                mb: (bytes / 1024 / 1024).toFixed(2),
            };
            // Mesure gzip pour le bundle de production ESM + le CSS
            if (name === "geoleaf.esm.js" || name === "geoleaf-main.min.css") {
                try {
                    const buf = fs.readFileSync(filepath);
                    const gzip = zlib.gzipSync(buf, { level: 6 });
                    sizes[name + ".gzip"] = {
                        bytes: gzip.length,
                        kb: (gzip.length / 1024).toFixed(2),
                    };
                } catch (e) {
                    sizes[name + ".gzip"] = null;
                }
            }
        }
    }

    return sizes;
}

function getMetricKb(buildSize, fileName) {
    if (!buildSize || !buildSize[fileName]) return 0;
    return parseFloat(buildSize[fileName].kb || 0);
}

function getTotalBuildKb(buildSize) {
    if (!buildSize) return 0;

    return getMetricKb(buildSize, "geoleaf.esm.js") + getMetricKb(buildSize, "geoleaf.esm.js.map");
}

/**
 * Compte les lignes de code (source core : packages/core/src)
 */
function measureCodeMetrics() {
    const srcPath = path.join(CORE_DIR, "src");

    if (!fs.existsSync(srcPath)) {
        console.warn(`${colors.yellow}⚠️  packages/core/src not found.${colors.reset}`);
        return null;
    }

    let totalFiles = 0;
    let totalLines = 0;
    let largeFiles = []; // Files > 500 lines

    function countLinesInFile(filepath) {
        const content = fs.readFileSync(filepath, "utf8");
        return content.split("\n").length;
    }

    function walkDir(dir) {
        const files = fs.readdirSync(dir);

        files.forEach((file) => {
            const filepath = path.join(dir, file);
            const stat = fs.statSync(filepath);

            if (stat.isDirectory()) {
                walkDir(filepath);
            } else if (file.endsWith(".js") || file.endsWith(".ts")) {
                totalFiles++;
                const lines = countLinesInFile(filepath);
                totalLines += lines;

                if (lines > 500) {
                    largeFiles.push({
                        file: path.relative(srcPath, filepath),
                        lines: lines,
                    });
                }
            }
        });
    }

    walkDir(srcPath);

    // Sort large files by lines desc
    largeFiles.sort((a, b) => b.lines - a.lines);

    return {
        totalFiles,
        totalLines,
        avgLinesPerFile: totalFiles ? (totalLines / totalFiles).toFixed(0) : "0",
        largeFiles: largeFiles.slice(0, 10), // Top 10
    };
}

/**
 * Benchmark complet
 */
function runBenchmark() {
    console.log(`${colors.bright}${colors.cyan}
╔════════════════════════════════════════════════════════╗
║                                                        ║
║       GeoLeaf Performance Benchmark                    ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
${colors.reset}`);
    console.log(
        `${colors.yellow}ℹ️  Rapport informatif — aucune assertion, aucun budget.${colors.reset}`
    );
    console.log(`   Le budget de taille est \`npm run size\` (check-bundle-size.cjs).`);

    const results = {
        timestamp: new Date().toISOString(),
        version: require("../package.json").version,
        metrics: {},
    };

    // 1. Build Size
    console.log(`\n${colors.bright}📦 Build Size:${colors.reset}`);
    const buildSize = measureBuildSize();

    if (buildSize) {
        results.metrics.buildSize = buildSize;
        const esmKbMain = getMetricKb(buildSize, "geoleaf.esm.js");
        const totalKb = getTotalBuildKb(buildSize);

        const esmGzipMain = buildSize["geoleaf.esm.js.gzip"];
        const esmGzipMainKb = esmGzipMain ? parseFloat(esmGzipMain.kb) : 0;
        console.log(
            `  geoleaf.esm.js:     ${esmKbMain.toFixed(2)} KB${esmGzipMainKb > 0 ? " (gzip: " + esmGzipMainKb.toFixed(2) + " KB)" : ""}`
        );

        if (buildSize["geoleaf-main.min.css"]) {
            const cssKb = getMetricKb(buildSize, "geoleaf-main.min.css");
            const cssGzip = buildSize["geoleaf-main.min.css.gzip"];
            const cssGzipKb = cssGzip ? parseFloat(cssGzip.kb) : 0;
            console.log(
                `  geoleaf-main.min.css: ${cssKb.toFixed(2)} KB${cssGzipKb > 0 ? " (gzip: " + cssGzipKb.toFixed(2) + " KB)" : ""}`
            );
        }
        console.log(`  Total (with maps):  ${totalKb.toFixed(2)} KB`);
    }

    // 2. Code Metrics
    console.log(`\n${colors.bright}📊 Code Metrics:${colors.reset}`);
    const codeMetrics = measureCodeMetrics();
    results.metrics.codeMetrics = codeMetrics;

    console.log(`  Total files:        ${codeMetrics.totalFiles}`);
    console.log(`  Total lines:        ${codeMetrics.totalLines.toLocaleString()}`);
    console.log(`  Avg lines/file:     ${codeMetrics.avgLinesPerFile}`);
    console.log(`  Files >500 lines:   ${codeMetrics.largeFiles.length}`);

    if (codeMetrics.largeFiles.length > 0) {
        console.log(`\n  ${colors.yellow}Top large files:${colors.reset}`);
        codeMetrics.largeFiles.slice(0, 5).forEach((f) => {
            console.log(`    - ${f.file} (${f.lines} lines)`);
        });
    }

    // 3. File-read time — SIZE INDICATOR, NOT a runtime metric (audit F-TOOL-5).
    // This times a Node `fs.readFileSync` of geoleaf.esm.js from disk: it scales
    // with bundle *size*, it is NOT representative of browser parse/exec cost.
    // Kept as a cheap size proxy only — it was never gated, and since T6.3 there
    // is no gate here at all.
    console.log(
        `\n${colors.bright}📦 File-read time (size indicator — Node I/O, not browser parse):${colors.reset}`
    );
    let distPath = path.join(__dirname, "../dist");
    if (!fs.existsSync(distPath)) distPath = path.join(CORE_DIR, "dist");
    const parseTime = measureTime(() => {
        if (
            buildSize &&
            buildSize["geoleaf.esm.js"] &&
            fs.existsSync(path.join(distPath, "geoleaf.esm.js"))
        ) {
            fs.readFileSync(path.join(distPath, "geoleaf.esm.js"), "utf8");
        }
    });

    results.metrics.parseTime = parseTime;
    console.log(`  Min:     ${parseTime.min.toFixed(2)}ms`);
    console.log(`  Max:     ${parseTime.max.toFixed(2)}ms`);
    console.log(`  Avg:     ${parseTime.avg.toFixed(2)}ms`);
    console.log(`  Median:  ${parseTime.median.toFixed(2)}ms`);

    return results;
}

// Main
runBenchmark();
console.log("");
