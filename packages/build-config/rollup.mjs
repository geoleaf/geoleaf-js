/*!
 * GeoLeaf — shared Rollup configuration factory
 * © 2026 Mattieu Pottier — MIT License
 */

/**
 * @description
 * Assembles the Rollup plugin stack shared by the monorepo's packages.
 *
 * ## What the factory absorbs — and what it deliberately leaves to the leaves
 *
 * It absorbs the imports, the `package.json` read and the ordered plugin
 * assembly. A plugin config thus goes from ~45 to ~18 lines.
 *
 * It does NOT touch `input`, `output` nor `external`: those three stay written
 * literally in each leaf. **This is not an aesthetic choice.**
 * `scripts/verify-plugin-contract.cjs` verifies the contract by reading the TEXT
 * of `rollup.config.mjs`:
 *
 *   PC-12 → `content.includes("geoleaf-<name>.plugin.js")` and `/format:\s*["']es["']/`
 *   PC-10 → `/maplibre-gl/` for the externalisation
 *   PC-13 → `/\binject\s*:\s*true\b/` (forme interdite)
 *
 * A factory that DERIVED the output name would take PC-12 down on the 13
 * plugins at once — and that gate runs `--fail` in pre-commit, in `ci:local` AND
 * in `ci.yml`. Masking `'maplibre-gl'` behind a flag would disarm PC-10 in
 * silence. The rule is therefore: **everything a gate reads at the text stays in
 * the leaf.**
 *
 * ## Plugin order
 *
 * `nodeResolve → commonjs? → json? → replace? → postcss? → typescript → minify?`
 *
 * This order is not arbitrary: it is that of the 15 original configs, verified
 * one by one before extraction. Changing it would change the bundles.
 *
 * ## Perimeter
 *
 * 15 configs. `core` (543 l., 4 entries, array export), `plugin-addpoi` (148 l.)
 * and `plugin-storage` (207 l.) carry home-grown Rollup plugins that index
 * `../core/src`: they only receive the `cspStyleInject` import change.
 *
 * ⚠️ Those three declare `@rollup/plugin-commonjs@^29.0.0`, while the 10 packages
 * served by this factory are on `^28.0.3` (nested copies at 28.0.9, verified on
 * disk). That is why `build-config` declares `^28.0.3` and not the root's
 * version: importing from here resolves from HERE, and declaring `^29` would
 * flip 10 bundles a major version without a word.
 */

import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";
import json from "@rollup/plugin-json";
import postcss from "rollup-plugin-postcss";
import { minify } from "rollup-plugin-esbuild";

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// The banner's canonical form lives in `scripts/lib/license-banner.cjs` — one
// place, read by the `--write` generator, by the LIC-HEADERS gate and by this
// factory. Loaded through `createRequire` because it is CommonJS: the pattern
// already exists in this package (`vitest/resolve-js-to-ts.mjs`). Duplicating it
// here would make the SET banner diverge from the REQUIRED banner, and the
// disagreement would read as "the gate reddens on a bundle we just bannered".
const { bundleBanner } = createRequire(import.meta.url)("../../scripts/lib/license-banner.cjs");

// `core`, `plugin-addpoi` and `plugin-storage` are outside the factory's
// perimeter and import the injector directly from
// `@geoleaf/build-config/csp-style-inject.mjs`. No re-export here: it would
// serve nobody.
import { cspStyleInject } from "./csp-style-inject.mjs";

/**
 * Makes `rollup-plugin-postcss`'s `augmentChunkHash` deterministic.
 *
 * ## The defect
 *
 * `rollup-plugin-postcss@4.0.2` (last published in 2021, unmaintained project)
 * implements:
 *
 *     augmentChunkHash() {
 *         if (extracted.size === 0) return;
 *         const extractedValue = [...extracted].reduce(…);  // Map → objet
 *         return JSON.stringify(extractedValue);
 *     }
 *
 * `extracted` is a **Map**, filled in the `transform` hook — hence in the order
 * Rollup transforms the CSS modules, which is not stable run to run. The
 * serialisation depends on that insertion order: same content, different string,
 * **hence different hash**.
 *
 * Rollup adds this value to EVERY chunk's hash. Measured consequence on
 * `@geoleaf/core`: the 7 chunks changed name at each build while their content —
 * `.js` AND `.js.map` — was byte-identical. Diagnosis confirmed by instrumenting
 * the hook: run A started with `feature-info-sidepanel.css`, run B with
 * `branding.css`.
 *
 * Real cost: Turborepo cache invalidated at every build, a `deploy/` differing
 * at every generation without a code change, and browser cache broken on
 * identical chunks — the exact inverse of what a content hash serves.
 *
 * ## The fix
 *
 * We do not fix `node_modules` (overwritten at the next `npm install`) and we do
 * not remove `[hash]` from chunk names (that would lose cache-busting to work
 * around a sort bug). We reorder: a Rollup plugin is a plain object, so its hook
 * can be replaced. The hook's INTENT is preserved — if the extracted CSS
 * changes, the hashes change — only the **order sensitivity** disappears.
 *
 * No effect on the other packages: the factory configures them with
 * `extract: false`, so `extracted.size === 0` and the hook exits before
 * serialising.
 *
 * @param {import('rollup').Plugin} plugin The `postcss(...)` instance to sanitise.
 * @returns {import('rollup').Plugin} The same instance, sorted hook.
 */
export function withStableChunkHash(plugin) {
    const original = plugin.augmentChunkHash;
    if (typeof original !== "function") return plugin;

    plugin.augmentChunkHash = function stableAugmentChunkHash(chunk) {
        const value = original.call(this, chunk);
        if (typeof value !== "string") return value;
        try {
            const parsed = JSON.parse(value);
            // Rebuild key by key rather than using the replacer-array form of
            // JSON.stringify: the replacer applies to NESTED objects too and would
            // silently drop keys of the per-entry values.
            const sorted = {};
            for (const key of Object.keys(parsed).sort()) sorted[key] = parsed[key];
            return JSON.stringify(sorted);
        } catch {
            // Not the JSON shape we expect — leave it untouched rather than guess.
            return value;
        }
    };
    return plugin;
}

/**
 * Reads the `package.json` sitting beside the calling config file.
 *
 * Replaces the `__dirname` + `readFileSync` block copied into 16 configs. Takes
 * the caller's `import.meta.url` rather than `process.cwd()`: the result then
 * does not depend on the directory Rollup is launched from.
 *
 * @param {string} importMetaUrl The calling `rollup.config.mjs`'s `import.meta.url`.
 * @returns {{ name: string, version: string, [k: string]: unknown }}
 */
export function readPackageJson(importMetaUrl) {
    const dir = path.dirname(fileURLToPath(importMetaUrl));
    const file = path.join(dir, "package.json");
    if (!fs.existsSync(file)) {
        throw new Error(`build-config/rollup: no package.json next to ${importMetaUrl}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * The bundle's licence banner — set AFTER the minifier, and that is the whole
 * subject.
 *
 * ## Why not `output.banner`
 *
 * Because it does not come out. Measured:
 * `plugins/offline-ui/rollup.config.mjs` DECLARED a full `output.banner`, and
 * its shipped bundle started with `var Xe=Object.defineProperty`. Rollup
 * prefixes the banner before the `renderChunk` hooks, `rollup-plugin-esbuild`'s
 * `minify()` IS a `renderChunk`, and its `legalComments: "none"` deletes every
 * `/*!`. Declaring is thus not enough — that it comes out must be measured.
 *
 * ## Why not `legalComments: "inline"` either
 *
 * That would be the other possible fix, and it costs dearly for nothing:
 * `"inline"` keeps ALL the input's legal comments, so the sources' ~650 `/*!`
 * banners would surface in each minified bundle. We want ONE notice at the head
 * of the shipped file, not six hundred scattered inside.
 *
 * ## Why `generateBundle` and not `renderChunk`
 *
 * `generateBundle` runs after all the `renderChunk`, hence after the minifier,
 * without depending on the plugin array's order. And above all, the sourcemap is
 * already produced there: prefixing N lines of code amounts EXACTLY to prefixing
 * N `;` to the `mappings`, which shifts each entry by that many lines without
 * losing one. A `renderChunk` that returned the string alone would slide the
 * whole map by N lines in silence — and that map is read by
 * `verify-e2e-coverage.cjs` and by `npm run size` to attribute bytes to sources.
 *
 * 🛑 **The WRITTEN map is NOT `chunk.map`** — and believing it produced a
 * six-line shift that came out green. Rollup serialises the map as a bundle
 * **ASSET** (`<file>.map`, `type: "asset"`) BEFORE calling `generateBundle`;
 * `chunk.map` is only an in-memory view nobody re-reads. Measured by probe:
 * mutating `chunk.map.mappings` shows in `bundle.generate()` and **disappears**
 * in `bundle.write()`. So it is the asset's `source` that must be reworked — and
 * both are updated, so a `generate()` consumer does not read a map inconsistent
 * with the disk's.
 *
 * ## 100 %-third-party chunks are SKIPPED
 *
 * Writing "© 2026 Mattieu Pottier — Released under the MIT License" at the head
 * of `geoleaf-print.jspdf-*.js` would be a false attribution: that file is
 * jsPDF. The decision derives from the graph (`chunk.modules` all under
 * `node_modules/`), never from a name list — and the LIC-04 gate applies the
 * SAME derivation on the sourcemap, printing the exempted at every run.
 *
 * @param {{name: string, version: string}} pkg The package manifest, via `readPackageJson`.
 * @returns {import('rollup').Plugin}
 */
export function licenseBanner(pkg) {
    const banner = bundleBanner(pkg.name, pkg.version);
    const addedLines = banner.split("\n").length;
    return {
        name: "geoleaf-license-banner",
        generateBundle(_options, bundle) {
            const shift = ";".repeat(addedLines);
            for (const file of Object.values(bundle)) {
                if (file.type !== "chunk") continue;
                const ids = Object.keys(file.modules || {});
                if (ids.length > 0 && ids.every((id) => id.includes("node_modules"))) continue;
                if (file.code.startsWith("/*!")) continue;
                file.code = `${banner}\n${file.code}`;

                // The in-memory view…
                if (file.map) file.map.mappings = shift + file.map.mappings;
                // …AND the asset, which is what lands on disk.
                const asset = bundle[`${file.fileName}.map`];
                if (asset && asset.type === "asset" && typeof asset.source === "string") {
                    const map = JSON.parse(asset.source);
                    map.mappings = shift + map.mappings;
                    asset.source = JSON.stringify(map);
                }
            }
        },
    };
}

/**
 * Builds a package's plugin stack.
 *
 * Each option corresponds to a plugin really used by at least one package; none
 * was invented "just in case". The distribution measured over the 15 original
 * configs: nodeResolve 15/15, replace 13/15, commonjs 10/15,
 * postcss 7/15, json 4/15, minify 1/15.
 *
 * @param {object}  [options]
 * @param {object}  [options.resolve]   `nodeResolve` options. `{}` ⇒ bare call.
 *                                      Valeur usuelle : `{ preferBuiltins: false }`.
 * @param {boolean} [options.commonjs]  Adds `@rollup/plugin-commonjs`.
 * @param {boolean} [options.json]      Adds `@rollup/plugin-json` (after commonjs).
 * @param {string}  [options.version]   If provided, injects `__GEOLEAF_VERSION__`
 *                                      via `@rollup/plugin-replace`. BARE value,
 *                                      never `JSON.stringify`: the token already
 *                                      appears inside a string literal in
 *                                      `entry.ts` (`_VERSION = "__GEOLEAF_VERSION__"`),
 *                                      so adding quotes would produce `""1.2.3""`.
 * @param {boolean} [options.css]       Adds `rollup-plugin-postcss` with the CSP
 *                                      injector (`cspStyleInject`). Never
 *                                      `inject: true`, the form PC-13 forbids.
 * @param {object}  [options.typescript] Options merged into `@rollup/plugin-typescript`
 *                                      (the local `tsconfig` is always kept).
 * @param {boolean} [options.minify]    Adds `rollup-plugin-esbuild`'s `minify()`.
 * @param {{name: string, version: string}} [options.pkg] The manifest, for the
 *                                      licence banner. Its ABSENCE breaks nothing
 *                                      here — LIC-04 is what reddens on the
 *                                      unbannered bundle, and that is the right
 *                                      place: the factory sets, the gate judges.
 * @returns {import('rollup').Plugin[]}
 */
export function pluginStack({
    resolve = { preferBuiltins: false },
    commonjs: useCommonjs = false,
    json: useJson = false,
    version,
    css = false,
    typescript: tsOptions = {},
    minify: useMinify = false,
    pkg,
} = {}) {
    const plugins = [nodeResolve(resolve)];

    if (useCommonjs) plugins.push(commonjs());
    if (useJson) plugins.push(json());

    if (version !== undefined) {
        plugins.push(
            replace({ preventAssignment: true, values: { __GEOLEAF_VERSION__: version } })
        );
    }

    if (css) {
        plugins.push(
            postcss({ inject: cspStyleInject, minimize: true, extract: false, sourceMap: false })
        );
    }

    plugins.push(typescript({ tsconfig: "./tsconfig.json", ...tsOptions }));

    // 🛑 **`es2022`, and the motive it replaces was CIRCULAR.** This line carried `es2015`
    // until 2026-08-27, justified as "same engine and target as `@geoleaf/core`" — while the
    // core carried the same line with the same sentence. Two files handed each other a reason
    // neither of them gave.
    //
    // The real constraint is measurable, and was measured on 2026-08-27:
    //   · the PUBLIC README states browser support as "derived from the ES2022 compilation
    //     target declared in the repository's tsconfig files";
    //   · `maplibre-gl@6.5`, a MANDATORY peer, already ships static blocks, `??=`, `?.` and
    //     `??` — strict ES2022. A browser that cannot read that renders no map, hence no
    //     application;
    //   · the granular `dist/esm/` entry is published UNMINIFIED, so an integrator already
    //     receives ES2022.
    // Downlevelling therefore protected nobody: its only beneficiary would have been a browser
    // unable to run the mandatory dependency.
    //
    // ⚠️ **What the target actually changes, PROBED on the output rather than inferred from
    // the name**: esbuild stopped rewriting `async`/`await` into generator state machines. The
    // `es2022` output contains NO static block, NO private field and NO top-level await — its
    // effective syntax floor is `?.`/`??`, i.e. Chrome 80 / Safari 13.1, well below the
    // Chrome 90+ the README announces.
    //
    // Measured across the 15 plugins plus the core: **20.84 KB gz (−4.9 %)**. ⚠️ `es2020`
    // returned 19.42: the two are NOT equivalent, contrary to what a first measurement on a
    // single package suggested.
    if (useMinify) plugins.push(minify({ target: "es2022", legalComments: "none" }));

    // Last of the stack, and its `generateBundle` hook runs after every
    // `renderChunk` anyway: the banner survives the minifier by construction, not
    // by ordering convention. `legalComments` stays `"none"` — see
    // `licenseBanner`'s comment.
    if (pkg) plugins.push(licenseBanner(pkg));

    return plugins;
}
