/*!
 * GeoLeaf Print Plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/entry.ts",
    output: {
        // Code-splitting: jsPDF is dynamically imported on the first PDF export,
        // so it lands in a separate lazy chunk (geoleaf-print.jspdf-<hash>.js) and
        // stays out of the plugin's load-time cost. The host page only references
        // the named entry; the browser resolves the chunk relatively, so all
        // dist/*.js must be deployed together (see scripts/build-deploy.cjs).
        dir: "dist",
        format: "es",
        sourcemap: true,
        // The sources already travel in `src/` (files[]): embedding them a
        // SECOND time in the sourcemap is pure duplication.
        sourcemapExcludeSources: true,
        entryFileNames: "geoleaf-print.plugin.js",
        chunkFileNames: "geoleaf-print.[name]-[hash].js",
        // Consolidate jsPDF into a single named lazy chunk.
        manualChunks(id) {
            if (id.includes("jspdf")) return "jspdf";
        },
    },
    // Core and maplibre-gl loaded separately by the host page.
    // jsPDF is bundled into a lazy chunk (loaded on first PDF export).
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
