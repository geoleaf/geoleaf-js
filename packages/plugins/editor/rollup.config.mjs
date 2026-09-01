/*!
 * GeoLeaf Editor Plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/entry.ts",
    output: {
        // Code-splitting: the drawing engine (terra-draw + its MapLibre adapter +
        // the mode classes) is dynamically imported on first tool activation, so
        // it lands in a separate lazy chunk and stays out of the initial bundle.
        // The host page only ever references the named entry; the browser resolves
        // the chunk relatively, so all dist/*.js must be deployed together.
        dir: "dist",
        format: "es",
        sourcemap: true,
        // The sources already travel in `src/` (files[]): embedding them a
        // SECOND time in the map is a pure duplicate.
        sourcemapExcludeSources: true,
        entryFileNames: "geoleaf-editor.plugin.js",
        chunkFileNames: "geoleaf-editor.[name]-[hash].js",
        // Consolidate the terra-draw vendor packages into a single lazy chunk.
        manualChunks(id) {
            if (id.includes("terra-draw")) return "terra-draw";
        },
    },
    // Core and maplibre-gl loaded separately by the host page.
    // terra-draw and terra-draw-maplibre-gl-adapter are bundled (lazy chunk).
    // 🛑 THE `$` ANCHOR IS LOAD-BEARING, AND ITS ABSENCE TURNED ESM-PURITY RED.
    // Without it, EVERY `@geoleaf/core/...` subpath stayed external, hence
    // written as-is into the bundle:
    // `import "@geoleaf/core/kernel/config/layer-geometry.js"` — a BARE
    // specifier, unresolvable by a browser. The defect had never shown because
    // the only subpath imported so far (`contracts/sync.contract.js`) is an
    // `import type`, erased at compilation.
    // Anchored, only the root package stays external (the host loads it) and
    // subpaths are BUNDLED — already `offline-ui`'s form (`/^@geoleaf\/core$/`),
    // and its motive holds here: these are PURE, import-free functions,
    // embedding a copy is inconsequential. Singletons do not go through an
    // import but through `globalThis`.
    external: [/^@geoleaf\/core$/, "maplibre-gl"],
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
