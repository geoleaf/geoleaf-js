/*!
 * GeoLeaf Realtime Layer Plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/entry.ts",
    output: {
        // Code-splitting: the GTFS-RT decoder is dynamically imported on first
        // use, so it — and its `gtfs-realtime-bindings`/`protobufjs`/`long` graph
        // (whose module-init probes WebAssembly → a benign CSP `wasm-eval`
        // violation) — lands in a separate lazy chunk and stays off the boot
        // path. The host page only references the named entry; the browser
        // resolves the chunk relatively, so all dist/*.js must be deployed
        // together (see scripts/build-deploy.cjs).
        dir: "dist",
        format: "es",
        sourcemap: true,
        // 2.10 bis — les sources voyagent déjà dans `src/` (files[]) :
        // les embarquer une SECONDE fois dans la carte est un doublon pur.
        sourcemapExcludeSources: true,
        entryFileNames: "geoleaf-realtime-layer.plugin.js",
        chunkFileNames: "geoleaf-realtime-layer.[name]-[hash].js",
        // Consolidate the GTFS-RT decoder + its protobuf graph into one chunk.
        manualChunks(id) {
            if (
                id.includes("gtfs-realtime-bindings") ||
                id.includes("protobufjs") ||
                id.includes("/long/") ||
                id.includes("gtfs-rt-decoder")
            ) {
                return "gtfs-rt";
            }
        },
    },
    // @geoleaf/core is never bundled — loaded separately by the host page
    external: [/^@geoleaf\/core/],
    plugins: pluginStack({
        resolve: { preferBuiltins: false },
        commonjs: true,
        json: true,
        version: pkg.version,
        pkg,
        minify: true,
    }),
};
