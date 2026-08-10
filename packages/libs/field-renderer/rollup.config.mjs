/*!
 * GeoLeaf Field Renderer — Rollup Config
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/index.ts",
    output: {
        file: "dist/geoleaf-field-renderer.js",
        format: "es",
        sourcemap: true,
        // 2.10 bis — les sources voyagent déjà dans `src/` (files[]) :
        // les embarquer une SECONDE fois dans la carte est un doublon pur.
        sourcemapExcludeSources: true,
        inlineDynamicImports: true,
    },
    // Pure DOM library — no external dependencies.
    external: [],
    plugins: pluginStack({
        resolve: { preferBuiltins: false },
        commonjs: true,
        version: pkg.version,
        pkg,
        css: true,
        minify: true,
    }),
};
