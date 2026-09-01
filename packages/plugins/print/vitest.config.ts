/**
 * Vitest configuration for @geoleaf-plugins/print
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/print",
    coverageExclude: [
        // Entry point (no logic, just re-exports)
        "src/entry.ts",
        "src/lang/**",
        // Modules excluded before they had suites
        "src/emprise-selector.ts",
        "src/flow.ts",
        // Facade wrappers — delegates covered by module-level tests
        "src/public-api.ts",
        // Utilities — covered via public-api tests
        "src/internal.ts",
        // Test helpers — not counted in production coverage
        "src/__tests__/**",
    ],
    setupFiles: ["./src/__tests__/canvas-setup.ts"],
});
