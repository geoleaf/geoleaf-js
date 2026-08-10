/*!
 * GeoLeaf File Import Plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/entry.ts",
    output: {
        file: "dist/geoleaf-file-import.plugin.js",
        format: "es",
        sourcemap: true,
        // 2.10 bis — les sources voyagent déjà dans `src/` (files[]) :
        // les embarquer une SECONDE fois dans la carte est un doublon pur.
        sourcemapExcludeSources: true,
    },
    // @geoleaf/core is never bundled — loaded separately by the host page
    external: [/^@geoleaf\/core/],
    plugins: pluginStack({
        resolve: { preferBuiltins: false, browser: true },
        commonjs: true,
        json: true,
        version: pkg.version,
        pkg,
        minify: true,
    }),
};
