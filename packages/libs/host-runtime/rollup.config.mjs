/*!
 * @geoleaf/host-runtime — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";

const pkg = readPackageJson(import.meta.url);

export default {
    input: "src/index.ts",
    output: {
        file: "dist/index.js",
        format: "es",
        sourcemap: true,
    },
    // No external deps — the bundle is self-contained and inlined into each consumer.
    // In particular, NOTHING is imported from @geoleaf/core (type-only shape re-declared).
    external: [],
    // `pkg` serves the licence banner. This package is `private`, hence
    // OUTSIDE LIC-04's corpus: the banner is set for bundle uniformity, not
    // because a gate requires it. Do not conclude that dropping `pkg` would
    // be consequence-free elsewhere.
    plugins: pluginStack({ resolve: {}, css: true, minify: true, pkg }),
};
