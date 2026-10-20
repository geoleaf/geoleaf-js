/**
 * check-test-failures.cjs
 *
 * Reads the Vitest JSON reports the coverage run writes — one `test-results.json` per
 * package of the unit scope (`node scripts/run-tests.cjs --coverage`) — and exits with
 * code 1 if any test failed, if a package left no report, or if a package ran no test.
 *
 * The last two are what this check adds to the coverage run's own exit code: a package
 * whose task never ran, or whose configuration collects nothing, leaves the run green
 * while it tested nothing. The reports are deleted by `run-tests.cjs` before each run, so
 * a missing one cannot be stood in for by an earlier run's.
 *
 * Usage:
 *   node scripts/check-test-failures.cjs                              # every package of the scope
 *   node scripts/check-test-failures.cjs --file=path/to/report.json   # a single report
 */

"use strict";

const fs = require("fs");
const path = require("path");

const testScope = require("./lib/test-scope.cjs");

const ROOT = path.resolve(__dirname, "..");

// ── Resolve the reports to read ───────────────────────────────────────────────
const argFile = process.argv.find((a) => a.startsWith("--file="));
const reports = argFile
    ? [{ name: path.basename(argFile), file: path.resolve(argFile.slice("--file=".length)) }]
    : testScope.unitScope().map((p) => ({
          name: p.name,
          file: path.join(p.absDir, testScope.UNIT_REPORT_FILE),
      }));

/** @type {string[]} */
const problems = [];
const totals = { passedSuites: 0, totalSuites: 0, passedTests: 0, totalTests: 0 };
/** @type {{ file: string, title: string, message: string }[]} */
const failures = [];

for (const { name, file } of reports) {
    if (!fs.existsSync(file)) {
        problems.push(
            `${name} : aucun rapport (${path.relative(ROOT, file)}) — sa tâche n'a pas tourné`
        );
        continue;
    }

    let results;
    try {
        results = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        problems.push(`${name} : rapport illisible (${path.relative(ROOT, file)}) — ${e.message}`);
        continue;
    }

    // Vitest JSON reporter shape: { numFailedTests, numPassedTests, numTotalTests,
    //   numFailedTestSuites, numPassedTestSuites, numTotalTestSuites, testResults: [] }
    const {
        numFailedTests = 0,
        numPassedTests = 0,
        numTotalTests = 0,
        numFailedTestSuites = 0,
        numPassedTestSuites = 0,
        numTotalTestSuites = 0,
        testResults = [],
    } = results;

    totals.passedSuites += numPassedTestSuites;
    totals.totalSuites += numTotalTestSuites;
    totals.passedTests += numPassedTests;
    totals.totalTests += numTotalTests;

    if (numTotalTests === 0) problems.push(`${name} : aucun test exécuté`);
    if (numFailedTests > 0 || numFailedTestSuites > 0) {
        problems.push(
            `${name} : ${numFailedTests} test(s) en échec dans ${numFailedTestSuites} suite(s)`
        );
    }

    for (const suite of testResults) {
        const failedInSuite = (suite.assertionResults || []).filter((t) => t.status === "failed");
        const suiteFile = path.relative(ROOT, suite.testFilePath || suite.name || "(unknown)");
        // A suite that failed to load has no assertion results, only its own message.
        if (failedInSuite.length === 0 && suite.status === "failed") {
            failures.push({
                file: suiteFile,
                title: "(chargement de la suite)",
                message: suite.message || "",
            });
        }
        for (const t of failedInSuite) {
            failures.push({
                file: suiteFile,
                title: [...(t.ancestorTitles || []), t.title].join(" > "),
                message: (t.failureMessages && t.failureMessages[0]) || "",
            });
        }
    }
}

// ── Print summary ─────────────────────────────────────────────────────────────
console.log("\n── Test results summary ──────────────────────────────────────────");
console.log(`  Reports : ${reports.length} lu(s)`);
console.log(`  Suites  : ${totals.passedSuites} passed / ${totals.totalSuites} total`);
console.log(`  Tests   : ${totals.passedTests} passed / ${totals.totalTests} total`);

if (failures.length > 0) {
    console.log("\n── Failing tests ─────────────────────────────────────────────────");
    let current = "";
    for (const f of failures) {
        if (f.file !== current) {
            console.log(`\n  ${f.file}`);
            current = f.file;
        }
        console.log(`    ✗ ${f.title}`);
        if (f.message) console.log(`      ${f.message.split("\n")[0]}`);
    }
}

if (problems.length > 0) {
    console.log("\n─────────────────────────────────────────────────────────────────");
    console.error(`\n[check-test-failures] FAILED\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
}

console.log("\n[check-test-failures] All tests passed.");
process.exit(0);
