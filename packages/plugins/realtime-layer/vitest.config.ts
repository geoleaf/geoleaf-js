/**
 * Vitest configuration for @geoleaf-plugins/realtime-layer
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/realtime-layer",
    coverageExclude: ["src/**/*.d.ts", "src/__tests__/**"],
});
