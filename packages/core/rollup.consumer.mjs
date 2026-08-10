// rollup.consumer.mjs
// The PUBLISHED-PACKAGE witness (S6). Run after `rollup -c`, which writes dist/esm/.
//
//   examples/consumer/entry.ts  →  examples/dist/consumer/geoleaf.consumer.esm.js
//
// This bundles the documented recipe through the real npm subpaths (`@geoleaf/core/...`), so it
// resolves through node_modules → the workspace symlink → `package.json#exports` → `dist/esm/`.
// It is the only artifact in the repo that sees what an integrator sees. `examples/minimal/` still
// measures the SOURCE graph; this one measures the PACKAGE. Both are gated.
//
// Not published: `files` ships `dist/` only, and this writes to `examples/dist/`.

import { esmConfig, pluginTsLoad, pkg } from "./rollup.config.mjs";
import { minify } from "rollup-plugin-esbuild";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";

/**
 * ⚠️ THE TRAP THIS CONFIG EXISTS TO AVOID — do not "restore" @rollup/plugin-typescript here.
 *
 * `@rollup/plugin-typescript` ships its own `resolveId` hook, which returns a bare path with NO
 * `moduleSideEffects` flag. Rollup's `addDefaultsToResolvedId` takes `moduleSideEffects` from the
 * resolving plugin and only falls back to the `treeshake` option — so whichever plugin resolves an
 * id decides its side-effect status. If the TS plugin wins the race for `@geoleaf/core/...`, then
 * `@rollup/plugin-node-resolve` never sees the specifier, **`package.json#sideEffects` is never
 * read**, and this witness would silently measure `src/` instead of `dist/esm/` — a green gate
 * proving nothing, over a published package that is broken.
 *
 * `pluginTsLoad` is a pure `load` hook (ts.transpileModule, no resolution), so node-resolve owns
 * every specifier and honours `sideEffects`. The gate double-locks this by asserting that every
 * source in the witness's sourcemaps sits under `/dist/esm/`.
 */
export default {
    ...esmConfig,
    input: "examples/consumer/entry.ts",
    plugins: [
        replace({
            preventAssignment: true,
            values: {
                __GEOLEAF_VERSION__: JSON.stringify(pkg.version),
                __SW_DEBUG__: "false",
            },
        }),
        pluginTsLoad("./tsconfig.json"),
        resolve({
            browser: true,
            preferBuiltins: false,
            extensions: [".ts", ".js"],
            // Explicit, though these are node-resolve's ESM defaults — the whole point of this
            // build is that the `exports` map is what decides, so say so.
            exportConditions: ["import", "browser", "default"],
        }),
        commonjs(),
        minify({ target: "es2015", legalComments: "none" }),
    ],
    output: {
        // Spread esmConfig.output to keep the SAME manualChunks and the same minifier: measuring a
        // differently-built artifact would prove nothing about the shipped one. The chunking
        // predicates test `/capabilities/<id>/` against module ids, which now read
        // `…/dist/esm/capabilities/<id>/…` — they still match.
        ...esmConfig.output,
        dir: "examples/dist/consumer",
        entryFileNames: "geoleaf.consumer.esm.js",
        sourcemap: true, // the gate reads these maps; without them there is no oracle
    },
};
