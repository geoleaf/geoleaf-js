/*!
 * GeoLeaf geocoding plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/entry.ts",
    output: {
        file: "dist/geoleaf-geocoding.plugin.js",
        format: "es",
        sourcemap: true,
        // The sources already travel in `src/` (files[]): embedding them a
        // SECOND time in the sourcemap is pure duplication.
        sourcemapExcludeSources: true,
        inlineDynamicImports: true,
    },
    // @geoleaf/core is always external (provided by the host page).
    external: [/^@geoleaf\/core/],
    plugins: pluginStack({
        resolve: { preferBuiltins: false },
        commonjs: true,
        version: pkg.version,
        pkg,
        css: true,
        minify: true,
    }),
};
