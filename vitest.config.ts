/**
 * Root Vitest configuration — GeoLeaf-JS monorepo (Vitest 4)
 *
 * Replaces the deprecated standalone `vitest.workspace.ts` (array export +
 * `--workspace` CLI flag, both removed in Vitest 4) with the canonical
 * `test.projects` field. Each entry points to a per-package vitest.config.ts.
 *
 * Run:
 *   npm run test:vitest          — all projects
 *   npm run test:vitest:core     — @geoleaf/core only (--project filter)
 *   npm run test:vitest:coverage — coverage report
 *
 * tsx propagation: Vitest 4 does NOT honor per-project execArgv for forked
 * workers (verified in S1 — tsx loaded via poolOptions.forks.execArgv left 1148
 * `.js → .ts` imports failing with ERR_MODULE_NOT_FOUND). Setting NODE_OPTIONS at
 * config-load time propagates tsx (ESM .js → .ts resolution + tsconfig paths) to
 * every forked worker. This is essential and stays. (S2 node18-cleanup removed the
 * dead Node 24 `--no-experimental-require-module` branch; engines require Node ≥ 22.)
 */
// Side effect — MUST run before workers spawn. Shared with the 17 package configs
// since the shared factory; this file used to carry its own copy of the same four lines.
import "@geoleaf/build-config/vitest/ensure-tsx-node-options.mjs";

import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";

import { maxWorkers } from "@geoleaf/build-config/vitest/worker-budget.mjs";

/**
 * This run's perimeter comes from `scripts/lib/test-scope.cjs`.
 *
 * The exclusion list (`EXCLUDED_FROM_ROOT_RUN`) moved there, with its
 * justification: it is PERIMETER knowledge, not Vitest configuration, and the
 * runner that verifies the `ci:local ⊇ ci.yml` invariant must be able to read
 * it from CJS. Keeping it here would have imposed writing a second copy on the
 * runner side — exactly the drift `packages.cjs` and that module exist to kill.
 */
const testScope = createRequire(import.meta.url)("./scripts/lib/test-scope.cjs");

export default defineConfig({
    test: {
        // The run's worker ceiling. Derived, and above all IDENTICAL to the one
        // the 18 package configs declare: Vitest 4 kills the `projects` run
        // before any test if two projects of one `sequence.groupOrder` diverge
        // on this value. Here `GEOLEAF_TEST_FANOUT` is absent (a single vitest
        // process) → the run takes the machine, as before the budget work.
        maxWorkers: maxWorkers(),
        projects: testScope
            .rootProjectScope()
            .map((p: { dir: string }) => `${p.dir}/vitest.config.ts`),
        // Vitest 4 resolves the coverage provider from the ROOT config when running
        // `--coverage` across projects — so it must be declared here. Monorepo
        // standard: istanbul (each project config sets it too).
        coverage: {
            provider: "istanbul",
            // ⚠️ NO `reportsDirectory` here, and that is a measurement's result.
            //
            // The survey attributed the root's 23 MB `coverage/` to
            // "`vitest run --coverage`, implicit path". **False, verified.** In
            // `projects` mode, each project applies ITS `reportsDirectory` — and
            // the 19 all declare it at `"./coverage"`, relative to their own root
            // (`packages/build-config/vitest/base.mjs` + 4 overrides).
            // Measurement: after `rm -rf coverage`,
            // `npm run test:vitest:coverage` writes into
            // `packages/core/coverage/` and does NOT recreate `coverage/` at the
            // root.
            //
            // That root `coverage/` was thus a RESIDUE of an invocation from
            // another era, with no current producer — deleted, it does not come
            // back. Declaring a `reportsDirectory` here to "relocate" it created
            // an empty `artifacts/`: a declaration claiming to move what nothing
            // produces, exactly the defect class that work removed. It was
            // written, measured without effect, then removed.
            //
            // Do not put it back without first measuring that a ROOT report
            // exists.
            //
            // The SIX objects named "coverage" in this repo (and their four
            // meanings): see `docs/reference/ARCHITECTURE.md`, section
            // « coverage — six objets, quatre sens ». This file governs only
            // one. (The pointer used to say a workshop path, dead BEFORE the
            // split.)
        },
    },
});
