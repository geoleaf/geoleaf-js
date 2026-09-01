#!/usr/bin/env node
/**
 * verify-coverage-attribution.cjs — the gate that verifies the MEASURING DEVICE.
 *
 * ## The defect no test can catch
 *
 * Every other gate of this repo verifies the code. This one verifies the
 * instrument that measures the code. It is the only defect a green suite cannot
 * reveal: a false coverage report is **well-formed**, its percentages are
 * **plausible**, and nothing reddens. That is exactly how the coverage rework's
 * defect lived for a month.
 *
 * The protocol is the one that revealed it: a witness module with **4 functions**,
 * a test that calls **only one**, and the assertion that the `lcov` credits **that
 * one and not the other three**. A question whose answer is already known — an
 * **external oracle** — put to the instrument. That is what makes the check
 * conclusive with a SINGLE provider: istanbul is not asked to verify itself, it is
 * confronted with a truth held in advance.
 *
 * ## Why a gate and not a one-off counter-proof
 *
 * The repo's history settles it: an unwired verification does not happen. The
 * coverage gate itself was absent from `ci:local` until 07-19 and **stayed RED on
 * `main`** with nothing flagging it. A "do it from time to time" counter-proof
 * would suffer the same fate.
 *
 * ## A single provider: istanbul
 *
 * The repo measures its coverage with **istanbul, everywhere, and nothing else**.
 * The defect class that had motivated this gate — a `require()`-loaded module the
 * instrumentation does not see under `--import tsx` — was eliminated and is now
 * guarded at the source by `verify-test-load-mode.cjs` (a baseline that can only
 * descend). Here, attribution is verified: `charlie` called once must be credited
 * `FNDA:1`, the other three `FNDA:0`. The probe certifies only the **witness** —
 * one file, one worker, on the `import` branch — not the aggregate in a full
 * suite.
 *
 * Usage :
 *   node scripts/verify-coverage-attribution.cjs           # gate
 *   node scripts/verify-coverage-attribution.cjs --verbose # prints the produced lcov
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT, ".tmp-coverage-probe");
const VERBOSE = process.argv.includes("--verbose");

// The working directory must not outlive the process, and a `finally` does not
// suffice: each guard below exits through `process.exit()`, which skips `finally`.
process.on("exit", () => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

/** The function the test calls — the other three must NEVER be credited. */
const CALLED = "charlie";
const NEVER_CALLED = ["alpha", "bravo", "delta"];

/**
 * Writes the witness, its test and the coverage config.
 *
 * The 4 functions have distinct bodies on distinct lines: a shifted attribution
 * becomes visible on the `DA:` as much as on the `FNDA:`.
 */
function plantWitness() {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    fs.writeFileSync(
        path.join(TMP_DIR, "witness.ts"),
        [
            "export function alpha(n: number): number {",
            "    return n + 1;",
            "}",
            "",
            "export function bravo(n: number): number {",
            "    return n + 2;",
            "}",
            "",
            "export function charlie(n: number): number {",
            "    return n + 3;",
            "}",
            "",
            "export function delta(n: number): number {",
            "    return n + 4;",
            "}",
            "",
        ].join("\n")
    );

    // Loads through `import` — the branch the instrument measures correctly.
    fs.writeFileSync(
        path.join(TMP_DIR, "witness.test.ts"),
        [
            'import { describe, it, expect } from "vitest";',
            'import { charlie } from "./witness";',
            "",
            'describe("témoin d\'étalonnage", () => {',
            '    it("n\'appelle QUE charlie", () => {',
            "        expect(charlie(1)).toBe(4);",
            "    });",
            "});",
            "",
        ].join("\n")
    );

    fs.writeFileSync(
        path.join(TMP_DIR, "vitest.config.ts"),
        [
            'import { defineConfig } from "vitest/config";',
            "",
            "export default defineConfig({",
            `    root: ${JSON.stringify(TMP_DIR)},`,
            "    test: {",
            '        include: ["witness.test.ts"],',
            "        coverage: {",
            '            provider: "istanbul",',
            '            include: ["witness.ts"],',
            "            all: false,",
            '            reporter: ["lcovonly"],',
            '            reportsDirectory: "./cov",',
            "        },",
            "    },",
            "});",
            "",
        ].join("\n")
    );
}

/**
 * Runs vitest with coverage (istanbul) and returns the witness's `FNDA` counters.
 *
 * @returns {Record<string, number>} function name → credited call count.
 */
function measure() {
    const res = spawnSync(
        "npx",
        ["vitest", "run", "--config", path.join(TMP_DIR, "vitest.config.ts"), "--coverage"],
        { cwd: ROOT, encoding: "utf8", env: { ...process.env, CI: "true" } }
    );

    const lcovPath = path.join(TMP_DIR, "cov", "lcov.info");
    if (!fs.existsSync(lcovPath)) {
        console.error("✘ verify-coverage-attribution: aucun lcov produit.");
        console.error((res.stdout || "") + (res.stderr || ""));
        process.exit(1);
    }

    const lcov = fs.readFileSync(lcovPath, "utf8");
    if (VERBOSE) console.log(`\n─── lcov ───\n${lcov}`);

    /** @type {Record<string, number>} */
    const fnda = {};
    for (const line of lcov.split("\n")) {
        const f = line.match(/^FNDA:(\d+),(.+)$/);
        if (f) fnda[f[2].trim()] = Number(f[1]);
    }
    return fnda;
}

/**
 * Verifies a reading credits the right function and it alone.
 *
 * @param {Record<string, number>} fnda
 * @returns {string[]} Anomalies, vide si conforme.
 */
function checkAttribution(fnda) {
    const bad = [];

    if (Object.keys(fnda).length === 0) {
        bad.push("aucune fonction relevée — l'instrument n'a rien mesuré");
        return bad;
    }
    if (fnda[CALLED] !== 1) {
        bad.push(
            `\`${CALLED}\` est la SEULE fonction appelée, attendu FNDA:1, ` +
                `relevé FNDA:${fnda[CALLED] ?? "absent"}`
        );
    }
    for (const fn of NEVER_CALLED) {
        if (fnda[fn] !== 0) {
            bad.push(
                `\`${fn}\` n'est JAMAIS appelée, attendu FNDA:0, relevé FNDA:${fnda[fn] ?? "absent"}`
            );
        }
    }
    return bad;
}

// ── Execution ────────────────────────────────────────────────────────────────
plantWitness();

const problems = checkAttribution(measure());

if (problems.length > 0) {
    console.error("✘ verify-coverage-attribution: l'appareil de mesure ne dit pas vrai.\n");
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
        "\n  Un rapport de couverture faux est bien formé et plausible : aucun test ne\n" +
            "  peut l'attraper."
    );
    process.exit(1);
}

console.log(
    "✔ verify-coverage-attribution: l'attribution est juste sur la branche `import` — " +
        `\`${CALLED}\` créditée FNDA:1, les 3 autres FNDA:0.`
);
