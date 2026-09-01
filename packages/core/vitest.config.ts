/**
 * Vitest configuration for @geoleaf/core
 *
 * Replaces the dual Jest config (jest.config.cjs + jest.esm.config.cjs)
 * and the custom jest-esm-transform.cjs transformer.
 *
 * Key design decisions:
 * - pool: 'forks' — each test runs in an isolated forked Node.js process.
 *   tsx is loaded via execArgv (--import tsx) so the forked workers can require
 *   TypeScript source and redirect .js → .ts imports (CJS-compatible loading).
 * - resolveJsToTs plugin — intercepts .js imports in source files, resolves
 *   to .ts counterparts using existsSync (reliable filesystem lookup). Combined
 *   with resolve.extensionAlias { .js: ['.ts', '.js'] } so Vite's resolver also
 *   tries the .ts sibling for the ESM `import './foo.js'` convention.
 * - globals: true — vi.* available without explicit import in test files
 */
// Side effect: ensure `--import tsx` in NODE_OPTIONS before workers spawn (Vitest 4
// no longer loads tsx reliably via poolOptions.forks.execArgv). MUST be first.
import "@geoleaf/build-config/vitest/ensure-tsx-node-options.mjs";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveJsToTs } from "@geoleaf/build-config/vitest/resolve-js-to-ts.mjs";
import { maxWorkers, vmMemoryLimit } from "@geoleaf/build-config/vitest/worker-budget.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    root: __dirname,
    plugins: [resolveJsToTs],

    test: {
        name: "@geoleaf/core",
        environment: "happy-dom",
        globals: true,
        setupFiles: [resolve(__dirname, "__tests__/setup.js")],

        // ⚠️ BOTH extensions, and the order of reasons counts. The shared factory
        // (`build-config/vitest/base.mjs`) declares `.test.ts`: that is the target.
        // This package overrode it with `.test.js` ALONE to keep the frozen `.js`
        // test debt's suites visible — but the override also made every NEW test
        // written in TypeScript invisible to the runner, while going green. The
        // very trap `check-js-test-debt` (JTD-02) names explicitly, and it closed
        // on `write-capture-parity.guard.test.ts`. Accepting both lets the debt
        // keep running without forbidding new code in the right extension.
        // 🛑 TWO patterns, not a `{js,ts}` brace. Vitest understands both forms;
        // `check-js-test-debt`'s matcher does NOT expand the brace, and the
        // condensed version made it declare the package's 456 `.js` suites
        // "uncollected". The gesture meant to make the gate right had made it
        // blind — seen, then fixed.
        include: ["**/__tests__/**/*.test.js", "**/__tests__/**/*.test.ts"],
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/e2e/**",
            // The `bundle-*` suites evaluate the BUILT `dist/` — they live under
            // `vitest.bundle.config.ts`, which globs them precisely by this
            // pattern.
            //
            // 🛑 This line named the single `bundle.test.js` until 2026-08-07,
            // while the dedicated config has globbed `bundle-*.test.js` since
            // `bundle-boot-contract` was added. The file was thus collected
            // TWICE: by its config, which builds what it evaluates, and by this
            // run, which does not build it. Its failure here taught nothing about
            // the code and took `Unit tests` and `Coverage gate` down by ricochet
            // — two of the three red gates of that incident had no other cause
            // than this too-narrow exclusion. ⚠️ The pattern now follows
            // `vitest.bundle.config.ts`'s: the two read together, or the next
            // `bundle-*` file reopens the same hole.
            "**/__tests__/bundle.test.js",
            "**/__tests__/bundle-*.test.js",
            "**/__tests__/bundle-*.test.ts",
        ],

        // forks pool: each test runs in an isolated forked Node.js process.
        // --import tsx registers BOTH:
        //   - require.extensions['.ts'] handler (TypeScript CJS loading)
        //   - Module._resolveFilename patch (.js → .ts redirect for CJS requires)
        // Vitest 4 removed `poolOptions`; forks settings are now top-level (isolate
        // defaults to true → former `singleFork: false`).
        pool: "forks",
        execArgv: ["--import", "tsx"],

        // This comment used to say the worker cap "lives in the root config".
        // True in `projects` mode, and FALSE everywhere else: under
        // `turbo run test`, each package is an autonomous `vitest run` that never
        // loads the root config, and thus fell back on Vitest's default —
        // 23 workers on 24 cores, per package, simultaneously. Measured: 81
        // processes and 11.3 GB of RSS for ~11 GB available.
        // What Vitest 4 refuses is not the per-project cap, it is the DIVERGENCE
        // between projects of one `sequence.groupOrder` — hence a single, derived
        // value.
        maxWorkers: maxWorkers(),
        vmMemoryLimit: vmMemoryLimit(),

        coverage: {
            // Provider: **istanbul**, like the repo's 17 packages. `all:false` —
            // coverage only counts files reached by the tests.
            //
            // The defect class that once skewed this measurement — a
            // `require()`-loaded module the instrumentation does not see under
            // `--import tsx` — was eliminated (the `require()` baseline went
            // 357 → 2) and is now guarded at the source by
            // `verify-test-load-mode.cjs` (it can only descend).
            // `verify-coverage-attribution.cjs` additionally verifies, at every
            // `ci:local`, that attribution is correct, on a known-answer witness.
            provider: "istanbul",
            all: false,
            reportOnFailure: true,
            include: ["src/**/*.ts"],
            exclude: ["src/**/*.d.ts"],
            thresholds: {
                // Recalibrated on the istanbul measurement (deterministic,
                // 0.00 amplitude over 4 runs), then **ratcheted upward** after the
                // 5 deposit modules got their tests (cache-manager,
                // storage/facade, feature-interaction, branding/lifecycle,
                // init-reveal), which took the core from 90.71 to **92.07 %**
                // lines (90.36 stmts / 90.77 fns / 81.42 branches).
                //
                // ⚠️ Ratchet upward, NEVER downward.
                //
                // ── 2026-07-25 raise: 90/88/88/79 → 92/90/90/81 ──
                //
                // Day's measurement, taken under the gate's EXACT command
                // (`turbo run test:coverage --filter=@geoleaf/core`, and not a
                // bare `vitest` — the 17-package `projects` aggregate is another
                // object):
                //
                //   lines 92.77 · statements 91.02 · functions 91.36 · branches 81.97
                //
                // The margins fall from ~2 pts to **0.77 / 1.02 / 1.36 / 0.97**,
                // and that is a choice, not an oversight. The previous margin was
                // justified as protection against "turbo's parallel load" — yet
                // what load produces is `hookTimeout` overruns, which make the
                // test FAIL, not the coverage silently drop. Under istanbul the
                // measured amplitude stays 0.00. A 2-point margin mostly left
                // room to regress with nothing saying so.
                //
                // If a run reddens here with no test deleted, the first cause to
                // look for is a file that ENTERED the perimeter without tests —
                // not noise.
                branches: 81,
                functions: 90,
                lines: 92,
                statements: 90,
            },
            reporter: ["text", "lcov", "html", "json"],
            reportsDirectory: "./coverage",
        },

        testTimeout: 10000,
        // Hooks that import core module graphs under tsx + istanbul can exceed the
        // default 10 s when the full `npm test` (turbo) runs all workspaces in parallel
        // (CPU contention). Give setup hooks headroom to avoid flaky timeouts.
        hookTimeout: 30000,
        reporters: ["verbose"],
    },

    resolve: {
        // extensionAlias: when Vite resolves a .js import and the .js file doesn't
        // exist, try .ts first. This handles the ESM convention used throughout the
        // codebase: source files import ./foo.js but the actual files are ./foo.ts.
        // Used by Vite's ssrLoadModule for all transitive imports in source files.
        extensionAlias: {
            ".js": [".ts", ".js"],
        },

        alias: [
            // Workspace package: resolve field-renderer from source (no CJS "require" export in dist).
            {
                find: "@geoleaf/field-renderer",
                replacement: resolve(__dirname, "../libs/field-renderer/src/index.ts"),
            },
            // Entry-point side-effect stub. `bundle-esm-entry.ts` are the only
            // specifiers this matches (`import "./app/app-namespace.js"` / `"./app/boot.js"`).
            // ⚠️ STRUCT S7 — five sibling entries were removed here: they targeted
            // `./lazy/*` and `./modules/*`, and BOTH directories were deleted
            // long ago. They matched zero specifiers in the repo and had been
            // resolving nothing for months. A vitest alias whose `find` matches nothing
            // is silent by construction — it is not a config error, it is dead weight
            // that reads as coverage. Kept this one because a test importing
            // `bundle-esm-entry.ts` is a legitimate thing to write, and it costs a line.
            {
                find: /^\.\/app\/.+\.js$/,
                replacement: resolve(__dirname, "__tests__/__mocks__/empty-module.js"),
            },
            // S14 Phase B (B3): stub the in-core offline engine's IndexedDB layer in unit
            // tests (the real IDB layer opens a database — not available under happy-dom).
            // Mirrors the former plugin-storage vitest aliases now that the engine is in-core.
            // ⚠️ `(js|ts)` — WITHOUT `ts`, these two entries were DEAD for the
            // sources. `resolveJsToTs.transform` rewrites `.js` → `.ts` INSIDE
            // source files (it explicitly skips `__tests__/`), so `storage.ts`
            // asks for `../db/indexeddb.ts` — which `/\.js$/` did not match. The
            // REAL `indexeddb.ts` (591 l.) was thus loaded despite the alias, and
            // its `_ensureModule` guards threw "Preferences module not
            // available". That is what made the core's 2 last sites pass for
            // "incomplete mocks": the mock was never served. Same trap as
            // `image-upload.(js|ts)` on the addpoi side.
            {
                // ⚠️ `core/` → `db/` rename. This entry was SEEN DEAD before being
                // fixed — 13 red tests over 4 files, all "Preferences module not
                // available" from the REAL `indexeddb.ts`. The alias thus really
                // guards something; it is not decorative.
                find: /^\.\.\/db\/indexeddb\.(js|ts)$/,
                replacement: resolve(__dirname, "__tests__/__mocks__/indexeddb.js"),
            },
            {
                find: /^\.\/indexeddb\.(js|ts)$/,
                replacement: resolve(__dirname, "__tests__/__mocks__/indexeddb.js"),
            },
        ],
    },
});
