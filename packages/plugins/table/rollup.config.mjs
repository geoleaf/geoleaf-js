/*!
 * GeoLeaf table plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/entry.ts",
    output: {
        // Code-splitting, like editor: the spreadsheet writer is an `import()` in `export.ts`, and
        // `inlineDynamicImports` folded it into the entry — every page that loaded the table paid
        // for an Excel writer few ever ask for, while TB-10 said « loaded on demand ». The host
        // only references the named entry; the browser resolves the chunk next to it, so all
        // dist/*.js are deployed together.
        dir: "dist",
        format: "es",
        sourcemap: true,
        // The sources already travel in `src/` (files[]): embedding them a
        // SECOND time in the sourcemap is pure duplication.
        sourcemapExcludeSources: true,
        entryFileNames: "geoleaf-table.plugin.js",
        chunkFileNames: "geoleaf-table.[name]-[hash].js",
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
