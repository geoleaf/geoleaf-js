// rollup.config.mjs
// Official GeoLeaf build pipeline — v2.0.0 (MapLibre GL JS)
// ESM-only output (UMD removed).
// ⚠️ The motive written here said "MapLibre GL JS v5 is ESM-native": FALSE of v5
// (it declared `main: dist/maplibre-gl.js`, no `module` nor `exports` — a classic
// script), and it became TRUE with v6, genuinely ESM-only. The decision was good,
// its justification was not — same case as the kernel CDC's ADR-03.
//
// Outputs:
//   - geoleaf.esm.js   + dist/chunks/  (chunked ESM — CDN + bundlers) — the SHIPPED bundle
//   - dist/esm/         (preserveModules — granular tree-shaking for bundlers)
//
// This config builds the CORE, and nothing but the core. It used to also emit
// `dist/geoleaf-{storage,addpoi}.plugin.js` — a second, divergent build of two plugins that
// already build themselves in their own packages. Nobody consumed them: `build-deploy.cjs`
// copies the REAL artefacts from `packages/plugin-*/dist/`, and its `coreDistFiles` whitelist
// never even looked at them. They were pure liability:
//   - `files: ["dist/", …]` shipped ~660 KB of plugin code
//     inside the public `@geoleaf/core` npm package, to every integrator of the core;
//   - they were built with `postcss({ inject: true })`, i.e. the default `styleInject` helper
//     (a `<style>` element + textContent), so they violated the strict `style-src 'self'` CSP.
//     The B.7 fix (`cspStyleInject` → `adoptedStyleSheets`) had reached the 9 plugin packages
//     but never these two copies. The real artefacts contain zero `styleInject`.
// Deleting the two configs removes both problems at once. Do not bring them back: a plugin is
// built by its own package, once.
//
// Entry points:
//   - bundle-esm-entry.ts  — ~50 named exports + lazy chunks (the shipped bundle)
const INPUT_FILE_ESM = "src/bundle-esm-entry.ts"; // ESM only — all named exports

import { visualizer } from "rollup-plugin-visualizer";
import { minify } from "rollup-plugin-esbuild";
import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";
import postcss from "rollup-plugin-postcss";
import postcssImport from "postcss-import";
import istanbul from "rollup-plugin-istanbul";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { cspStyleInject } from "@geoleaf/build-config/csp-style-inject.mjs";
import { withStableChunkHash, licenseBanner } from "@geoleaf/build-config/rollup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * CSS — TWO strategies, one per delivery channel (S6). This is deliberate; do not "unify" it.
 *
 * Since S6 the CSS is part of the JS module graph (`install.ts` does `import "./css/<id>.css"`),
 * which is what makes it tree-shake with its capability. But the two channels want the result in
 * different shapes:
 *
 *   - **CDN / `<link>`** (`dist/geoleaf.esm.js`) → EXTRACT to a real `dist/geoleaf-main.min.css`.
 *     Same path, same name as the file `postcss-cli` used to produce, so `exports["./style.css"]`,
 *     the seven references in `build-deploy.cjs` and the service worker's STATIC_ASSETS are all
 *     unchanged. Not breaking. Inlining 127 KB of CSS into the CDN bundle would be a regression.
 *   - **Bundlers** (`dist/esm/`) → INJECT through `adoptedStyleSheets`. Emitting `import "./x.css"`
 *     statements into `dist/esm/**.js` instead would break `import "@geoleaf/core"` in every
 *     runtime without a CSS loader (Node, SSR, vitest in a node env) — and `.` resolves there.
 *     `cspStyleInject` is CSP-safe under the strict `style-src 'self'` (a `<style>` element would
 *     be blocked; a constructable stylesheet is not) — it is the B.7 fix, already used by 9
 *     packages. As a bonus, the CSS becomes a real module of the JS graph, so ONE oracle (the JS
 *     sourcemaps) covers both JS and CSS in the tree-shaking gates.
 *
 * `postcssImport()` is NOT optional in either: `geoleaf-main.css` is a tree of `@import … layer()`,
 * and `CSSStyleSheet.replaceSync()` rejects `@import` outright. Flatten first, always.
 */
// `withStableChunkHash`: rollup-plugin-postcss serialises a Map in its
// `augmentChunkHash`, hence in the CSS modules' transformation order — which is
// not stable. The core's 7 chunks changed name at EVERY build for byte-identical
// content. Detail in build-config/rollup.mjs.
const cssExtract = (outFile) =>
    withStableChunkHash(
        postcss({
            extract: path.resolve(__dirname, outFile),
            minimize: true,
            sourceMap: true,
            plugins: [postcssImport()],
        })
    );

const cssAdopt = () =>
    postcss({
        extract: false,
        inject: cspStyleInject,
        minimize: true,
        sourceMap: false,
        plugins: [postcssImport()],
    });

// E2E coverage instrumentation — enabled via COVERAGE=true env var
const COVERAGE = process.env.COVERAGE === "true";

/**
 * Pre-compile .ts files so Rollup receives JS (avoids "Expression expected" on `interface`).
 *
 * Exported and consumed by `rollup.consumer.mjs` ONLY — it is the reason that config can exist.
 * A pure `load` hook (ts.transpileModule, no `resolveId`), so `@rollup/plugin-node-resolve` keeps
 * ownership of every specifier and `package.json#sideEffects` is actually read. Swapping it for
 * `@rollup/plugin-typescript` there would silently turn the published-package witness into a
 * green gate that proves nothing — see the warning at the top of rollup.consumer.mjs.
 */
function pluginTsLoad(tsconfigPath) {
    const configPath = path.resolve(__dirname, tsconfigPath);
    return {
        name: "plugin-ts-load",
        load(id) {
            if (!id.endsWith(".ts") || id.includes("node_modules")) return null;
            const raw = fs.readFileSync(id, "utf-8");
            const config = ts.readConfigFile(configPath, (p) => fs.readFileSync(p, "utf-8"));
            if (config.error) return null;
            const parsed = ts.parseJsonConfigFileContent(
                config.config,
                ts.sys,
                path.dirname(configPath)
            );
            const out = ts.transpileModule(raw, {
                compilerOptions: { ...parsed.options, declaration: false, declarationMap: false },
                fileName: id,
            });
            return {
                code: out.outputText,
                map: out.sourceMapText ? JSON.parse(out.sourceMapText) : undefined,
            };
        },
    };
}

// Read version from package.json for dynamic injection
const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));

/**
 * Base Rollup configuration for GeoLeaf.
 * - external: MapLibre GL JS loaded as peer dependency.
 * - treeshake: aggressive configuration to eliminate dead code.
 */
const baseConfig = {
    input: INPUT_FILE_ESM,
    plugins: [
        // Build version injection — replaces __GEOLEAF_VERSION__ in JS sources
        replace({
            preventAssignment: true,
            values: {
                __GEOLEAF_VERSION__: JSON.stringify(pkg.version),
                __SW_DEBUG__: process.env.NODE_ENV !== "production" ? "true" : "false",
            },
        }),
        // TypeScript — before resolve/commonjs to process .ts files
        // noEmit: true — Rollup handles JS output; TS only type-checks (required by allowImportingTsExtensions)
        //
        // declaration/declarationDir MUST be neutralised (S6). Without them this plugin inherits
        // `declaration: true` + `declarationDir: "dist/types"` from tsconfig.json — whose `include`
        // covers `examples/**` and which has no `rootDir`. TS then computes the common source dir as
        // packages/core/ and writes a whole parasite tree into dist/types/src/** and
        // dist/types/examples/**, shadowing the real declarations. The .d.ts are the job of
        // `tsc -p tsconfig.declarations.json` (rootDir: "src"), and of nothing else.
        typescript({
            tsconfig: "./tsconfig.json",
            compilerOptions: { noEmit: true, declaration: false, declarationDir: undefined },
        }),
        // Node.js module resolution (when needed)
        resolve({
            browser: true,
            preferBuiltins: false,
            extensions: [".ts", ".js"],
        }),
        // CommonJS support (conversion to ESM)
        commonjs(),
        // Istanbul instrumentation for E2E coverage (COVERAGE=true)
        ...(COVERAGE
            ? [
                  istanbul({
                      // ⚠️ 2026-07-24 — `src/modules/**` was split into four roots.
                      // Left as-is, this glob would have stopped matching **in
                      // silence**: the E2E instrumentation would have covered
                      // `app/` alone and the coverage would have come out low with
                      // no error.
                      // ⚠️ `src/capabilities/**` was ADDED on 2026-08-19, and its
                      // absence was no earlier oversight: it predated the
                      // directory's existence. Its effect was measuring the boot
                      // on a denominator excluding half the code the boot
                      // executes — a high figure on a narrow perimeter, the most
                      // flattering form of a false measurement.
                      // 🛑 The widening MAKES THE PERCENTAGE DROP, and that is no
                      // regression: the denominator grows before the numerator.
                      // `nyc.config.cjs`'s thresholds were recalibrated in the
                      // same gesture, with this motive.
                      // 🛑 **`**/*.ts` and not `**`, and this is no precaution**:
                      // the five historical roots contain no `.css`,
                      // `capabilities/` contains eleven. An extension-less glob
                      // hands them to Babel for instrumentation, which parses
                      // them as JavaScript and throws — "Support for the
                      // experimental syntax 'decorators' isn't currently enabled"
                      // on a stylesheet's first brace. The build then fails
                      // ENTIRELY, and `build-deploy-coverage.cjs` gives up
                      // leaving the PREVIOUS deploy in place: whoever reads the
                      // figures without reading the exit code measures the old
                      // bundle believing they measure the new.
                      include: [
                          "src/api/**",
                          "src/capabilities/**/*.ts",
                          "src/globals/**",
                          "src/kernel/**",
                          "src/utils/**",
                          "src/app/**",
                      ],
                      exclude: ["**/*.test.*", "**/*.spec.*", "node_modules/**"],
                  }),
              ]
            : []),
        // File size reporter removed (rollup-plugin-filesize has vulnerable dependencies)
        // Use dist/stats.html (rollup-plugin-visualizer) for bundle analysis
    ],
    external: ["maplibre-gl"],

    // Tree-shaking — preserve all side-effects (app/*, globals.js, sw-register.js…)
    // ⚠️ Do not filter here: app/boot.js, globals/globals.js etc. are pure side-effect imports.
    // ⚠️ unknownGlobalSideEffects MUST be true: modules that mutate window.GeoLeaf via
    //    variables derived from globalThis (e.g. globals/globals.api.js → `_gl.init = …`, or
    //    kernel/ui/ui-api.js and kernel/storage/facade.js, which do `_g.GeoLeaf = _g.GeoLeaf || {}`)
    //    would be incorrectly eliminated if Rollup treats globalThis as a stateless local object.
    //    ⚠️ The example given here was `api/geoleaf-api.js → Object.assign` until socle-init 7.7
    //    removed that assignment. The FLAG is still required — roughly two dozen modules mutate
    //    the global this way — so it was re-exemplified rather than dropped.
    // Suppress TS5096: @rollup/plugin-typescript v12 fires this even when noEmit is set
    // because the check runs before compilerOptions overrides are applied.
    onwarn(warning, warn) {
        if (warning.plugin === "typescript" && warning.message.includes("TS5096")) return;
        // 🛑 A CIRCULAR CHUNK FAILS THE BUILD. It used to print and exit 0, and that cost a day.
        //
        // A chunk cycle lets one chunk's body run before another has finished initialising, so
        // any cross-chunk call made at IMPORT TIME lands in a temporal dead zone. That is not
        // theoretical: adding a single `utils/ → kernel/geojson/` import closed the cycle
        // `chunk-geojson -> chunk-core-utils -> chunk-geojson`, and the shipped bundle began
        // throwing `Cannot access '_teardowns' before initialization` on import — from
        // `kernel/geojson/shared.ts`'s top-level `registerLifecycleTeardown()`.
        //
        // ⚠️ Rollup printed that warning on every build of the broken tree, and exited 0. A
        // warning inside a hundred lines of build output, followed by a green exit code, is not
        // a signal. Three `ci:local` gates went red instead, all naming a file that had nothing
        // to do with the change — the diagnosis took far longer than the fix.
        //
        // ⚠️ Rollup gives this warning no `code`, so the message is the only handle, and a
        // reword upstream would silence this throw. `bundle-chunk-cycle.guard.test.js` therefore
        // asserts the same property on the built artefact, independently of Rollup's phrasing.
        // Neither guard replaces the other: this one stops the build, that one survives Rollup.
        if (/circular chunk/i.test(warning.message)) {
            throw new Error(
                `[rollup] ${warning.message}\n` +
                    `Fix the grouping in manualChunks — match the real import graph, not the ` +
                    `thematic directory name. The usual cause is a module in one chunk importing ` +
                    `a module in another that imports back; see the style-operators rule for the ` +
                    `worked example.`
            );
        }
        warn(warning);
    },
    treeshake: {
        moduleSideEffects: true,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
        unknownGlobalSideEffects: true,
        annotations: true,
    },
};

/**
 * ESM Bundle — primary output for CDN and bundlers (native import/export).
 * Tree-shaking + ~50 named exports + lazy chunks in dist/chunks/.
 * Entry: bundle-esm-entry.ts (populates window.GeoLeaf via globals.js side-effect).
 */
const esmConfig = {
    ...baseConfig,
    plugins: [
        ...(baseConfig.plugins || []),
        // CSS → a real file at the SAME path postcss-cli used to write (see the cssExtract comment).
        cssExtract("dist/geoleaf-main.min.css"),
        // Minify the CDN bundle (served directly to browsers). Restored after being
        // dropped in the v2.0.0 MapLibre build rework. Placed before visualizer so
        // dist/stats.html reports the real (minified) sizes. The granular dist/esm/
        // output stays unminified — bundlers minify it themselves.
        // ⚠️ `es2022` and not `es2015`: see the long motive at
        // `packages/build-config/rollup.mjs` — the previous target was justified by a
        // sentence this file and that one handed to each other. Measured, not inferred.
        minify({ target: "es2022", legalComments: "none" }),
        // Bundle analysis (treemap)
        visualizer({
            filename: "dist/stats.html",
            open: false,
            gzipSize: true,
            brotliSize: true,
            template: "treemap",
            title: "GeoLeaf ESM — Bundle Analysis",
            sourcemap: true,
        }),
        // Emit sw-core.js (lite SW) and geojson-worker.js as assets
        swCoreVersionPlugin(pkg.version),
        geojsonWorkerPlugin(pkg.version),
        // Licence notice at the head of EVERY shipped chunk (LIC-04). Set in
        // `generateBundle`, hence after `minify()` — an `output.banner` would be
        // deleted by `legalComments: "none"`, as it was at offline-ui's. ⚠️ It
        // does NOT touch the two assets emitted just above: `sw-core.js` and
        // `geojson-worker.js` are `type: "asset"`, not chunks, and carry their
        // banner from their SOURCE.
        licenseBanner(pkg),
    ],
    input: INPUT_FILE_ESM,
    // v2.0.0: ESM bundle serves as CDN entry point (replaces UMD).
    // All side-effects must be preserved (globals.js, app/*, config facades, etc.)
    // because modules mutate window.GeoLeaf.* at load time.
    // The granular esmGranularConfig (preserveModules) handles tree-shaking for bundlers.
    treeshake: baseConfig.treeshake,
    output: {
        dir: "dist",
        format: "es",
        entryFileNames: "geoleaf.esm.js",
        chunkFileNames: "chunks/geoleaf-[name]-[hash].js",
        sourcemap: true,
        // The sources already travel in `src/` (files[]): embedding them a
        // SECOND time in the map is pure duplication.
        sourcemapExcludeSources: true,
        exports: "named",
        // PERF-01: thematic manualChunks to avoid combinatorial explosion.
        // Without grouping, Rollup creates one chunk per unique dependency combination
        // between the ~12 dynamic imports → 300+ duplicated chunks.
        // With thematic grouping → ~15 stable reusable chunks.
        manualChunks(id) {
            const norm = id.replace(/\\/g, "/");

            // (S5) The `/src/lazy/` rule is gone with `src/lazy/` itself. It named a chunk per
            // lazy entry point; by S4 the two survivors were re-export shells over eager code, so
            // Rollup emitted them EMPTY ("Generated empty chunks: lazy/basemap-selector, ...").

            // Thematic groups — keep related modules in one stable chunk.
            // Legend + Themes + Layer-manager — ONE chunk (chunk-ui-controls). These three
            // eager-at-boot control surfaces mutually import (the legend reads layer state, the
            // layer-manager renders the legend, the theme engine repaints both), so slicing them
            // into three chunks produced a chunk-level import cycle (rollup "Circular chunk")
            // with NO module-level cycle (madge = 0). Merging matches the real import graph and
            // clears the warnings; the boot payload is unchanged — all three were already in the
            // eager boot closure.
            if (
                norm.includes("/capabilities/legend/") ||
                norm.includes("/api/geoleaf.legend") ||
                norm.includes("/kernel/themes/") ||
                norm.includes("/api/geoleaf.themes") ||
                norm.includes("/capabilities/theme-selector/") ||
                norm.includes("/kernel/layer-manager/") ||
                norm.includes("/kernel/basemaps/") ||
                norm.includes("/api/geoleaf.layer-manager") ||
                norm.includes("/api/geoleaf.baselayers")
            ) {
                return "chunk-ui-controls";
            }
            // `chunk-poi` and `chunk-table` REMOVED: they were never emitted, and
            // the bundle map lied by two entries. Measured — no `chunk-poi*` nor
            // `chunk-table*` in `dist/`, and the patterns can NOT match:
            // `src/kernel/poi/` and `src/modules/optional/` do not exist, there
            // is no `api/geoleaf.table.ts`, and the last `contracts/poi*` — the
            // AddForm seam contract — left with the merged package. ⚠️ They were
            // dead INDEPENDENTLY of the merge: the merge did not kill them, it
            // provided the occasion.
            // Labels — MELTED into chunk-ui-controls.
            //
            // 🛑 Same remedy as the legend↔layers↔themes trio above, for the same
            // measured reason: `chunk-labels -> chunk-ui-controls ->
            // chunk-labels`. The labels import a symbol from the controls, and
            // the controls carry a side-effect `import` toward the labels — the
            // layer-manager paints the label buttons, the theme applier
            // re-initialises them. The edge exists both ways because the real
            // graph is mutual; splitting them named a theme, not a boundary.
            //
            // ⚠️ The cycle showed ONLY in the instrumented build
            // (`COVERAGE=true`): istanbul makes every module a side-effect
            // carrier, so Rollup keeps the bare import the normal build prunes.
            // It had been there a while, silent — Rollup printed it and exited 0,
            // exactly like the cycle that once cost a whole diagnosis.
            //
            // ⚠️ The payload does not move: both chunks were already in the
            // boot's eager closure. What changes is one request fewer, and a
            // simple invariant — no cycle, in any build variant.
            // (Themes + Layer-manager are folded into chunk-ui-controls above,
            // to break the legend↔layers↔themes chunk cycle.)
            // 🛑 `style-operators.ts` LIVES WITH `utils/`, NOT WITH ITS DIRECTORY — and the rule
            // must stay ABOVE the `/kernel/geojson/` one below, which would otherwise claim it.
            //
            // It is a leaf table of comparison operators that imports nothing, and it has two
            // kinds of consumer: the geojson style resolver (same directory) and
            // `utils/validators/style-validator-rules.ts`, which validates the rules that use
            // them. Leaving it in chunk-geojson makes that second consumer an edge
            // core-utils → geojson, which closes `chunk-geojson -> chunk-core-utils ->
            // chunk-geojson`. Rollup then evaluates one chunk's body before the other finished,
            // and `kernel/geojson/shared.ts`'s import-time `registerLifecycleTeardown()` call
            // lands in a temporal dead zone: the shipped bundle throws on import.
            //
            // ⚠️ Measured, not assumed: with this rule removed the cycle returns, and with it the
            // build fails via `onwarn`. Hosting the table where its non-geojson consumer already
            // lives costs nothing — it imports nothing, so it drags nothing with it.
            if (norm.includes("/kernel/geojson/style-operators")) {
                return "chunk-core-utils";
            }
            // GeoJSON processing (loader, clustering, style-utils, geojson-types) + the
            // `vector-tiles` capability (S5), which is the MVT branch of that same layer-loading
            // path. Grouping it here keeps the shipped bundle's chunk count stable; in an entry
            // that leaves the capability out, Rollup simply never reaches these modules.
            if (
                norm.includes("/kernel/geojson/") ||
                norm.includes("/api/geoleaf.geojson") ||
                norm.includes("/capabilities/vector-tiles/")
            ) {
                return "chunk-geojson";
            }
            // Core shared utilities (log, utils, config, constants, errors, security)
            // Referenced by almost everything — placed in a single shared chunk
            // so lazy chunks don't need to re-emit them.
            if (
                norm.includes("/utils/") ||
                norm.includes("/kernel/config/") ||
                norm.includes("/kernel/security/")
            ) {
                return "chunk-core-utils";
            }
        },
    },
};

// UMD builds removed in v2.0.0. (The original motive invoked an "ESM-native" v5
// that was not; v6 is — see this file's header.)
// CDN usage: <script type="module" src="dist/geoleaf.esm.js"></script>

/**
 * Custom Rollup plugin — Service Worker Core (lite) version injection.
 * Emits dist/sw-core.js for the open-source/free bundle.
 * Provides basic offline caching (Cache API only, no IndexedDB/sync).
 * Attached to the ESM build (core production).
 */
function swCoreVersionPlugin(version) {
    const SW_CORE_SOURCE = "src/kernel/storage/sw-core.js";
    return {
        name: "sw-core-version-inject",
        generateBundle() {
            if (!fs.existsSync(SW_CORE_SOURCE)) return;
            const swDebug = process.env.NODE_ENV !== "production" ? "true" : "false";
            const content = fs
                .readFileSync(SW_CORE_SOURCE, "utf-8")
                .replaceAll("__GEOLEAF_VERSION__", version)
                .replaceAll("__SW_DEBUG__", swDebug);
            this.emitFile({
                type: "asset",
                fileName: "sw-core.js",
                source: content,
            });
        },
        // (T2) The `writeBundle` hook that copied dist/sw-core.js back to the package root
        // is gone. It existed "for local dev serving" — so that serving packages/core/
        // directly would let `navigator.serviceWorker.register("sw-core.js")` resolve. That
        // need died with the app's move to apps/geoleaf-app/: dev serving now goes through
        // deploy/, where build-deploy.cjs already places sw-core.js beside index.html.
        //
        // Nothing in the toolchain read the root copy (measured): build-deploy.cjs reads
        // DIST/sw-core.js, `sw-register.ts` treats "sw-core.js" as an HTTP path, not a
        // disk one, and index.html never referenced it. The SOURCE stays
        // src/kernel/storage/sw-core.js and the published output stays dist/sw-core.js
        // (emitted by generateBundle above) — nothing changes for npm consumers.
    };
}

/**
 * Custom Rollup plugin — GeoJSON Web Worker asset emission.
 * Emits dist/geojson-worker.js for off-thread GeoJSON parsing.
 * Attached to the core build so it’s always available.
 */
function geojsonWorkerPlugin(version) {
    const WORKER_TS = path.resolve(__dirname, "src/kernel/geojson/geojson-worker.ts");
    const WORKER_JS = path.resolve(__dirname, "src/kernel/geojson/geojson-worker.js");
    return {
        name: "geojson-worker-emit",
        generateBundle() {
            const workerPath = fs.existsSync(WORKER_TS)
                ? WORKER_TS
                : fs.existsSync(WORKER_JS)
                  ? WORKER_JS
                  : null;
            if (!workerPath) return;
            let content = fs.readFileSync(workerPath, "utf-8");
            if (workerPath.endsWith(".ts")) {
                const out = ts.transpileModule(content, {
                    compilerOptions: {
                        target: ts.ScriptTarget.ES2020,
                        module: ts.ModuleKind.ESNext,
                        strict: true,
                    },
                    fileName: "geojson-worker.ts",
                });
                content = out.outputText;
            }
            content = content.replaceAll("__GEOLEAF_VERSION__", version);
            this.emitFile({
                type: "asset",
                fileName: "geojson-worker.js",
                source: content,
            });
        },
    };
}

/**
 * The public subpath surface of the npm package (S6).
 *
 * Every one of these is an `exports` subpath in package.json, so it must exist as a real file in
 * dist/esm/ — and in `preserveModules` mode, Rollup only emits a chunk for a module whose AST is
 * *included*. A module of pure re-exports never is (its Program has no includable statement), so
 * `kernel-exports.ts`, `globals.ts` and the three capability facades were silently flattened into
 * `bundle-esm-entry.js` and had NO file to point at. `moduleSideEffects: true` cannot bring them
 * back — only entry status can.
 *
 * The 18 installers are already emitted *incidentally* (the full boot reaches them). Listing them
 * makes their export surface **contractual**: without entry status, Rollup tree-shakes the exports
 * of a non-entry chunk down to what another chunk imports, so the day an installer grows an export
 * that only a consumer uses, it would be silently stripped from the emitted file.
 */
function publicSubpathEntries() {
    const capsDir = path.resolve(__dirname, "src/capabilities");
    // `*/install.ts` is exactly the 18 capabilities. Measured 25/07/2026: 18 directories,
    // 18 installers, zero directory without one. Do not widen this glob.
    //
    // This comment used to except `capabilities/layers/` as "misfiled kernel with no installer".
    // That directory does not exist — the layers surface is `kernel/geojson/layers-public-api.ts`,
    // which `api/geoleaf.layers.ts` calls. The exception outlived what it excepted, and a stale
    // exception is worse here than none: it describes the filter as narrower than it is, so the
    // next reader looks for a special case that cannot occur.
    const installers = fs
        .readdirSync(capsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(capsDir, d.name, "install.ts")))
        .map((d) => `src/capabilities/${d.name}/install.ts`)
        .sort();

    return [
        INPUT_FILE_ESM, // "."
        "src/kernel-exports.ts", // "./kernel"
        "src/globals/globals.ts", // "./globals"  — kernel side-effect
        "src/app/app-namespace.ts", // "./helpers"  — kernel side-effect
        "src/app/boot-install.ts", // "./boot"
        "src/api/geoleaf.legend.ts", // "./facades/legend.js"
        "src/api/geoleaf.permalink.ts", // "./facades/permalink.js"
        "src/api/geoleaf.share.ts", // "./facades/share.js"
        ...installers, // "./capabilities/<id>/install.js"
    ];
}

/**
 * PERF-TS1 — Granular ESM build (preserveModules: true)
 * Generates one .js file per source module in dist/esm/.
 * Allows consumers (Webpack/Vite) to tree-shake at module level.
 * Do not include in the CDN bundle — bundler use only.
 */
const esmGranularConfig = {
    ...baseConfig,
    input: publicSubpathEntries(),
    plugins: [
        replace({
            preventAssignment: true,
            values: {
                __GEOLEAF_VERSION__: JSON.stringify(pkg.version),
                __SW_DEBUG__: "false",
            },
        }),
        // outDir and declarationDir must be under dist/esm to satisfy the TS plugin
        typescript({
            tsconfig: "./tsconfig.json",
            compilerOptions: {
                noEmit: true,
                declaration: false,
                declarationDir: undefined,
                outDir: path.resolve(__dirname, "dist/esm"),
            },
        }),
        // CSS → adoptedStyleSheets, NOT a `.css` file next to the .js (see the cssAdopt comment).
        cssAdopt(),
        resolve({ browser: true, preferBuiltins: false, extensions: [".ts", ".js"] }),
        commonjs(),
        // This output is NOT minified, so an `output.banner` would survive there.
        // The same plugin is used anyway: one mechanism for both outputs beats
        // two doing the same thing two ways — and this one is what skips the
        // 100 %-third-party chunks, which an `output.banner` cannot do.
        licenseBanner(pkg),
    ],
    // ⚠️ NO `treeshake` override here — it inherits baseConfig's `moduleSideEffects: true`.
    //
    // Until S6 this config carried a path heuristic:
    //     moduleSideEffects: (id) => id.includes('globals') || id.includes('sw-register') || id.includes('/app/')
    // baseConfig forbids exactly that, in writing, 440 lines up ("Do not filter here"). And it was
    // not a style violation — it AMPUTATED the published package. The three modules that mutate the
    // `Config` singleton (built-in/config/geoleaf-config/config-{accessors,loaders,validation}.ts,
    // bare-imported by globals.config.ts) match none of those substrings, so Rollup dropped them, and
    // `import { Config } from "@geoleaf/core"` shipped a Config with no `.get()` / `.set()` /
    // `.loadUrl()`. The CDN bundle was fine — it uses baseConfig.treeshake — so nobody saw it.
    //
    // dist/esm is the GRANULAR build: its job is to emit the whole module graph, one file per module,
    // and let the CONSUMER's bundler tree-shake it. Tree-shaking here is not just unnecessary, it is
    // the bug. What guides the consumer is `package.json#sideEffects` — see scripts/check-side-effects.cjs
    // (declaration) and scripts/check-consumer-bundle.cjs (deed).
    output: {
        dir: "dist/esm",
        format: "es",
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        sourcemap: false,
        exports: "named",
    },
};

/**
 * Example entry — the tree-shaking PROOF (S4, presets chantier).
 *
 * `examples/minimal/entry.ts` is the documented recipe for a consumer who wants a lighter
 * bundle: kernel + 9 of the 17 capabilities. Building it on every `npm run build` is what
 * turns "the core is tree-shakeable" from a claim into a measured fact — `npm run size:example`
 * walks its real eager closure and fails if a single file of an EXCLUDED capability shows up.
 *
 * Derived from `esmConfig` by spread, deliberately: same plugins, same minifier, same
 * manualChunks. Measuring a differently-built artifact would prove nothing about the shipped
 * one. Sourcemaps stay ON — the gate reads them to recover the source paths behind the
 * minified chunks.
 *
 * Output goes to `examples/dist/` — OUTSIDE `dist/`, so it is never published (package.json
 * `files` ships `dist/` only) and never mistaken for a second product. GeoLeaf ships ONE bundle.
 *
 * The sw-core / geojson-worker asset emitters are dropped: they would overwrite the real
 * bundle's assets, and this entry is a measurement fixture, not a deployable.
 *
 * ⚠ The plugin list is rebuilt rather than spread from `baseConfig`: @rollup/plugin-typescript
 * requires the tsconfig `outDir` to sit inside the Rollup `output.dir`, and baseConfig's is
 * pinned to `dist/`. Same plugins, same order — only `outDir` differs.
 */
const exampleMinimalConfig = {
    ...esmConfig,
    input: "examples/minimal/entry.ts",
    plugins: [
        replace({
            preventAssignment: true,
            values: {
                __GEOLEAF_VERSION__: JSON.stringify(pkg.version),
                __SW_DEBUG__: "false",
            },
        }),
        typescript({
            tsconfig: "./tsconfig.json",
            compilerOptions: {
                noEmit: true,
                declaration: false,
                declarationDir: undefined,
                outDir: path.resolve(__dirname, "examples/dist/minimal"),
            },
        }),
        // Same two-channel logic as the shipped bundle: extract to a file. The gate reads this file's
        // SOURCEMAP to prove that an excluded capability's stylesheet is not in it — the CSS oracle,
        // symmetric with the JS one.
        cssExtract("examples/dist/minimal/geoleaf.minimal.css"),
        resolve({ browser: true, preferBuiltins: false, extensions: [".ts", ".js"] }),
        commonjs(),
        // ⚠️ `es2022` and not `es2015`: see the long motive at
        // `packages/build-config/rollup.mjs` — the previous target was justified by a
        // sentence this file and that one handed to each other. Measured, not inferred.
        minify({ target: "es2022", legalComments: "none" }),
    ],
    output: {
        ...esmConfig.output,
        dir: "examples/dist/minimal",
        entryFileNames: "geoleaf.minimal.esm.js",
    },
};

/**
 * The SECOND composed entry — same pattern, other list.
 *
 * 🛑 It exists because a proof on ONE entry proves nothing about another: the
 * gate was hard-coded on `minimal`, and would have measured `minimal` whatever
 * was composed beside it. Two entries, two measurements, two floors.
 *
 * ⚠️ `sourcemap` must stay on: the gate reads the sourcemap to establish that no
 * source file of an excluded capability enters the closure. Without it there is
 * no oracle, just a weight.
 */
const exampleSlimConfig = {
    ...esmConfig,
    input: "examples/slim/entry.ts",
    plugins: [
        replace({
            preventAssignment: true,
            values: {
                __GEOLEAF_VERSION__: JSON.stringify(pkg.version),
                __SW_DEBUG__: "false",
            },
        }),
        typescript({
            tsconfig: "./tsconfig.json",
            compilerOptions: {
                noEmit: true,
                declaration: false,
                declarationDir: undefined,
                outDir: path.resolve(__dirname, "examples/dist/slim"),
            },
        }),
        cssExtract("examples/dist/slim/geoleaf.slim.css"),
        resolve({ browser: true, preferBuiltins: false, extensions: [".ts", ".js"] }),
        commonjs(),
        // ⚠️ `es2022` and not `es2015`: see the long motive at
        // `packages/build-config/rollup.mjs` — the previous target was justified by a
        // sentence this file and that one handed to each other. Measured, not inferred.
        minify({ target: "es2022", legalComments: "none" }),
    ],
    output: {
        ...esmConfig.output,
        dir: "examples/dist/slim",
        entryFileNames: "geoleaf.slim.esm.js",
    },
};

// v2.0.0: ESM-only output (UMD removed)
// esmConfig            — chunked ESM (CDN + bundlers) — the SHIPPED bundle, all capabilities
// esmGranularConfig    — preserveModules (granular tree-shaking for third-party bundlers)
// exampleMinimalConfig — the tree-shaking proof (NOT published — examples/dist/)
// exampleSlimConfig    — a second composed entry, so the proof covers a LIST and not one row
//
// The frozen "lite" build (S4, presets chantier) is GONE. It was never served, and a
// hand-maintained parallel entry/boot/globals triple is exactly the debt the capability
// installers (`capabilities/<cap>/install.ts`) replace: a consumer who wants less now
// writes their own ~25-line entry composing the installers they need — see
// `examples/minimal/entry.ts`, which is that recipe, built and measured on every build.
//
// The two plugin configs are gone too (see the header): the core's dist is the CORE's product.
// `__tests__/bundle.test.js` now GATES that — it fails if any geoleaf-*.plugin.js reappears here.
export default [esmConfig, esmGranularConfig, exampleMinimalConfig, exampleSlimConfig];

/**
 * Consumed by `rollup.consumer.mjs` (the published-package witness, S6).
 *
 * That build lives in its OWN config file rather than as a sixth entry here, for two reasons:
 * it reads `dist/esm/` — which THIS file's `esmGranularConfig` writes — so `rollup -c -w` would
 * loop forever on it; and an inter-config ordering dependency inside a single `rollup -c` is
 * invisible to the reader and to Turbo. Rollup's CLI runs configs sequentially and awaits each
 * `bundle.write()`, so `rollup -c && rollup -c rollup.consumer.mjs` is the same ordering, said
 * out loud.
 */
export { esmConfig, pluginTsLoad, pkg };
