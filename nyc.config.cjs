/**
 * NYC Configuration — coverage report of the shipped bundle's BOOT
 *
 * ⚠️ This file governs ONE of the six objects named "coverage" in this repo,
 * which carry four distinct meanings. The full map is in
 * `docs/reference/ARCHITECTURE.md`, section « coverage — six objets, quatre
 * sens ». (The pointer used to say a workshop path: it was dead BEFORE the
 * split — the file has always lived under `reference/`.)
 * Never bring this figure alongside the unit coverage: other code, other chain.
 *
 * This configuration enables code coverage collection during E2E tests:
 * - Instruments source code for coverage tracking
 * - Generates reports in multiple formats
 * - Tracks real code execution in browser
 */

module.exports = {
    // No include filter — coverage data already only contains instrumented files
    // (rollup-plugin-istanbul include: ['src/modules/**', 'src/app/**'])

    // Files to exclude from coverage
    exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "__tests__/**",
        "tests/**",
        "coverage/**",
        "node_modules/**",
        "dist/**",
        "build/**",
    ],

    // Report formats
    reporter: [
        "text", // Console output
        "text-summary", // Brief summary
        "html", // HTML report in coverage-e2e/
        "lcov", // LCOV format for CI
        "json", // JSON for programmatic access
    ],

    // Output directory. Used to be `coverage-e2e` at the root: declared since
    // forever, NEVER created on disk, for lack of a consumer (`report:e2e` was
    // called by nothing before). It finally exists — may it be born in the right
    // place.
    reportDir: "artifacts/coverage-e2e",

    // Coverage thresholds (start conservative, increase over time)
    watermarks: {
        lines: [50, 80],
        functions: [50, 80],
        branches: [50, 80],
        statements: [50, 80],
    },

    // ── Thresholds — recalibrated 2026-07-25 ───────────────────────────────────
    //
    // ⚠️ WHAT THESE PERCENTAGES MEASURE, and the three things they are NOT.
    //
    // They measure the coverage of ONE SINGLE page load, by ONE SINGLE spec
    // (`e2e/07-boot-sequence.spec.js`, sole caller of `e2e/helpers/coverage.js`
    // — hence the produced file's name, `e2e-boot-sequence.json`), in a real
    // Chromium, against the SHIPPED MINIFIED BUNDLE.
    //
    //   1. This is NOT "the E2E coverage". The suite counts 36 specs. Three
    //      others target the instrumented variant (`20`, `21`, `22`) without
    //      ever dumping; the remaining 32 run against NON-instrumented deploys,
    //      where `window.__coverage__` does not exist — they cannot contribute.
    //   2. This is NOT the unit coverage (92.07 % lines). That one measures the
    //      SOURCES under Node/jsdom, exercised by suites written to touch each
    //      branch. Two measurements of two objects — never to reconcile.
    //   3. The denominator is NOT `core/src`. Only the 226 files instrumented by
    //      `packages/core/rollup.config.mjs` (`src/{api,globals,kernel,
    //      utils,app}`) enter it. `src/capabilities/**` — 219 files, 44 % of
    //      `core/src` — is absent from numerator AND denominator.
    //
    // 2026-07-25 measurement, after source-map remap, on 216 files present /
    // 226:
    //   lines 39.78 · statements 37.69 · functions 39.50 · branches 27.39
    // Thresholds = measurement − ~10 % relative, rounded down. Ratchet UPWARD
    // only, like the per-package thresholds.
    //
    // The previous values (8/10/8/8) were calibrated "≤ baseline 8.8 %" BEFORE
    // the instrumentation glob split: it was `src/modules/**`, split into four
    // roots and therefore DEAD — only `app/` was instrumented. A threshold
    // calibrated on a skewed measurement catches nothing, even once wired.
    //
    // ⚠️ These thresholds do not suffice alone: `nyc report` comes out GREEN on
    // an empty `.nyc_output/` (`percent.js` returns 100 when `total === 0`,
    // `blankSummary()` returns `pct: 'Unknown'`, and `'Unknown' < 35` is
    // `false`). `scripts/verify-e2e-coverage.cjs` is what closes that hole, with
    // a witness floor. Never wire `report:e2e` bare as a CI step.
    checkCoverage: true,
    lines: 35,
    statements: 33,
    functions: 35,
    branches: 24,

    // Per-file coverage thresholds
    perFile: false,

    // Source maps
    sourceMap: true,
    produceSourceMap: true,

    // Instrumentation settings (false — already instrumented by rollup-plugin-istanbul)
    instrument: false,

    // All files mode — disabled for E2E (only report files that have coverage data)
    all: false,

    // File extensions to process
    extension: [".ts", ".js"],

    // Cache — DISABLED. It was `.nyc_output`, i.e. EXACTLY the `tempDir` below.
    // Yet `nyc/index.js#coverageFileLoad` does a `JSON.parse` on EVERY tempDir
    // file swallowing the error (`return {}`): a cache file dropped there would
    // have shrunk the coverage map IN SILENCE, hence lowered the figure with
    // nothing explaining it. `instrument: false` (the bundle arrives already
    // instrumented by rollup-plugin-istanbul) makes this cache useless anyway.
    cacheDir: false,

    // Temp directory
    tempDir: ".nyc_output",

    // Clean output directory before tests
    clean: true,

    // Show process tree
    showProcessTree: false,

    // Skip coverage if no coverage data found
    skipFull: false,

    // Require additional modules
    require: [],

    // Exclude patterns (glob)
    excludeNodeModules: true,
};
