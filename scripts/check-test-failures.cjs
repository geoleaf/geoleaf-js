/**
 * check-test-failures.cjs
 *
 * Reads the Vitest JSON reporter output (test-results.json) and exits with
 * code 1 if any tests failed. Used as a CI gate after
 * `vitest run --reporter=json --outputFile=test-results.json` (root vitest.config.ts projects).
 *
 * Usage: node scripts/check-test-failures.cjs [--file=path/to/test-results.json]
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── Resolve results file path ─────────────────────────────────────────────────
const argFile = process.argv.find((a) => a.startsWith("--file="));
const resultsPath = argFile
    ? path.resolve(argFile.split("=")[1])
    : path.resolve(process.cwd(), "test-results.json");

if (!fs.existsSync(resultsPath)) {
    console.error(`[check-test-failures] File not found: ${resultsPath}`);
    console.error("Run `vitest --reporter=json --outputFile=test-results.json` first.");
    process.exit(1);
}

// ── Parse JSON results ────────────────────────────────────────────────────────
let results;
try {
    results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
} catch (e) {
    console.error(`[check-test-failures] Failed to parse ${resultsPath}: ${e.message}`);
    process.exit(1);
}

// ── Extract metrics ───────────────────────────────────────────────────────────
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

// ── Print summary ─────────────────────────────────────────────────────────────
console.log("\n── Test results summary ──────────────────────────────────────────");
console.log(
    `  Suites  : ${numPassedTestSuites} passed / ${numTotalTestSuites} total${numFailedTestSuites > 0 ? ` (${numFailedTestSuites} FAILED)` : ""}`
);
console.log(
    `  Tests   : ${numPassedTests} passed / ${numTotalTests} total${numFailedTests > 0 ? ` (${numFailedTests} FAILED)` : ""}`
);

// ── List failing suites and test names ────────────────────────────────────────
if (numFailedTests > 0 || numFailedTestSuites > 0) {
    console.log("\n── Failing tests ─────────────────────────────────────────────────");
    for (const suite of testResults) {
        const failedInSuite = (suite.assertionResults || []).filter((t) => t.status === "failed");
        if (failedInSuite.length === 0) continue;
        const relPath = path.relative(
            process.cwd(),
            suite.testFilePath || suite.name || "(unknown)"
        );
        console.log(`\n  ${relPath}`);
        for (const t of failedInSuite) {
            const title = [...(t.ancestorTitles || []), t.title].join(" > ");
            console.log(`    ✗ ${title}`);
            if (t.failureMessages && t.failureMessages.length > 0) {
                console.log(`      ${t.failureMessages[0].split("\n")[0]}`);
            }
        }
    }
    console.log("\n─────────────────────────────────────────────────────────────────");
    console.error(
        `\n[check-test-failures] FAILED — ${numFailedTests} test(s) in ${numFailedTestSuites} suite(s) failed.`
    );
    process.exit(1);
}

console.log("\n[check-test-failures] All tests passed.");
process.exit(0);
