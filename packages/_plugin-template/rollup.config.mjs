/*!
 * GeoLeaf __PLUGIN_NAME__ plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { pluginStack, readPackageJson } from '@geoleaf/build-config/rollup.mjs';

const pkg = readPackageJson(import.meta.url);

export default {
    input: 'src/entry.ts',
    output: {
        file: 'dist/geoleaf-__PLUGIN_NAME__.plugin.js',
        format: 'es',
        sourcemap: true,
        inlineDynamicImports: true,
    },
    // @geoleaf/core is always external (provided by the host page).
    external: [/^@geoleaf\/core//* <map> */, 'maplibre-gl'/* </map> */],
    // `pkg` porte la bannière de licence du bundle (npm S3, LIC-04). ⚠️ Sans lui, un plugin
    // généré naîtrait avec un bundle sans notice — et `packages/_*` est exclu des globs
    // `workspaces`, donc `packages.cjs` ne rend pas ce répertoire et AUCUNE gate ne le voit.
    // Le défaut ne se verrait qu'au premier `npm run create:plugin`, sur le paquet enfant.
    plugins: pluginStack({ resolve: { preferBuiltins: false }, commonjs: true, version: pkg.version, css: true, minify: true, pkg }),
};
