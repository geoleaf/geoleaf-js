/*!
 * GeoLeaf Measure Plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/entry.ts",
    output: {
        file: "dist/geoleaf-measure.plugin.js",
        format: "es",
        sourcemap: true,
        // 2.10 bis — les sources voyagent déjà dans `src/` (files[]) :
        // les embarquer une SECONDE fois dans la carte est un doublon pur.
        sourcemapExcludeSources: true,
        inlineDynamicImports: true,
    },
    // Core and maplibre-gl loaded separately by the host page. Turf bundled inline.
    external: [/^@geoleaf\/core/, "maplibre-gl"],
    plugins: pluginStack({
        resolve: { preferBuiltins: false },
        commonjs: true,
        version: pkg.version,
        pkg,
        css: true,
        typescript: { compilerOptions: { paths: {} } },
        minify: true,
    }),
};
