/**
 * Vitest configuration for @geoleaf-plugins/offline-ui
 *
 * Uses forks pool + tsx loader (mirrors packages/core/vitest.config.ts).
 * tsx registers require.extensions['.ts'] + Module._resolveFilename patch
 * so that CJS require('../src/foo.ts') correctly resolves to foo.ts.
 *
 * IMPORTANT — Istanbul coverage must be run via workspace mode:
 *   npm run test:vitest:coverage (from monorepo root)
 * Running standalone `npx vitest run --coverage` bypasses Vite's transform
 * pipeline (tsx intercepts first), and Istanbul cannot instrument sources.
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
const coreRoot = resolve(__dirname, "../../core");

export default defineConfig({
    root: __dirname,
    plugins: [resolveJsToTs],

    test: {
        name: "@geoleaf-plugins/offline-ui",
        // happy-dom (not jsdom): jsdom pulls whatwg-url → webidl-conversions@8 which
        // crashes under the tsx loader (TypeError "reading 'get'"). Mirrors plugin-addpoi.
        environment: "happy-dom",
        globals: true,

        // ⚠️ `.ts` ADDED on 07/08/2026. It was not there, and the repo's two rules
        // contradicted each other on this package: JTD-01 refuses any NEW `.js`
        // suite ("a new test is written in TypeScript"), while this glob only
        // collected `.js` — a new JTD-01-compliant test would therefore never have
        // RUN, and a guard that does not run guards nothing. Seen: the inline-layer
        // guard file reported "0 tests" before this change.
        // The 17 existing `.js` suites stay — the `.js` debt is frozen, not
        // reopened; this glob only makes it possible to write NEW ones on the right
        // side.
        // ⚠️ TWO patterns, not a `{js,ts}` brace: it is the form of
        // `packages/core/vitest.config.ts`, and **JTD-04 cannot read braces**.
        // Written first as `{js,ts}`, it turned the gate red on the package's **22**
        // suites — "vitest DOES NOT COLLECT" — while they all ran (359 tests). A
        // false positive, but on exactly the class JTD-04 exists to catch: an
        // `include` that stops matching makes suites invisible **while staying
        // green**.
        include: ["**/__tests__/**/*.test.js", "**/__tests__/**/*.test.ts"],
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            // bundle.test.js reads a pre-built dist/geoleaf-offline-ui.plugin.js — use vitest.bundle.config.ts
            "**/__tests__/bundle.test.js",
        ],

        setupFiles: [resolve(__dirname, "__tests__/setup.js")],

        // Vitest 4 removed `poolOptions`; forks execArgv is now top-level.
        pool: "forks",
        execArgv: ["--import", "tsx"],

        // Process budget, derived and IDENTICAL across the 18 configs (Vitest 4
        // kills the `projects` run if two projects diverge on `maxWorkers`).
        maxWorkers: maxWorkers(),
        vmMemoryLimit: vmMemoryLimit(),

        coverage: {
            // Istanbul provider, like the 17 packages. This package's tests once
            // loaded their sources via `require()`, which `--import tsx` kept out of
            // instrumentation (0% reported while 90/90 tests passed). The ESM
            // conversion removed that branch.
            provider: "istanbul",
            all: false,
            include: ["src/**/*.ts"],
            exclude: ["src/**/*.d.ts"],
            reporter: ["text", "lcov", "html"],
            reportsDirectory: "./coverage",
            // Aligned with packages/core. A falling threshold or a failing test
            // must NOT take the reading with it: during a require() → import
            // conversion, reds are EXPECTED, and the batch that needs diagnosing is
            // precisely the one whose measurement would be lost.
            reportOnFailure: true,
            // Recalibrated on the **istanbul, 4-run** measurement (22/07/2026). The
            // earlier threshold (19) had deliberately stayed RED on statements,
            // awaiting this re-measurement across the 4 packages. These figures are
            // LOW and that is the package's real state: 90 tests cover about a
            // fifth of it (75 stays the TARGET — to be ratcheted up, never down).
            // The measurement is deterministic; the 4 runs yield, identically:
            //
            //   |            | old threshold | true measure (istanbul) | new threshold |
            //   |------------|--------------|-----------------------------|---------------|
            //   | statements |      19      |            18,91           |      16       |
            //   | lines      |      19      |            19,34           |      17       |
            //   | functions  |      16      |            18,89           |      16       |
            //   | branches   |      10      |            10,10           |       8       |
            //
            // Thresholds ~2 pts under the measure — margin against turbo's parallel
            // load, not against noise (nil under istanbul). The statements red is
            // lifted.
            //
            // ── Re-ratcheted (24/07/2026) ─────────────────────────────────────────
            //
            // The 75 target is NOT reached here, and that is arbitrated: this
            // package weighs 5,654 lines for 8 test files, getting it there is a
            // work item of its own (~10-14 h), opened as a dedicated line. This pass
            // does the first step.
            //
            //   |            | prior threshold | measure 24/07 before | after | new threshold |
            //   |------------|----------|------------------------|-----------|---------------|
            //   | statements |    16    |         21,07          |   38,45   |      36       |
            //   | lines      |    17    |         21,30          |   38,87   |      36       |
            //   | branches   |     8    |         12,75          |   23,75   |      21       |
            //   | functions  |    16    |         22,07          |   36,79   |      34       |
            //
            // The gain comes from one file — `src/__tests__/cache-control-view.test.js`,
            // a port of the core's `ui/cache-button.test.js` (725 l., 30 tests, ZERO
            // production line covered: it redefined in the test the very function it
            // verified). Replayed against the real code: `cache-control-dom` 0 →
            // 100% lines, `cache-control-state` 0 → 87.80, `cache-control-events`
            // 0 → 65.15,
            // `cache-control-zone` 0 → 50,80 par ricochet.
            //
            // ⚠️ **Root cause of this package's lag, to instruct with the dedicated
            // line**: it is the only one EXCLUDED from the root `projects` run —
            // `scripts/lib/test-scope.cjs`, `EXCLUDED_FROM_ROOT_RUN`: "test
            // infrastructure to redo (IndexedDB/IDBFactory mock) — inherited
            // exclusion". It is only measured by turbo.
            //
            // ⚠️ Ratchet up, NEVER down.
            //
            // ── The 75 TARGET is REACHED (24/07/2026) ─────────────────────────────
            //
            // 8 test files added, finally exercising the modules until then at
            // 0-40%: the layer-selector cluster (`populate` end to end, ~1,380 l.),
            // download-handler, sync-manager, cache-control-zone, export-logic,
            // cache-control (the FACTORY, imported WITHOUT extension to get around
            // the cross-plugin stub), entry + orchestrator, modal-manager,
            // button-control. Istanbul measurement, deterministic:
            //
            //   |            | prior threshold | measure 24/07 after | new threshold |
            //   |------------|-----------|-------------------------|---------------|
            //   | statements |    36     |          93,38          |      91       |
            //   | lines      |    36     |          94,03          |      92       |
            //   | branches   |    21     |          75,10          |      73       |
            //   | functions  |    34     |          81,38          |      79       |
            //
            // All 4 metrics ≥ 75: storage is no longer the laggard package.
            // Thresholds ~2 pts under the measure (margin against turbo's parallel
            // load; noise nil under istanbul).
            //
            // ⚠️ RATCHETED on 04/08/2026 — 73/79/92/91 → 74/80/93/92. Removing the
            // backup chain pushed all four metrics up (measured after: 74.58 /
            // 80.00 / 93.58 / 92.94), because it takes away code the suite did not
            // cover. A threshold that does not follow a rise stops guarding
            // anything: it becomes crossable again by new untested code.
            // Ratcheted again afterwards, ~2 pts under the measure as the 04/08
            // convention requires.
            //
            // 🛑 **The FUNCTIONS margin was NIL** — 80.00% for a threshold of 80,
            // while the comment above these thresholds announced "~2 pts under the
            // measure". Neither lowerable (forbidden) nor raisable (it would have
            // gone red): the only exit was to **cover one more function**, never to
            // touch the threshold.
            //
            // Done: `cache-control-factory.test.js` now exercises the factory's
            // seven handler delegations (`_handleDownload`… `_toggleCollapsed`),
            // each of which istanbul counted as an uncovered function.
            // `cache/cache-control.ts` goes from **52.38 to 80.95%** functions, and
            // the package from **80.00 to 82.8**.
            //
            // Measure of 06/08: 93.36 stmts · 74.79 branches · 82.8 functions ·
            // 93.98 lines.
            thresholds: {
                branches: 74,
                functions: 80,
                lines: 93,
                statements: 92,
            },
        },

        testTimeout: 10000,
        reporters: ["verbose"],
    },

    resolve: {
        alias: [
            // The specifier the sources really import was only routed to its mock
            // by `__tests__/setup.js`, never by Vite. The mock resolves
            // `confirmDialog` to `true` by default and overrides per test; loading
            // the real package would open a real modal. ⚠️ `s1-fixes.test.js`
            // already imports `export-logic.js` in ESM and passes: that proves the
            // real package LOADS, not that this path behaves the same — it
            // exercises no `confirmDialog` call.
            //
            // 🛑 **The target changed**: `confirmDialog` and `createFocusTrap` moved
            // to `@geoleaf/host-runtime`, so IT is what must be routed. Leaving the
            // alias on `field-renderer` would have made it silently inert — the
            // suite would have stayed green while opening real modals.
            // ⚠️ The mock is now PARTIAL: `offline-ui` consumes nine symbols of
            // `host-runtime` (`Log`, `tLabel`, `coreConfigGet`, `getGeoLeaf`,
            // `getUINotifications`, `fetchWithTimeout`…), not three. It re-exports
            // the real module and only overrides the two interface functions.
            {
                find: /^@geoleaf\/host-runtime$/,
                replacement: resolve(__dirname, "__mocks__/host-runtime.js"),
            },
            // @core/log → mock
            {
                find: /^@core\/log(\/index\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/log.js"),
            },
            // @core/utils — specific mocks first, then core source fallback
            {
                find: /^@core\/utils\/general\/dom-helpers(\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/dom-helpers.js"),
            },
            {
                // Pattern realigned on the real specifier, which carries a `general/` segment.
                // NOTE — like every alias here, this only governs TEST-file imports: source
                // files come in via `require()` + tsx, which resolves `@core/*` through
                // tsconfig paths to the real core source, bypassing Vite's aliases entirely.
                find: /^@core\/utils\/general\/event-listener-manager(\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/event-listener-manager.js"),
            },
            {
                find: /^@core\/utils\/general\/dom-security(\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/dom-security.js"),
            },
            // `profile-layers` left `capabilities/offline/` for the profile/config
            // domain. It needs an entry BEFORE the catch-all below, otherwise it
            // would be routed to the `Config` mock, which has nothing to do with
            // it. Mapped to the real source, like `@core/shared/*`.
            {
                find: /^@core\/config\/profile-layers(\.js)?$/,
                replacement: `${coreRoot}/src/kernel/config/profile-layers.ts`,
            },
            // ─── Public-API review — the core's PUBLISHED subpaths ─────────────────
            //
            // The plugin's sources now import `@geoleaf/core/kernel/config/…` and
            // `@geoleaf/core/capabilities/…` instead of aliases to the core's
            // sources: that is what gives it back a `rootDir` and hence the
            // publication of its types. In TEST, Vite must resolve these specifiers
            // to the SOURCES (`dist/` can be absent or stale during a test run).
            //
            // ⚠️ These are PURE, import-free functions — embedding a copy is
            // inconsequential. Singletons, by contrast, do NOT go through an
            // import: they are read on `globalThis.GeoLeaf`, otherwise the plugin
            // gets a second, never-initialised instance.
            {
                find: /^@geoleaf\/core\/kernel\/(.+)\.js$/,
                replacement: `${coreRoot}/src/kernel/$1.ts`,
            },
            {
                find: /^@geoleaf\/core\/capabilities\/(.+)\.js$/,
                replacement: `${coreRoot}/src/capabilities/$1.ts`,
            },
            // @core/config → mock
            { find: /^@core\/config\/.*$/, replacement: resolve(__dirname, "__mocks__/config.js") },
            // @core/shared → core source (canonical built-in/shared, matching tsconfig paths)
            {
                find: /^@core\/shared\/([^/]+)\.js$/,
                replacement: `${coreRoot}/src/kernel/shared/$1.ts`,
            },
            // @core-offline/* → in-core offline capability source (S14 Phase B — the UI
            // bundles the stateless CacheCalculator / resolveProfileLayers helpers).
            {
                find: /^@core-offline\/(.+)\.js$/,
                replacement: `${coreRoot}/src/capabilities/offline/$1.ts`,
            },
            // ─── Relative-path aliases — 6 REMOVED, backlog R.23 (24/07/2026) ────────
            //
            // Same class as the `@core/ui/notifications` removal noted further down
            // (PLUGINS S12): `.js`-only relative aliases that resolve nothing. Removed:
            //   ../indexeddb.js · ../core/indexeddb.js · (../)+log/index.js   [`core/` → `db/` au S8]
            //   ../../config/config-primitives.js
            //   ../../config/geoleaf-config/config-core.js · ../../utils/formatters.js
            //
            // Three converging proofs, measured rather than argued:
            //   1. No source or test here imports those specifiers (full sweep of `src/`).
            //   2. Mutation: neutralising all six left the suite at 162/162.
            //   3. Each mock keeps a canonical `@core/*` route (`@core/log` → log.js,
            //      `@core/config/*` → config.js, `@core/utils/general/formatters` →
            //      formatters.js). No mock lost its only path.
            //
            // `./indexeddb.js` and `./log/index.js` are DELIBERATELY kept: they were not
            // part of the mutation, so they are not part of the proof. An entry left in
            // by caution costs less than one removed on an assumption.
            {
                find: /^\.\/indexeddb\.js$/,
                replacement: resolve(__dirname, "__mocks__/indexeddb.js"),
            },
            // Cross-plugin / cascade-heavy deps stubbed out. Regex must match the WHOLE
            // specifier (anchored ^…$): a regex find does string.replace, so an un-anchored
            // suffix match would leave the "../../" prefix and produce a broken path. Any
            // relative depth + .js|.ts (resolveJsToTs rewrites .js→.ts).
            // ⚠️ `sync/` → `cache/`. This entry was SEEN DEAD before being fixed:
            // left stale, 2 tests go red and the REAL `cache-control.ts` loads
            // instead of the stub. So it does guard something.
            {
                find: /^(\.\.\/)+cache\/cache-control\.(js|ts)$/,
                replacement: resolve(__dirname, "__mocks__/empty-module.js"),
            },
            { find: /^\.\/log\/index\.js$/, replacement: resolve(__dirname, "__mocks__/log.js") },
            // @core absolute aliases (used by plugin-storage src files)
            {
                find: /^@core\/utils\/general\/formatters(\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/formatters.js"),
            },
            // The `@core/ui/notifications` alias is removed: NO source in the repo
            // imports that specifier any more. It is the last remnant of the `ui/`
            // (root, dead) vs `src/ui/` (real) duplicate: the directory left and
            // the alias + mock pair outlived it. An alias that no longer resolves
            // anything does not break — it fakes a maintained decoupling.
        ],
    },
});
