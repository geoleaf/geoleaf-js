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
        // The sources already travel in `src/` (files[]): embedding them a
        // SECOND time in the sourcemap is pure duplication.
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
