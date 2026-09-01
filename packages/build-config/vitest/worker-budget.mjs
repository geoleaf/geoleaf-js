/**
 * @description
 * The Vitest runs' process budget — single, derived source.
 *
 * ## The defect this module fixes
 *
 * A test run of this repo costs
 * `concurrent_vitest_processes × workers_per_process` Node processes. The two
 * factors lived in different places, and **the product was bounded nowhere**:
 *
 * - `npm test` launched `turbo run test` **without `--concurrency`**;
 * - no package config declared `maxWorkers`, so each `vitest run` fell back on
 *   Vitest 4's default — `Math.max(numCpus - 1, 1)`, i.e. **23** on a 24-core
 *   machine (`resolveMaxWorkers`, `vitest/dist/chunks/cli-api.*.js`).
 *
 * Each process thus believed it owned the machine alone. **Measured on
 * 2026-07-22** on the reference WSL host (24 cores, 15 GB of RAM): peak of **81
 * Node processes and 11.3 GB of cumulated RSS**, for ~11 GB really available.
 * The run passed *at the edge* — hence a `ci:local` red one time out of two,
 * always on **timeout** and never on an assertion, on untouched packages green
 * in isolation.
 *
 * ⚠️ The factor that gives is not the CPU but the **memory**: under pressure,
 * `vmForks` workers reach their recycling threshold, and a recycle = fresh VM
 * context = full re-import and re-transpilation. That is how a 72-line file
 * **with no timer whatsoever** (`plugin-websocket/src/__tests__/entry.test.ts`)
 * exceeds 10 s.
 *
 * ## The invariants
 *
 *     fanout × maxWorkers()                    ≤ availableParallelism()
 *     fanout × maxWorkers() × vmMemoryLimit()  ≤ MEMORY_HEADROOM   (of total RAM)
 *
 * ⚠️ The first invariant has **one assumed exception**: `maxWorkers()` never
 * goes below 2, so a 4-core CI runner keeps intra-package parallelism. When that
 * floor bites, the total caps at `2 × fanout` — hence at worst **2 × cores**,
 * reached when `fanout = cores`. That is the LEGITIMATE worst case, and it stays
 * better than the prior state (a 4-core runner opened 4 × 3 = 12 workers, it
 * opens 8).
 *
 * `oversubscribed` thus only fires **beyond** that legitimate worst case, i.e.
 * for a `--fanout` forced to a value the machine cannot hold. The threshold is
 * not arbitrary: it is the exact boundary between "the floor protects me" and
 * "I asked the impossible". An alert firing at every CI run would no longer be
 * read — precisely the defect this module fixes.
 *
 * The first bounds the processes, the second bounds the memory they can reach
 * before recycling. Both derive from **one** input: `GEOLEAF_TEST_FANOUT`, the
 * number of concurrent `vitest` processes, set by `scripts/run-tests.cjs` (which
 * also passes it to `turbo --concurrency`). Absent, it is `1`: a solitary run.
 *
 * ## Two rules inherited from this directory
 *
 * **`.mjs`, never `.ts`** — like this whole folder: depend on no transpiler to
 * read modules one of which installs precisely that transpiler (cf. `base.mjs`).
 *
 * **One identical value everywhere** — Vitest 4 kills the `projects` run BEFORE
 * any test if two projects declare different `maxWorkers` under the same
 * `sequence.groupOrder` (`cli-api.*.js`, "Projects X and Y have different
 * 'maxWorkers'…"). It refuses only the **divergence**, not the cap itself —
 * hence this module, called by the 18 configs, which makes uniformity
 * structural rather than disciplinary.
 */

import { availableParallelism, totalmem } from "node:os";

/** Name of the environment variable carrying the concurrent vitest process count. */
export const FANOUT_ENV = "GEOLEAF_TEST_FANOUT";

/**
 * Share of **total** RAM the worker set can reach before recycling.
 *
 * Not a reservation: the threshold triggers a recycle, it preallocates nothing.
 * But at 1, the "ceiling" is a tautology — it allows the workers to occupy the
 * whole machine, which is no net. The rest pays for what the 07-22 measurement
 * shows around the workers: the main processes (one per turbo task), the page
 * cache, and the simple fact that of 15 GB of RAM this host had only ~11 free.
 *
 * `0.5` puts the per-worker threshold at ~650 MB solo and ~325 MB in a swarm,
 * when the measured mean RSS per worker was ~140 MB. Recycling thus stays the
 * exception it must be: REDUCING THE NUMBER of workers does the work, not this
 * threshold.
 */
const MEMORY_HEADROOM = 0.5;

/**
 * Number of `vitest` processes running in parallel on this machine.
 *
 * `1` by default — a root `npx vitest run`, or an isolated
 * `npm test -w <package>`, is alone and can take the machine. Only
 * `scripts/run-tests.cjs` sets something else, because it is what creates the
 * swarm.
 *
 * Internal: the three public functions below derive from it everything the
 * configs need. Exposing it without a consumer would make it an orphan export,
 * which the `dead-code` gate (knip) refuses — rightly.
 *
 * @returns {number} Integer ≥ 1.
 */
function fanout() {
    const n = Number(process.env[FANOUT_ENV]);
    return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Worker ceiling for THIS vitest process.
 *
 * - **Alone** (`fanout === 1`): the root config's historical adaptive formula —
 *   never under 4 (2-4-core CI runners), never above 12 (beyond, Vitest itself
 *   notes the main thread chokes; a 24-core host ran 83 % idle with the old
 *   fixed 4).
 * - **In a swarm**: this process's share of the machine, floored at 2 so a
 *   4-core CI runner keeps intra-package parallelism.
 *
 * ⚠️ Assumed change: an isolated `npm test -w <package>` goes from 23 workers
 * (uncapped Vitest default) to 12 — the ceiling the root run already applied,
 * extended to the solitary case which had none. **Measured on `@geoleaf/core`
 * alone** (423 test files): 29 → 16 processes, 3,494 → 1,496 MB, 52 → 55 s.
 * Half the processes and 57 % less memory for 3 s — the excess parallelism did
 * not pay.
 *
 * @returns {number} Entier ≥ 2.
 */
export function maxWorkers() {
    const cores = availableParallelism();
    const n = fanout();

    return n === 1 ? Math.min(12, Math.max(4, cores - 2)) : Math.max(2, Math.floor(cores / n));
}

/**
 * A `vmForks` worker's recycling threshold, as a **fraction of total RAM**.
 *
 * Vitest reads it under the **`vmMemoryLimit`** key and only accepts a number in
 * `]0, 1]` (fraction), a percentage (`"50%"`) or a size (`"512MB"`).
 *
 * ⚠️ Never rewrite this as `"1/2"`: `stringToBytes` parses that string via
 * `parseFloat` → **1** → `Math.floor(1 × totalmem)`, i.e. **100 % of the RAM**
 * and no recycling at all. Exactly the trap the previous config had fallen
 * into — under a key (`memoryLimit`) Vitest 4 does not even read, which masked
 * the error by making it harmless.
 *
 * No effect on the `forks` pools (core, addpoi, storage): Vitest only consults
 * this value for `vmForks` / `vmThreads`.
 *
 * @returns {number} Fraction in `]0, 1]`.
 */
export function vmMemoryLimit() {
    return MEMORY_HEADROOM / (fanout() * maxWorkers());
}

/**
 * The resolved budget, for logging. No production consumer — serves to display
 * what the run will cost before it costs it.
 *
 * `oversubscribed` flags a budget beyond the legitimate worst case
 * (`2 × cores`) — see the floor exception, at the head of the module. False in
 * all normal use, including on a 4-core CI runner.
 *
 * @returns {{fanout: number, maxWorkers: number, vmMemoryLimit: number, cores: number,
 *   peakWorkers: number, peakMemoryMb: number, oversubscribed: boolean}}
 */
export function describeBudget() {
    const n = fanout();
    const workers = maxWorkers();
    const cores = availableParallelism();

    return {
        fanout: n,
        maxWorkers: workers,
        vmMemoryLimit: vmMemoryLimit(),
        cores,
        peakWorkers: n * workers,
        peakMemoryMb: Math.round((totalmem() * (n * workers * vmMemoryLimit())) / 1024 / 1024),
        oversubscribed: n * workers > 2 * cores,
    };
}
