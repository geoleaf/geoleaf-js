/*!
 * @geoleaf/host-runtime — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from '@geoleaf/build-config/rollup.mjs';

const pkg = readPackageJson(import.meta.url);

export default {
    input: 'src/index.ts',
    output: {
        file: 'dist/index.js',
        format: 'es',
        sourcemap: true,
    },
    // No external deps — the bundle is self-contained and inlined into each consumer.
    // In particular, NOTHING is imported from @geoleaf/core (type-only shape re-declared).
    external: [],
    // `pkg` sert la bannière de licence (npm S3). Ce paquet est `private`, donc HORS du corpus
    // de LIC-04 : la bannière y est posée pour l'uniformité du bundle, pas parce qu'une gate
    // l'exige. Ne pas en déduire que l'absence de `pkg` serait sans conséquence ailleurs.
    plugins: pluginStack({ resolve: {}, css: true, minify: true, pkg }),
};
