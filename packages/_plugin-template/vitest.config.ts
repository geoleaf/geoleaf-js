/**
 * Vitest configuration for __PLUGIN_PKG__
 */
// Side effect: ensure `--import tsx` in NODE_OPTIONS before workers spawn. MUST be first.
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
        name: "__PLUGIN_PKG__",
        environment: "happy-dom",
        globals: true,

        include: ["**/__tests__/**/*.test.ts"],
        exclude: ["**/node_modules/**", "**/dist/**"],

        pool: "vmForks",
        memoryLimit: "1/2",

        coverage: {
            provider: "istanbul",
            include: ["src/**/*.ts"],
            exclude: ["src/entry.ts", "src/public-api.ts"],
            reporter: ["text", "lcov", "html"],
            reportsDirectory: "./coverage",
            thresholds: {
                branches: 75,
                functions: 75,
                lines: 75,
                statements: 75,
            },
        },

        testTimeout: 10_000,
        reporters: ["verbose"],
    },
});
