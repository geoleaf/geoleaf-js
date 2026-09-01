/*!
 * GeoLeaf position-share plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/entry.ts",
    output: {
        file: "dist/geoleaf-position-share.plugin.js",
        format: "es",
        sourcemap: true,
        inlineDynamicImports: true,
    },
    // @geoleaf/core is always external (provided by the host page).
    external: [/^@geoleaf\/core/],
    // `pkg` carries the bundle's licence banner (LIC-04). ⚠️ Without it, a
    // generated plugin would be born with a notice-less bundle — and
    // `packages/_*` is excluded from the `workspaces` globs, so `packages.cjs`
    // does not return this directory and NO gate sees it. The defect would
    // only show at the first `npm run create:plugin`, on the child package.
    plugins: pluginStack({
        resolve: { preferBuiltins: false },
        commonjs: true,
        version: pkg.version,
        css: true,
        minify: true,
        pkg,
    }),
};
