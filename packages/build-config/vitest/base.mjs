/**
 * @description
 * Shared Vitest configuration factory.
 *
 * Replaces the **25 relative imports** `../core/vitest-plugins/…` spread over 17
 * packages. It was the repo's densest coupling: 17 packages' test infrastructure
 * lived in an 18th, so moving `packages/core` broke everyone else's tests.
 *
 * ## Two design rules, both learned the hard way
 *
 * **1. Everything is `.mjs` here, never `.ts`** — for robustness, not because a
 * `.ts` would be impossible. Verified: a `.ts` of this package, imported by npm
 * specifier from a `vitest.config.ts`, loads fine, even with `NODE_OPTIONS`
 * emptied. The real motive is to depend on no transpiler to read modules one of
 * which installs precisely that transpiler. Detail in
 * `ensure-tsx-node-options.mjs`.
 *
 * **2. `resolve.alias` is NEVER merged nor reordered.** Vitest alias order is
 * significant: in `plugin-storage`, `@core/config/profile-layers` must precede
 * the `@core/config/*` catch-all, else the second captures the first. The
 * factory thus receives the package's array and places it **as-is**, after its
 * own entries (it has none today) and without sorting it.
 *
 * Corollary to know before touching the aliases: they govern **only the test
 * files**. Sources go through tsx and the tsconfig's `paths` to the core's real
 * source. This double resolution path is documented in
 * `plugin-storage/vitest.config.ts` and `plugin-addpoi/vitest.config.ts`; the
 * factory preserves it by touching neither.
 *
 * ## What is mutualised
 *
 * The fields identical across the 18 configs: `globals`, `include`, `exclude`,
 * `maxWorkers`, `vmMemoryLimit`,
 * `coverage.provider`/`reporter`/`reportsDirectory`, `testTimeout`, `reporters`,
 * the `__dirname` block and the `resolveJsToTs` plugin.
 *
 * ⚠️ `maxWorkers` and `vmMemoryLimit` are not mutualised for comfort: Vitest 4
 * refuses **divergent** `maxWorkers` between projects of one
 * `sequence.groupOrder` and kills the run before any test. Both therefore come
 * from `worker-budget.mjs`, including in the 3 bespoke configs (core, addpoi,
 * storage) that do not use this factory.
 *
 * What genuinely diverges stays parameterised: `name`, `environment`
 * (happy-dom ×16, node ×2), `pool` (vmForks ×15, forks ×3), coverage
 * (`include`/`exclude` and thresholds ranging from **19** for `plugin-storage`
 * to **85** for `field-renderer`), `setupFiles` and `alias`.
 */

// Side effect — MUST be evaluated before Vitest spawns any worker. A static ESM
// import is fully evaluated before the importing module's body, so importing it
// here (rather than in each of the 18 leaves) both preserves the ordering and
// removes the trap of a leaf placing another import above it.
import "./ensure-tsx-node-options.mjs";

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// The run's process budget. See that module for the invariants; retain here
// that the value MUST be the same across the 18 configs, else Vitest 4 kills the
// `projects` run before any test.
import { maxWorkers, vmMemoryLimit } from "./worker-budget.mjs";

// `core`, `plugin-addpoi` and `plugin-storage` keep a bespoke configuration
// (aliases, forks pool, setup) and import the plugin directly from
// `@geoleaf/build-config/vitest/resolve-js-to-ts.mjs`. No re-export here.
import { resolveJsToTs } from "./resolve-js-to-ts.mjs";

/** Default coverage thresholds — the project target (≥ 75 %). */
const DEFAULT_THRESHOLDS = { branches: 75, functions: 75, lines: 75, statements: 75 };

/**
 * Builds a package's Vitest configuration.
 *
 * @param {object} options
 * @param {string} options.configUrl The calling `vitest.config.ts`'s
 *   `import.meta.url` — used to compute `root`. Passing the URL rather than a
 *   path avoids depending on the directory Vitest is launched from.
 * @param {string} options.name Vitest project name (= the package's npm name).
 * @param {"happy-dom"|"node"} [options.environment] Default `happy-dom`.
 * @param {"vmForks"|"forks"|"threads"} [options.pool] Default `vmForks`.
 * @param {string[]} [options.coverageInclude] Default `["src/**\/*.ts"]`.
 * @param {string[]} [options.coverageExclude] Default `[]`.
 * @param {object} [options.thresholds] Coverage thresholds. Default 75 everywhere.
 * @param {string[]} [options.setupFiles] Setup files, as-is.
 * @param {unknown[]} [options.alias] The package's `resolve.alias` — **taken
 *   verbatim**, never merged nor sorted (order is significant).
 * @param {unknown[]} [options.plugins] Extra plugins, added AFTER `resolveJsToTs`.
 * @param {object} [options.test] Extra `test` fields, merged last.
 * @returns {import('vitest/config').UserConfig}
 */
export function packageConfig({
    configUrl,
    name,
    environment = "happy-dom",
    pool = "vmForks",
    coverageInclude = ["src/**/*.ts"],
    coverageExclude = [],
    thresholds = DEFAULT_THRESHOLDS,
    setupFiles,
    alias,
    plugins = [],
    test = {},
}) {
    if (!configUrl) throw new Error("vitest/base: `configUrl` is required (pass import.meta.url).");
    if (!name) throw new Error("vitest/base: `name` is required.");

    const root = dirname(fileURLToPath(configUrl));

    return defineConfig({
        root,
        plugins: [resolveJsToTs, ...plugins],
        // Passed through untouched — see the ordering note in this module's header.
        ...(alias ? { resolve: { alias } } : {}),

        test: {
            name,
            environment,
            globals: true,

            include: ["**/__tests__/**/*.test.ts"],
            exclude: ["**/node_modules/**", "**/dist/**"],

            pool,

            // The worker ceiling and the memory-recycling threshold, derived from
            // a single source. They replace a `memoryLimit: "1/2"` that was
            // doubly false: the key Vitest 4 reads is `vmMemoryLimit` (that one
            // was not), and `"1/2"` would have parsed there as **1** anyway, i.e.
            // 100 % of the RAM.
            maxWorkers: maxWorkers(),
            vmMemoryLimit: vmMemoryLimit(),

            ...(setupFiles ? { setupFiles } : {}),

            coverage: {
                provider: "istanbul",
                include: coverageInclude,
                exclude: coverageExclude,
                reporter: ["text", "lcov", "html"],
                reportsDirectory: "./coverage",
                thresholds,
            },

            testTimeout: 10_000,
            reporters: ["verbose"],

            ...test,
        },
    });
}
