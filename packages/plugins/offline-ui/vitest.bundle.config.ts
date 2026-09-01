/**
 * Vitest configuration for bundle validation tests (post-build).
 *
 * Runs __tests__/bundle.test.js, which reads dist/geoleaf-offline-ui.plugin.js — it therefore
 * requires a prior build (`turbo run build`, or `npm run build -w @geoleaf-plugins/offline-ui`).
 * Excluded from the main vitest.config.ts for exactly this reason.
 *
 * Deliberately bare next to vitest.config.ts: no happy-dom, no setup file, no `resolve.alias`
 * mock wall. This suite never imports the plugin's source — it reads one built file off disk and
 * greps it. A DOM and a pile of module mocks would be scenery, and the node environment is what
 * the assertions actually need.
 *
 * Usage: npm run test:bundle --workspace=@geoleaf-plugins/offline-ui
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: __dirname,

    test: {
        name: "@geoleaf-plugins/offline-ui:bundle",
        environment: "node",
        globals: true,

        include: ["__tests__/bundle.test.js"],
        exclude: ["**/node_modules/**", "**/dist/**"],

        // Vitest 4 removed `poolOptions`; `singleFork: true` is now maxWorkers:1 + isolate:false.
        pool: "forks",
        maxWorkers: 1,
        isolate: false,

        testTimeout: 30000,
        reporters: ["verbose"],
    },
});
