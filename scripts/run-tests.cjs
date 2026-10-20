#!/usr/bin/env node
/**
 * The monorepo's unit-test launcher — and the only place that creates a swarm of
 * vitest processes, hence the only one able to bound it.
 *
 * Usage:
 *   node scripts/run-tests.cjs              # `turbo run test`          (unit gate)
 *   node scripts/run-tests.cjs --coverage   # `turbo run test:coverage` (coverage gate,
 *                                           #  one JSON report per package)
 *   node scripts/run-tests.cjs --force      # bypasses the turbo cache (measurements)
 *   node scripts/run-tests.cjs --fanout=2   # forced swarm, to re-measure the budget
 *
 * ## The fixed defect
 *
 * `npm test` was `turbo run test --filter=…` × 12, **without `--concurrency`**, and no
 * package config declared `maxWorkers`: each `vitest run` believed it owned the
 * machine and opened ~23 workers. Measured on 2026-07-22 on the reference host
 * (24 cores, 15 GB): **81 Node processes, 11.3 GB cumulated RSS** for ~11 GB
 * available. Hence a `ci:local` red one time out of two, always on timeout and never
 * on an assertion.
 *
 * This script sets BOTH factors of the product from a single source:
 *   - `--concurrency=TEST_FANOUT` on the turbo side;
 *   - `GEOLEAF_TEST_FANOUT` in the child environment, which `worker-budget.mjs`
 *     reads to derive `maxWorkers` and `vmMemoryLimit` in each of the 18 configs.
 *
 * ⚠️ The variable is set here, in the child process's environment, and not as an npm
 * script prefix (`VAR=x turbo …`): that syntax is POSIX shell and breaks under
 * `cmd.exe`, where part of the development happens (cf. `ci-local.cjs`'s `NPM_SHELL`
 * guard, taken up here).
 *
 * ## The package list is derived, never written
 *
 * It comes from `scripts/lib/test-scope.cjs`. The list of 12 `--filter` it replaces
 * was hand-written and had drifted: it skipped **5 packages / 27 test files**, not by
 * arbitration but by accretion — each package had been added the day it received
 * tests, and five never were. It is the described failure mode: a hard list does not
 * break, it silently stops matching.
 *
 * ## The coverage run is also the CI's only unit run — hence its reports
 *
 * `ci.yml` used to run the whole suite twice: bare (`npx vitest run`, `projects` mode, a
 * JSON reporter read by `check-test-failures.cjs`), then under coverage. The second runs a
 * superset of the first — every package of `unitScope()`, with the same per-package
 * configs — and a red test turns it red as well. The bare run is gone; the coverage run
 * now writes `test-results.json` in each package, which `check-test-failures.cjs` reads
 * and requires for every package of the scope.
 *
 * ⚠️ Those reports are deleted BEFORE turbo starts. A task turbo replays from its cache
 * restores its own (`outputs` of `test:coverage`); a task that never ran — turbo stopped
 * early — must leave NO report behind, or the next check would read the green of an
 * earlier run.
 */

"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const testScope = require("./lib/test-scope.cjs");

const ROOT = path.resolve(__dirname, "..");

/**
 * Number of turbo tasks — hence `vitest` processes — run abreast.
 *
 * `4`, not a comfort setting: it is the first factor of the product that made
 * `ci:local` unbelievable. The 07-21 counter-proof gave 34/34 at `--concurrency=2`;
 * `4` is retained because the second factor is now bounded too
 * (`maxWorkers = cores / fanout`), which was not the case when `2` was measured. The
 * coverage gate already carried this `4` hard-coded, in TWO files — it now exists
 * only here.
 *
 * Resulting product, **measured over 5 consecutive executions**: 27 to 31 processes
 * and 4.8 GB cumulated RSS at worst, against 81 processes and 11.3 GB before — while
 * testing 17 packages instead of 12, for a near-unchanged duration (71 s → 74-84 s).
 */
const DEFAULT_FANOUT = 4;

const args = process.argv.slice(2);
const WITH_COVERAGE = args.includes("--coverage");
const FORCE = args.includes("--force");

/**
 * `--fanout=N` — to MEASURE another value, not to live on it.
 *
 * The number retained above must stay the fruit of a measurement; this flag exists so
 * redoing one does not require editing this file, hence so it gets redone.
 */
const fanoutArg = args.find((a) => a.startsWith("--fanout="));
const parsedFanout = fanoutArg ? Number(fanoutArg.slice("--fanout=".length)) : NaN;

if (fanoutArg && !(Number.isInteger(parsedFanout) && parsedFanout > 0)) {
    console.error(`run-tests.cjs : --fanout attend un entier ≥ 1, reçu "${fanoutArg}".`);
    process.exit(1);
}

const TEST_FANOUT = fanoutArg ? parsedFanout : DEFAULT_FANOUT;

// Under Windows, `npx` is a .cmd Node refuses to spawn without a shell (CVE-2024-27980).
const NPM_SHELL = process.platform === "win32";

/**
 * The root `projects` run (`npm run test:vitest`) must not test a package this gate skips.
 *
 * This invariant used to carry "`ci:local` green → safe push": `ci.yml` ran the suite in
 * `projects` mode, so a narrower local perimeter emptied that guarantee. `ci.yml` now runs
 * THIS script (`--coverage`), so both sides read the same perimeter by construction; what
 * remains is the developer's root run, kept from drifting away from the gate.
 */
try {
    testScope.assertUnitScopeCoversRoot();
} catch (err) {
    // Stackless message: written to be read and followed, not debugged.
    console.error(`\n${err.message}\n`);
    process.exit(1);
}

const packages = testScope.unitScope();
const parked = Object.entries(testScope.PARKED);

if (packages.length === 0) {
    console.error("run-tests.cjs : aucun paquet testable — la dérivation a échoué.");
    process.exit(1);
}

const task = WITH_COVERAGE ? "test:coverage" : "test";

// Vitest arguments passed to the `test:coverage` tasks only (turbo does not forward them
// to the `build` dependencies). The config's `verbose` reporter is restated: a CLI
// `--reporter` replaces the configured ones instead of adding to them.
const REPORT_ARGS = WITH_COVERAGE
    ? [
          "--",
          "--reporter=verbose",
          "--reporter=json",
          `--outputFile.json=${testScope.UNIT_REPORT_FILE}`,
      ]
    : [];

if (WITH_COVERAGE) {
    for (const p of packages)
        fs.rmSync(path.join(p.absDir, testScope.UNIT_REPORT_FILE), { force: true });
}

/**
 * Launches turbo with both budget factors set together.
 *
 * ⚠️ `worker-budget.mjs` is ESM and this script CJS: the environment variable's name
 * is therefore **imported**, never copied. A string hard-written on both sides would
 * silently degrade the run toward `fanout = 1` — i.e. toward no bound — the day
 * either was renamed. An `import()` costs 2 ms and removes the entire class.
 *
 * @returns {Promise<number>} Turbo's exit code.
 */
async function main() {
    const budget = await import("@geoleaf/build-config/vitest/worker-budget.mjs");

    // Set on THIS process, then inherited by turbo and by each `vitest run`: the
    // budget shown below is thus computed by the same code, and from the same value,
    // as the one the children will apply. No description able to lie about the run.
    process.env[budget.FANOUT_ENV] = String(TEST_FANOUT);
    const described = budget.describeBudget();

    console.log(
        `\n▶ ${task} — ${packages.length} paquets, ${TEST_FANOUT} de front\n` +
            `  budget : ${described.fanout} × ${described.maxWorkers} workers = ` +
            `${described.peakWorkers} sur ${described.cores} cœurs, ` +
            `plafond mémoire collectif ${described.peakMemoryMb} Mo`
    );
    // A budget that cannot be held must be said. Only happens with a `--fanout`
    // forced beyond half the cores, where the 2-worker floor wins over the invariant.
    if (described.oversubscribed) {
        console.log(
            `  ⚠️ SURSOUSCRIT : ${described.peakWorkers} workers pour ${described.cores} cœurs — ` +
                `le plancher de ${described.maxWorkers} workers l'emporte sur la borne. ` +
                `À réserver à une mesure ponctuelle.`
        );
    }
    // A gate that shrinks its perimeter must SAY so: staying silent is how the
    // previous list lost 5 packages with nobody seeing it.
    for (const [name, reason] of parked) console.log(`  ⏸ au parc : ${name} — ${reason}`);

    const result = spawnSync(
        "npx",
        [
            "turbo",
            "run",
            task,
            `--concurrency=${TEST_FANOUT}`,
            ...(FORCE ? ["--force"] : []),
            ...packages.map((p) => `--filter=${p.name}`),
            ...REPORT_ARGS,
        ],
        { cwd: ROOT, stdio: "inherit", shell: NPM_SHELL, env: process.env }
    );

    return result.status === null ? 1 : result.status;
}

main().then(
    (code) => process.exit(code),
    (err) => {
        console.error(`run-tests.cjs : ${err.message}`);
        process.exit(1);
    }
);
