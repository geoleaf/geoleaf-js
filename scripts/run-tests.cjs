#!/usr/bin/env node
/**
 * The monorepo's unit-test launcher — and the only place that creates a swarm of
 * vitest processes, hence the only one able to bound it.
 *
 * Usage:
 *   node scripts/run-tests.cjs              # `turbo run test`          (unit gate)
 *   node scripts/run-tests.cjs --coverage   # `turbo run test:coverage` (coverage gate)
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
 */

"use strict";

const { spawnSync } = require("node:child_process");
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
 * The invariant that makes "`ci:local` green → safe push" true.
 *
 * Throws if the local gate tested less than `ci.yml`. Checked at EVERY run, not in a
 * separate gate one would forget to wire: the push protocol makes `ci:local` the only
 * criterion before spending GitHub Actions quota, and a narrower local perimeter
 * would empty that guarantee while displaying nothing.
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
