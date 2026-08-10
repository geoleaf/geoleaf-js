/**
 * Vitest configuration for @geoleaf-plugins/connector
 *
 * Mirrors packages/plugin-storage/vitest.config.ts pattern:
 * - resolveJsToTs plugin: .js imports in source → resolved to .ts at test time
 * - vmForks pool: isolated VM context per test file (module-level state isolation)
 * - happy-dom environment: browser APIs (fetch, indexedDB, document, CustomEvent)
 * - globals: true — describe/it/expect/vi available without imports
 *
 * No resolve.alias needed: connector source never imports @core/* or @geoleaf/core.
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/connector",
    coverageExclude: ["src/**/*.d.ts"],
});
