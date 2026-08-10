/**
 * Vitest configuration for @geoleaf-plugins/measure
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/measure",
    coverageExclude: [
        "src/entry.ts",
        "src/lang/**",
        "src/public-api.ts",
        "src/internal.ts",
        // PLUGINS S1 — `src/touch-drag.ts` moved to @geoleaf/host-runtime, which carries
        // the exclusion and its motive now.
        "src/__tests__/**",
    ],
    setupFiles: ["./src/__tests__/canvas-setup.ts"],
});
