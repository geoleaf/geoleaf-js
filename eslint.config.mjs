// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import security from "eslint-plugin-security";
import { createRequire } from "node:module";

// The workspace registry is CJS (it is shared with ~10 `.cjs` gates), so it is
// loaded through createRequire rather than converted — see scripts/lib/packages.cjs.
const registry = createRequire(import.meta.url)("./scripts/lib/packages.cjs");

// ── Type-hardening ratchet ──────────────────────────────────────────────────
// Globs where `@typescript-eslint/no-explicit-any` is elevated to "error".
// EXTEND at the end of each sprint once a directory is cleaned AND green.
// NEVER remove an entry — this is a one-way ratchet (no regression).
const ANY_HARDENED = [
    // `app/lazy-module-loader.ts` (S0 baseline) dropped in S5 — the FILE is gone with the
    // lazy machinery, not the rule. Removing a ratchet entry whose target no longer exists
    // does not loosen enforcement on any line of code; do not read it as a precedent.
    "packages/core/src/app/module-registry.ts", // pre-existing (S0 baseline)
    // ↓ add cleaned directories here as each sprint clears them (one-way ratchet).
    "packages/core/src/kernel/ui/**/*.ts", // 0 any, tsc+tests green
    "packages/core/src/kernel/themes/**/*.ts", // 0 any, tsc+tests green
    "packages/core/src/kernel/map/**/*.ts", // 0 any, tsc+tests green
    "packages/core/src/kernel/geojson/**/*.ts", // 0 any, tsc+tests green
    "packages/core/src/kernel/layer-manager/**/*.ts", // 0 any, tsc+tests green
    "packages/core/src/utils/loaders/**/*.ts", // 0 any, tsc+tests green
    // CAPACITÉS S10 — 4 entries removed here, under the precedent recorded above:
    // `utils/renderers/**`, `built-in/poi/**`, `built-in/filters/**`
    // and `modules/optional/**` (S5). Their directories were emptied by later sprints and
    // the globs had been matching ZERO files since — dead weight, not enforcement. Removing
    // a ratchet entry whose target no longer exists does not loosen enforcement on any line
    // of code; the S6 catch-all below covers every file they ever did. This is the same
    // reading as the `app/lazy-module-loader.ts` note above, and it is not a precedent for
    // removing an entry that still matches something.
    //
    // They went unnoticed because `probe-gate-visibility.cjs` only armed the PLUGIN ratchet;
    // its family B now reads BOTH lists straight out of this file, so the next dead glob
    // fails the probe instead of accumulating.
    "packages/core/src/**/*.ts", // S6 — whole core hardened (basemaps/api/permalink/data/contracts/app/adapters/globals + tail); __tests__ excluded by block ignores. 2 documented irreducibles (storage-contract DB, notifications overload). Covers capabilities/taxonomy + capabilities/feature-info (reclassified in-core, SR0).
];

// ── Type-hardening ratchet — PLUGINS ────────────────────────────────────────
// Globs where `@typescript-eslint/no-explicit-any` is elevated to "error", for
// the PLUGIN packages. Deliberately a SEPARATE constant + block (6quater below)
// from the core ANY_HARDENED: each list lives in its own file zone so parallel
// branches (e.g. feature/capacites-extraction, which also extends the core
// ratchet) never share a git hunk with this one. Same one-way rule: never remove.
// The ratchet now names PACKAGES and derives their globs, instead of
// writing 14 `packages/<dir>/src/**/*.ts` paths by hand.
//
// This entry was in no task of ARCHI S9 or S10, and it is the most dangerous
// instance of the class both sprints target. A hard-coded glob does not fail when
// its path stops existing — it silently matches nothing. So once ARCHI S10 moves
// these packages under `packages/plugins/` and `packages/libs/`, all 14 globs would
// have matched zero files and `no-explicit-any` would have quietly dropped back to
// "warn" across every plugin. A one-way ratchet would have been released, with a
// green lint run and no diff to point at.
//
// Which packages are hardened stays an explicit, hand-maintained list: it is a
// policy (a package earns its lock by reaching 0 `any`), not a fact that can be
// read off the repo. Deriving it would auto-enroll any new package and break the
// build on its first `any`. Only the PATHS are derived — and an unknown name now
// throws, so a rename surfaces here instead of silently unlocking a package.
const ANY_HARDENED_PLUGIN_PACKAGES = [
    // S0 — free locks: plugin packages already at 0 explicit `any` (count-any.cjs).
    "@geoleaf-plugins/offline-ui",
    "@geoleaf-plugins/cog",
    "@geoleaf-plugins/connector",
    "@geoleaf-plugins/file-import",
    "@geoleaf-plugins/realtime-layer",
    "@geoleaf-plugins/websocket",
    "@geoleaf-plugins/geocoding",
    "@geoleaf-plugins/table",
    "@geoleaf-plugins/measure", // S1 — 57 any → 0 (MapLibre frontier typed via MeasureMap; namespace via getGeoLeaf)
    "@geoleaf-plugins/print", // S2 — 29 any → 0 (native map + offscreen typed via maplibre-gl type-only)
    "@geoleaf-plugins/editor", // S2 — 15 any → 0 (EditorMap frontier; terra-draw generic adapter)
    "@geoleaf-plugins/flatgeobuf", // S3a — 4 any → 0 (namespace + FGB iterator header via structural casts)
    "@geoleaf/field-renderer", // S3a — 2 any → 0 (globalThis structural cast for I18n)
    // Free lock (0 any, 8/8 files). Locks the utilities consolidated into
    // host-runtime at S1 (css-adopt/touch-drag/notify-seam/host). A lib in a
    // `*_PLUGIN_PACKAGES` list is already established — `@geoleaf/field-renderer` above is
    // one; the constant is effectively "hardened non-core packages". pkgGlob() resolves the
    // path by NAME and throws on an unknown one, so a rename surfaces here.
    "@geoleaf/host-runtime",
];

/**
 * Repo-relative path inside a workspace package, resolved by npm NAME.
 *
 * Every `files:`/`ignores:` glob naming a package must go through
 * here. A glob that stops matching does NOT fail: it silently changes which rules
 * apply to a file. The move proved both directions of that — the two exemption
 * blocks below detached and lint suddenly reported complexity errors (visible),
 * while a *restriction* block detaching would have dropped rules with nothing to
 * show for it (invisible, and far worse).
 *
 * An unknown name throws, so a rename surfaces here instead of silently changing
 * the linted surface.
 *
 * @param {string} name npm package name, e.g. "@geoleaf-plugins/offline-ui"
 * @param {string} rest glob suffix, e.g. "src/**"
 */
function pkgGlob(name, rest) {
    const pkg = registry.byName(name);
    if (!pkg) {
        throw new Error(
            `eslint.config.mjs: "${name}" is referenced by a lint rule but is not a workspace ` +
                `package. A glob that matches nothing changes the applied rules in silence — fix ` +
                `the name rather than dropping the entry.`
        );
    }
    return `${pkg.dir}/${rest}`;
}

const ANY_HARDENED_PLUGINS = ANY_HARDENED_PLUGIN_PACKAGES.map((name) =>
    pkgGlob(name, "src/**/*.ts")
);

// KERNEL S14 — layering boundary: `modules/` (implementation) must not import
// `app/` (boot orchestration). The dependency runs one way: app/ composes modules,
// never the reverse. KERNEL S13 studied this and found 27 imports in the right
// direction and exactly 2 inverse edges, both on the SAME symbol
// (`CapabilityRegistry`) — a misplaced symbol, not a porous boundary. S14 moved it
// to `kernel/api/`, which is what makes this rule postable without an
// exception. Do not add an allowlist here: an exception would re-open the hole the
// move just closed.
//
// ⚠️ Spread into EVERY block that sets `no-restricted-imports` on files under
// `modules/`. ESLint flat config OVERRIDES (does not merge) a rule when a later
// block matches the same file — so the `ui/mobile` and `ui/desktop` blocks below,
// which live under `modules/`, would silently drop this boundary if they set the
// rule without re-including it.
const KERNEL_APP_BOUNDARY = {
    group: ["**/app/*", "**/app/**"],
    message:
        "kernel layer must not import app/ — the dependency runs app/ → (api|globals|kernel|utils), never the reverse (KERNEL S13 study, S14 move; the four roots replaced modules/ at R.9). Put the shared symbol in kernel/ instead.",
};

/** @type {import("eslint").Linter.Config[]} */
export default [
    // ── 1. Global ignores ──────────────────────────────────────────────────────
    {
        ignores: [
            "node_modules/",
            "**/node_modules/",
            "**/dist/",
            "**/coverage/",
            // `"**/*.min.js"` removed: 0 files in the repo (measured with
            // `git ls-files | grep '\.min\.js$'`). The project only minifies into
            // `dist/` and `deploy/`, both already ignored above and below, and
            // without a `.min` suffix. An exemption matching nothing is benign in
            // THIS direction (it makes the rule stricter, not looser) but it reads
            // as a real constraint, and nobody could say anymore what it protects.
            // Hand-authored toolchain config files (build / test-runner / coverage).
            // Out of runtime scope and infra-only; some are CommonJS (nyc.config.cjs)
            // which the module-mode base block cannot parse. Audited & kept ignored.
            // NB: jest.config.js was removed here — the project runs on Vitest, no Jest config exists.
            "**/rollup.config.mjs",
            "**/postcss.config.mjs",
            "eslint.config.mjs",
            "vitest.config.ts",
            "playwright.config.js",
            "nyc.config.cjs",
            // Generated artifact directories — never lint
            "deploy/",
            // The single run-reports directory. It carries VENDOR JS:
            // `prettify.js`, `sorter.js`, `block-navigation.js` (istanbul HTML
            // report), which no other `ignores` covers — `**/coverage/` does not
            // match the `coverage-e2e` component, and nothing covers
            // `artifacts/playwright/report`.
            //
            // ⚠️ DEFENSIVE entry, not load-bearing — and that is a measurement, not
            // an assumption. The plan announced it "mandatory, without which
            // `npm run lint` goes red at the first istanbul report". Verified:
            // removing it leaves `npx eslint .` at exit 0, those files triggering
            // no rule of this config. ESLint DOES lint them though — synthetic
            // witness `var x = 1; y = 2;` dropped under `artifacts/`, ignore
            // removed: 2 errors. The line thus protects against a future,
            // less docile report JS, not a current red. Flat config does not skip
            // a gitignored directory.
            "artifacts/",
            // Moved out of `packages/`. ⚠️ MANDATORY, non-obvious edit: this
            // directory carries 129 `.js` files (hashed VitePress chunks) that no
            // other `ignores` covers — `**/dist/` does not match the `docs-dist`
            // component, and the chunks are not named `*.min.js`. Without this
            // line, `npm run lint` (a `ci:local` gate + `ci.yml` step) goes red at
            // the first `docs:build`.
            "docs-dist/",
            // The entry used to be `packages/core/docs/` IN FULL, which silenced
            // three hand-written SOURCES: `.vitepress/config.ts` (179 L),
            // `theme/index.ts` and `theme/custom.css`. Only the two generated
            // trees are artifacts. Alignment in the right direction: the ESLint
            // ignore is NARROWED, `.gitignore` is not widened — that would
            // gitignore hand-written TypeScript. Same shape list as
            // `scripts/lib/generated-artifacts.cjs`.
            "packages/core/docs/api/",
            "packages/core/docs/public/",
            // Plugin scaffold template — placeholder __PLUGIN_*__ tokens are not
            // valid TS/identifiers; consumed by scripts/create-plugin.cjs, never built.
            "packages/_plugin-template/",
            // Local archive — git-untracked one-shot scripts (py/cjs), experimental
            // churn. Confirmed out of scope.
            "_archive_local/",
            // Agent worktrees — full copies of the repo at some past commit. They are
            // git-excluded (.git/info/exclude) but that says nothing to ESLint, so a stale
            // copy was being linted as if it were source: ~2700 files scanned, about half
            // of them duplicates, contributing 428 phantom `any` errors from code that
            // predates the ratchet. Their paths also dodge the ANY_HARDENED globs (anchored
            // at the repo root), so a worktree can never be hardened — only ignored. (S7)
            ".claude/",
            // Operator-run build/CI/deploy scripts (CommonJS, ~24.5k LOC over 75
            // files — measured; the comment used to announce "~5.6k LOC",
            // underestimated by a factor of 4.4).
            // Out of runtime
            // scope, not attacker-reachable: console.* output is their contract, and fs/regex
            // paths derive from __dirname literals + operator CLI args, so eslint-plugin-security
            // would only emit noise. Linting them needs a dedicated sourceType:"commonjs" +
            // heavily-relaxed override yielding ~0 real findings. Kept ignored — re-evaluate
            // only if a script ever handles untrusted input.
            //
            // The glob used to be `**/scripts/**/*.{cjs,js}`, and its comment named
            // "the stray plain-CJS .js maintenance scripts under
            // packages/core/scripts/". That directory was deleted — the repo's ONLY
            // package-level `scripts/` — so the glob's "package" half matched
            // nothing anymore and the comment had become false. Reduced to the
            // root.
            //
            // The `"scripts/**/*.{cjs,js}"` duplicate was removed in turn. It had
            // been kept "for the files", assuming `"scripts/"` only covered
            // directories. MEASURED: `npx eslint scripts/ci-local.cjs` → "File
            // ignored because of a matching ignore pattern" with the single
            // `"scripts/"` entry. The second pattern thus changed nothing, and its
            // justification described an ESLint behaviour that is not its own.
            // Demo extensions — explicitly non-production code
            // ("must NOT be deployed" / "browser-side scratch, NOT a production module").
            // Confirmed out of scope after audit.
            //
            // `"**/poc/"` removed in the same gesture: 0 `poc/` directories in the
            // repo. The comment covered both patterns, which made the dead one
            // indistinguishable from the live one — `**/demo/` does match
            // (`packages/plugins/connector/demo`).
            "**/demo/",
            // `**/sw-core.js` REMOVED from here. The pattern dated from a
            // two-tracked-copies era, one deleted (`1502ea18`) after measurement:
            // it was byte-identical to `dist/`. Only ONE remains, the source
            // `packages/core/src/kernel/storage/sw-core.js` (662 l.), shipped in
            // production (offline cache, IndexedDB, Background Sync) and until now
            // outside ESLint, outside `tsc` (`allowJs: false`) AND outside
            // `count-any` (`count-any.cjs` only collects `.ts`) — three nets,
            // none covered it.
            //
            // Measured before lifting the ignore: 0 errors, 0 warnings, 11
            // suppressions. Block 2's `browser` + `node` globals suffice
            // (`no-undef` = 0); `globals.serviceworker` is useless.
            //
            // ⚠️ Its head `/* eslint-disable no-console */` is NOT a dead directive
            // to purge: it is what suppresses the 11 hits. It was inert for lack
            // of being read, it becomes load-bearing. `reportUnusedDisableDirectives`
            // (block 9) now sees it, and sees it USED.
            //
            // The 5 artifact copies (`dist/`, the 4 `deploy/*/`) stay covered by
            // `**/dist/` and `deploy/` above — nothing to re-anchor.
            // Vitest/Jest mock files — intentionally loose
            "**/__mocks__/**",
        ],
    },

    // ── 1bis. ESLint core recommended — its OWN config object (Q1.1) ───────────
    // It used to be spread INSIDE block 2, on the same object literal as a `rules:`
    // key. `js.configs.recommended` is `{ name, rules }` and nothing else, so that
    // `rules:` key overwrote it whole: 63 of its 64 rules never reached the resolved
    // config. Measured before the fix with `--print-config`: 29 rules resolved on a
    // core `.ts` where spread ∪ block 2 should give 82. `no-unreachable`,
    // `no-dupe-keys`, `no-fallthrough`, `no-debugger`, `no-constant-binary-expression`,
    // `use-isnan`, `valid-typeof`, `no-unsafe-optional-chaining` were ABSENT — not
    // `off`, absent. Restoring it surfaced 26 real defects, 18 of them in shipped code.
    //
    // ⚠️ It must stay a SEPARATE object placed BEFORE block 2, and block 2 must keep
    // its own `rules:`. Merging the two back — for any reason — silently re-creates
    // the exact bug: later keys win per-object, and `recommended` carries only rules.
    //
    // Two of its rules are re-pointed downstream rather than kept as-is:
    //   • `no-undef` — off for `**/*.ts` (block 3, TypeScript already checks it);
    //     for `.js` it needs the runner globals declared in block 3quater.
    //   • `no-redeclare` — off for `**/*.ts`, substituted by the TS-aware version
    //     (block 3), which understands overload sets.
    { files: ["**/*.{js,mjs,cjs,ts}"], ...js.configs.recommended },

    // ── 2. Base JS config (all JS/TS files) ────────────────────────────────────
    {
        files: ["**/*.{js,mjs,cjs,ts}"],
        plugins: {
            security,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.es2021,
                ...globals.node,
                L: "readonly",
                GeoLeaf: "writable",
                vi: "readonly",
                // Page global published by the MapLibre GL UMD bundle. Same class as
                // `L` and `GeoLeaf` above: read inside `page.evaluate()` bodies, which
                // execute in the browser, not in Node. Needed since Q1.1 restored
                // `no-undef` for `.js` (it is `off` for `.ts`, block 3).
                maplibregl: "readonly",
            },
        },
        rules: {
            "no-var": "error",
            "prefer-const": "error",
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",
            "no-script-url": "error",
            // 🛑 MOTIVE REQUIRED by the standing guard-rail — "never take a
            // `security/*` rule to `warn`/`off` without a written justification
            // BESIDE the rule". This line was the repo's ONLY known breach of that
            // rule; the deliverable was this comment, not a fix.
            //
            // Two facts justify it, and neither is a preference:
            //   ① the rule is notoriously noisy on **configuration-object
            //      indexing** — the `config[key]` pattern is everywhere in this
            //      repo, and each legitimate occurrence would produce a
            //      suppression, hence noise that would end up masking a real
            //      signal;
            //   ② the class it targets is **already guarded elsewhere, and
            //      better**: `scripts/check-dynamic-key-writes.cjs` (wired into
            //      `ci:local` and the `pre-commit` hook) watches dynamic-key
            //      WRITES — prototype pollution — on a decreasing baseline.
            //
            // 🖐 The decision to TURN IT BACK ON belongs to Mattieu: it would first
            // require measuring what it reports today, then arbitrating
            // suppression by suppression. Writing the motive does not prejudge
            // that decision.
            "security/detect-object-injection": "off",
            "security/detect-non-literal-regexp": "warn",
            "security/detect-unsafe-regex": "error",
            "security/detect-buffer-noassert": "error",
            "security/detect-eval-with-expression": "error",
            "security/detect-no-csrf-before-method-override": "error",
            "security/detect-possible-timing-attacks": "warn",
            "no-console": ["warn", { allow: ["warn", "error", "info"] }],
            "no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            // Hard ceiling — S7 gate. B.6 resolved every function > 20 (max = 20),
            // so this is enforceable as an error and protects that invariant in CI
            // (`npm run lint` runs in 0-error mode). The informational warn-at-10 layer
            // is dropped; functions at 11–20 (backlog B.2) are tracked via the audit,
            // not the CI gate. The two logic-dense plugins (`offline-ui`, `addpoi`)
            // and the test files keep `complexity: off`.
            complexity: ["error", 20],
            // 4 → 5: depth-5 is acceptable for the data-processing code (offline
            // manifest enumeration, storage cleanup, geometry conversion). The one
            // egregious outlier (depth 8, cache/calculator) was flattened in code.
            "max-depth": ["warn", 5],
            // Soft target raised 50 → 100: 50 was too strict for this codebase's
            // style (setup/registration functions, linear DOM builders). Functions
            // above 100 (genuinely oversized) are still flagged and refactored.
            "max-lines-per-function": [
                "warn",
                { max: 100, skipBlankLines: true, skipComments: true },
            ],
            // `skipComments` aligned on `max-lines-per-function` above (2026-07-30).
            // The limit bounds the code's COMPLEXITY, not the documentation
            // volume — yet the ⛔ rule IMPOSES TSDoc, and without this flag the
            // only way to satisfy both rules at once was to split a file whose
            // code is 240 lines. Measured at the time of the change: 1 single
            // file of the repo exceeded 700 raw lines, and 0 files exceed 700
            // lines of real code — the guard thus guards exactly what it guarded,
            // and nothing less.
            "max-lines": ["error", { max: 700, skipComments: true, skipBlankLines: true }],
        },
    },

    // ── 3. TypeScript override ─────────────────────────────────────────────────
    {
        files: ["**/*.ts"],
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
            },
        },
        rules: {
            "no-unused-vars": "off",
            "no-undef": "off",
            // Q1.1 — `no-redeclare` arrives with the restored `js.configs.recommended`
            // spread (block 2). Its BASE version counts a TypeScript overload set as a
            // redeclaration: `domCreate` in `utils/general/dom-helpers.ts` has two
            // signatures + one implementation and scores 2 false positives. The
            // TS-aware version understands overloads. Substitute, never just disable —
            // the rule still catches genuine redeclarations.
            "no-redeclare": "off",
            "@typescript-eslint/no-redeclare": "error",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            // S7 (roadmap nettoyage) — `error` by DEFAULT, no longer "off".
            // The old comment claimed "2595 pre-existing instances": that number died with
            // the typage roadmaps. `npm run count:any` reports ONE `any` left in production
            // code (storage-contract DB, an eslint-disabled documented irreducible), and zero
            // across all 14 plugins. So this flip fixes no debt — production was already
            // clean, hardened glob by glob (blocks 6 / 6quater).
            //
            // What it actually buys: ANY_HARDENED and ANY_HARDENED_PLUGINS are HAND-MAINTAINED
            // lists, and `create:plugin` does not append to them. A new package therefore
            // landed OUTSIDE the ratchet and could reintroduce `any` silently. Defaulting to
            // error closes that hole: new code is hardened unless someone opts out on purpose.
            // Tests keep their exemption (block 4bis) — a deliberate, documented decision
            // (typing ratchet decision), not an oversight.
            "@typescript-eslint/no-explicit-any": "error",
        },
    },

    // ── 3bis. Type declaration files — lint for dead declarations only ──────────
    // Placed AFTER block 3 so its relaxations win (block 3's `**/*.ts` glob also
    // matches `*.d.ts`). Covers the 11 hand-written declarations left in the tree:
    // `core/src/global.d.ts` (the ambient `window.GeoLeaf` view) and 10 `css.d.ts`
    // module shims. ⚠️ It no longer covers a *published* surface: the root
    // `index.d.ts` was removed at ARCHI S6 — the published type contract is the
    // GENERATED `dist/types/`, which is not linted (it is an artifact) but IS
    // compiled by `typecheck:consumer` and checked by `verify-published-types.cjs`.
    // Audited & brought into scope: guards the type surface against orphan
    // declarations at near-zero noise. Size/complexity limits are meaningless for
    // declarations; unused-vars stays at warn (declared-but-unused ambient names are
    // expected) and honours the `^_` convention.
    {
        files: ["**/*.d.ts"],
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
            },
        },
        rules: {
            "max-lines": "off",
            "max-lines-per-function": "off",
            complexity: "off",
            "no-unused-vars": "off",
            "no-undef": "off",
            // Ambient `var` is the only way to declare a mutable global binding in a
            // declaration file (e.g. `declare global { var GeoLeaf: … }`). Standard
            // for .d.ts — TypeScript's own ambient decls use `var`.
            "no-var": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
        },
    },

    // ── 3ter. Web Worker source — provide worker globals ───────────────────────
    // Replaces the removed `/* eslint-env worker */` directive (unsupported in
    // flat config; reported as an error in ESLint 10). Merges worker globals
    // (self, postMessage, importScripts…) on top of blocks 2 & 3 — flat config
    // merges `languageOptions.globals` cumulatively across matching blocks.
    {
        files: ["**/geojson-worker.ts"],
        languageOptions: {
            globals: {
                ...globals.worker,
            },
        },
    },

    // ── 3ter bis. `sw-core.js` — the ONLY file of the repo that CANNOT be split ──
    //
    // 🛑 THIS IS NOT A COMFORT RELAXATION, AND THE MOTIVE IS VERIFIABLE. The
    // Service Worker is not bundled: `packages/core/rollup.config.mjs`
    // (`swCoreVersionPlugin`) reads it with `readFileSync`, replaces three tokens
    // in it, and emits it as an ASSET. No import is resolved in it, neither at
    // build nor at runtime — an `import` in this file would be served as-is to
    // the browser, in a context without bare-specifier resolution. The only way
    // to honour `max-lines: 700` there would thus be to DELETE behaviour, not
    // file it elsewhere. Exactly the case the limit is not made to arbitrate.
    //
    // The ceiling is RAISED, not removed: the pressure stays, and it will redden
    // again. Moved to 800 on 2026-08-07 (tile-cache bounding) — measured at 701
    // lines of real code right after, hence ~99 lines of margin and a guaranteed
    // next conversation.
    //
    // ⏳ WHAT WOULD LIFT THIS EXEMPTION: giving the worker a real bundling step (a
    // second Rollup entry point rather than an asset `emitFile`). That day, the
    // shared literals — `DATA_ORIGINS_KEY`, `TILE_BUDGET_KEY`, the tile ceiling —
    // stop being written twice, and their source guards become moot along with
    // this line.
    {
        files: ["packages/core/src/kernel/storage/sw-core.js"],
        rules: {
            "max-lines": ["error", { max: 800, skipComments: true, skipBlankLines: true }],
        },
    },

    // ── 3quater. Vitest globals for JS test files (Q1.1) ───────────────────────
    // Same mechanic as 3ter: `languageOptions.globals` merges cumulatively across
    // matching blocks. Required by the restored `no-undef` — the suites run under
    // `globals: true` (packages/core/vitest.config.ts), so `describe`/`it`/
    // `expect`/`beforeEach`… are ambient and would otherwise score 22 348 hits.
    // Block 2 declared `vi` by hand; `globals.vitest` supersedes that entry.
    //
    // ⚠️ Deliberately NOT applied to `e2e/**/*.js`, although block 4 below covers
    // both. Playwright specs IMPORT `test`/`expect` from `@playwright/test`;
    // declaring them ambient there would mask a real `no-undef` in e2e — which is
    // where the one genuine hit lives (`maplibregl`, 06-performance-baseline).
    //
    // `jest` is not a Vitest global. It is ambient only because two setup files alias
    // it (`packages/core/__tests__/setup.js` and
    // `packages/plugins/offline-ui/__tests__/setup.js` do `globalThis.jest = vi`).
    // The call sites and `__mocks__` depend on that shim, so the global is declared
    // here to match reality. Removing the shim is a separate chantier (backlog).
    // ⚠️ This comment used to cite a third site, `addpoi/__tests__/setup.js`, and
    // the counter-example of a mock that gave the WRONG reason for the shim. Both
    // left with the merged package — the rule's motive holds.
    {
        files: ["packages/**/__tests__/**/*.js", "packages/**/src/__tests__/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.vitest,
                jest: "readonly",
            },
        },
    },

    // ── 4. Test files (JS) override ────────────────────────────────────────────
    {
        files: [
            // Root `"__tests__/**/*.js"` removed: every test directory moved under
            // `packages/`, no `__tests__/` exists at the repo root anymore. A dead
            // `files:` glob is more dangerous than a dead `ignores:` one — it
            // stops applying rules instead of applying too many.
            "packages/**/__tests__/**/*.js",
            // Canonical test location (Plugin Contract v1 PC-09): tests under src/__tests__/.
            "packages/**/src/__tests__/**/*.js",
            "e2e/**/*.js",
        ],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
        },
        rules: {
            "no-eval": "off",
            "no-script-url": "off",
            "security/detect-eval-with-expression": "off",
            // Test fixtures/helpers use validation regexes on controlled inputs
            "security/detect-unsafe-regex": "off",
            // Dynamic RegExp built from controlled test/fixture strings — not attacker-reachable.
            "security/detect-non-literal-regexp": "off",
            // Tests & e2e legitimately log diagnostics and perf metrics.
            "no-console": "off",
            "no-unused-vars": "warn",
            "max-lines-per-function": "off",
            "max-lines": "off",
            "max-depth": "off",
            complexity: "off",
        },
    },

    // ── 4bis. Test files (TS) override ─────────────────────────────────────────
    // Same relaxation of size/complexity limits for `.ts` test files (long setup +
    // assertion blocks are expected). The base `no-unused-vars` stays OFF here
    // (kept off by block 3): it false-positives on identifiers in type positions
    // such as `(e: unknown) => void`. `@typescript-eslint/no-unused-vars` (block 3,
    // error) still flags genuinely dead test imports and variables.
    {
        // `"e2e/**/*.ts"` removed: `e2e/` carries 46 `.js` and 0 `.ts`.
        // ⚠️ `**/*.spec.ts` stays ABSENT from this glob while blocks 6/6bis/
        // 6quater/6quinquies exclude it explicitly — a real but inert asymmetry
        // (0 `.spec.ts` in the repo). Left in place on purpose: fixing it without
        // a witness file would lay an unverifiable glob, exactly the defect this
        // cleanup settles.
        files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
        rules: {
            "no-eval": "off",
            "no-script-url": "off",
            "security/detect-eval-with-expression": "off",
            // Test fixtures/helpers use validation regexes on controlled inputs
            "security/detect-unsafe-regex": "off",
            "security/detect-non-literal-regexp": "off",
            "no-console": "off",
            "max-lines-per-function": "off",
            "max-lines": "off",
            "max-depth": "off",
            complexity: "off",
            // Tests stay outside the hardened zone by decision. Blocks 6 and
            // 6quater already ignore them; since S7 made block 3 default to "error", the
            // exemption has to be restated HERE — this block runs after block 3, so it wins.
            // Test doubles legitimately type mock objects as `any`; forcing them into the
            // ratchet would mean ~291 rewrites and would reverse a decision already taken.
            "@typescript-eslint/no-explicit-any": "off",
        },
    },

    // ── 5. (removed) ───────────────────────────────────────────────────────────
    // `max-lines: "off"` block removed: its 5 entries were ALL stale.
    //   - `app/init.ts`, `geojson/popup-tooltip.ts`: no longer exist (init split
    //     into init-deferred-ui / init-feature-modules / init-reveal);
    //   - `built-in/permalink/permalink-manager.ts`: moved to
    //     `capabilities/permalink/` — the glob thus matched nothing anymore, and
    //     the file is 362 l.;
    //   - `geojson/core.ts` (413 l.) and `**/security/index.ts` (72 l.): far
    //     below the limit, the exemption protected them from nothing.
    // No file of `packages/core/src` reaches 700 lines — the CONCLUSION holds,
    // the two terms carrying it were false: the measured max is **673**
    // (`capabilities/toast-renderer/notifications.ts`), and the file previously
    // cited is **665**. Old wording: (max 667,
    // `adapters/maplibre/maplibre-style-converter.ts`). Deleting this block thus
    // TIGHTENS block 2's hard limit instead of loosening it: no file escapes it
    // anymore.
    //
    // Same class as the 4 ratchet globs purged at the top of the file, but benign
    // in this direction: an exemption that stops matching makes the rule
    // STRICTER. It is the inverse — a RESTRICTION that stops matching — that is
    // dangerous, and that is why `probe-gate-visibility.cjs` exists.

    // ── 6. Type-hardening ratchet — no-explicit-any elevated to error ─────────
    // Driven by ANY_HARDENED (top of file). MUST come after block 3 so it wins
    // over block 3's global "off" for no-explicit-any. The S7 type-aware block
    // (6bis) that follows only ADDS the no-unsafe-* family — it never touches
    // no-explicit-any, so this block stays authoritative for it.
    // A ratchet decision, recorded at lock time.
    {
        files: ANY_HARDENED,
        // Tests stay out of the hardened zone by decision. Core tests
        // live under packages/core/__tests__/ (outside src/), so these globs already
        // miss them; the ignores are a defensive guard for any future co-located test.
        ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
        },
    },

    // ── 6bis. Type-aware gate — no-unsafe-* on core/src (S7) ──────────────────
    // Catches "de-facto any": values typed `any`/`error` at runtime and
    // propagated by `as unknown as X`, JSON.parse / res.json(), or loose
    // namespace members (`getGeoLeaf()?.X`) — which `no-explicit-any` cannot
    // see. These rules are TYPE-AWARE, so this block opts into the TS project
    // service. Scoped to `packages/core/src` ONLY (tests + `.d.ts` excluded) so
    // the type-checking cost stays confined and plugins/tests remain
    // non-type-aware. Placed after block 6: it only adds the no-unsafe-* family,
    // never altering no-explicit-any. Ratchet phase (warn → error) tracked in
    // a recorded ratchet decision.
    {
        files: ["packages/core/src/**/*.ts"],
        ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "error",
            "@typescript-eslint/no-unsafe-member-access": "error",
            "@typescript-eslint/no-unsafe-call": "error",
            "@typescript-eslint/no-unsafe-argument": "error",
            "@typescript-eslint/no-unsafe-return": "error",
            // Q1.4 — promise family. Same type-aware perimeter, no extra infrastructure:
            // `projectService` is already on above. On a stack with an ORDERED boot
            // sequence (B1→B11), tile loading, IndexedDB and a Service Worker, an
            // un-awaited promise swallows its rejection and desynchronises init — the
            // failure mode is silent, which is exactly why a rule is worth more than a
            // review here. Measured on the day it was posed: 23 floating + 6 misused in
            // core, 0 await-thenable.
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/await-thenable": "error",
        },
    },

    // ── 6ter (a). Kernel layering boundary — modules/ ⊄ app/ (KERNEL S14) ─────
    // See KERNEL_APP_BOUNDARY above for the rationale and the flat-config caveat.
    {
        files: [
            // ⚠️ 2026-07-24 — `modules/**` was split into four roots. Left as-is,
            // this glob would have covered **zero files** and the boundary would
            // have fallen IN SILENCE, with no gate turning red.
            "packages/core/src/api/**/*.ts",
            "packages/core/src/globals/**/*.ts",
            "packages/core/src/kernel/**/*.ts",
            "packages/core/src/utils/**/*.ts",
        ],
        rules: {
            "no-restricted-imports": ["error", { patterns: [KERNEL_APP_BOUNDARY] }],
        },
    },

    // ── 6ter. UI mobile/desktop boundary (archi backlog B.4) ─────────────────
    // The mobile toolbar (ui/mobile/) and the desktop panel (ui/desktop/) are
    // independent surfaces that must NOT import each other — shared logic belongs
    // in ui/ root (filter-panel, content-builder, notifications, theme…). Any
    // cross-platform wiring (e.g. the theme toggle injected into the mobile DOM)
    // is done via shared helpers + DOM, never a direct mobile↔desktop import.
    {
        files: ["packages/core/src/kernel/ui/mobile/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/ui/desktop/**", "**/desktop/desktop-panel*"],
                            message:
                                "ui/mobile must not import ui/desktop — put shared logic in ui/ root (archi B.4 boundary).",
                        },
                        // Re-included: this block lives under modules/ and would otherwise
                        // override block 6ter (a). See KERNEL_APP_BOUNDARY.
                        KERNEL_APP_BOUNDARY,
                    ],
                },
            ],
        },
    },
    {
        files: ["packages/core/src/kernel/ui/desktop/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/ui/mobile/**", "**/mobile/mobile-toolbar*"],
                            message:
                                "ui/desktop must not import ui/mobile — put shared logic in ui/ root (archi B.4 boundary).",
                        },
                        // Re-included: this block lives under modules/ and would otherwise
                        // override block 6ter (a). See KERNEL_APP_BOUNDARY.
                        KERNEL_APP_BOUNDARY,
                    ],
                },
            ],
        },
    },

    // ── 6ter bis. Engine boundary — no VALUE import of maplibre-gl (socle S4) ─
    // The MapLibre engine is reached only through the adapter (adapters/maplibre/)
    // and the injected `maplibregl` global (global.d.ts). A *value* import of
    // "maplibre-gl" anywhere else would pull the engine into the CDN bundle and
    // bypass IMapAdapter. Type-only imports are erased (harmless) and stay allowed
    // everywhere — see basemaps-types.ts, which re-exports MaplibreMap type-only.
    // Uses the @typescript-eslint extension for its `allowTypeImports` option; the
    // base no-restricted-imports rule is also posed in blocks 6ter (a) and 6ter ter,
    // on unrelated specifiers, so there is no conflict / double-report.
    // (The wording used to say "ONLY active in block 6ter": false, it is set in
    // three places. The conclusion — no double-report — holds, resting on the
    // specifiers being disjoint, not on the block's uniqueness.)
    {
        files: ["packages/core/src/**/*.ts"],
        ignores: ["packages/core/src/adapters/maplibre/**"],
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["maplibre-gl", "maplibre-gl/*"],
                            allowTypeImports: true,
                            message:
                                "Only adapters/maplibre/** may value-import the engine. Elsewhere use IMapAdapter or the injected `maplibregl` global; type-only imports (`import type`) are allowed.",
                        },
                    ],
                },
            ],
        },
    },

    // ── 6ter ter. Capability → adapter boundary (socle B.1) ──────────────────
    // Capabilities describe WHAT to render; the MapLibre adapter decides HOW. A
    // capability importing adapters/maplibre/* couples an optional feature to the concrete
    // engine — a non-MapLibre engine would then require touching capabilities, not just the
    // adapter. Everything a capability needs is on IMapAdapter (contracts/map-adapter.contract)
    // or a neutral util. Uses the BASE rule (blocks value AND type imports) — a different rule
    // name from the @typescript-eslint one in "6ter bis", so both coexist on capability files.
    // 0 violations after the vector-tiles decouple + sprite/const relocation.
    {
        files: ["packages/core/src/capabilities/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/adapters/maplibre/**"],
                            message:
                                "capabilities/ must not import adapters/maplibre/* — go through IMapAdapter (contracts/map-adapter.contract) or a neutral util. The engine boundary is one-way (socle B.1).",
                        },
                        // ── Mirror of KERNEL_APP_BOUNDARY ───────────────────────────────
                        // `modules/ ⊄ app/` has been guarded for a while;
                        // `capabilities/ ⊄ app/` was not. The dependency runs
                        // app/ → capabilities/, never the reverse.
                        //
                        // ⚠️ This rule is ADDED TO THE EXISTING BLOCK, not laid in a
                        // new `capabilities/**` block. In flat config, a second
                        // block carrying `no-restricted-imports` on the same files
                        // OVERWRITES the first instead of merging (trap verified on
                        // the kernel, cf. the KERNEL_APP_BOUNDARY note): the engine
                        // boundary above would have vanished in silence.
                        //
                        // ✅ **The exception was settled on 2026-07-24.** It covered
                        // 13 capability `install.ts` importing their boot wrapper
                        // from `app/boot-modules/`. The 13 wrappers moved into
                        // their capability (`capabilities/<id>/module.ts`), so the
                        // exception fell **by construction** — exactly what the
                        // arbitration had ruled out in favour of the gate, and the
                        // completeness criterion it had set itself. Only the **6
                        // kernel wrappers** remain in `app/boot-modules/` (config,
                        // core-map, geojson, shared, theme-engine, ui), which no
                        // capability imports. **Zero `eslint-disable` on this
                        // rule.**
                        //
                        // ⚠️ Do not reopen an exception here: a capability that
                        // needs an `ICoreModule` lifecycle declares it at home, not
                        // in `app/`.
                        {
                            group: ["**/app/**"],
                            message:
                                "capabilities/ must not import app/ — the dependency runs app/ → capabilities/, never the reverse. Since R.10 there is NO exception: a capability that needs an ICoreModule lifecycle declares it in its own directory (capabilities/<id>/module.ts). Anything else must move to modules/ or go through a seam.",
                        },
                        // ── `capabilities/ → built-in/` goes through a mediator ────────────
                        // 55 edges measured on 07-24. The original statement said
                        // "55 bypass every barrel, 0 go through a facade": false
                        // for 17 of them, which already went through
                        // `config/config-primitives.js`, a 15-line re-export whose
                        // TSDoc says `RECOMMENDED USAGE`. The real deposit was 38,
                        // 25 of them value imports — now routed through a barrel.
                        //
                        // ⚠️ This group is ADDED TO THE EXISTING BLOCK, like the
                        // `app/` boundary above and for the same reason: in flat
                        // config, a second block carrying `no-restricted-imports`
                        // on the same files OVERWRITES the first instead of
                        // merging. The three boundaries (engine, app, built-in)
                        // must hold in this single block.
                        //
                        // Three routes stay open, all categories ALREADY named by
                        // the architecture — none is an escape invented for this
                        // gate:
                        //   • `*/index.js`           — the barrels (`security/index.ts` pattern)
                        //   • `*-types.js`           — the type hubs (ARCHITECTURE.md §Hubs)
                        //   • `*-seam.js`            — the seams (item-controls, desktop-tabs)
                        //   • `config-primitives.js` — the historical mediator, 17 edges
                        //
                        // ⚠️ Written as `regex` and NOT as a glob `group` — not a
                        // style preference, a correction. Measured on 07-24: in a
                        // `group`, a single-segment negation bites
                        // (`!**/kernel/*/index.js`) but the same at depth 2 does
                        // NOT (`!**/kernel/*/*/*-types.js`). The gate came out red
                        // on 8 perfectly legitimate imports — the 3 hubs and seams
                        // nested one level down (`config/geoleaf-config/config-types.js`,
                        // `geojson/loader/loader-types.js`,
                        // `ui/desktop/desktop-tabs-seam.js`). A glob that does not
                        // bite where believed is exactly the documented outage
                        // class: the rule looks laid, and it does not guard what it
                        // announces.
                        {
                            regex: String.raw`kernel/[^/]+/(?!index\.js$)(?!.*-types\.js$)(?!.*-seam\.js$)(?!config-primitives\.js$).+`,
                            message:
                                "capabilities/ must not reach deep into kernel/ — import the sub-directory barrel (e.g. kernel/geojson/index.js) instead. Type hubs (*-types.js), seams (*-seam.js) and config-primitives.js stay directly importable. If the symbol you need is not on the barrel, adding it there is the decision to make — widening the barrel is explicit, bypassing it is not (backlog R.8).",
                        },
                    ],
                },
            ],
        },
    },

    // ── 6ter quater. Physical constants owned by the kernel ────────────────────────
    // Three capabilities were re-routed onto a kernel primitive rather than
    // reimplementing its formula — legend → `taxonomy/resolver`, scale →
    // `scale-utils`, vector-tiles → the adapter — and a fourth later (proximity →
    // `utils/geo/haversine`). Nothing held them: `check-orphan-exports` and knip
    // look for an export WITHOUT a consumer, yet `scaleAtZoom` and
    // `resolveCategoryKey` also have callers internal to their own module. A
    // re-fork would leave them green.
    //
    // The real guard-rail is the `__tests__/capabilities/kernel-reuse.test.js`
    // test set, which computes each expected value WITH the kernel primitive: it
    // catches any numeric drift, however it is written. This block covers only
    // the crude case — the constant's literal copy-paste — but it flags it AT
    // WRITE TIME, with the name of the symbol to import, which a test does not.
    //
    // Precedent that justifies laying it: `print` USED TO CARRY four copies of
    // the Web Mercator constant, in its ROUNDED form `156543.04` — the one the
    // core got rid of. ⚠️ No longer true (measured since): they are consolidated
    // into a single export, `page-format.ts METERS_PER_PIXEL_AT_ZOOM_0`, and
    // the `file:line` cited here were stale by a factor of 1.3
    // (`modal-renderer.ts` never had 548 lines). The precedent stays valid as
    // HISTORY — the re-fork happened — but it no longer describes the repo's
    // state. The block stays scoped to the CORE.
    //
    // ⚠️ SEPARATE block, deliberately: it carries only `no-restricted-syntax`, a
    // rule key no other block uses. The flat-config trap documented in 6ter ter
    // plays PER RULE KEY, not per block — verified with `--print-config`, where
    // `no-restricted-imports` (6ter ter) and
    // `@typescript-eslint/no-restricted-imports` (6ter bis) already coexist on
    // the same file. Laying these selectors INSIDE 6ter ter would be the real
    // risk: the import boundaries would be touched for an unrelated reason.
    {
        files: ["packages/core/src/**/*.ts"],
        ignores: [
            // The two legitimate owners — this is where the constants live.
            "packages/core/src/utils/general/scale-utils.ts",
            "packages/core/src/utils/geo/haversine.ts",
        ],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector: "Literal[value=156543.03392]",
                    message:
                        "Constante Web Mercator (m/px au zoom 0) : importer `scaleAtZoom`/`zoomAtScale` depuis utils/general/scale-utils.js. La formule a UNE source de vérité depuis le S6.",
                },
                {
                    selector: "Literal[value=156543.04]",
                    message:
                        "Valeur ARRONDIE de la constante Web Mercator — c'est la copie dont le core s'est débarrassé au S6 (elle dérivait de l'exacte). Importer `scaleAtZoom`/`zoomAtScale` depuis utils/general/scale-utils.js.",
                },
                {
                    selector: "Literal[value=6371000]",
                    message:
                        "Rayon terrestre en mètres : importer `EARTH_RADIUS_M` depuis utils/geo/haversine.js — sans quoi le rendu et le prédicat qui filtre ne tiennent plus sur la même Terre (S10).",
                },
                {
                    selector: "Literal[value=6371008.8]",
                    message:
                        "Rayon terrestre IUGG : le kernel utilise la moyenne WGS-84 (`EARTH_RADIUS_M`, utils/geo/haversine.js). Deux rayons = deux frontières pour un même cercle (S10).",
                },
            ],
        },
    },

    // ── 6quater. Type-hardening ratchet — PLUGINS (no-explicit-any) ──────────
    // Driven by ANY_HARDENED_PLUGINS (top of file). Twin of block 6, scoped to
    // plugin packages, kept as a SEPARATE block + constant so it never shares a
    // git hunk with the core ratchet (blocks 6 / 6bis) — parallel branches extend
    // each list independently. Must come after block 3 (global no-explicit-any
    // "off") to win, and before block 7 (which only relaxes stylistic rules, never
    // no-explicit-any). Type-aware no-unsafe-* for plugins is deferred to S4.
    // A recorded plugin-ratchet decision.
    {
        files: ANY_HARDENED_PLUGINS,
        ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
        },
    },

    // ── 6quinquies. Type-aware gate — no-unsafe-* on hardened PLUGINS (S4) ────
    // Twin of block 6bis (core), scoped to ANY_HARDENED_PLUGINS. Catches the
    // "de-facto any" that no-explicit-any cannot see (values typed any at runtime
    // and propagated via `as unknown as X`, JSON.parse / res.json(), loose
    // namespace members). TYPE-AWARE → opts into the TS project service
    // (projectService resolves each plugin's own tsconfig.json — resolution
    // validated in S0, including the two logic-dense plugins whose sources carry
    // the most state and branches: `offline-ui` and `addpoi`). Kept as a
    // SEPARATE block + the shared ANY_HARDENED_PLUGINS constant (same zone rule as
    // 6quater) so it never shares a git hunk with the core gate. Phase: `error` for
    // EVERY hardened plugin, sans exception.
    //
    // ⚠️ This sentence used to announce "EXCEPT plugin-storage, whose
    // 68-violation residual is deferred (see the 6sexies carve-out just below)".
    // THREE false statements in a single sentence:
    //   1. the "6sexies" block never existed (grep `no-unsafe` → 6bis and
    //      6quinquies, and nothing else);
    //   2. `plugin-storage` no longer exists either — renamed `offline-ui`;
    //   3. the 68 violations are settled: `--print-config` on
    //      `plugins/offline-ui/src/entry.ts` resolves the 5 `no-unsafe-*` to
    //      `error`, and the lint is green.
    // The debt was paid, the comment carrying it stayed — and it described an
    // exemption the config no longer granted.
    {
        files: ANY_HARDENED_PLUGINS,
        ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "error",
            "@typescript-eslint/no-unsafe-member-access": "error",
            "@typescript-eslint/no-unsafe-call": "error",
            "@typescript-eslint/no-unsafe-argument": "error",
            "@typescript-eslint/no-unsafe-return": "error",
            // Q1.4 — promise family, twin of the core entry in block 6bis. Measured
            // when posed: 14 floating + 18 misused across the hardened plugins,
            // 0 await-thenable. Concentrated in `offline-ui` (cache UI + sync), which
            // is precisely the async-heaviest surface of the tree.
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/await-thenable": "error",
        },
    },

    // ── 7. Offline UI / AddPOI — relax stylistic rules (accepted patterns) ────
    // The exemption rests on the business logic's DENSITY in these two packages,
    // and nothing else: it does not distinguish them from the 11 other plugins by
    // nature, it observes that they carry more state and more branches. Two
    // guard-rails to keep in mind before widening it: it is nominative (it does
    // not follow a package that grows), and it is stylistic (no correctness rule
    // is disabled in it).
    {
        files: [pkgGlob("@geoleaf-plugins/offline-ui", "src/**")],
        rules: {
            // Complex business logic in this plugin — accepted as-is
            complexity: "off",
            "max-lines-per-function": "off",
            "max-depth": "off",
            "no-console": "off",
            // The cited motive named a "900-line" `sync-handler.ts` that did not
            // exist; the repo's only one was 444, and it left with the merged
            // `addpoi`. ⚠️ **The exemption stays, and its PERIMETER SHRANK**: it
            // now covers only `offline-ui`, whose `cache/` and `sync-manager.ts`
            // alone motivate it. Re-measure before renewing it.
            "max-lines": "off",
        },
    },

    // ── 8. View-construction functions — max-lines-per-function relaxed ─────────
    // Field-type renderers and modal/control factories build a cohesive DOM
    // subtree together with their private event handlers inline. Their length
    // reflects thorough encapsulation (many small private closures over shared
    // mutable state), not a function doing too much — splitting them into
    // state-objects/classes would add ceremony without improving clarity. Only
    // genuinely oversized *sequential* functions are refactored elsewhere; these
    // cohesive factories are kept intact (hybrid decision: refactor only where
    // splitting actually helps).
    {
        files: [
            pkgGlob("@geoleaf/field-renderer", "src/types/**/*.ts"),
            pkgGlob("@geoleaf/field-renderer", "src/ui/responsive-modal.ts"),
            pkgGlob("@geoleaf-plugins/connector", "src/login-ui.ts"),
            pkgGlob("@geoleaf-plugins/geocoding", "src/control.ts"),
            pkgGlob("@geoleaf-plugins/print", "src/emprise-selector.ts"),
            // `print/src/modal-renderer.ts` removed: the file is renamed
            // `modal-open.ts`, but the exemption was ALREADY inert — `openModal`
            // is 75 lines for a 100 ceiling. Re-targeting it would have frozen a
            // glob that disarms nothing; a `files` glob that no longer matches
            // reddens no gate anyway (ESLint does not warn on it).
        ],
        rules: {
            "max-lines-per-function": "off",
        },
    },

    // ── 9. Orphan disable directives are an error ──────────────────────────────
    // Renumbered 7 → 9 (CAPACITÉS B.31): this block shipped as a second "7",
    // straddling block 8, and the file is navigated by these ordinals. Blocks 7
    // (storage/addpoi relaxations) and 8 (view-construction) keep their numbers —
    // both are referenced as such from CHANGELOG.md.
    // A `eslint-disable` whose rule no longer fires is worse than noise: it reads as
    // "this code needs an exemption" long after it stopped being true, and the next
    // reader either trusts it or has to re-derive why it is there. The audit
    // found 0 orphans across the 15 disables of packages/core/src — this pins that.
    //
    // ESLint 9+/10 already defaults this to "warn" in flat config, which is why the
    // audit came back clean; making it explicit and blocking costs nothing today and
    // means a disable that outlives its rule fails the build instead of accumulating.
    //
    // Chosen over `eslint-plugin-eslint-comments`' `require-description`: that would
    // add a dependency AND fail immediately on the sites this sprint justified in
    // prose rather than in the `--` suffix. This rule needs neither.
    {
        linterOptions: {
            reportUnusedDisableDirectives: "error",
        },
    },

    // ── 10. `"use strict"` is dead weight in an ESM module (backlog B.4) ───────
    // Every workspace package declares `"type": "module"`, and an ES module is strict
    // by specification — the directive changes nothing at runtime. It is a leftover
    // from the pre-ESM sources, and 29 files under `src/` still carried one.
    //
    // A rule rather than a one-off purge, because a manual sweep only removes the
    // occurrences that exist today: the next file copied from an old one brings the
    // directive back and nothing objects. `strict: "never"` is auto-fixable, so the
    // purge IS the rule being applied once.
    //
    // Scope derived from the registry — never a hard-coded `packages/plugins/*` glob.
    // A path written by hand does not break when a package moves, it silently stops
    // matching, and the rule reports success having scanned nothing (the failure mode
    // `probe-gate-visibility.cjs` exists to catch).
    //
    // 🛑 **THE CORE WAS EXCLUDED, AND THAT IS WHAT DROVE THE DEPOSIT TO 301.**
    // The filter said `.filter((p) => p.name !== "@geoleaf/core")`, **without a
    // written motive**. The rule thus purged 16 packages of 17, sparing precisely
    // the one carrying the most files. Result measured on 08-16: **301**
    // `"use strict"` under `packages/core/src`, against a handful elsewhere.
    //
    // ⚠️ And the mechanism sustained itself: **every new core file inherited the
    // directive by imitating its neighbours**, including one written that very
    // morning while settling another line
    // (`kernel/storage/eviction-notice.ts`). A deposit growing through mere
    // conformity to the neighbourhood does not shrink by waiting — it rises with
    // each batch.
    //
    // The glob targets only `**/*.ts`: `kernel/storage/sw-core.js`, copied as-is
    // into the deploy variants and therefore NOT an ES module, legitimately keeps
    // its own.
    //
    // 🛑 **AND `geojson-worker.ts` IS THE SAME CASE, despite its extension.** It
    // is `.ts`, so the glob caught it — but it is never consumed as a module:
    // `rollup.config.mjs` emits it as a CLASSIC SCRIPT for a Web Worker. Its
    // directive is not dead weight, it is load-bearing.
    //
    // ⚠️ **The removal came out GREEN at lint, typecheck and across 10,854
    // tests** — `LIC-HEADERS/LIC-04` is what caught it, and through a seemingly
    // unrelated symptom: deprived of the source's directive, the transpiler
    // re-injects one **before** the licence banner, which stops being at the head
    // of the shipped file. A file whose nature differs from its extension shows
    // neither at type nor at test — only in what it becomes once built.
    {
        files: registry.all().map((p) => `${p.dir}/src/**/*.ts`),
        ignores: ["**/geojson-worker.ts"],
        rules: {
            strict: ["error", "never"],
        },
    },
    // ── `scripts/` CommonJS tooling ────────────────────────────────────────────
    //
    // 🛑 THIS DIRECTORY WAS NEVER LINTED. `"scripts/"` sat in the global
    // `ignores`: `isPathIgnored()` returned `true` for the 134 files, ~50,000
    // LOC — including EVERY GATE OF THE REPO. The tooling guarding the code was
    // the only corpus nothing guarded.
    //
    // ⚠️ Placed AT THE END OF THE ARRAY, and that is not cosmetic: in flat
    // config, the last matching block wins. Laid higher, its relaxations were
    // overwritten by the base block — measured, 836 `no-console` warnings of pure
    // noise.
    //
    // The relaxations, and their motive — each measured, none precautionary:
    //   · `no-console` — console output IS these scripts' contract, not an
    //     oversight;
    //   · the SIZE limits (`max-lines`, `complexity`, `max-depth`,
    //     `max-lines-per-function`) — a gate is a linear sweep with its branches;
    //     fragmenting them to satisfy a threshold would make the perimeter harder
    //     to read, precisely the defect these gates exist to find;
    //   · `security/detect-non-literal-fs-filename` and
    //     `detect-non-literal-regexp` — their paths derive from `__dirname`
    //     literals and operator CLI arguments, never untrusted input.
    //
    // 🛑 WHAT IS NOT RELAXED, DELIBERATELY: `no-eval`, `no-implied-eval`,
    // `no-new-func`, `no-script-url` and `security/detect-unsafe-regex` stay at
    // `error`. The standing guard-rail forbids lowering them without a written
    // motive beside the rule.
    //
    // ⚠️ The first run found **19** (18 `detect-unsafe-regex`, 1 `no-new-func`),
    // and the temptation was to silence them here — the original exclusion
    // comment already pleaded that these scripts "are not attacker-reachable".
    // **True today and not a stable property**: their regexes bite on repo file
    // names, and the repo has been public since 08-12 — a PR suffices to propose
    // one. The 18 thus go as SUPPRESSIONS, a debt that can only shrink, and not
    // as `off`, which would be a permanent permission. The single `no-new-func`
    // is handled by a LOCAL derogation with its written motive
    // (`probe-boot-contract.mjs`).
    // ⚠️ TWO blocks and not one: `scripts/` carries 119 CommonJS files and 15 ESM
    // (`.mjs`, the recent tooling). A single `sourceType` would make the parser
    // fail on one of the two halves — and a file that does not parse is not
    // linted, it is SKIPPED. The relaxations are identical; only the module mode
    // changes.
    {
        files: ["scripts/**/*.{cjs,js}"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: { ...globals.node },
        },
        rules: {
            "no-console": "off",
            "max-lines": "off",
            "max-lines-per-function": "off",
            "max-depth": "off",
            complexity: "off",
            "security/detect-non-literal-fs-filename": "off",
            "security/detect-non-literal-regexp": "off",
            // Motive: see the main security-rules block, higher in this file —
            // same reason (the rule is noisy on configuration-object indexing, and
            // the targeted class is guarded elsewhere and better), same decision.
            "security/detect-object-injection": "off",
        },
    },
    {
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: { ...globals.node },
        },
        rules: {
            "no-console": "off",
            "max-lines": "off",
            "max-lines-per-function": "off",
            "max-depth": "off",
            complexity: "off",
            "security/detect-non-literal-fs-filename": "off",
            "security/detect-non-literal-regexp": "off",
            // Motive: see the main security-rules block, higher in this file —
            // same reason (the rule is noisy on configuration-object indexing, and
            // the targeted class is guarded elsewhere and better), same decision.
            "security/detect-object-injection": "off",
        },
    },
];
