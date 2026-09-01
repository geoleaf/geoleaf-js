/**
 * Knip configuration — workspace keys DERIVED, per-package options declared.
 *
 * Replaces `knip.json`. The JSON form spelled out 19 workspace paths
 * by hand, and two of them — `packages/plugin-taxonomy` and
 * `packages/plugin-feature-info` — had pointed at directories deleted months
 * earlier (reclassified into `@geoleaf/core`, SR0). Knip silently ignores a
 * workspace key that matches nothing, so the rot was invisible: the config looked
 * maintained and audited two packages fewer than the repo contains.
 *
 * Two changes make that class of bug impossible rather than merely fixed:
 *
 *   1. **Keys are derived** from `package.json#workspaces` via
 *      `scripts/lib/packages.cjs`. They cannot name a package that is not there,
 *      and they follow ARCHI S10 moving plugins under `packages/plugins/` for free.
 *   2. **Options are keyed by npm NAME**, not by path — a name survives the move —
 *      and an option block naming an unknown package THROWS. A stale entry now
 *      fails the run instead of being ignored.
 *
 * The per-package options below are genuine configuration (differing entry points
 * and dependency exemptions), not duplication, so they stay written out.
 *
 * A third guard was added once the cost of NOT having it was measured — see
 * `assertNoShadowingConfig()` below.
 */

"use strict";

import fs from "node:fs";
import path from "node:path";

import registry from "./scripts/lib/packages.cjs";

/**
 * Options shared by every plugin that only exposes `src/entry.ts`.
 *
 * ⚠️ `ignoreDependencies: ["@geoleaf/core"]` holds ONLY for plugins that declare
 * the core as a dependency without importing anything from it — they reach it
 * through the `window.GeoLeaf` global, which knip cannot link to the package.
 * The 7 plugins that now import a published type (`GeoLeafRawEventMap`) no
 * longer need it and remove it explicitly below: `check-dead-code.cjs` fails on
 * a config entry that no longer matches, precisely so a suppression does not
 * outlive its motive.
 */
const PLUGIN_BASE = {
    // No `entry`. `src/entry.ts` was declared here until the knip 6 bump (26/07/2026),
    // which flagged it redundant for all 13 plugins at once: knip's own default entry
    // patterns already cover it. Declaring it again is the same class of lie this file
    // exists to prevent — a config entry that describes work knip does anyway.
    project: ["src/**/*.ts"],
    ignoreDependencies: ["@geoleaf/core"],
};

/**
 * Options shared by plugins that also expose a public API and i18n dictionaries.
 *
 * `src/entry.ts` is NOT listed — see `PLUGIN_BASE`. The other two are not covered by
 * knip's defaults and must stay: `public-api.ts` is a root nothing imports, and the
 * `lang/*.ts` dictionaries are reached by dynamic key.
 */
const PLUGIN_WITH_API = {
    entry: ["src/public-api.ts", "src/lang/*.ts"],
    project: ["src/**/*.ts"],
    ignoreDependencies: ["@geoleaf/core"],
};

/** Same base, for plugins that really import `@geoleaf/core`. */
const PLUGIN_BASE_IMPORTS_CORE = { ...PLUGIN_BASE, ignoreDependencies: [] };
const PLUGIN_WITH_API_IMPORTS_CORE = { ...PLUGIN_WITH_API, ignoreDependencies: [] };

/**
 * Options shared by the internal libraries (no `register()`, plain index entry).
 *
 * No `entry`: knip already derives one from `package.json#main`, and for
 * `host-runtime` (`main: dist/index.js`) it resolves straight back to
 * `src/index.ts` — spelling it out was redundant, and knip said so.
 *
 * ⚠️ The exemption `field-renderer` used to carry here is GONE. This comment claimed it
 * needed `entry: ["src/index.ts"]` declared because its `main` is
 * `dist/geoleaf-field-renderer.js`, which maps to no source file by name. Under knip 6
 * (2026-07-26 bump) that declaration is flagged redundant like all the others, so the
 * derivation evidently no longer depends on the `main` filename. Removed, and re-measured
 * rather than reasoned about — the whole point of the blocking hints.
 */
const LIB_BASE = {
    project: ["src/**/*.ts"],
    ignoreDependencies: [],
};

/**
 * Per-package overrides, keyed by npm name.
 * A name absent from the workspace registry throws — see the assertion below.
 */
const BY_NAME = {
    "@geoleaf/core": {
        // Without `entry`, knip fell back on defaults that covered nothing useful
        // here. These six patterns are the package's real entry points: the
        // shipped entry, the kernel half, the boot's three side-effect sides, and
        // the capability installers (each is a root, none is imported by the
        // entry).
        entry: [
            "src/bundle-esm-entry.ts",
            "src/kernel-exports.ts",
            "src/globals/globals.ts",
            "src/app/app-namespace.ts",
            "src/app/boot-install.ts",
            "src/capabilities/*/install.ts",
        ],
        project: ["src/**/*.ts"],
        ignoreDependencies: ["eslint", "eslint-plugin-security", "tsx"],
    },

    // Plugins — entry only.
    // ⚠️ `paths` declared HERE, for the TESTS alone.
    //
    // The `@core/*` and `@core-offline/*` aliases lived in the tsconfig's
    // `paths`, where knip read them. They were removed from it: the SHIPPED code
    // has none left, and keeping them would have kept the core's sources in the
    // program, hence forbidden the `rootDir` that publishing the types requires.
    //
    // The TEST files keep 6 of them — resolved by the Vite aliases of
    // `vitest.config.ts`, which knip does not read. Without this declaration it
    // flags them "unlisted", which is accurate and useless: they are resolved,
    // just elsewhere.
    "@geoleaf-plugins/offline-ui": {
        ...PLUGIN_BASE_IMPORTS_CORE,
        paths: {
            "@core/*": ["../../core/src/kernel/*"],
            "@core-offline/*": ["../../core/src/capabilities/offline/*"],
        },
    },
    "@geoleaf-plugins/cog": PLUGIN_BASE,
    "@geoleaf-plugins/flatgeobuf": PLUGIN_BASE,
    "@geoleaf-plugins/file-import": {
        ...PLUGIN_BASE,
        ignoreDependencies: ["@geoleaf/core", "topojson-specification"],
    },
    "@geoleaf-plugins/geocoding": PLUGIN_BASE_IMPORTS_CORE,
    // `happy-dom` removed at the knip 6 bump: the exemption no longer matched
    // anything. Useful irony — knip is what DETECTED this undeclared dependency
    // in the first place (cf. the 07-22 CHANGELOG), and knip is what now flags
    // that the exemption has served its time.
    "@geoleaf-plugins/connector": PLUGIN_BASE,

    // Plugins — entry + public API (+ i18n).
    "@geoleaf-plugins/table": { ...PLUGIN_WITH_API_IMPORTS_CORE, ignore: ["**/__tests__/**"] },
    // `ignore: __tests__` removed at the knip 6 bump: it no longer matched
    // anything (blocking hint). Its namesakes on `addpoi`, `print` and `table`
    // still match — so this is not a global knip change, it is measure's test
    // perimeter that moved.
    "@geoleaf-plugins/measure": PLUGIN_WITH_API_IMPORTS_CORE,
    "@geoleaf-plugins/print": {
        ...PLUGIN_WITH_API_IMPORTS_CORE,
        ignore: ["**/__tests__/**"],
    },
    // `ignoreDependencies: ["geojson"]` removed on 2026-08-10: it silenced a
    // signal `@types/geojson` produced while undeclared. It has been declared in
    // `dependencies` (six published `.d.ts` depend on it), so knip no longer
    // flags it, so the silencer has nothing left to silence — and knip says so
    // itself (`knip-hint`). The entry vanishes WITH ITS SUBJECT, like the
    // SYNC-02 exemption before it.
    // ⚠️ Measured on both sides before removal: reintroducing `@types/geojson`
    // without this line → knip GREEN; removing it from the manifest → knip green
    // too. Only the "declared + silenced" combination is red. The removal
    // TIGHTENS the gate, it does not loosen it.
    "@geoleaf-plugins/editor": PLUGIN_WITH_API_IMPORTS_CORE,
    "@geoleaf-plugins/realtime-layer": {
        // `src/entry.ts` removed at the knip 6 bump — covered by the default patterns.
        entry: ["src/public-api.ts"],
        project: ["src/**/*.ts"],
        ignoreDependencies: ["@geoleaf/core"],
    },
    "@geoleaf-plugins/websocket": {
        // `src/entry.ts` removed at the knip 6 bump — covered by the default patterns.
        entry: ["src/public-api.ts"],
        project: ["src/**/*.ts"],
        ignoreDependencies: ["@geoleaf/core"],
    },
    "@geoleaf-plugins/position-share": PLUGIN_WITH_API,

    // The deployable application (T2). Its files are loaded by `index.html` through
    // `<script type="module">`, so nothing in the JS graph ever imports them — without
    // a declared entry knip falls back on its defaults, finds no root, and reports them
    // as unused files. Measured after the move: 1 new signal, on
    // `connector.local.example.js`. It is a TEMPLATE (copied to the git-ignored
    // `connector.local.js`), so it can only ever be a declared root — never an
    // `ignore`, which would hide a genuinely dead file. `project: ["*.js"]` bounds the
    // scan to the workspace root: `src/assets/` holds nothing but PNGs.
    //
    // `init.js` is NOT listed: knip's default entry patterns already cover it, and
    // declaring it again earned a "redundant entry pattern" hint the moment T2 landed.
    "@geoleaf/app": {
        entry: ["connector.local.example.js"],
        project: ["*.js"],
    },

    // Internal libraries.
    "@geoleaf/field-renderer": LIB_BASE,
    "@geoleaf/host-runtime": LIB_BASE,
};

// ─── Guard: no other knip config may exist ────────────────────────────────────

/**
 * Config files knip looks for, in ITS resolution order
 * (`node_modules/knip/dist/constants.js#KNIP_CONFIG_LOCATIONS`).
 * Everything before `knip.js` wins over this file.
 */
const CONFIG_LOCATIONS = [
    "knip.json",
    "knip.jsonc",
    ".knip.json",
    ".knip.jsonc",
    "knip.ts",
    "knip.js",
    "knip.config.ts",
    "knip.config.js",
];

/**
 * Fail on any knip config other than this one.
 *
 * Two distinct failure modes, both silent, both observed in this repo:
 *
 *   1. **A root config of higher priority masks this file.** Knip loads exactly ONE
 *      config, the first match in `CONFIG_LOCATIONS` (`util/create-options.js`).
 *      Re-introducing `knip.json` at the root would therefore disable every rule
 *      below — no warning, no diff in the output shape, just a different answer.
 *   2. **A per-package config that nothing reads.** `findFile()` is `join` + `isFile`:
 *      it does NOT walk up. A `knip.json` inside a package is only ever read when knip
 *      runs with that package as cwd. `packages/core/knip.json` lived like that for
 *      months — 20 `ignoreIssues` rules and 10 `ignoreDependencies` that the CI gate
 *      never applied, while reading as maintained configuration.
 *
 * The tell is identical in both cases: the config looks authoritative and isn't. So
 * this throws, like the stale-override check below and like `packages.cjs` itself.
 */
function assertNoShadowingConfig() {
    /** @type {string[]} */
    const offenders = [];

    for (const name of CONFIG_LOCATIONS) {
        if (name === "knip.js") continue; // this file
        if (fs.existsSync(path.join(registry.ROOT, name))) offenders.push(name);
    }

    for (const pkg of registry.all()) {
        for (const name of CONFIG_LOCATIONS) {
            if (fs.existsSync(path.join(pkg.absDir, name))) offenders.push(`${pkg.dir}/${name}`);
        }
    }

    if (offenders.length > 0) {
        throw new Error(
            `knip.js: ${offenders.length} competing knip config file(s) — ${offenders.join(", ")}. ` +
                `Knip loads a single config from its cwd and never walks up, so each of these ` +
                `either masks knip.js (root, higher priority) or is dead weight nothing reads ` +
                `(per-package). Delete them; this file is the only configuration.`
        );
    }
}

assertNoShadowingConfig();

// ─── Derive the workspace map ─────────────────────────────────────────────────

const packages = registry.all();
const known = new Set(packages.map((p) => p.name));

// A stale override is now a hard failure. This is exactly what the two dead
// `plugin-taxonomy` / `plugin-feature-info` keys did NOT do for months.
for (const name of Object.keys(BY_NAME)) {
    if (!known.has(name)) {
        throw new Error(
            `knip.js: options declared for "${name}", which is not a workspace package. ` +
                `Known: ${[...known].sort().join(", ")}`
        );
    }
}

/** @type {Record<string, object>} */
const workspaces = {
    ".": {
        // `"knip.js"` removed at the knip 6 bump: covered by the default patterns
        // (blocking hint). Its presence was inert anyway — 07-25 CHANGELOG: a
        // root config file is structurally unflaggable, since
        // `*.config.{cjs,mjs,js,ts}` already makes it an entry point.
        entry: ["scripts/**/*.{cjs,mjs,js}", "e2e/**/*.{js,cjs,mjs}", "*.config.{cjs,mjs,js,ts}"],
        project: ["scripts/**/*.{cjs,mjs,js}", "e2e/**/*.{js,cjs,mjs}"],
        ignoreDependencies: [
            "gtfs-realtime-bindings",
            "axe-core",
            "minimatch",
            "ajv",
            "ajv-formats",
            "flatbuffers",
            "flatgeobuf",
            "geojson-vt",
            "vt-pbf",
            "geotiff",
            "fflate",
            "http-server",
            // `lint-staged` removed at the knip 6 bump: the exemption no longer matched anything.
            "madge",
            "serve",
            // ⚠️ `typedoc` is `unlisted` like `sharp` below, for the inverse
            // reason: it IS declared, but at the right owner — a devDependency of
            // `packages/core`, which `gen-api-surface.cjs` resolves explicitly
            // (`require.resolve("typedoc", { paths: [CORE.absDir] })`, since
            // 2026-08-24 — the hard-coded physical path
            // `packages/core/node_modules/...` broke at the first clean `npm ci`,
            // which hoists the package to the root). Declaring it AT THE ROOT TOO
            // would create a second source for the same dependency — the exact
            // defect class of copied overrides
            // (cf. overrides-reference-direct.guard).
            "typedoc",
            // ⚠️ `sharp` is this list's only `unlisted` rather than `unused`:
            // `generate-pwa-icons.cjs` `require()`s it while NOTHING declares it,
            // and that is wanted. Taken out of devDependencies on 2026-08-09
            // because it made `npm ci` fail on EVERY Dependabot PR (its
            // `@img/sharp-wasm32` pulls `@emnapi/*`, which lockfile regeneration
            // does not hoist), and it carried a HIGH advisory (`<0.35.0`) for a
            // script wired into no gate. The `require` sits behind a `try/catch`
            // that prints the install command on demand.
            // 🛑 Removing this line "cleans" nothing: it would turn the gate red,
            // or push toward re-declaring `sharp` — which would reopen both
            // defects at once.
            "sharp",
            // ⚠️ THESE FIVE ARE IMPORTED BY NOTHING, AND THAT IS THEIR WHOLE
            // PURPOSE (2026-08-09).
            //
            // They are declared as devDependencies SOLELY to create a
            // NON-OPTIONAL edge from the root. Without it, they only exist in the
            // tree through `optional: true` chains (the
            // `@oxc-*/binding-wasm32-wasi` bindings and `@napi-rs/wasm-runtime`
            // for `@emnapi/*`; `@asamuzakjp/css-color` via happy-dom for the
            // `@csstools/*`), and Dependabot's lockfile regeneration RE-HOISTS
            // them elsewhere — measured: `@emnapi/*` moved under
            // `packages/build-config/node_modules/`. `npm ci` then no longer
            // finds them from the root and dies in EUSAGE before any gate. That
            // is what made EVERY Dependabot PR red, including those bumping a
            // single package.
            //
            // ⚠️ EMPIRICAL FIX, and it must be said: **112 root entries are
            // `optional: true` and only THESE FIVE fail**. The class is thus NOT
            // "optional root entry" — `dompurify`, `jsdom`, `undici` are too and
            // cross without breaking anything. What distinguishes them is not
            // characterised. The five measured are treated; no claim is made of
            // having closed the mechanism.
            //
            // 🛑 Their removal is not decided from "nobody imports them" — true
            // and beside the point. It is decided by watching a Dependabot PR's
            // colour.
            "@csstools/css-parser-algorithms",
            "@csstools/css-tokenizer",
            "@emnapi/core",
            "@emnapi/runtime",
            "@emnapi/wasi-threads",
        ],
    },
};

// A package with no declared options is not an error — it takes knip's defaults.
// A package that disappears from the registry simply stops being configured, which
// is correct: it no longer exists.
for (const pkg of packages) {
    const options = BY_NAME[pkg.name];
    if (options) workspaces[pkg.dir] = options;
}

// ─── Issue types: exports/types are OFF on the core, and only there ───────────

/**
 * Suppress the `exports` and `types` issue types under `packages/core/src/**`.
 *
 * ## Why, measured
 *
 * When the core entered knip's field of view at API S2.4b, it produced 160 signals in
 * one go. They were triaged one by one against the whole monorepo (API S2.4c):
 *
 *   | verdict                                        | count |
 *   | consumed by shipped code — knip false positive |  116  |
 *   | used inside its own file                       |   39  |
 *   | consumed by tests only                         |    3  |
 *   | already exempt with a written motive           |    1  |
 *   | **actionable dead code**                       |  **0** |
 *
 * The 116 are barrel semantics, not debt: a symbol re-exported through an `index.ts`
 * is reported twice — once at the barrel because consumers import the deep path, once
 * at the deep path because they import the barrel. 14 symbols accounted for 30 of the
 * baseline rows on their own (`ValidateUrlOptions` alone appeared 4 times).
 *
 * So this category cost 157 frozen baseline rows for zero findings, at a ~73 % false
 * positive rate — which is also the odds that any FUTURE alarm here would be wrong.
 * A tripwire that cries wolf three times out of four is not a tripwire.
 *
 * ## Why `ignoreIssues` and not `exclude`
 *
 * Root-level `exclude: ["exports","types"]` was measured too, and rejected: it blinds
 * the 13 plugins and 2 libs as well. They report nothing today because they are clean
 * — silent is not the same as absent, and the probes proved knip DOES see a
 * dead export in `packages/plugins/table` and `packages/libs/field-renderer`. Scoping
 * by path keeps that watch alive. It also leaves the `__tests__` ignore entries of
 * `measure`/`print`/`table` doing real work; under `exclude` all three went dead and
 * raised blocking config hints.
 *
 * (⚠️ Do not spell a `slash-star-star` glob inside this comment — the sequence closes
 * the block and the remainder parses as code. That is how the first draft of this
 * header failed, with `ERROR: __tests__ is not defined`.)
 *
 * ## What still covers the core's exports
 *
 * `scripts/check-orphan-exports.cjs`, and now alone. Its 74 baseline candidates were
 * measured on 25/07/2026 as 51 invisible to knip and 23 overlapping; after this scope
 * the overlap is 0 and it is the sole gate on that angle. It searches by token across
 * the whole repo — including the literal VALUES of string consts, registry keys and
 * event names — which is precisely the class an import graph cannot reach.
 *
 * ⚠️ Only `exports` and `types` are listed. `nsExports`, `nsTypes`, `enumMembers` and
 * `classMembers` produce no signal in this repo, so listing them would raise a config
 * hint. ⚠️ `files` is deliberately absent: the one real find of the whole exercise —
 * `packages/core/src/contracts/sidepanel-renderer.contract.ts` — is a
 * file-level signal and must keep being reported. Removing `files` too would turn this
 * gate into a dependency checker and drop the only genuine finding it ever made.
 *
 * ## The gate was SEEN red on this scope — 26/07/2026, re-run under knip 6.29.0
 *
 * A narrowed guard nobody watched fail guards nothing. Each probe was injected, the exit
 * code checked, then removed. Every row was re-run after the 6.29.0 bump, because the
 * bump changed the config materially and probes from the previous version prove nothing
 * about this one:
 *
 *   | probe                                                | `dead-code` | verdict |
 *   | orphan `src/__probe_dead_file.ts` in plugins/table   | exit 1      | `file` reported |
 *   | dead exported CONST in plugins/table/src/sort.ts     | exit 1      | `exports` reported — **plugins still watched** |
 *   | dead exported INTERFACE in the same file             | exit 1      | `types` reported — see below |
 *   | dead export in core/src/utils/general-utils.ts       | exit 0      | **silent — scope is bounded** |
 *   | `probe-dead-config-entry` in ignoreDependencies      | exit 1      | blocking hint, not baselineable |
 *   | dep `probe-unused-dep` in plugins/table/package.json | exit 1      | `dependencies` reported |
 *
 * Rows 2 and 4 are the pair that justifies `ignoreIssues` over `exclude`: the same dead
 * export is caught in a plugin and ignored in the core, which is exactly the asymmetry
 * intended. Row 3 is the control on `ignoreExportsUsedInFile` below — it proves that
 * setting suppresses types referenced INSIDE their own file, not types referenced
 * nowhere. Without that row, `interface: true` could have been silently disabling the
 * whole `types` category. To re-run, re-inject any row and check the exit code flips.
 */
const IGNORE_ISSUES = {
    "packages/core/src/**": ["exports", "types"],
};

/**
 * An exported `interface` or `type` referenced inside its own file is not dead.
 *
 * Added at the knip 6 bump (26/07/2026), which surfaced 18 unused exported types in the
 * PLUGINS that knip 5.85 did not report. Pre-flighted one by one before believing them,
 * and they are a single structural class — the declaration and its only reference sit in
 * the same file:
 *
 *   - `TableLayerConfig`  declared `table-types.ts`      → used `table-types.ts`
 *   - `HeartbeatConfig`   declared `config-schema.ts`    → used `config-schema.ts`
 *   - `JwtAuth`           declared `i-ws-transport.ts`   → used `i-ws-transport.ts`
 *
 * These are each plugin's published type surface: an integrator consumes them through the
 * shipped `.d.ts`, which no module graph can see. `JwtAuth` is worse still — the one
 * cross-file consumer, `config-schema.ts`, reaches it by inline
 * `import("./transports/i-ws-transport.js").JwtAuth`, a dynamic type import knip does not
 * resolve to a named import.
 *
 * This is the same bucket as the 39 "used inside its own file" verdicts of the core triage
 * (API S2.4c), so it gets the same answer — a stated rule about a structural property,
 * NOT 18 frozen baseline rows. A rule can be argued and re-measured; a baseline of
 * structural false positives just accumulates.
 *
 * ⚠️ Scoped to `interface` and `type` on purpose. Values (`function`, `class`, `enum`,
 * `member`) keep being reported: a dead exported FUNCTION referenced only by itself is a
 * genuine finding, and this repo has no measurement saying otherwise.
 */
const IGNORE_EXPORTS_USED_IN_FILE = {
    interface: true,
    type: true,
};

export default {
    workspaces,
    ignoreIssues: IGNORE_ISSUES,
    ignoreExportsUsedInFile: IGNORE_EXPORTS_USED_IN_FILE,
};
