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
        // 2.10 bis — les sources voyagent déjà dans `src/` (files[]) :
        // les embarquer une SECONDE fois dans la carte est un doublon pur.
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
    // 🛑 B-161 — L'ANCRE `$` EST LOAD-BEARING, ET SON ABSENCE A FAIT ROUGIR ESM-PURITY.
    // Sans elle, TOUT sous-chemin `@geoleaf/core/...` restait external, donc écrit tel quel
    // dans le bundle : `import "@geoleaf/core/kernel/config/layer-geometry.js"` — un
    // spécificateur NU, irrésoluble par un navigateur. Le défaut ne s'était jamais vu parce
    // que l'unique sous-chemin importé jusqu'ici (`contracts/sync.contract.js`) est un
    // `import type`, effacé à la compilation.
    // Ancré, seul le paquet racine reste external (le hôte le charge) et les sous-chemins
    // sont BUNDLÉS — c'est déjà la forme d'`offline-ui` (`/^@geoleaf\/core$/`), et son motif
    // vaut ici : ce sont des fonctions PURES et sans import, en embarquer une copie est sans
    // conséquence. Les singletons, eux, ne passent pas par un import mais par `globalThis`.
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
