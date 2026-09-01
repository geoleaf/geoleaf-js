/**
 * Vitest configuration for bundle validation tests (post-build).
 *
 * Runs bundle.test.js which reads dist/ artefacts — requires a prior
 * `turbo run build` (or `npm run build --workspace=@geoleaf/core`).
 * Excluded from the main vitest.config.ts for exactly this reason.
 *
 * Usage: npm run test:bundle --workspace=@geoleaf/core
 */
// Side effect: ensure `--import tsx` in NODE_OPTIONS before workers spawn (Vitest 4
// no longer loads tsx reliably via poolOptions.forks.execArgv). MUST be first.
import "@geoleaf/build-config/vitest/ensure-tsx-node-options.mjs";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolveJsToTs } from "@geoleaf/build-config/vitest/resolve-js-to-ts.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    root: __dirname,
    plugins: [resolveJsToTs],

    test: {
        name: "@geoleaf/core:bundle",
        environment: "node",
        globals: true,

        // Glob, NOT a single-file literal: `bundle.test.js` was the only bundle test for a
        // long time, and the literal that named it would have silently ignored every new
        // sibling. Any `__tests__/bundle-*.test.js` is picked up from now on.
        // ⚠️ `.ts` added on 2026-08-07, and it is not cosmetic:
        // `check-js-test-debt` (JTD-01) refuses any NEW `.js` suite, so every
        // bundle test written from now on is TypeScript. A `.js`-only pattern
        // would have made them invisible HERE — hence collected by no config,
        // and green for having run nothing. The twin pattern lives in
        // `vitest.config.ts`'s `exclude`: the two read together.
        include: [
            "__tests__/bundle.test.js",
            "__tests__/bundle-*.test.js",
            "__tests__/bundle-*.test.ts",
        ],
        exclude: ["**/node_modules/**"],

        // Vitest 4 removed `poolOptions`; `singleFork: true` is now maxWorkers:1 + isolate:false.
        pool: "forks",
        maxWorkers: 1,
        isolate: false,
        execArgv: ["--import", "tsx"],

        testTimeout: 30000,
        reporters: ["verbose"],
    },
});
