/**
 * Vitest configuration for @geoleaf-plugins/websocket
 *
 * Mirrors packages/plugin-connector/vitest.config.ts pattern:
 * - resolveJsToTs plugin: .js imports in source → resolved to .ts at test time
 * - vmForks pool: isolated VM context per test file (module-level state isolation)
 * - happy-dom environment: browser APIs (WebSocket, document, CustomEvent)
 * - globals: true — describe/it/expect/vi available without imports
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/websocket",
    coverageExclude: ["src/**/*.d.ts", "src/__tests__/**"],
});
